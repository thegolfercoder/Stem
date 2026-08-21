"""Render a set of clips that behave like footage somebody would actually shoot.

Testing on one clean clip filmed straight on proves very little. Real footage is
handheld and tilted, shot from wherever there was room, at whatever frame rate
the phone was set to, and contains a good deal of standing about either side of
the swing. Some of it contains no swing at all, because people press record and
then change their mind.

That last group matters most. The interesting question is not whether a good clip
produces good numbers - it is whether a bad clip produces *no* numbers rather
than plausible ones.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from synth.camera import CameraConfig
from synth.render import render_swing_video
from synth.rig import SwingGeometry
from synth.swing import SwingTiming, generate_swing

CASES: list[dict[str, object]] = [
    # name, and what it is meant to exercise
    {"name": "face_on_normal", "azimuth": 0.0, "tempo": 3.0, "fps": 60.0, "height": 1280},
    {"name": "down_the_line", "azimuth": 90.0, "tempo": 3.0, "fps": 60.0, "height": 1280},
    {"name": "angled_45", "azimuth": 45.0, "tempo": 3.0, "fps": 60.0, "height": 1280},
    {"name": "slow_tempo", "azimuth": 0.0, "tempo": 2.2, "fps": 60.0, "height": 1280},
    {"name": "quick_tempo", "azimuth": 0.0, "tempo": 3.8, "fps": 60.0, "height": 1280},
    {"name": "thirty_fps", "azimuth": 0.0, "tempo": 3.0, "fps": 30.0, "height": 1280},
    {"name": "slow_motion_120", "azimuth": 0.0, "tempo": 3.0, "fps": 120.0, "height": 720},
    {
        "name": "landscape_720",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 720,
        "landscape": True,
    },
    {
        "name": "tilted_camera",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "roll": 11.0,
    },
    {
        "name": "left_handed",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "left": True,
    },
    {
        "name": "far_away",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "distance": 7.5,
    },
    {
        "name": "close_up_feet_cut",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "distance": 2.6,
        "look_at": 1.35,
    },
    # Clips that should be refused rather than measured.
    {
        "name": "no_swing_standing",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "truncate": "address",
    },
    {
        "name": "half_swing_cut_at_top",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "truncate": "top",
    },
    {
        "name": "empty_scene",
        "azimuth": 0.0,
        "tempo": 3.0,
        "fps": 60.0,
        "height": 1280,
        "empty": True,
    },
]


def write(path: Path, frames: np.ndarray, fps: float) -> None:
    height, width = frames.shape[1], frames.shape[2]
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for frame in frames:
        writer.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
    writer.release()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("out/testclips"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    manifest: list[str] = []
    for index, case in enumerate(CASES):
        tempo = float(case["tempo"])
        backswing = 0.80
        timing = SwingTiming(
            address_hold_s=1.2,
            backswing_s=backswing,
            downswing_s=backswing / tempo,
            follow_through_s=0.45,
            finish_hold_s=1.0,
        )
        swing = generate_swing(
            timing=timing,
            geometry=SwingGeometry(),
            frame_rate_hz=float(case["fps"]),
            left_handed=bool(case.get("left", False)),
        )

        height = int(case["height"])
        width = round(height * 16 / 9) if case.get("landscape") else round(height * 9 / 16)
        camera = CameraConfig(
            azimuth_deg=float(case["azimuth"]) * (-1.0 if case.get("left") else 1.0),
            elevation_deg=4.0,
            distance_m=float(case.get("distance", 4.5)),
            roll_deg=float(case.get("roll", 0.0)),
            frame_width=width,
            frame_height=height,
            vertical_fov_deg=55.0,
            look_at_height_m=float(case.get("look_at", 1.15)),
        )

        frames = render_swing_video(swing, camera, seed=index)

        truncate = case.get("truncate")
        if truncate == "address":
            frames = frames[: swing.truth.event_frames[0] + 4]
        elif truncate == "top":
            frames = frames[: swing.truth.event_frames[3] + 2]
        if case.get("empty"):
            frames = np.repeat(frames[:1] * 0 + np.array([120, 160, 120], np.uint8), 90, axis=0)

        path = args.out / f"{case['name']}.mp4"
        write(path, frames, float(case["fps"]))
        manifest.append(f"{path.name}: {len(frames)} frames at {case['fps']:.0f} fps")
        print(f"  {path.name:26s} {len(frames):4d} frames  {width}x{height}")

    print(f"\nwrote {len(CASES)} clips to {args.out}")


if __name__ == "__main__":
    main()
