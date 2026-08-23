"""Reading an iPhone clip without getting any of the easy things wrong.

Four things about phone video break naive readers, and all four are silent
failures - the code runs, the numbers come out, and they are wrong.

**Rotation.** A clip filmed in portrait is stored landscape with a rotation flag
in the container. A reader that ignores the flag gets a sideways golfer, and a
pose estimator handed a sideways golfer produces confident nonsense. OpenCV can
apply the flag itself, but only if asked.

**Real timestamps.** Frames are not evenly spaced. The nominal frame rate is a
convenience, and iPhone slow-motion is the extreme case: a clip captured at 240
frames per second is commonly written to play at 30, so the advertised rate has
nothing to do with the rate the shutter ran at. Every time here is read from the
container per frame rather than computed from an index, because tempo is a ratio
of durations and a wrong time base moves it.

**Variable frame rate.** iPhones drop the capture rate in poor light without
announcing it. Frame spacing stops being uniform partway through the clip, which
goes unnoticed and then shows up as a tempo that drifts across a session.

**Sheer size.** Ten seconds of 240fps 1080p is 2400 frames and about seven
gigabytes uncompressed. Frames are yielded rather than accumulated, so a long
clip costs the same memory as a short one.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field


class VideoInfo(BaseModel):
    """What the container says about a clip, and what was actually found in it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    path: str
    width: int
    height: int
    n_frames: int
    nominal_fps: float = Field(description="The rate the container advertises.")
    measured_fps: float = Field(
        description=(
            "The rate implied by the frame timestamps actually read. Where this "
            "disagrees with the nominal rate, this is the one that means something."
        )
    )
    duration_s: float
    rotation_applied: bool
    timestamps_uniform: bool = Field(
        description=(
            "Whether frame spacing held steady, which it does not under variable-rate capture."
        )
    )

    @property
    def is_slow_motion(self) -> bool:
        """A clip whose capture rate exceeds its playback rate by a clear margin."""
        return self.measured_fps > self.nominal_fps * 1.5


class VideoReader:
    """Frames and their real times, with rotation handled."""

    def __init__(self, path: Path | str, apply_rotation: bool = True) -> None:
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(f"no such video: {self.path}")

        self.capture = cv2.VideoCapture(str(self.path))
        if not self.capture.isOpened():
            raise OSError(
                f"could not open {self.path}. If this is an iPhone clip it is probably "
                "HEVC, which needs an OpenCV build with the codec available."
            )

        self.rotation_degrees = 0
        if hasattr(cv2, "CAP_PROP_ORIENTATION_META"):
            meta = self.capture.get(cv2.CAP_PROP_ORIENTATION_META)
            if np.isfinite(meta):
                self.rotation_degrees = int(meta) % 360

        self.rotation_applied = False
        if apply_rotation and hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
            self.rotation_applied = bool(self.capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1))

        self.nominal_fps = float(self.capture.get(cv2.CAP_PROP_FPS)) or 30.0
        self.declared_frames = int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT))

    def __enter__(self) -> VideoReader:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self.capture.release()

    def frames(self) -> Iterator[tuple[NDArray[np.uint8], float]]:
        """Yield each frame as RGB, with its presentation time in seconds.

        Falls back to the nominal rate for any frame whose timestamp the container
        does not carry, which happens on the first frame in some encoders. The
        fallback is monotonic, so downstream code never sees time run backwards.
        """
        index = 0
        last_time = -1.0
        while True:
            position_ms = self.capture.get(cv2.CAP_PROP_POS_MSEC)
            ok, frame = self.capture.read()
            if not ok:
                break

            time_s = position_ms / 1000.0
            if not np.isfinite(time_s) or time_s <= last_time:
                time_s = last_time + 1.0 / self.nominal_fps if index else 0.0
            last_time = time_s

            rgb = np.asarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), dtype=np.uint8)
            yield rgb, time_s
            index += 1

    def describe_stream(self, n_frames: int, timestamps: NDArray[np.float64]) -> VideoInfo:
        """Describe a clip that was streamed rather than held in memory.

        The frame size comes from the capture properties rather than from a
        decoded frame, because by the time this is called the frames are gone -
        which is the point of streaming them.
        """
        width = int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if self.rotation_applied and self.rotation_degrees in (90, 270):
            width, height = height, width

        duration = float(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0.0
        gaps = np.diff(timestamps) if len(timestamps) > 1 else np.array([1.0 / self.nominal_fps])
        median_gap = float(np.median(gaps))
        measured = 1.0 / median_gap if median_gap > 0 else self.nominal_fps
        uniform = bool(np.std(gaps) < 0.25 * median_gap) if len(gaps) > 1 else True

        return VideoInfo(
            path=str(self.path),
            width=width,
            height=height,
            n_frames=int(n_frames),
            nominal_fps=self.nominal_fps,
            measured_fps=measured,
            duration_s=duration,
            rotation_applied=self.rotation_applied,
            timestamps_uniform=uniform,
        )

    def read_all(
        self, max_frames: int | None = None
    ) -> tuple[NDArray[np.uint8], NDArray[np.float64], VideoInfo]:
        """Read the whole clip into memory. Only for clips known to be short."""
        images: list[NDArray[np.uint8]] = []
        times: list[float] = []
        for image, time_s in self.frames():
            images.append(image)
            times.append(time_s)
            if max_frames is not None and len(images) >= max_frames:
                break

        if not images:
            raise OSError(f"{self.path} contained no readable frames")

        stack = np.stack(images)
        timestamps = np.asarray(times, dtype=np.float64)
        return stack, timestamps, self._describe(stack, timestamps)

    def _describe(self, images: NDArray[np.uint8], timestamps: NDArray[np.float64]) -> VideoInfo:
        duration = float(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0.0
        gaps = np.diff(timestamps) if len(timestamps) > 1 else np.array([1.0 / self.nominal_fps])
        median_gap = float(np.median(gaps))
        measured = 1.0 / median_gap if median_gap > 0 else self.nominal_fps
        uniform = bool(np.std(gaps) < 0.25 * median_gap) if len(gaps) > 1 else True

        return VideoInfo(
            path=str(self.path),
            width=int(images.shape[2]),
            height=int(images.shape[1]),
            n_frames=int(images.shape[0]),
            nominal_fps=self.nominal_fps,
            measured_fps=measured,
            duration_s=duration,
            rotation_applied=self.rotation_applied,
            timestamps_uniform=uniform,
        )
