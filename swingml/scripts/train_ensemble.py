"""Train an ensemble on every real-domain clip available, with augmentation.

Three things stack here, and they are worth separating because they buy different
amounts.

**The domain.** The model runs on landmarks from a real pose estimator, so it is
fine-tuned on landmarks from a real pose estimator. This was measured to be the
dominant error in the whole pipeline: the same swing scored half a frame through
synthetic landmarks and several frames through MediaPipe's.

**Augmentation.** A few hundred real-domain clips is not many, and each can stand
in for a great many by being played faster or slower, jittered, occluded and
cropped. The physics is kept honest - warping time rescales the channels measured
per second and leaves the ones measuring a shape alone - because an augmentation
that produces impossible input teaches the model to expect it.

**The ensemble.** Members start from the same synthetic pretraining and diverge
through their fine-tuning seed and the augmentations they happen to see. That is
less diversity than training each from scratch and costs a fraction as much, and
averaging what they do agree on still removes a good deal of individual error.
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

from swingml.analysis import load_model, save_model
from swingml.features import feature_dimension
from swingml.model.augment import AugmentConfig
from swingml.model.data import SwingDataset, collate, masked_soft_cross_entropy
from swingml.model.ensemble import SERVING_TIME_WARPS, EnsembleConfig, SwingEventEnsemble
from swingml.model.evaluate import EventAccuracy, decode_batch, evaluate_predictions
from swingml.model.tcn import SwingEventNet
from swingml.skeleton import Handedness
from synth.dataset import Sample

SPLIT_SEED = 17


def load_detected(paths: list[Path]) -> list[Sample]:
    """Every cached real-domain clip, from however many files they were built in."""
    samples: list[Sample] = []
    for path in paths:
        if not path.is_file():
            continue
        data = np.load(path)
        # Every member of this archive is pulled out once. Indexing an npz
        # decompresses the whole member on each access, so reading them inside
        # the loop turns a hundred megabytes into tens of gigabytes of churn.
        features = data["features"]
        events = data["events"]
        left_handed = data["left_handed"]
        tempo_ratio = data["tempo_ratio"]
        capture_rate_hz = data["capture_rate_hz"]
        azimuth_deg = data["azimuth_deg"]
        lengths = data["lengths"]
        offsets = np.concatenate(([0], np.cumsum(lengths)))
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


def split(
    samples: list[Sample], holdout: float, calibration: float, seed: int
) -> tuple[list[int], list[int], list[int]]:
    """Three disjoint sets of indices: train, validate, calibrate.

    Two held-out sets rather than one, because they answer different questions and
    sharing them would flatter the answer. The validation set picks each member's
    best epoch, so by the end the members have been fitted to it - loosely, but
    enough that the errors they make on it are smaller than the errors they will
    make on a clip nobody has looked at. Error bands measured there would be too
    tight, and a band that is too tight is the one failure the whole calibration
    exists to avoid. So a third set is set aside at the start and touched by
    nothing until the bands are measured.

    The same permutation for every member, so the ensemble is judged on clips none
    of its members has seen.
    """
    order = [int(i) for i in np.random.default_rng(seed).permutation(len(samples))]
    n_calibration = int(len(samples) * calibration)
    n_validation = int(len(samples) * holdout)
    calibrate = order[:n_calibration]
    validate = order[n_calibration : n_calibration + n_validation]
    train = order[n_calibration + n_validation :]
    return train, validate, calibrate


def evaluate_model(
    model: SwingEventNet | SwingEventEnsemble, samples: list[Sample]
) -> EventAccuracy:
    predictions: list[np.ndarray | None] = []
    truth: list[np.ndarray] = []
    for sample in samples:
        if isinstance(model, SwingEventEnsemble):
            logits = model.logits(sample.features)[None, ...]
        else:
            model.eval()
            with torch.no_grad():
                logits = model(torch.from_numpy(sample.features)[None, ...]).numpy()
        lengths = np.array([sample.features.shape[0]])
        predictions.extend(decode_batch(logits, lengths))
        truth.append(sample.event_frames)
    return evaluate_predictions(predictions, truth)


def train_member(
    base: Path,
    train_samples: list[Sample],
    validation: list[Sample],
    seed: int,
    epochs: int,
    learning_rate: float,
    batch_size: int,
    augment: AugmentConfig,
) -> SwingEventNet:
    torch.manual_seed(seed)
    model = load_model(base) if base.is_file() else SwingEventNet(feature_dimension())

    dataset = SwingDataset(train_samples, rng_seed=seed, augment=augment)
    loader = DataLoader(
        dataset, batch_size=batch_size, shuffle=True, collate_fn=collate, drop_last=False
    )
    optimiser = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimiser, T_max=max(1, epochs * len(loader))
    )

    best_state = {k: v.clone() for k, v in model.state_dict().items()}
    best_score = -1.0

    for epoch in range(epochs):
        model.train()
        total = 0.0
        for batch in loader:
            optimiser.zero_grad()
            logits = model(batch["features"])
            loss = masked_soft_cross_entropy(
                logits, batch["target"], batch["weight"], batch["mask"]
            )
            loss.backward()  # type: ignore[no-untyped-call]
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            schedule.step()
            total += float(loss.item())

        report = evaluate_model(model, validation)
        score = report.within_2
        if score > best_score:
            best_score = score
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        mean_loss = total / max(len(loader), 1)
        within_1 = report.within_1 * 100
        print(
            f"    member {seed} epoch {epoch + 1:3d}/{epochs}  loss {mean_loss:.4f}"
            f"  within 1/2 {within_1:5.1f}/{score * 100:5.1f}%",
            flush=True,
        )

    model.load_state_dict(best_state)
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, nargs="+", default=[Path("out/detected/train.npz")])
    parser.add_argument("--base", type=Path, default=Path("out/events/swing_event_net.pt"))
    parser.add_argument("--out", type=Path, default=Path("out/ensemble"))
    parser.add_argument("--members", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=45)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=6e-5)
    parser.add_argument(
        "--holdout",
        type=float,
        default=0.15,
        help="fraction used to choose each member's best epoch",
    )
    parser.add_argument(
        "--calibration",
        type=float,
        default=0.15,
        help=(
            "fraction set aside, and used for nothing during training, so that "
            "error bands can be measured on clips no part of this run has seen"
        ),
    )
    parser.add_argument("--no-augment", action="store_true")
    args = parser.parse_args()

    samples = load_detected(args.data)
    if not samples:
        print("no cached clips found; build some with make_detected_dataset.py", file=sys.stderr)
        raise SystemExit(1)

    train_index, validation_index, calibration_index = split(
        samples, args.holdout, args.calibration, seed=SPLIT_SEED
    )
    train_samples = [samples[i] for i in train_index]
    validation = [samples[i] for i in validation_index]
    print(
        f"{len(samples)} real-domain clips: {len(train_samples)} to train on, "
        f"{len(validation)} to choose epochs with, {len(calibration_index)} kept back "
        f"untouched for measuring error bands"
    )
    azimuths = np.array([s.azimuth_deg for s in samples])
    print(
        f"camera angles: {np.percentile(azimuths, 5):.0f} to {np.percentile(azimuths, 95):.0f} "
        f"degrees, median {np.median(azimuths):.0f}"
    )

    augment = AugmentConfig(enabled=not args.no_augment)
    print(f"augmentation {'on' if augment.enabled else 'off'}\n")

    args.out.mkdir(parents=True, exist_ok=True)
    members: list[SwingEventNet] = []
    started = time.time()
    for index in range(args.members):
        print(f"  training member {index + 1} of {args.members}")
        model = train_member(
            args.base,
            train_samples,
            validation,
            seed=100 + index,
            epochs=args.epochs,
            learning_rate=args.learning_rate,
            batch_size=args.batch_size,
            augment=augment,
        )
        path = args.out / f"member_{index}.pt"
        save_model(model, path)
        members.append(model)
        print(f"    saved {path}\n")

    print(f"trained {len(members)} members in {(time.time() - started) / 60:.0f} min\n")

    print("held-out clips, each member alone:")
    for index, model in enumerate(members):
        print(f"  member {index}: {evaluate_model(model, validation)}")

    for warps in ((1.0,), SERVING_TIME_WARPS):
        ensemble = SwingEventEnsemble(members, EnsembleConfig(time_warps=warps))
        label = "ensemble" if warps == (1.0,) else "ensemble + test-time warping"
        print(f"\n{label}:")
        print(evaluate_model(ensemble, validation).report())

    (args.out / "members.json").write_text(
        json.dumps([f"member_{i}.pt" for i in range(len(members))], indent=2), encoding="utf-8"
    )
    # Written out rather than left to be recomputed. Reproducing this split in the
    # calibration script would mean two places agreeing about a permutation, and
    # the day they stopped agreeing the bands would quietly be measured on
    # training data and come out too tight with nothing to show for it.
    (args.out / "calibration_split.json").write_text(
        json.dumps(
            {
                "files": [str(p) for p in args.data],
                "seed": SPLIT_SEED,
                "n_samples": len(samples),
                "indices": calibration_index,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
