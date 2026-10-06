"""Run the analyser over a folder of clips and report what it did with each.

The number that matters here is not the average error. It is how many clips the
analyser was honest about: a tool that produces a plausible tempo for a video of
somebody standing still is worse than one that produces nothing, because a wrong
number gets acted on and a missing one gets investigated.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_test_clips import CASES, Case

from swingml.analysis import AnalysisConfig, analyse_video, load_model
from swingml.assets import find_event_model
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

# Clips whose names say they contain nothing measurable. The right outcome for
# these is a refusal, so a reading counts as a failure rather than a success.
SHOULD_REFUSE = {"no_swing_standing", "half_swing_cut_at_top", "empty_scene"}


def true_tempo(case: Case) -> float:
    """The tempo each clip was generated with, from the generator's own event frames.

    Every clip used to be scored against a tempo of 3.0, including the ones
    generated at 2.2 and 3.8, so the two cases built to test tempo range were
    scored against the wrong answer.
    """
    from synth.rig import SwingGeometry
    from synth.swing import SwingTiming, generate_swing

    timing = SwingTiming(
        address_hold_s=1.2,
        backswing_s=0.80,
        downswing_s=0.80 / case.tempo,
        follow_through_s=0.45,
        finish_hold_s=1.0,
    )
    frames = generate_swing(
        timing=timing, geometry=SwingGeometry(), frame_rate_hz=case.fps, left_handed=case.left
    ).truth.event_frames
    return float(frames[3] - frames[0]) / float(frames[5] - frames[3])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clips", type=Path, default=Path("out/testclips"))
    parser.add_argument("--model", type=Path, default=None)
    parser.add_argument("--json", type=Path, default=None, help="also write the results here")
    args = parser.parse_args()
    cases = {case.name: case for case in CASES}
    results: list[dict[str, object]] = []

    model_path = args.model or find_event_model()
    if model_path is None:
        raise SystemExit("no trained model found")
    model = load_model(model_path)
    estimator = MediaPipePoseEstimator()

    videos = sorted(args.clips.glob("*.mp4"))
    print(f"{'clip':28s} {'result':>9} {'tempo':>7} {'back ms':>8} {'conf':>6} {'det':>5}  note")
    print("-" * 100)

    right = wrong = refused_ok = refused_bad = 0
    for video in videos:
        stem = video.stem
        case = cases.get(stem)
        handedness = Handedness.LEFT if case is not None and case.left else Handedness.RIGHT
        truth = true_tempo(case) if case is not None and stem not in SHOULD_REFUSE else None
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
            results.append(
                {
                    "clip": stem,
                    "should_refuse": should_refuse,
                    "outcome": "refused",
                    "reason": analysis.events.reason,
                    "true_tempo": truth,
                    "detection_rate": analysis.detection_rate,
                    "seconds": round(elapsed, 1),
                }
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
        error = 100.0 * (tempo - truth) / truth if truth else float("nan")

        if should_refuse:
            wrong += 1
            note = "SHOULD HAVE REFUSED"
        else:
            right += 1
            note = f"tempo {error:+.0f}% vs generated {truth:.2f}, {elapsed:.0f}s"
        results.append(
            {
                "clip": stem,
                "should_refuse": should_refuse,
                "outcome": "read",
                "tempo": tempo,
                "true_tempo": truth,
                "tempo_error_pct": error,
                "backswing_ms": back,
                "mean_confidence": confidence,
                "detection_rate": analysis.detection_rate,
                "seconds": round(elapsed, 1),
            }
        )

        print(
            f"{stem:28s} {'read':>9} {tempo:7.2f} {back:8.0f} {confidence:6.2f} "
            f"{100 * analysis.detection_rate:4.0f}%  {note}"
        )

    print("-" * 100)
    print(f"clips that should read and did:      {right}")
    print(f"clips that should read but refused:  {refused_bad}")
    print(f"clips that should refuse and did:    {refused_ok}")
    print(f"clips that should refuse but read:   {wrong}   <- the dangerous column")
    if args.json is not None:
        summary = {
            "model": str(model_path),
            "should_read_and_did": right,
            "should_read_but_refused": refused_bad,
            "should_refuse_and_did": refused_ok,
            "should_refuse_but_read": wrong,
            "clips": results,
        }
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
