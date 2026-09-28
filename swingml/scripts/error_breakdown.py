"""Where a model's error on real swings comes from, broken down until it can be acted on.

"Accuracy within one frame" is one number standing for several different
failures: a pose estimator losing the hands through impact, a camera angle the
model saw little of, a slow-motion clip, a label convention the model disagrees
with. They have different fixes, so this splits the error by the layer and the
condition it comes from rather than reporting it as one quantity.

Three views of the same predictions:

- by event, signed as well as absolute, so a systematic lean (an address always
  placed early) is told apart from scatter;
- by capture condition: camera view, slow motion, handedness, how well the
  estimator saw the wrists at the true impact, and how often it found the body;
- by counterfactual repair: the tempo error that would remain if one event were
  placed exactly right and everything else left alone. The event whose repair
  removes the most tempo error is the largest source of it, which is the ranking
  the product needs, because tempo is the headline number.

Every clip is scored whether or not the model would have refused it; refusal is
measured separately (`release_gate`), so a model cannot look accurate here by
declining the hard clips.

    python scripts/error_breakdown.py --model swingml/data/swing_event_net.pt \\
        --clips out/golfdb/split/holdout.npz --out docs/audit/error-breakdown.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.events import SwingEvent
from swingml.features import feature_layout
from swingml.skeleton import SWING_LANDMARKS, Landmark

EVENTS = [event.label for event in SwingEvent.ordered()]
CORE = (0, 3, 4, 5)
"""Address, top, mid-downswing and impact: the events the tempo ratio is built from."""


class Clip:
    """One clip's truth, prediction and capture conditions."""

    def __init__(
        self,
        truth: NDArray[np.int64],
        predicted: NDArray[np.float64],
        conditions: dict[str, float],
    ) -> None:
        self.truth = truth
        self.predicted = predicted
        self.conditions = conditions

    @property
    def signed(self) -> NDArray[np.float64]:
        return self.predicted - self.truth

    @property
    def absolute(self) -> NDArray[np.float64]:
        return np.abs(np.rint(self.predicted) - self.truth)


def tempo(frames: NDArray[np.float64] | NDArray[np.int64]) -> float:
    back = float(frames[3] - frames[0])
    down = float(frames[5] - frames[3])
    return back / down if down > 0 else float("inf")


def tempo_error(predicted: NDArray[np.float64], truth: NDArray[np.int64]) -> float:
    true = tempo(truth)
    return abs(tempo(predicted) - true) / true


def read_conditions(path: Path) -> list[dict[str, float]]:
    """Per-clip capture conditions, from the archive's own columns and features."""
    data = dict(np.load(path))  # decompressed once, not once per clip
    layout = feature_layout()
    visibility_start = layout.visibility[0]
    wrists = [SWING_LANDMARKS.index(w) for w in (Landmark.LEFT_WRIST, Landmark.RIGHT_WRIST)]
    offsets = np.concatenate(([0], np.cumsum(data["lengths"])))
    out: list[dict[str, float]] = []
    for index in range(len(data["lengths"])):
        features = data["features"][offsets[index] : offsets[index + 1]]
        impact = int(data["events"][index][5])
        window = features[max(0, impact - 2) : impact + 3]
        wrist_visibility = float(window[:, [visibility_start + w for w in wrists]].mean())
        out.append(
            {
                "clip_id": float(data["seeds"][index]),
                "azimuth_deg": float(data["azimuth_deg"][index]),
                "slow": float(data["slow"][index]) if "slow" in data else float("nan"),
                "left_handed": float(data["left_handed"][index]),
                "detection_rate": float(data["detection_rate"][index]),
                "capture_rate_hz": float(data["capture_rate_hz"][index]),
                "tempo_ratio": float(data["tempo_ratio"][index]),
                "wrist_visibility_at_impact": wrist_visibility,
            }
        )
    return out


def predict(model_path: Path, paths: Sequence[Path]) -> list[Clip]:
    from swingml.analysis import load_model
    from swingml.model.benchmark import load_samples, predict_events, subframe_positions

    model = load_model(model_path)
    clips: list[Clip] = []
    for path in paths:
        samples = load_samples([path])
        decoded = predict_events(model, samples)
        for sample, events, conditions in zip(samples, decoded, read_conditions(path), strict=True):
            if events is None:
                # Scored as refused rather than silently dropped.
                conditions = {**conditions, "refused_by_decoder": 1.0}
                continue
            clips.append(
                Clip(np.asarray(sample.event_frames), subframe_positions(events), conditions)
            )
    return clips


