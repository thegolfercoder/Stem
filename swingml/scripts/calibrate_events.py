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
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model, model_fingerprint
from swingml.events import NUM_EVENTS, SwingEvent
from swingml.model.calibration import (
    ModelCalibration,
    build_calibration,
    build_tempo_calibration,
    measure_coverage,
    measure_tempo_coverage,
)
from swingml.model.decode import decode_events
from swingml.model.ensemble import (
    SERVING_TIME_WARPS,
    EnsembleConfig,
    SwingEventEnsemble,
)
from swingml.model.tcn import SwingEventNet
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


def tempo_of(frames: np.ndarray) -> float:
    """Backswing over downswing, in whatever units the frames are counted in.

    The canonical grid is uniform, so frame counts stand in for durations here and
    the ratio is the same number the pipeline reports.
    """
    address, top, impact = (
        int(SwingEvent.ADDRESS),
        int(SwingEvent.TOP),
        int(SwingEvent.IMPACT),
    )
    downswing = frames[impact] - frames[top]
    return float(frames[top] - frames[address]) / float(max(downswing, 1))


def predict(
    model: SwingEventNet | SwingEventEnsemble, clips: list[tuple[np.ndarray, np.ndarray]]
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]:
    """Run the model over clips, returning confidence and error, and a refusal count.

    The bands must be measured through whatever will actually run at inference. An
    ensemble is more confident and more accurate than any of its members, so a
    table built from one member and quoted for the ensemble would be wrong in both
    directions at once.
    """
    confidences: list[np.ndarray] = []
    errors: list[np.ndarray] = []
    tempo_predicted: list[float] = []
    tempo_true: list[float] = []
    refused = 0
    if isinstance(model, torch.nn.Module):
        model.eval()
    with torch.no_grad():
        for features, truth in clips:
            logits = (
                model.logits(features)
                if isinstance(model, SwingEventEnsemble)
                else model(torch.from_numpy(features[None])).numpy()[0]
            )
            decoded = decode_events(logits)
            if isinstance(decoded, NoReading):
                refused += 1
                continue
            confidences.append(np.asarray(decoded.confidence, dtype=np.float64))
            errors.append(np.abs(np.asarray(decoded.frames) - np.asarray(truth)).astype(np.float64))
            tempo_predicted.append(tempo_of(np.asarray(decoded.frames)))
            tempo_true.append(tempo_of(np.asarray(truth)))
    if not confidences:
        empty = np.empty((0, NUM_EVENTS))
        return empty, empty, np.empty(0), np.empty(0), refused
    return (
        np.stack(confidences),
        np.stack(errors),
        np.asarray(tempo_predicted),
        np.asarray(tempo_true),
        refused,
    )


