"""Measure the error bands, then check them on clips they were not measured from.

The measurement and the check must not share data. A table fitted to a set of
errors will describe that set beautifully and say nothing about the next clip, so
the held-out clips are split in two: one half builds the table, the other half is
asked whether the table's promise holds. If the second half comes back near the
coverage the table claims, the bands mean what they say; if it comes back well
below, they do not, and the honest response is to widen them or report nothing.

Neither half is ever a clip the model trained on. That is the whole point: the
question is how far wrong the model is on footage it has not seen, and any
overlap with training turns the answer into an underestimate.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model
from swingml.events import NUM_EVENTS
from swingml.model.calibration import build_calibration, measure_coverage
from swingml.model.decode import decode_events
from swingml.quantity import NoReading


def load_clips(paths: list[Path]) -> list[tuple[np.ndarray, np.ndarray]]:
    """Every cached detected clip, as (features, true event frames)."""
    clips: list[tuple[np.ndarray, np.ndarray]] = []
    for path in paths:
        data = np.load(path)
        # Pulled out of the loop on purpose. Indexing an npz decompresses the whole
        # member every time, so reading it per clip turns a hundred megabytes into
        # tens of gigabytes of churn and gets the process killed.
        features = data["features"]
        events = data["events"]
        lengths = data["lengths"]
        offsets = np.concatenate(([0], np.cumsum(lengths)))
        for index, length in enumerate(lengths):
            clips.append((features[offsets[index] : offsets[index] + length], events[index]))
    return clips


def predict(
    model: torch.nn.Module, clips: list[tuple[np.ndarray, np.ndarray]]
) -> tuple[np.ndarray, np.ndarray, int]:
    """Run the model over clips, returning confidence and error, and a refusal count."""
    confidences: list[np.ndarray] = []
    errors: list[np.ndarray] = []
    refused = 0
    model.eval()
    with torch.no_grad():
        for features, truth in clips:
            logits = model(torch.from_numpy(features[None])).numpy()[0]
            decoded = decode_events(logits)
            if isinstance(decoded, NoReading):
                refused += 1
                continue
            confidences.append(np.asarray(decoded.confidence, dtype=np.float64))
            errors.append(np.abs(np.asarray(decoded.frames) - np.asarray(truth)).astype(np.float64))
    if not confidences:
        return np.empty((0, NUM_EVENTS)), np.empty((0, NUM_EVENTS)), refused
    return np.stack(confidences), np.stack(errors), refused


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, nargs="+", required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("out/calibration/events.json"))
    parser.add_argument(
        "--holdout",
        type=float,
        default=0.2,
        help="the tail fraction of each file the model was held out from during training",
    )
    parser.add_argument("--coverage", type=float, default=0.8)
    parser.add_argument("--bins", type=int, default=4)
    parser.add_argument(
        "--measured-on",
        default="rendered swings put through the same pose estimator",
        help="what the calibration clips were, in words a reader can judge",
    )
    args = parser.parse_args()

    torch.manual_seed(0)

    # Only the tail of each file was held out of fine-tuning, so only the tail may
    # be used here. Taking the whole file would calibrate partly on training data
    # and quietly promise a tighter band than the model can keep.
    clips: list[tuple[np.ndarray, np.ndarray]] = []
    for path in args.data:
        one_file = load_clips([path])
        split = int(len(one_file) * (1.0 - args.holdout))
        clips.extend(one_file[split:])
    print(f"{len(clips)} clips the model was held out from, across {len(args.data)} files")

    model = load_model(args.checkpoint)
    confidence, error, refused = predict(model, clips)
    print(f"{confidence.shape[0]} decoded, {refused} refused")
    if confidence.shape[0] < 4 * args.bins:
        raise SystemExit("too few clips to calibrate anything meaningful")

    # Split by clip, not by event: the eight events of one clip share its footage
    # and its difficulty, so scattering them across both halves would let the
    # table see the check's data through the back door.
    order = np.random.default_rng(0).permutation(confidence.shape[0])
    half = len(order) // 2
    fit, check = order[:half], order[half:]

    calibration = build_calibration(
        confidence[fit],
        error[fit],
        measured_on=args.measured_on,
        n_clips=len(fit),
        coverage=args.coverage,
        n_bins=args.bins,
    )
    print()
    print(calibration.report())

    observed = measure_coverage(calibration, confidence[check], error[check])
    print(f"\ncoverage on {len(check)} clips the table was not built from:")
    for label, value in observed.items():
        if label in {"all", "n"}:
            continue
        print(f"  {label:<22} {100 * value:5.1f}%")
    print(f"  {'all':<22} {100 * observed['all']:5.1f}%  over {int(observed['n'])} events")
    print(f"  {'claimed':<22} {100 * args.coverage:5.1f}%")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(calibration.model_dump_json(indent=2), encoding="utf-8")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