def summarise(clips: Sequence[Clip]) -> dict[str, object]:
    if not clips:
        return {"n": 0}
    absolute = np.stack([c.absolute for c in clips])
    signed = np.stack([c.signed for c in clips])
    tempo_errors = np.array([tempo_error(c.predicted, c.truth) for c in clips])
    return {
        "n": len(clips),
        "within_1_all8": round(float((absolute <= 1).mean()), 4),
        "within_1_core4": round(float((absolute[:, CORE] <= 1).mean()), 4),
        "within_2_core4": round(float((absolute[:, CORE] <= 2).mean()), 4),
        "tempo_median_rel_error": round(float(np.median(tempo_errors)), 4),
        "tempo_p80_rel_error": round(float(np.percentile(tempo_errors, 80)), 4),
        "median_abs_error_frames": {
            e: round(float(v), 2) for e, v in zip(EVENTS, np.median(absolute, axis=0), strict=True)
        },
        "median_signed_error_frames": {
            e: round(float(v), 2) for e, v in zip(EVENTS, np.median(signed, axis=0), strict=True)
        },
    }


def repairs(clips: Sequence[Clip]) -> dict[str, float]:
    """Median tempo error if one event were placed exactly right, the rest untouched."""
    out = {"none": float(np.median([tempo_error(c.predicted, c.truth) for c in clips]))}
    for index in (0, 3, 5):
        fixed = []
        for c in clips:
            predicted = c.predicted.copy()
            predicted[index] = c.truth[index]
            fixed.append(tempo_error(predicted, c.truth))
        out[EVENTS[index]] = float(np.median(fixed))
    return {k: round(v, 4) for k, v in out.items()}


def slices(clips: Sequence[Clip]) -> dict[str, dict[str, object]]:
    def split(
        name: str, groups: dict[str, Callable[[dict[str, float]], bool]]
    ) -> dict[str, object]:
        return {
            label: summarise([c for c in clips if test(c.conditions)])
            for label, test in groups.items()
        }

    visibility = np.array([c.conditions["wrist_visibility_at_impact"] for c in clips])
    low, high = np.percentile(visibility, [33.3, 66.7])
    return {
        "camera_view": split(
            "view",
            {
                "face_on": lambda c: c["azimuth_deg"] == 0.0,
                "down_the_line": lambda c: c["azimuth_deg"] == 90.0,
                "other": lambda c: not np.isfinite(c["azimuth_deg"]),
            },
        ),
        "slow_motion": split(
            "slow",
            {"slow_motion": lambda c: c["slow"] > 0.5, "real_time": lambda c: c["slow"] <= 0.5},
        ),
        "handedness": split(
            "hand",
            {"left": lambda c: c["left_handed"] > 0.5, "right": lambda c: c["left_handed"] <= 0.5},
        ),
        "wrist_visibility_at_impact": split(
            "wrist",
            {
                f"lowest_third_below_{low:.2f}": lambda c: c["wrist_visibility_at_impact"] < low,
                "middle_third": lambda c: low <= c["wrist_visibility_at_impact"] < high,
                f"highest_third_from_{high:.2f}": lambda c: c["wrist_visibility_at_impact"] >= high,
            },
        ),
        "true_tempo": split(
            "tempo",
            {
                "below_3.0": lambda c: c["tempo_ratio"] < 3.0,
                "3.0_to_4.0": lambda c: 3.0 <= c["tempo_ratio"] < 4.0,
                "4.0_and_above": lambda c: c["tempo_ratio"] >= 4.0,
            },
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--clips", type=Path, nargs="+", required=True)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    clips = predict(args.model, args.clips)
    report = {
        "model": str(args.model),
        "clips": [str(p) for p in args.clips],
        "overall": summarise(clips),
        "tempo_error_if_one_event_were_exact": repairs(clips),
        "by_condition": slices(clips),
    }
    text = json.dumps(report, indent=2)
    print(text)
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")


if __name__ == "__main__":
    main()
