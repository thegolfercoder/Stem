"""Train the swing-event model on generated swings and measure what it learned.

Reports the constrained decoder against the unconstrained one on the same
predictions, because the difference between them is the clearest evidence for
whether encoding the ordering was worth doing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.features import CANONICAL_RATE_HZ, feature_dimension
from swingml.model.data import SwingDataset, collate, masked_soft_cross_entropy
from swingml.model.evaluate import (
    EventAccuracy,
    decode_batch,
    evaluate_predictions,
    greedy_batch,
)
from swingml.model.tcn import SwingEventNet
from synth.dataset import generate_dataset


def run_validation(
    model: SwingEventNet, loader: DataLoader[dict[str, torch.Tensor]]
) -> tuple[EventAccuracy, EventAccuracy, float]:
    model.eval()
    dp_predictions: list[np.ndarray | None] = []
    greedy_predictions: list[np.ndarray | None] = []
    truth: list[np.ndarray] = []
    total_loss = 0.0
    n_batches = 0

    with torch.no_grad():
        for batch in loader:
            logits = model(batch["features"])
            total_loss += float(
                masked_soft_cross_entropy(logits, batch["target"], batch["weight"], batch["mask"])
            )
            n_batches += 1
            numpy_logits = logits.numpy()
            lengths = batch["lengths"].numpy()
            dp_predictions.extend(decode_batch(numpy_logits, lengths))
            greedy_predictions.extend(greedy_batch(numpy_logits, lengths))
            truth.extend(batch["events"].numpy())

    dp = evaluate_predictions(dp_predictions, truth)
    greedy = evaluate_predictions(greedy_predictions, truth)
    return dp, greedy, total_loss / max(n_batches, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-samples", type=int, default=5000)
    parser.add_argument("--val-samples", type=int, default=700)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--channels", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--sigma-frames", type=float, default=2.0)
    parser.add_argument("--feature-noise", type=float, default=0.01)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--out", type=Path, default=Path("out/events"))
    args = parser.parse_args()

    if args.threads:
        torch.set_num_threads(args.threads)
    torch.manual_seed(0)
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"generating {args.train_samples} training and {args.val_samples} validation swings")
    started = time.time()
    train_samples = generate_dataset(args.train_samples, seed_offset=0)
    # Validation seeds sit far from training seeds so no swing appears in both.
    val_samples = generate_dataset(args.val_samples, seed_offset=10_000_000)
    print(f"  generated in {time.time() - started:.0f}s")

    train_loader = DataLoader(
        SwingDataset(
            train_samples, sigma_frames=args.sigma_frames, feature_noise=args.feature_noise
        ),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate,
    )
    val_loader = DataLoader(
        SwingDataset(val_samples, sigma_frames=args.sigma_frames),
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate,
    )

    model = SwingEventNet(feature_dimension(), channels=args.channels)
    print(
        f"model: {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M parameters, "
        f"receptive field {model.receptive_field} frames "
        f"({model.receptive_field / CANONICAL_RATE_HZ:.2f}s)"
    )

    optimiser = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimiser,
        max_lr=args.learning_rate,
        total_steps=args.epochs * len(train_loader),
        pct_start=0.2,
    )

    history: list[dict[str, float]] = []
    best_score = -1.0

    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0
        epoch_started = time.time()
        for batch in train_loader:
            optimiser.zero_grad(set_to_none=True)
            logits = model(batch["features"])
            loss = masked_soft_cross_entropy(
                logits, batch["target"], batch["weight"], batch["mask"]
            )
            loss.backward()  # type: ignore[no-untyped-call]
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            schedule.step()
            epoch_loss += float(loss.detach())

        dp, _, val_loss = run_validation(model, val_loader)
        score = dp.correct_rate[2]
        history.append(
            {
                "epoch": epoch,
                "train_loss": epoch_loss / len(train_loader),
                "val_loss": val_loss,
                "pce_1": dp.correct_rate[1],
                "pce_2": dp.correct_rate[2],
                "pce_5": dp.correct_rate[5],
                "seconds": time.time() - epoch_started,
            }
        )
        print(
            f"epoch {epoch + 1:3d}/{args.epochs}  train {epoch_loss / len(train_loader):.4f}  "
            f"val {val_loss:.4f}  within 1/2/5 frames "
            f"{100 * dp.correct_rate[1]:5.1f}/{100 * dp.correct_rate[2]:5.1f}/"
            f"{100 * dp.correct_rate[5]:5.1f}%  ({time.time() - epoch_started:.0f}s)",
            flush=True,
        )

        if score > best_score:
            best_score = score
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "in_features": feature_dimension(),
                    "channels": args.channels,
                    "canonical_rate_hz": CANONICAL_RATE_HZ,
                    "epoch": epoch,
                    "pce_2": score,
                },
                args.out / "swing_event_net.pt",
            )

    dp, greedy, _ = run_validation(model, val_loader)
    print("\nfinal, ordered decoding:")
    print(dp.summary())
    print("\nsame predictions, unconstrained per-event maximum:")
    print(greedy.summary())
    print(
        f"\nordering violations: constrained {dp.ordering_violations}, "
        f"greedy {greedy.ordering_violations}"
    )

    (args.out / "metrics.json").write_text(
        json.dumps(
            {
                "history": history,
                "final_dp": dp.model_dump(),
                "final_greedy": greedy.model_dump(),
                "args": {k: str(v) for k, v in vars(args).items()},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out / 'metrics.json'} and {args.out / 'swing_event_net.pt'}")


if __name__ == "__main__":
    main()
