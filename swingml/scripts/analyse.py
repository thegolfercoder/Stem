"""Analyse one or more swing videos and print what came out.

python scripts/analyse.py clip.mov --model out/events/swing_event_net.pt
python scripts/analyse.py swings/ --model out/events/swing_event_net.pt --left-handed
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_video, load_model
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.session import summarise_session
from swingml.skeleton import Handedness

VIDEO_SUFFIXES = {".mov", ".mp4", ".m4v", ".avi", ".mkv"}


def collect_videos(target: Path) -> list[Path]:
    if target.is_dir():
        return sorted(p for p in target.iterdir() if p.suffix.lower() in VIDEO_SUFFIXES)
    return [target]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a video file, or a directory of them")
    parser.add_argument("--model", type=Path, default=Path("out/events/swing_event_net.pt"))
    parser.add_argument("--left-handed", action="store_true")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.0,
        help="refuse swings below this mean event confidence; needs calibrating first",
    )
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--json", type=Path, default=None, help="write results here")
    args = parser.parse_args()

    videos = collect_videos(args.target)
    if not videos:
        parser.error(f"no videos found at {args.target}")

    model = load_model(args.model)
    estimator = MediaPipePoseEstimator()
    config = AnalysisConfig(
        handedness=Handedness.LEFT if args.left_handed else Handedness.RIGHT,
        min_mean_confidence=args.min_confidence,
        max_frames=args.max_frames,
    )

    analyses = []
    for video in videos:
        analysis = analyse_video(video, model, estimator, config)
        analyses.append(analysis)
        print(analysis.describe())
        print()

    if len(analyses) > 1:
        print(summarise_session(analyses).describe())

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps([a.model_dump(mode="json") for a in analyses], indent=2),
            encoding="utf-8",
        )
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
