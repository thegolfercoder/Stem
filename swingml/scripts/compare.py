"""Two models on the same clips, and whether the difference between them is real.

Every improvement in this project has been a few points on a few hundred clips,
which is the regime where a difference can be entirely the luck of which clips
were drawn. The holdout is 160 clips; a two-point gap across 160 clips is
comfortably inside what resampling the same model against itself produces. Saying
so out loud is the difference between an experiment and a story.

The comparison is paired: both models answer the same clips, the difference is
taken per clip, and the resampling is over clips rather than over events. Events
within one clip stand or fall together - a model that puts address ten frames
early usually gets toe-up wrong too - so treating 1,280 events as 1,280
independent draws would report an interval several times narrower than the truth.

Refusals are counted, reported, and then set aside: the paired statistics are
taken over the clips both models answered, because a difference computed over
different clips for each model is not a difference.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model
from swingml.model.benchmark import TOLERANCES, load_samples, predict_frames, tempo_of
from swingml.model.ensemble import SERVING_TIME_WARPS, EnsembleConfig, SwingEventEnsemble
from synth.dataset import Sample

RESAMPLES = 4000


def load_any(path: Path) -> torch.nn.Module | SwingEventEnsemble:
    """A checkpoint, or a directory of ensemble members.

    A directory is loaded at the serving time warps rather than at 1.0, because
    the question being asked is always what the shipped thing would do.
    """
    if path.is_dir():
        members = sorted(path.glob("member_*.pt")) or sorted(path.glob("*.pt"))
        if not members:
            raise SystemExit(f"no checkpoints in {path}")
        return SwingEventEnsemble.load(members, EnsembleConfig(time_warps=SERVING_TIME_WARPS))
    return load_model(path)


def per_clip(
    predictions: list[NDArray[np.int64] | None], samples: list[Sample]
) -> dict[str, NDArray[np.float64]]:
    """One number per clip per metric, which is what may be resampled."""
    within: dict[int, list[float]] = {t: [] for t in TOLERANCES}
    tempo: list[float] = []
    for prediction, sample in zip(predictions, samples, strict=True):
        truth = np.asarray(sample.event_frames)
        error = np.abs(np.asarray(prediction) - truth)
        for tolerance in TOLERANCES:
            within[tolerance].append(float((error <= tolerance).mean()))
        true_tempo = tempo_of(truth)
        tempo.append(abs(tempo_of(np.asarray(prediction)) - true_tempo) / max(true_tempo, 1e-9))
    out = {f"within_{t}": np.asarray(within[t]) for t in TOLERANCES}
    out["tempo"] = np.asarray(tempo)
    return out


def interval(samples: NDArray[np.float64]) -> tuple[float, float]:
    return float(np.percentile(samples, 2.5)), float(np.percentile(samples, 97.5))


def compare(
    a: dict[str, NDArray[np.float64]],
    b: dict[str, NDArray[np.float64]],
    resamples: int,
    seed: int,
) -> None:
    n = len(next(iter(a.values())))
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, n, size=(resamples, n))

    print(f"\n  {n} clips both models answered, {resamples} resamples")
    print("  metric        A        B      difference (95% interval)      B better in")
    for key in [f"within_{t}" for t in TOLERANCES] + ["tempo"]:
        # The median for tempo, the mean for a share. A mean relative tempo error
        # is dominated by the handful of clips where a model reads the swing
        # completely wrong, which says something worth knowing but not this.
        reduce = np.median if key == "tempo" else np.mean
        better_is = "lower" if key == "tempo" else "higher"
        left, right = a[key], b[key]
        point = float(reduce(right)) - float(reduce(left))
        resampled = np.array(
            [float(reduce(right[draw])) - float(reduce(left[draw])) for draw in draws]
        )
        low, high = interval(resampled)
        share = float((resampled < 0).mean() if better_is == "lower" else (resampled > 0).mean())
        significant = "*" if (low > 0.0) == (high > 0.0) else " "
        print(
            f"  {key:<10} {100 * float(reduce(left)):6.2f}%  {100 * float(reduce(right)):6.2f}%   "
            f"{100 * point:+6.2f}%  [{100 * low:+6.2f}, {100 * high:+6.2f}]{significant}  "
            f"{100 * share:5.1f}%"
        )
    print("  * the interval excludes zero, so the sign of the difference is resolved")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--a", type=Path, required=True, help="checkpoint or ensemble directory")
    parser.add_argument("--b", type=Path, required=True, help="the one being argued for")
    parser.add_argument("--clips", type=Path, nargs="+", required=True)
    parser.add_argument("--resamples", type=int, default=RESAMPLES)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    samples = load_samples(args.clips)
    if not samples:
        raise SystemExit("no clips")
    print(f"{len(samples)} clips from {', '.join(p.name for p in args.clips)}")

    predictions = {}
    for label, path in (("A", args.a), ("B", args.b)):
        predictions[label] = predict_frames(load_any(path), samples)
        refused = sum(p is None for p in predictions[label])
        print(f"  {label}: {path}  {refused} refused")

    both = [
        i
        for i in range(len(samples))
        if predictions["A"][i] is not None and predictions["B"][i] is not None
    ]
    if len(both) < len(samples):
        print(f"  {len(samples) - len(both)} clips one model refused, set aside")

    kept = [samples[i] for i in both]
    compare(
        per_clip([predictions["A"][i] for i in both], kept),
        per_clip([predictions["B"][i] for i in both], kept),
        args.resamples,
        args.seed,
    )


if __name__ == "__main__":
    main()
