"""Run the analyser over a folder of clips and report what it did with each.

The number that matters here is not the average error. It is how many clips the
analyser was honest about: a tool that produces a plausible tempo for a video of
somebody standing still is worse than one that produces nothing, because a wrong
number gets acted on and a missing one gets investigated.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_video, load_model
from swingml.assets import find_event_model
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

# Clips whose names say they contain nothing measurable. The right outcome for
# these is a refusal, so a reading counts as a failure rather than a success.
SHOULD_REFUSE = {"no_swing_standing", "half_swing_cut_at_top", "empty_scene"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clips", type=Path, default=Path("out/testclips"))
    parser.add_argument("--model", type=Path, default=None)
    parser.add_argument("--expect-tempo", type=float, default=3.0)
    args = parser.parse_args()

    model = load_model(args.model or find_event_model())
    estimator = MediaPipePoseEstimator()

    videos = sorted(args.clips.glob("*.mp4"))
    print(f"{'clip':28s} {'result':>9} {'tempo':>7} {'back ms':>8} {'conf':>6} {'det':>5}  note")
    print("-" * 100)

    right = wrong = refused_ok = refused_bad = 0
    for video in videos:
        stem = video.stem
        handedness = Handedness.LEFT if "left" in stem else Handedness.RIGHT
        started = time.time()
        analysis = analyse_video(video, model, estimator, AnalysisConfig(handedness=handedness))
        elapsed = time.time() - started

        should_refuse = stem in SHOULD_REFUSE
        if isinstance(analysis.events, NoReading):
            outcome = "refused"
            note = analysis.events.reason[:52]
            if should_refuse:
                refused_ok += 1
            else:
                refused_bad += 1
            print(
                f"{stem:28s} {outcome:>9} {'—':>7} {'—':>8} {'—':>6} "
                f"{100 * analysis.detection_rate:4.0f}%  {note}"
            )
            continue

        metrics = analysis.metrics
        tempo = (
            metrics.tempo_ratio.value
            if not isinstance(metrics, NoReading) and not isinstance(metrics.tempo_ratio, NoReading)
            else float("nan")
        )
        back = (
            metrics.backswing_duration.value
            if not isinstance(metrics, NoReading)
            and not isinstance(metrics.backswing_duration, NoReading)
            else float("nan")
        )
        confidence = sum(analysis.events.confidence) / len(analysis.events.confidence)
        error = 100.0 * (tempo - args.expect_tempo) / args.expect_tempo

        if should_refuse:
            wrong += 1
            note = "SHOULD HAVE REFUSED"
        else:
            right += 1
            note = f"tempo {error:+.0f}% vs generated, {elapsed:.0f}s"

        print(
            f"{stem:28s} {'read':>9} {tempo:7.2f} {back:8.0f} {confidence:6.2f} "
            f"{100 * analysis.detection_rate:4.0f}%  {note}"
        )

    print("-" * 100)
    print(f"clips that should read and did:      {right}")
    print(f"clips that should read but refused:  {refused_bad}")
    print(f"clips that should refuse and did:    {refused_ok}")
    print(f"clips that should refuse but read:   {wrong}   <- the dangerous column")


if __name__ == "__main__":
    main()
