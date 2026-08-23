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

from pydantic import BaseModel, ConfigDict

from synth.camera import CameraConfig
from synth.render import render_swing_video
from synth.rig import SwingGeometry
from synth.swing import SwingTiming, generate_swing


class Case(BaseModel):
    """One clip to render, and what about real footage it stands in for."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    azimuth: float = 0.0
    tempo: float = 3.0
    fps: float = 60.0
    height: int = 1280
    landscape: bool = False
    roll: float = 0.0
    left: bool = False
    distance: float = 4.5
    look_at: float = 1.15
    truncate: str | None = None
    empty: bool = False


CASES: list[Case] = [
    # Ordinary footage, from where somebody would actually stand.
    Case(name="face_on_normal"),
    Case(name="down_the_line", azimuth=90.0),
    Case(name="angled_45", azimuth=45.0),
    # Different swings.
    Case(name="slow_tempo", tempo=2.2),
    Case(name="quick_tempo", tempo=3.8),
    Case(name="left_handed", left=True),
    # Different phones and settings.
    Case(name="thirty_fps", fps=30.0),
    Case(name="slow_motion_120", fps=120.0, height=720),
    Case(name="landscape_720", height=720, landscape=True),
    Case(name="tilted_camera", roll=11.0),
    # Framed badly, as people do.
    Case(name="far_away", distance=7.5),
    Case(name="close_up_feet_cut", distance=2.6, look_at=1.35),
    # No swing in them at all. A refusal is the right answer to each of these,
    # and a plausible tempo is the wrong one.
    Case(name="no_swing_standing", truncate="address"),
    Case(name="half_swing_cut_at_top", truncate="top"),
    Case(name="empty_scene", empty=True),
]


def write(path: Path, frames: np.ndarray, fps: float) -> None:
    height, width = frames.shape[1], frames.shape[2]
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), fps, (width, height))
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
        tempo = case.tempo
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
            frame_rate_hz=case.fps,
            left_handed=case.left,
        )

        height = case.height
        width = round(height * 16 / 9) if case.landscape else round(height * 9 / 16)
        camera = CameraConfig(
            azimuth_deg=case.azimuth * (-1.0 if case.left else 1.0),
            elevation_deg=4.0,
            distance_m=case.distance,
            roll_deg=case.roll,
            frame_width=width,
            frame_height=height,
            vertical_fov_deg=55.0,
            look_at_height_m=case.look_at,
        )

        frames = render_swing_video(swing, camera, seed=index)

        truncate = case.truncate
        if truncate == "address":
            frames = frames[: swing.truth.event_frames[0] + 4]
        elif truncate == "top":
            frames = frames[: swing.truth.event_frames[3] + 2]
        if case.empty:
            frames = np.repeat(frames[:1] * 0 + np.array([120, 160, 120], np.uint8), 90, axis=0)

        path = args.out / f"{case.name}.mp4"
        write(path, frames, case.fps)
        manifest.append(f"{path.name}: {len(frames)} frames at {case.fps:.0f} fps")
        print(f"  {path.name:26s} {len(frames):4d} frames  {width}x{height}")

    print(f"\nwrote {len(CASES)} clips to {args.out}")


if __name__ == "__main__":
    main()
