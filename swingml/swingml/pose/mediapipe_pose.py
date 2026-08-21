"""MediaPipe Pose behind the estimator seam.

Chosen for this stage because it runs on a laptop CPU at a usable rate, needs no
GPU, reports a per-landmark confidence that means something, and has a direct
counterpart that runs on the phone - so the research pipeline and the eventual
on-device one can be held to the same landmarks rather than merely to the same
idea.

Two things about how it is driven here matter.

**Video mode, not image mode.** Run per-image, the estimator re-detects the body
from scratch every frame and its output jitters between frames in a way that has
nothing to do with the golfer moving. Video mode carries a tracker across frames.
It needs strictly increasing timestamps, which is why the reader goes to the
trouble of producing real ones.

**A frame with no detection is recorded, not skipped.** Dropping undetected
frames would silently compress the time axis, and time is what tempo is measured
from. Undetected frames keep the previous landmarks at near-zero confidence and
are flagged, so the model sees a gap and the metrics can refuse a swing that had
too many.

**Frames are consumed one at a time and thrown away.** A minute of 1080p at
sixty frames a second is about twenty gigabytes of pixels, and holding a clip in
memory to analyse it puts a ceiling on clip length that has nothing to do with
the problem. What survives a frame is thirty-three landmarks - a few hundred
bytes - so the estimator takes an iterator, keeps one frame alive at a time, and
will run over a clip of any length in a fixed amount of memory.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.assets import POSE_MODEL_ENV_VAR as MODEL_ENV_VAR
from swingml.assets import POSE_MODEL_URL as MODEL_URL
from swingml.assets import ensure_pose_model, find_pose_model
from swingml.pose.base import PoseSequence
from swingml.skeleton import NUM_LANDMARKS

ProgressCallback = Callable[[int], None]
"""Called with how many frames have been processed so far."""


class MediaPipePoseConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    model_path: Path | None = Field(
        default=None,
        description=(
            f"Path to a pose landmarker bundle. Falls back to ${MODEL_ENV_VAR}, then "
            "to models/pose_landmarker_heavy.task beside the repository."
        ),
    )
    min_detection_confidence: float = 0.5
    min_presence_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    allow_download: bool = Field(
        default=True, description="Fetch the landmarker bundle if it is not present."
    )
    heavy_smoothing: bool = Field(
        default=False,
        description=(
            "MediaPipe's own landmark smoothing. Left off: it is a low-pass filter, "
            "and the events being detected are the sharpest moments in the clip. "
            "Smoothing them is smoothing away the signal."
        ),
    )


def resolve_model_path(configured: Path | None, allow_download: bool = True) -> Path:
    """Find the landmarker bundle, fetching it on first run if it is not here yet.

    Downloading is the default because the alternative is telling a user to run a
    curl command before the software will do anything, and that is not software.
    A caller that must not touch the network can turn it off.
    """
    if configured is not None and Path(configured).is_file():
        return Path(configured)

    found = find_pose_model()
    if found is not None:
        return found

    if not allow_download:
        raise FileNotFoundError(
            "no pose landmarker model found and downloading is disabled. Fetch it with:\n"
            f"  curl -L -o models/{MODEL_URL.rsplit('/', 1)[1]} {MODEL_URL}\n"
            f"or point ${MODEL_ENV_VAR} at an existing copy."
        )
    return ensure_pose_model()


class MediaPipePoseEstimator:
    """Runs MediaPipe Pose over a clip and returns landmarks in the shared schema."""

    def __init__(self, config: MediaPipePoseConfig | None = None) -> None:
        self.config = config or MediaPipePoseConfig()
        self.model_path = resolve_model_path(
            self.config.model_path, allow_download=self.config.allow_download
        )

    def _options(self) -> object:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        return vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=self.config.min_detection_confidence,
            min_pose_presence_confidence=self.config.min_presence_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
            output_segmentation_masks=False,
        )

    def estimate_stream(
        self,
        frames: Iterable[tuple[NDArray[np.uint8], float]],
        on_progress: ProgressCallback | None = None,
    ) -> PoseSequence:
        """Landmarks from an iterator of (RGB frame, timestamp), in fixed memory.

        This is the path real video takes. One frame is alive at a time, so clip
        length is bounded by patience rather than by RAM.

        Args:
            frames: yields each frame with its presentation time in seconds.
            on_progress: called with the number of frames done so far, for a
                caller that wants to show progress on a long clip.
        """
        import mediapipe as mp
        from mediapipe.tasks.python import vision

        xy_rows: list[NDArray[np.float32]] = []
        visibility_rows: list[NDArray[np.float32]] = []
        world_rows: list[NDArray[np.float32]] = []
        detected_rows: list[bool] = []
        times: list[float] = []
        width = height = 0

        with vision.PoseLandmarker.create_from_options(self._options()) as landmarker:
            last_ms = -1
            for index, (frame, time_s) in enumerate(frames):
                if frame.ndim != 3 or frame.shape[-1] != 3:
                    raise ValueError(f"expected an (H, W, 3) RGB frame, got {frame.shape}")
                if index == 0:
                    height, width = int(frame.shape[0]), int(frame.shape[1])

                timestamp_ms = max(round(time_s * 1000.0), last_ms + 1)
                last_ms = timestamp_ms

                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
                result = landmarker.detect_for_video(image, timestamp_ms)

                row_xy = np.zeros((NUM_LANDMARKS, 2), dtype=np.float32)
                row_visibility = np.zeros(NUM_LANDMARKS, dtype=np.float32)
                row_world = np.zeros((NUM_LANDMARKS, 3), dtype=np.float32)
                found = bool(result.pose_landmarks)

                if found:
                    for landmark_index, landmark in enumerate(result.pose_landmarks[0]):
                        if landmark_index >= NUM_LANDMARKS:
                            break
                        row_xy[landmark_index] = (landmark.x, landmark.y)
                        row_visibility[landmark_index] = float(
                            min(
                                getattr(landmark, "visibility", 1.0) or 1.0,
                                getattr(landmark, "presence", 1.0) or 1.0,
                            )
                        )
                    if result.pose_world_landmarks:
                        for landmark_index, landmark in enumerate(result.pose_world_landmarks[0]):
                            if landmark_index >= NUM_LANDMARKS:
                                break
                            row_world[landmark_index] = (landmark.x, landmark.y, landmark.z)
                elif xy_rows:
                    # Hold the last known pose so the time axis is never compressed,
                    # but at zero confidence so nothing downstream mistakes it for
                    # an observation.
                    row_xy = xy_rows[-1].copy()
                    row_world = world_rows[-1].copy()

                xy_rows.append(row_xy)
                visibility_rows.append(row_visibility)
                world_rows.append(row_world)
                detected_rows.append(found)
                times.append(time_s)

                if on_progress is not None and index % 15 == 0:
                    on_progress(index + 1)

        if not xy_rows:
            raise ValueError("no frames were supplied to the pose estimator")
        if on_progress is not None:
            on_progress(len(xy_rows))

        timestamps = np.asarray(times, dtype=np.float64)
        timestamps += np.arange(len(times)) * 1e-9  # guarantee strict increase

        return PoseSequence(
            xy=np.stack(xy_rows),
            visibility=np.stack(visibility_rows),
            timestamps_s=timestamps,
            frame_width=width,
            frame_height=height,
            world_xyz=np.stack(world_rows),
            detected=np.asarray(detected_rows, dtype=bool),
        )

    def estimate(
        self, frames: NDArray[np.uint8], timestamps_s: NDArray[np.float64]
    ) -> PoseSequence:
        """Landmarks for a stack of RGB frames, shape (T, H, W, 3).

        Convenience for callers that already hold every frame - the synthetic
        renderer, and tests. Real video goes through `estimate_stream`, which this
        delegates to so there is only one implementation to keep correct.
        """
        if frames.ndim != 4 or frames.shape[-1] != 3:
            raise ValueError(f"expected (T, H, W, 3) RGB frames, got {frames.shape}")
        if len(frames) != len(timestamps_s):
            raise ValueError("one timestamp per frame is required")
        return self.estimate_stream((frames[i], float(timestamps_s[i])) for i in range(len(frames)))