def select_clips(args: argparse.Namespace) -> list[tuple[np.ndarray, np.ndarray]]:
    """The clips to calibrate on, from the training run's own record where possible.

    A split file names exactly the clips that run set aside, in the order it
    pooled them, and is checked against the files and count it was written from -
    so a data file added or rebuilt since then fails here rather than producing a
    table measured partly on training data.
    """
    if args.split is None:
        # Fallback: the tail of each file. Correct only if training took the head,
        # which is what finetune_on_detected.py does and train_ensemble.py does not.
        clips: list[tuple[np.ndarray, np.ndarray]] = []
        for path in args.data:
            one_file = load_clips([path])
            cut = int(len(one_file) * (1.0 - args.holdout))
            clips.extend(one_file[cut:])
        print(f"{len(clips)} clips from the tail of {len(args.data)} files")
        return clips

    record = json.loads(args.split.read_text(encoding="utf-8"))
    pooled = load_clips([Path(p) for p in record["files"]])
    if len(pooled) != record["n_samples"]:
        raise SystemExit(
            f"the split file was written from {record['n_samples']} clips and these "
            f"files hold {len(pooled)}; the data has changed since training"
        )
    chosen = [pooled[i] for i in record["indices"]]
    print(f"{len(chosen)} clips set aside by the training run and used for nothing since")
    return chosen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, nargs="+", required=True)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        nargs="+",
        required=True,
        help="one checkpoint, or every member of the ensemble that will run",
    )
    parser.add_argument("--out", type=Path, default=Path("out/calibration/events.json"))
    parser.add_argument(
        "--split",
        type=Path,
        default=None,
        help=(
            "calibration_split.json written by train_ensemble.py, naming exactly the "
            "clips that run set aside. Strongly preferred over --holdout: it cannot "
            "silently disagree with what the model actually trained on"
        ),
    )
    parser.add_argument(
        "--holdout",
        type=float,
        default=0.2,
        help=(
            "fallback when there is no split file: the tail fraction of each data "
            "file the model was held out from"
        ),
    )
    parser.add_argument("--coverage", type=float, default=0.8)
    parser.add_argument("--bins", type=int, default=3)
    parser.add_argument(
        "--folds",
        type=int,
        default=5,
        help="folds for cross-checking the procedure before the final table is built",
    )
    parser.add_argument(
        "--measured-on",
        default="rendered swings put through the same pose estimator",
        help="what the calibration clips were, in words a reader can judge",
    )
    args = parser.parse_args()

    torch.manual_seed(0)

    clips = select_clips(args)

    if len(args.checkpoint) == 1:
        model: SwingEventNet | SwingEventEnsemble = load_model(args.checkpoint[0])
        print(f"calibrating {args.checkpoint[0]}")
    else:
        model = SwingEventEnsemble.load(
            list(args.checkpoint), EnsembleConfig(time_warps=SERVING_TIME_WARPS)
        )
        print(f"calibrating an ensemble of {len(args.checkpoint)} members, with time warping")
    confidence, error, tempo_predicted, tempo_true, refused = predict(model, clips)
    print(f"{confidence.shape[0]} decoded, {refused} refused")
    if confidence.shape[0] < 4 * args.bins:
        raise SystemExit("too few clips to calibrate anything meaningful")

    # Two things happen here, and they answer different questions.
    #
    # First the *procedure* is checked, by cross-validation. Each fold builds a
    # table from four fifths of the clips and measures how many of the remaining
    # fifth's errors land inside it; pooling the folds gives a coverage figure in
    # which every clip was checked against a table that had never seen it. A
    # single held-out half would do the same job in principle and cannot here: at
    # this corpus size half the clips leaves each bin below the count a band is
    # allowed to rest on, so the check would come back empty rather than
    # reassuring. Folds keep each fit large enough to answer.
    #
    # Then the table that ships is built from all of the clips. The procedure has
    # been shown to hold, so what the shipped table wants is the most data behind
    # each number, not a second and thinner demonstration of something already
    # demonstrated. This is worth saying out loud because the coverage figure
    # printed above belongs to the fold tables and not to this one.
    #
    # Folds are over clips, never over events: the eight events of one clip share
    # its footage and its difficulty, so splitting them apart would let a fold's
    # table see its own test data through the back door.
    order = np.random.default_rng(0).permutation(confidence.shape[0])
    folds = np.array_split(order, args.folds)
    inside = 0.0
    counted = 0.0
    thin = 0
    tempo_inside = 0.0
    tempo_counted = 0
    for held_out in folds:
        rest = np.setdiff1d(order, held_out)
        fold_table = build_calibration(
            confidence[rest],
            error[rest],
            measured_on=args.measured_on,
            n_clips=len(rest),
            coverage=args.coverage,
            n_bins=args.bins,
        )
        result = measure_coverage(fold_table, confidence[held_out], error[held_out])
        if result["n"]:
            inside += result["all"] * result["n"]
            counted += result["n"]
        else:
            thin += 1

        fold_tempo = build_tempo_calibration(
            tempo_predicted[rest],
            tempo_true[rest],
            measured_on=args.measured_on,
            coverage=args.coverage,
        )
        tempo_inside += measure_tempo_coverage(
            fold_tempo, tempo_predicted[held_out], tempo_true[held_out]
        ) * len(held_out)
        tempo_counted += len(held_out)

    print(f"\nthe procedure, cross-validated over {args.folds} folds:")
    if counted:
        print(
            f"  {100 * inside / counted:5.1f}% of {int(counted)} events fell inside a band "
            f"built without them"
        )
        print(f"  {100 * args.coverage:5.1f}% claimed")
    else:
        print("  no fold held enough clips per bin to check; the corpus is too small")
    if thin:
        print(f"  {thin} of {args.folds} folds were too thin to contribute")
    if tempo_counted:
        print(
            f"  tempo: {100 * tempo_inside / tempo_counted:5.1f}% of {tempo_counted} swings "
            f"fell inside a band built without them"
        )

    events = build_calibration(
        confidence,
        error,
        measured_on=args.measured_on,
        n_clips=confidence.shape[0],
        coverage=args.coverage,
        n_bins=args.bins,
    )
    tempo = build_tempo_calibration(
        tempo_predicted,
        tempo_true,
        measured_on=args.measured_on,
        coverage=args.coverage,
    )
    calibration = ModelCalibration(events=events, tempo=tempo, fingerprint=model_fingerprint(model))
    print(f"\nthe tables that ship, from all {confidence.shape[0]} clips:")
    print(events.report())
    median = float(np.median(np.abs(tempo_predicted - tempo_true) / tempo_true))
    print(f"\n  tempo ratio           {tempo}")
    print(f"    median relative error {100 * median:.1f}%")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(calibration.model_dump_json(indent=2), encoding="utf-8")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
