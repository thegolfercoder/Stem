"""A quick look at a clip before the full analysis: will it be measurable at all?

Tracking every frame of a phone clip takes a minute or more on a laptop. A clip
with nobody in it, or a golfer cut off at the knees, fails after that minute
with a refusal that could have been given at once. This samples ten frames,
reads the clip's own metadata, and says what is wrong while the golfer is still
standing there with the phone.

Two kinds of finding. **Blocking** ones stop the analysis: a clip too short to
hold a swing, or no golfer found in most of it. **Warnings** let it run but travel
with the result: too dark, feet or head out of frame, the golfer small in the
frame, a low frame rate, a low resolution.

The thresholds are judgements, not measurements. What was measured is what they
guard against: the analysis refuses clips where a body is found in under half
the frames, and every movement metric needs the feet in shot. Two checks the
brief for this asked for are not made, and say so: camera shake, which pose
landmarks alone cannot tell from golfer movement, and more than one person in
shot, which a single-person tracker cannot count.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.pose.base import PoseSequence
from swingml.skeleton import Landmark

SAMPLES = 10
MIN_DURATION_S = 1.5
MIN_BODY_SHARE = 0.5
MIN_LUMA = 45.0
MIN_SHORT_SIDE = 360
MIN_FPS = 25.0
MIN_BODY_HEIGHT = 0.25
MIN_FULL_BODY_SHARE = 0.6


class Check(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    passed: bool
    severity: Literal["block", "warn"]
    measured: str
    advice: str


class Preflight(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    checks: tuple[Check, ...]

    @property
    def blocking(self) -> tuple[Check, ...]:
        return tuple(c for c in self.checks if not c.passed and c.severity == "block")

    @property
    def warnings(self) -> tuple[Check, ...]:
        return tuple(c for c in self.checks if not c.passed and c.severity == "warn")


def sample_frames(
    path: Path, count: int = SAMPLES
) -> tuple[list[NDArray[np.uint8]], dict[str, float]]:
    """Up to `count` evenly spaced RGB frames and the clip's own description of itself."""
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return [], {}
    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(capture.get(cv2.CAP_PROP_FPS)) or 0.0
    frames: list[NDArray[np.uint8]] = []
    for index in np.linspace(0, max(total - 1, 0), num=min(count, max(total, 1))).astype(int):
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
        ok, image = capture.read()
        if ok:
            frames.append(np.asarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), dtype=np.uint8))
    capture.release()
    height, width = frames[0].shape[:2] if frames else (0, 0)
    meta = {
        "frames": float(total),
        "fps": fps,
        "duration_s": total / fps if fps > 0 else 0.0,
        "width": float(width),
        "height": float(height),
    }
    return frames, meta


def judge(
    meta: dict[str, float], frames: list[NDArray[np.uint8]], poses: PoseSequence | None
) -> Preflight:
    """The checks, from what was sampled. Pure, so it can be tested without video."""
    checks: list[Check] = []
    duration = meta.get("duration_s", 0.0)
    checks.append(
        Check(
            name="length",
            passed=duration >= MIN_DURATION_S,
            severity="block",
            measured=f"{duration:.1f} s",
            advice="Start recording before you address the ball and stop after the finish; "
            "a whole swing takes two to three seconds.",
        )
    )
    detected = (
        float(np.mean(poses.detected)) if poses is not None and poses.detected is not None else 0.0
    )
    checks.append(
        Check(
            name="golfer in shot",
            passed=detected >= MIN_BODY_SHARE,
            severity="block",
            measured=f"a body in {100 * detected:.0f}% of sampled frames",
            advice="Keep the golfer in the frame for the whole clip, lit from the front, "
            "with the phone still.",
        )
    )
    short_side = min(meta.get("width", 0.0), meta.get("height", 0.0))
    checks.append(
        Check(
            name="resolution",
            passed=short_side >= MIN_SHORT_SIDE,
            severity="warn",
            measured=f"{short_side:.0f} px on the short side",
            advice="Record at 720p or higher.",
        )
    )
    fps = meta.get("fps", 0.0)
    checks.append(
        Check(
            name="frame rate",
            passed=fps >= MIN_FPS,
            severity="warn",
            measured=f"{fps:.0f} frames a second",
            advice="Film at 60 frames a second or more if the phone offers it: at 30 the club "
            "moves a long way between frames and impact is placed less precisely.",
        )
    )
    luma = float(np.mean([f.mean() for f in frames])) if frames else 0.0
    checks.append(
        Check(
            name="light",
            passed=luma >= MIN_LUMA,
            severity="warn",
            measured=f"average brightness {luma:.0f} of 255",
            advice="Film in better light, with the light behind the camera rather than behind "
            "the golfer.",
        )
    )
    if poses is not None and poses.detected is not None and poses.detected.any():
        seen = poses.detected.astype(bool)
        visibility = poses.visibility[seen]
        head = visibility[:, int(Landmark.NOSE)] >= 0.5
        feet = (
            np.minimum(
                visibility[:, int(Landmark.LEFT_ANKLE)], visibility[:, int(Landmark.RIGHT_ANKLE)]
            )
            >= 0.5
        )
        full = float(np.mean(head & feet))
        checks.append(
            Check(
                name="whole body",
                passed=full >= MIN_FULL_BODY_SHARE,
                severity="warn",
                measured=f"head and feet both seen in {100 * full:.0f}% of frames with a body",
                advice="Stand the phone further back so head and feet are always in the frame; "
                "head movement and sway are measured against the feet and are refused "
                "without them.",
            )
        )
        heights = []
        for frame in np.nonzero(seen)[0]:
            ys = poses.xy[frame][poses.visibility[frame] >= 0.5, 1]
            if ys.size:
                heights.append(float(ys.max() - ys.min()))
        body = float(np.median(heights)) if heights else 0.0
        checks.append(
            Check(
                name="golfer size",
                passed=body >= MIN_BODY_HEIGHT,
                severity="warn",
                measured=f"the golfer fills {100 * body:.0f}% of the frame height",
                advice="Move the phone closer, about 4 m away, so the golfer fills most of "
                "the frame's height.",
            )
        )
    return Preflight(checks=tuple(checks))


def preflight(path: Path, estimator: object) -> Preflight:
    """Sample the clip and judge it. `estimator` is a MediaPipePoseEstimator."""
    frames, meta = sample_frames(path)
    poses: PoseSequence | None = None
    if frames and len({f.shape for f in frames}) == 1:
        spacing = 1.0 / max(meta.get("fps", 30.0), 1.0)
        stream = ((f, i * 10 * spacing) for i, f in enumerate(frames))
        poses = estimator.estimate_stream(stream)  # type: ignore[attr-defined]
    return judge(meta, frames, poses)
