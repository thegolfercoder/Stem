"""Run the whole pipeline on rendered video and check it against known truth.

Every stage in isolation can pass its own tests and the assembly still be wrong:
an off-by-one in the frame mapping, a time base that drifts, a resampling that
silently reverses. This renders a generated swing to an actual video file, reads
that file back through the ordinary reader, runs the real pose estimator over it,
and compares the events that come out against the frames the generator knows.

The pose estimator is being shown a rendered figure rather than a photograph of a
person, so nothing here is evidence about accuracy on real footage. It is
evidence that the pipeline is wired together correctly end to end, which is the
part that is usually wrong and is otherwise expensive to be sure of.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.events import SwingEvent
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.report.overlay import swing_card
from swingml.skeleton import Handedness
from swingml.video.reader import VideoReader
from synth.camera import CameraConfig
from synth.render import render_swing_video, write_video
from synth.swing import SwingTiming, generate_swing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("out/events/swing_event_net.pt"))
    parser.add_argument("--azimuth", type=float, nargs="+", default=[0.0, 90.0])
    parser.add_argument("--capture-fps", type=float, default=60.0)
    parser.add_argument("--tempo", type=float, default=3.0)
    parser.add_argument("--backswing", type=float, default=0.80)
    parser.add_argument("--keep", type=Path, default=None, help="keep the rendered clip here")
    parser.add_argument("--cards", type=Path, default=Path("out/cards"))
    args = parser.parse_args()

    timing = SwingTiming(backswing_s=args.backswing, downswing_s=args.backswing / args.tempo)
    swing = generate_swing(timing=timing, frame_rate_hz=args.capture_fps)
    model = load_model(args.model)
    estimator = MediaPipePoseEstimator()

    print(
        f"generated swing: tempo ratio {timing.tempo_ratio:.2f}, "
        f"backswing {1000 * timing.backswing_s:.0f} ms, "
        f"downswing {1000 * timing.downswing_s:.0f} ms, captured at {args.capture_fps:.0f} fps\n"
    )

    for azimuth in args.azimuth:
        camera = CameraConfig(
            azimuth_deg=azimuth,
            distance_m=4.5,
            frame_width=720,
            frame_height=1280,
            vertical_fov_deg=55.0,
        )
        frames = render_swing_video(swing, camera, seed=0)

        directory = Path(tempfile.mkdtemp())
        path = args.keep or (directory / f"swing_az{int(azimuth)}.mp4")
        path.parent.mkdir(parents=True, exist_ok=True)
        write_video(frames, str(path), args.capture_fps)

        with VideoReader(path) as reader:
            read_frames, read_times, info = reader.read_all()
        sequence = estimator.estimate(read_frames, read_times)
        analysis = analyse_pose_sequence(
            sequence, model, AnalysisConfig(handedness=Handedness.RIGHT), video=info
        )

        label = "face-on" if abs(azimuth) < 45 else "down the line"
        print(f"=== camera at {azimuth:.0f} degrees ({label}) ===")
        print(analysis.describe())

        if not isinstance(analysis.events, NoReading):
            errors = [
                analysis.event_source_frames[int(event)] - swing.truth.frame_of(event)
                for event in SwingEvent.ordered()
            ]
            print("  event error against the generator, in source frames:")
            for event in SwingEvent.ordered():
                print(f"    {event.label:20s} {errors[int(event)]:+d}")
            print(f"  mean |error| {np.mean(np.abs(errors)):.2f} frames")

            metrics = analysis.metrics
            if not isinstance(metrics, NoReading) and not isinstance(
                metrics.tempo_ratio, NoReading
            ):
                measured = metrics.tempo_ratio.value
                print(
                    f"  tempo ratio: {measured:.2f} measured against "
                    f"{timing.tempo_ratio:.2f} generated "
                    f"({100 * (measured - timing.tempo_ratio) / timing.tempo_ratio:+.1f}%)"
                )

            card = swing_card(
                analysis,
                read_frames,
                sequence,
                args.cards / f"swing_az{int(azimuth)}.png",
                title=f"generated swing, camera {azimuth:.0f} degrees ({label})",
            )
            print(f"  wrote {card}")
        print()


if __name__ == "__main__":
    main()
