"""The quick look before analysis: stop what cannot be measured, warn about the rest."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from swingml.capture import judge, preflight
from swingml.pose.base import PoseSequence
from swingml.skeleton import Landmark

FIXTURE = Path(__file__).parent / "fixtures" / "real_swing_01.mov"
META = {"frames": 180.0, "fps": 60.0, "duration_s": 3.0, "width": 720.0, "height": 1280.0}


def poses(detected: float, feet: bool = True, height: float = 0.6) -> PoseSequence:
    n = 10
    xy = np.full((n, 33, 2), 0.5, dtype=np.float32)
    xy[:, int(Landmark.NOSE), 1] = 0.5 - height / 2
    xy[:, int(Landmark.LEFT_ANKLE), 1] = 0.5 + height / 2
    xy[:, int(Landmark.RIGHT_ANKLE), 1] = 0.5 + height / 2
    visibility = np.ones((n, 33), dtype=np.float32)
    if not feet:
        visibility[:, [int(Landmark.LEFT_ANKLE), int(Landmark.RIGHT_ANKLE)]] = 0.1
    return PoseSequence(
        xy=xy, visibility=visibility, timestamps_s=np.arange(n) / 6.0, frame_width=720,
        frame_height=1280, detected=np.arange(n) < round(detected * n),
    )  # fmt: skip


def frames(luma: int) -> list[np.ndarray]:
    return [np.full((64, 36, 3), luma, dtype=np.uint8)] * 10


def failed(result) -> set[str]:  # type: ignore[no-untyped-def]
    return {c.name for c in result.checks if not c.passed}


def test_a_good_clip_passes_every_check() -> None:
    result = judge(META, frames(120), poses(1.0))
    assert not failed(result)


def test_nobody_in_shot_blocks_before_any_tracking() -> None:
    result = judge(META, frames(120), poses(0.2))
    assert [c.name for c in result.blocking] == ["golfer in shot"]


def test_a_clip_too_short_for_a_swing_blocks() -> None:
    result = judge({**META, "duration_s": 0.8}, frames(120), poses(1.0))
    assert "length" in {c.name for c in result.blocking}


@pytest.mark.parametrize(
    ("meta", "images", "tracked", "expected"),
    [
        (META, frames(20), poses(1.0), "light"),
        ({**META, "fps": 15.0}, frames(120), poses(1.0), "frame rate"),
        ({**META, "width": 240.0}, frames(120), poses(1.0), "resolution"),
        (META, frames(120), poses(1.0, feet=False), "whole body"),
        (META, frames(120), poses(1.0, height=0.15), "golfer size"),
    ],
)
def test_filming_problems_warn_without_blocking(meta, images, tracked, expected: str) -> None:  # type: ignore[no-untyped-def]
    result = judge(meta, images, tracked)
    assert failed(result) == {expected}
    assert not result.blocking
    assert all(c.advice for c in result.warnings)


def _estimator():  # type: ignore[no-untyped-def]
    from swingml.pose.mediapipe_pose import MediaPipePoseEstimator

    try:
        return MediaPipePoseEstimator()
    except Exception as error:  # the pose model may be absent offline
        pytest.skip(f"pose estimator unavailable: {error}")


def test_the_real_phone_fixture_passes(tmp_path: Path) -> None:
    assert not preflight(FIXTURE, _estimator()).blocking


def test_a_black_clip_is_stopped(tmp_path: Path) -> None:
    path = tmp_path / "black.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), 30, (360, 640))
    if not writer.isOpened():
        pytest.skip("this OpenCV build cannot write mp4")
    for _ in range(90):
        writer.write(np.zeros((640, 360, 3), dtype=np.uint8))
    writer.release()
    result = preflight(path, _estimator())
    assert "golfer in shot" in {c.name for c in result.blocking}
