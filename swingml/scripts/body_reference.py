"""What tour swings read as for head movement, pelvis sway and shoulder turn (#12).

Only tempo has a reference today (`swingml.insights.reference.TOUR_TEMPO_READINGS`),
so it is the only measure the practice loop can suggest from the numbers; the
other focuses wait for the golfer to choose them. This measures the other three
the way tempo's was measured: the readings the shipped pipeline gives tour
swings, not a textbook value, so a golfer's reading is compared with readings
that carry the same biases.

Every face-on clip of `golfdb-validation-v2` and `golfdb-calibration-v2` (used
to choose and calibrate models, never to train them, and never the holdout) is
run through the whole pipeline: MediaPipe on the clip, then the app's decision
and metrics. Down-the-line and other views are left out: these three are read
from the picture, and the picture depends on where the camera is. Handedness is
GolfDB's label, not the app's guess, so a handedness miss does not enter the
reference. Percentiles carry 95% intervals that resample golfer/video groups.

    python scripts/body_reference.py --videos <GolfDB videos_160> \\
        --out ../docs/audit/body-reference.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import (
    AnalysisConfig,
    analyse_video,
    load_model,
    model_fingerprint,
)
from swingml.assets import find_event_model
from swingml.dataset.manifest import (
    group_resamples,
    load,
    refuse_holdout_manifest,
    verify,
)
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

MEASURES = {
    "head_movement": "body lengths",
    "pelvis_sway": "body lengths",
    "shoulder_turn_foreshortened": "deg",
}
MANIFESTS = ("golfdb-validation-v2", "golfdb-calibration-v2")


def face_on_clips(manifest_path: Path, root: Path) -> list[tuple[int, bool, str]]:
    """(GolfDB clip id, left-handed, group) of every face-on clip of one split."""
    manifest = load(manifest_path)
    refuse_holdout_manifest(manifest)
    with np.load(verify(manifest, root)) as data:
        ids, azimuth, left = data["seeds"], data["azimuth_deg"], data["left_handed"]
        return [
            (int(ids[i]), bool(left[i] > 0.5), manifest.groups[i])
            for i in range(len(ids))
            if azimuth[i] == 0.0
        ]


def percentiles(values: np.ndarray, groups: list[str], resamples: int, seed: int) -> dict[str, Any]:
    point = np.percentile(values, [10, 50, 90])
    draws = np.array(
        [
            np.percentile(values[idx], [10, 50, 90])
            for idx in group_resamples(groups, resamples, np.random.default_rng(seed))
        ]
    )
    out: dict[str, Any] = {"n_swings": len(values), "n_groups": len(set(groups))}
    for k, name in enumerate(("p10", "p50", "p90")):
        low, high = np.percentile(draws[:, k], [2.5, 97.5])
        out[name] = round(float(point[k]), 3)
        out[f"{name}_ci95"] = [round(float(low), 3), round(float(high), 3)]
    return out


def main(argv: list[str] | None = None) -> dict[str, Any]:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--videos", type=Path, required=True, help="GolfDB videos_160")
    parser.add_argument("--manifests", type=Path, default=Path("swingml/manifests"))
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--resamples", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)

    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped event model found")
    model = load_model(path)
    estimator = MediaPipePoseEstimator()
    readings: dict[str, list[tuple[float, str]]] = {m: [] for m in MEASURES}
    refused: dict[str, int] = {m: 0 for m in MEASURES}
    clips = [
        clip
        for name in MANIFESTS
        for clip in face_on_clips(args.manifests / f"{name}.json", args.root)
    ]
    for done, (clip, left, group) in enumerate(clips, start=1):
        hand = Handedness.LEFT if left else Handedness.RIGHT
        config = AnalysisConfig(handedness=hand)
        analysis = analyse_video(args.videos / f"{clip}.mp4", model, estimator, config)
        metrics = analysis.metrics
        for measure in MEASURES:
            reading = None if isinstance(metrics, NoReading) else getattr(metrics, measure)
            if reading is None or isinstance(reading, NoReading):
                refused[measure] += 1
            else:
                readings[measure].append((float(reading.value), group))
        if done % 10 == 0:
            print(f"  {done}/{len(clips)} clips", flush=True)

    result: dict[str, Any] = {
        "source": f"face-on clips of {' and '.join(MANIFESTS)}, through the shipped pipeline",
        "model_fingerprint": model_fingerprint(model),
        "n_clips": len(clips),
        "measures": {},
    }
    for measure, unit in MEASURES.items():
        values = np.array([v for v, _ in readings[measure]])
        entry = percentiles(values, [g for _, g in readings[measure]], args.resamples, args.seed)
        entry.update(unit=unit, refused=refused[measure])
        result["measures"][measure] = entry
        print(
            f"{measure:28s} n={entry['n_swings']:3d} (refused {refused[measure]}): "
            f"p10 {entry['p10']} p50 {entry['p50']} p90 {entry['p90']} {unit}"
        )
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    main()
