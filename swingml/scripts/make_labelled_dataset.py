"""Turn the swings a golfer has labelled in the app into a training archive.

The model is fine-tuned on broadcast footage, and more of it stopped helping on
phone video: retrained on all 1,216 usable GolfDB clips it was better on
broadcast swings it had never seen and worse on the one phone clip whose
positions were checked by hand, because what it learnt was the broadcast
labellers' idea of where address is. Only labelled phone swings can say where
a phone golfer's is, and the app now lets the golfer mark them: move any
position to the right frame on the swing page, then confirm all eight.

This reads those confirmed swings - the landmarks the app kept and the eight
frames the golfer chose - and writes the same archive `make_golfdb_dataset.py`
writes, so `experiment.py --real-train`, `--holdout` and `compare.py` read it
unchanged. Nothing is tracked again: the landmarks are the ones the app
measured the swing from.

A swing is left out, with the reason printed, if two positions land on one
frame of the model's 60 Hz grid or the finish is the last frame, the same rule
the other corpora are filtered by.

    python scripts/make_labelled_dataset.py --out out/phone/labelled.npz
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.assets import home
from swingml.events import SwingEvent
from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.labels import GolferPositions, training_labels
from swingml.pose.base import PoseSequence
from swingml.skeleton import Handedness
from synth.dataset import label_frames


def build_one(
    sequence: PoseSequence, positions: GolferPositions, config: FeatureConfig
) -> tuple[NDArray[np.float32], NDArray[np.int64], dict[str, float]] | str:
    """Features and labelled event frames for one swing, or why it was left out."""
    resampled, grid = resample_pose(sequence, config.canonical_rate_hz)
    times = sequence.timestamps_s[list(positions.frames)]
    events = label_frames(times, grid, config.canonical_rate_hz, resampled.n_frames)
    if events is None:
        return "two positions fall on one 60 Hz frame, or the finish is the clip's last frame"
    top, address, impact = (
        int(SwingEvent.TOP),
        int(SwingEvent.ADDRESS),
        int(SwingEvent.IMPACT),
    )
    backswing = int(events[top]) - int(events[address])
    downswing = int(events[impact]) - int(events[top])
    steps = np.diff(sequence.timestamps_s)
    rate = float(1.0 / np.median(steps)) if steps.size else float("nan")
    detected = sequence.detected
    return (
        extract_features(resampled, positions.handedness, config),
        events,
        {
            "tempo_ratio": backswing / max(downswing, 1),
            "azimuth_deg": float("nan"),
            "capture_rate_hz": rate,
            "left_handed": float(positions.handedness is Handedness.LEFT),
            "landscape": float(sequence.frame_width > sequence.frame_height),
            "detection_rate": float(np.mean(detected)) if detected is not None else 1.0,
            "handedness_margin": float("nan"),
            "slow": 0.0,
            "golfdb_split": -1.0,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--frames",
        type=Path,
        default=None,
        help="the app's frames directory (default: frames/ under the app's home)",
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    root = args.frames or home() / "frames"
    config = FeatureConfig()
    features: list[NDArray[np.float32]] = []
    events: list[NDArray[np.int64]] = []
    seeds: list[int] = []
    meta: list[dict[str, float]] = []
    moved = np.zeros(len(SwingEvent.ordered()), dtype=np.int64)
    for swing_id, positions, sequence in training_labels(root):
        built = build_one(sequence, positions, config)
        if isinstance(built, str):
            print(f"  swing {swing_id}: left out, {built}")
            continue
        clip_features, clip_events, clip_meta = built
        features.append(clip_features)
        events.append(clip_events)
        seeds.append(swing_id)
        meta.append(clip_meta)
        moved += np.array(positions.moved, dtype=np.int64)

    if not features:
        raise SystemExit(
            f"no confirmed swings under {root}. On a swing's page, set any position "
            "that is wrong, tick 'All eight positions are right' and save."
        )

    def column(key: str) -> NDArray[np.float64]:
        return np.array([m[key] for m in meta], dtype=np.float64)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        lengths=np.array([f.shape[0] for f in features]),
        features=np.concatenate(features, axis=0),
        events=np.stack(events),
        seeds=np.array(seeds, dtype=np.int64),
        tempo_ratio=column("tempo_ratio"),
        azimuth_deg=column("azimuth_deg"),
        capture_rate_hz=column("capture_rate_hz"),
        left_handed=column("left_handed"),
        landscape=column("landscape"),
        detection_rate=column("detection_rate"),
        handedness_margin=column("handedness_margin"),
        slow=column("slow"),
        golfdb_split=column("golfdb_split"),
    )
    summary = {
        "swings": len(seeds),
        "swing_ids": seeds,
        "moved_by_the_golfer": {
            event.name.lower(): int(moved[int(event)]) for event in SwingEvent.ordered()
        },
    }
    args.out.with_suffix(".json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"wrote {args.out}: {len(seeds)} labelled swings")
    for event in SwingEvent.ordered():
        print(f"  {event.label:20s} moved by the golfer in {moved[int(event)]} of {len(seeds)}")


if __name__ == "__main__":
    main()
