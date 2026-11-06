"""Each frame carries its own presentation time (#40).

The reader used to ask OpenCV for the time before decoding each frame, which is
the time of the frame decoded before it. A fallback hid that for the first few
dozen frames; after it, every frame was stamped one frame early. On GolfDB clips
the jump came at frame 37 or 69, so a backswing spanning it was a frame short,
and the app's event times sat two 60 Hz grid frames before the labels.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from swingml.video.reader import VideoReader

cv2 = pytest.importorskip("cv2")
PHONE_CLIP = Path(__file__).parent / "fixtures" / "real_swing_01.mov"


def times_of(path: Path) -> np.ndarray:
    with VideoReader(path) as reader:
        return np.array([t for _, t in reader.frames()])


@pytest.mark.skipif(not PHONE_CLIP.is_file(), reason="needs the real phone clip")
def test_the_phone_clip_is_timed_frame_by_frame() -> None:
    times = times_of(PHONE_CLIP)
    assert len(times) == 211
    # A 30 fps phone clip: frame i at i/30 s, from the first frame to the last.
    np.testing.assert_allclose(times, np.arange(len(times)) / 30.0, atol=1e-6)


def test_a_long_constant_rate_clip_never_slips_a_frame(tmp_path: Path) -> None:
    path = tmp_path / "long.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (64, 48))
    for i in range(240):
        frame = np.full((48, 64, 3), i % 256, dtype=np.uint8)
        writer.write(frame)
    writer.release()
    times = times_of(path)
    assert len(times) == 240
    assert np.all(np.diff(times) > 0)
    np.testing.assert_allclose(times, np.arange(len(times)) / 30.0, atol=1e-6)
