"""Fine-tune the event model on landmarks the real estimator produced.

The model arrives already trained on many thousands of cheap synthetic swings,
which is where it learned what a swing looks like. What it has not seen is what
the pose estimator's output looks like, and that mismatch was the largest single
error in the pipeline.

Fine-tuning rather than retraining is deliberate. There are a few hundred
detected clips, not a few thousand, because each one costs seconds of rendering
and detection rather than milliseconds. A few hundred is far too few to learn a
swing from and quite enough to adapt to a change of input convention, which is
the standard reason to do this rather than start over.

The learning rate is well below the original run's and the schedule is short, for
the same reason: the aim is to move the model onto the new input distribution,
not to let it forget the distribution it generalised from.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model, save_model
from swingml.model.data import SwingDataset, collate, masked_soft_cross_entropy
from swingml.model.evaluate import decode_batch, evaluate_predictions
from swingml.skeleton import Handedness
from synth.dataset import Sample


def load_detected(path: Path) -> list[Sample]:
    """Unpack the cached detected clips back into the ordinary sample type."""
    data = np.load(path)
    # Pulled out of the loop: indexing an npz decompresses the whole member on
    # each access, which turns a large cache into tens of gigabytes of churn.
    features = data["features"]
    events = data["events"]
    left_handed = data["left_handed"]
    tempo_ratio = data["tempo_ratio"]
    capture_rate_hz = data["capture_rate_hz"]
    azimuth_deg = data["azimuth_deg"]
    lengths = data["lengths"]
    offsets = np.concatenate(([0], np.cumsum(lengths)))
    samples: list[Sample] = []
    for index, length in enumerate(lengths):
        samples.append(
            Sample(
                features=features[offsets[index] : offsets[index] + length],
                event_frames=events[index],
                handedness=(Handedness.LEFT if left_handed[index] > 0.5 else Handedness.RIGHT),
                tempo_ratio=float(tempo_ratio[index]),
                capture_rate_hz=float(capture_rate_hz[index]),
                azimuth_deg=float(azimuth_deg[index]),
            )
        )
    return samples


def evaluate(model: torch.nn.Module, loader: DataLoader[dict[str, torch.Tensor]]) -> object:
    model.eval()
    predictions: list[np.ndarray | None] = []
    truth: list[np.ndarray] = []
    with torch.no_grad():
        for batch in loader:
            logits = model(batch["features"]).numpy()
            predictions.extend(decode_batch(logits, batch["lengths"].numpy()))
            truth.extend(batch["events"].numpy())
    return evaluate_predictions(predictions, truth)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("out/detected/train.npz"))
    parser.add_argument("--checkpoint", type=Path, default=Path("out/events/swing_event_net.pt"))
    parser.add_argument("--out", type=Path, default=Path("out/finetuned"))
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=4e-5)
    parser.add_argument("--holdout", type=float, default=0.2)
    args = parser.parse_args()

    torch.manual_seed(0)
    args.out.mkdir(parents=True, exist_ok=True)

    samples = load_detected(args.data)
    split = int(len(samples) * (1.0 - args.holdout))
    train_samples, val_samples = samples[:split], samples[split:]
    print(f"{len(samples)} detected clips: {len(train_samples)} train, {len(val_samples)} held out")

    train_loader = DataLoader(
        SwingDataset(train_samples, feature_noise=0.01),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate,
    )
    val_loader = DataLoader(
        SwingDataset(val_samples), batch_size=args.batch_size, shuffle=False, collate_fn=collate
    )

    model = load_model(args.checkpoint)
    before = evaluate(model, val_loader)
    print("\nbefore fine-tuning, on held-out detected clips:")
    print(before.summary())  # type: ignore[attr-defined]

    optimiser = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimiser, T_max=args.epochs * max(len(train_loader), 1)
    )

    best = -1.0
    history: list[dict[str, float]] = []
    for epoch in range(args.epochs):
        model.train()
        total = 0.0
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
            total += float(loss.detach())

        accuracy = evaluate(model, val_loader)
        score = accuracy.correct_rate[2]  # type: ignore[attr-defined]
        history.append(
            {
                "epoch": epoch,
                "train_loss": total / max(len(train_loader), 1),
                "pce_1": accuracy.correct_rate[1],  # type: ignore[attr-defined]
                "pce_2": score,
                "pce_5": accuracy.correct_rate[5],  # type: ignore[attr-defined]
            }
        )
        print(
            f"epoch {epoch + 1:3d}/{args.epochs}  loss {total / max(len(train_loader), 1):.4f}  "
            f"within 1/2/5 frames "
            f"{100 * accuracy.correct_rate[1]:5.1f}/{100 * score:5.1f}/"  # type: ignore[attr-defined]
            f"{100 * accuracy.correct_rate[5]:5.1f}%",  # type: ignore[attr-defined]
            flush=True,
        )

        if score > best:
            best = score
            save_model(model, args.out / "swing_event_net.pt")

    after = evaluate(model, val_loader)
    print("\nafter fine-tuning, on the same held-out detected clips:")
    print(after.summary())  # type: ignore[attr-defined]
    (args.out / "metrics.json").write_text(
        json.dumps(
            {
                "history": history,
                "before": before.model_dump(),  # type: ignore[attr-defined]
                "after": after.model_dump(),  # type: ignore[attr-defined]
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out / 'swing_event_net.pt'}")


if __name__ == "__main__":
    main()
