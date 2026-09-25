"""The pictures a swing is shown with must be the frames that were analysed.

Clips faster than sixty frames a second are tracked at sixty: at 240 fps only
every fourth frame reaches the pose estimator, so frame n of the tracked
sequence is frame 4n of the video. The pictures used to be fetched by position
in the sequence, so a slow-motion clip - the way most people film a golf swing
on a phone - showed the wrong moment with somebody else's skeleton drawn on it.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from swingml.pose.base import PoseSequence
from swingml.video.reader import VideoReader
from swingml.web.frames import extract_event_frames, extract_sequence_frames

RATE = 240
FRAMES = 80
STEP = 3  # brightness step between consecutive video frames


def _write_clip(path: Path) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), RATE, (64, 64))
    if not writer.isOpened():
        pytest.skip("this OpenCV build cannot write mp4")
    for index in range(FRAMES):
        writer.write(np.full((64, 64, 3), index * STEP, dtype=np.uint8))
    writer.release()


def _tracked(path: Path) -> PoseSequence:
    """What the app tracks: the clip read at no more than sixty frames a second."""
    with VideoReader(path) as reader:
        times = np.array([t for _, t in reader.frames(max_rate_hz=60)])
    n = len(times)
    return PoseSequence(
        xy=np.full((n, 33, 2), 0.5, dtype=np.float32),
        visibility=np.zeros((n, 33), dtype=np.float32),
        timestamps_s=times,
        frame_width=64,
        frame_height=64,
        world_xyz=np.zeros((n, 33, 3), dtype=np.float32),
        detected=np.ones(n, dtype=bool),
    )


def _video_frame_shown(image_path: Path) -> int:
    image = cv2.imread(str(image_path))
    return round(float(image.mean()) / STEP)


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, PoseSequence]:
    path = tmp_path_factory.mktemp("slowmo") / "clip.mp4"
    _write_clip(path)
    sequence = _tracked(path)
    if sequence.n_frames >= FRAMES:
        pytest.skip("the reader did not thin this clip, so there is nothing to test")
    return path, sequence


def test_event_pictures_show_the_tracked_frames(
    clip: tuple[Path, PoseSequence], tmp_path: Path
) -> None:
    path, sequence = clip
    chosen = (2, 5, 7, 9, 11, 13, 15, 17)
    written = extract_event_frames(path, sequence, chosen, tmp_path)
    assert len(written) == 8
    for index, name in enumerate(written.values()):
        expected = round(float(sequence.timestamps_s[chosen[index]]) * RATE)
        assert _video_frame_shown(tmp_path / name) == expected


def test_scrubber_pictures_show_the_tracked_frames(
    clip: tuple[Path, PoseSequence], tmp_path: Path
) -> None:
    path, sequence = clip
    manifest = extract_sequence_frames(path, sequence, 2, 15, tmp_path)
    assert manifest
    for item in manifest:
        expected = round(float(sequence.timestamps_s[int(item["frame"])]) * RATE)
        assert _video_frame_shown(tmp_path / str(item["name"])) == expected
