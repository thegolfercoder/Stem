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
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.pose.base import PoseSequence
from swingml.skeleton import NUM_LANDMARKS

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)
MODEL_ENV_VAR = "SWINGML_POSE_MODEL"


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
    heavy_smoothing: bool = Field(
        default=False,
        description=(
            "MediaPipe's own landmark smoothing. Left off: it is a low-pass filter, "
            "and the events being detected are the sharpest moments in the clip. "
            "Smoothing them is smoothing away the signal."
        ),
    )


def resolve_model_path(configured: Path | None) -> Path:
    """Find the landmarker bundle, or say exactly how to get it."""
    candidates = [
        configured,
        Path(os.environ[MODEL_ENV_VAR]) if MODEL_ENV_VAR in os.environ else None,
        Path(__file__).resolve().parents[3] / "models" / "pose_landmarker_heavy.task",
        Path("models/pose_landmarker_heavy.task"),
    ]
    for candidate in candidates:
        if candidate is not None and candidate.exists():
            return candidate
    raise FileNotFoundError(
        "no pose landmarker model found. Download it with:\n"
        f"  curl -L -o models/pose_landmarker_heavy.task {MODEL_URL}\n"
        f"or point ${MODEL_ENV_VAR} at an existing copy."
    )


class MediaPipePoseEstimator:
    """Runs MediaPipe Pose over a clip and returns landmarks in the shared schema."""

    def __init__(self, config: MediaPipePoseConfig | None = None) -> None:
        self.config = config or MediaPipePoseConfig()
        self.model_path = resolve_model_path(self.config.model_path)

    def estimate(
        self, frames: NDArray[np.uint8], timestamps_s: NDArray[np.float64]
    ) -> PoseSequence:
        """Landmarks for a stack of RGB frames, shape (T, H, W, 3)."""
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        if frames.ndim != 4 or frames.shape[-1] != 3:
            raise ValueError(f"expected (T, H, W, 3) RGB frames, got {frames.shape}")
        if len(frames) != len(timestamps_s):
            raise ValueError("one timestamp per frame is required")

        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=self.config.min_detection_confidence,
            min_pose_presence_confidence=self.config.min_presence_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
            output_segmentation_masks=False,
        )

        n_frames, height, width = frames.shape[0], frames.shape[1], frames.shape[2]
        xy = np.zeros((n_frames, NUM_LANDMARKS, 2), dtype=np.float32)
        visibility = np.zeros((n_frames, NUM_LANDMARKS), dtype=np.float32)
        world = np.zeros((n_frames, NUM_LANDMARKS, 3), dtype=np.float32)
        detected = np.zeros(n_frames, dtype=bool)

        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            # MediaPipe's video mode wants integer milliseconds that strictly
            # increase. Real timestamps can collide once rounded, so the counter
            # is forced forward rather than allowed to repeat.
            last_ms = -1
            for index in range(n_frames):
                timestamp_ms = max(round(timestamps_s[index] * 1000.0), last_ms + 1)
                last_ms = timestamp_ms

                image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=np.ascontiguousarray(frames[index]),
                )
                result = landmarker.detect_for_video(image, timestamp_ms)

                if not result.pose_landmarks:
                    if index > 0:
                        xy[index] = xy[index - 1]
                        world[index] = world[index - 1]
                    visibility[index] = 0.0
                    continue

                detected[index] = True
                for landmark_index, landmark in enumerate(result.pose_landmarks[0]):
                    if landmark_index >= NUM_LANDMARKS:
                        break
                    xy[index, landmark_index] = (landmark.x, landmark.y)
                    visibility[index, landmark_index] = float(
                        min(
                            getattr(landmark, "visibility", 1.0) or 1.0,
                            getattr(landmark, "presence", 1.0) or 1.0,
                        )
                    )
                if result.pose_world_landmarks:
                    for landmark_index, landmark in enumerate(result.pose_world_landmarks[0]):
                        if landmark_index >= NUM_LANDMARKS:
                            break
                        world[index, landmark_index] = (landmark.x, landmark.y, landmark.z)

        times = np.asarray(timestamps_s, dtype=np.float64).copy()
        times += np.arange(n_frames) * 1e-9  # guarantee strict increase

        return PoseSequence(
            xy=xy,
            visibility=visibility,
            timestamps_s=times,
            frame_width=int(width),
            frame_height=int(height),
            world_xyz=world,
            detected=detected,
        )
