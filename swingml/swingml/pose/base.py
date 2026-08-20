"""The pose container, and the seam every pose estimator plugs into.

Keeping the estimator behind a protocol is not architectural politeness. The
model that runs in Python for research and the model that will eventually run on
the phone are not the same model, and neither is the one that gets swapped in
when a better one appears. Everything downstream depends on the *schema* -
thirty-three landmarks, image-normalised coordinates, real timestamps - and on
nothing else about how they were produced.
"""

from __future__ import annotations

from typing import Protocol, Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from swingml.skeleton import NUM_LANDMARKS


class PoseSequence(BaseModel):
    """Landmarks for every frame of a clip, with the times they were taken.

    Coordinates are image-normalised: x in [0, 1] across the width, y in [0, 1]
    down the height, exactly as MediaPipe reports them. That means x and y are
    *not* in the same units unless the frame is square, which is why
    `aspect_ratio` is carried and why nothing may compute an angle from these
    numbers without correcting for it first.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    xy: NDArray[np.float32] = Field(description="(T, 33, 2) image-normalised landmark positions.")
    visibility: NDArray[np.float32] = Field(description="(T, 33) landmark confidence in [0, 1].")
    timestamps_s: NDArray[np.float64] = Field(
        description=(
            "(T,) presentation time of each frame, from the container rather than "
            "assumed from a nominal frame rate. iPhone slow-motion clips in "
            "particular do not play at the rate they were captured at."
        )
    )
    frame_width: int
    frame_height: int
    world_xyz: NDArray[np.float32] | None = Field(
        default=None,
        description=(
            "(T, 33, 3) the estimator's own metric-scale output, origin at the hips. "
            "Inferred by a network from one view rather than triangulated, so it is a "
            "model's opinion about depth, not a measurement of it."
        ),
    )
    detected: NDArray[np.bool_] | None = Field(
        default=None, description="(T,) whether a body was found at all in each frame."
    )

    @model_validator(mode="after")
    def _shapes_agree(self) -> Self:
        n = self.xy.shape[0]
        if self.xy.shape != (n, NUM_LANDMARKS, 2):
            raise ValueError(f"xy must be (T, {NUM_LANDMARKS}, 2), got {self.xy.shape}")
        if self.visibility.shape != (n, NUM_LANDMARKS):
            raise ValueError(
                f"visibility must be (T, {NUM_LANDMARKS}), got {self.visibility.shape}"
            )
        if self.timestamps_s.shape != (n,):
            raise ValueError(f"timestamps_s must be (T,), got {self.timestamps_s.shape}")
        if self.world_xyz is not None and self.world_xyz.shape != (n, NUM_LANDMARKS, 3):
            raise ValueError("world_xyz must be (T, 33, 3)")
        if n > 1 and np.any(np.diff(self.timestamps_s) <= 0):
            raise ValueError("frame timestamps must strictly increase")
        return self

    @property
    def n_frames(self) -> int:
        return int(self.xy.shape[0])

    @property
    def aspect_ratio(self) -> float:
        """Width over height. The factor that makes x and y comparable."""
        return self.frame_width / self.frame_height

    @property
    def duration_s(self) -> float:
        return float(self.timestamps_s[-1] - self.timestamps_s[0]) if self.n_frames > 1 else 0.0

    @property
    def median_frame_rate_hz(self) -> float:
        if self.n_frames < 2:
            return float("nan")
        return float(1.0 / np.median(np.diff(self.timestamps_s)))

    def square_xy(self) -> NDArray[np.float32]:
        """Coordinates in square units, so that an angle computed from them is real.

        Scaling x by the aspect ratio puts both axes in units of frame *height*.
        Skipping this silently distorts every angle in the system by the aspect
        ratio, which for a 16:9 phone clip is a factor of 1.78 - large enough to
        turn a correct shoulder line into a wrong one and small enough to look
        plausible.
        """
        out = self.xy.astype(np.float32).copy()
        out[..., 0] *= np.float32(self.aspect_ratio)
        return out

    def slice_frames(self, start: int, end: int) -> PoseSequence:
        return PoseSequence(
            xy=self.xy[start:end],
            visibility=self.visibility[start:end],
            timestamps_s=self.timestamps_s[start:end],
            frame_width=self.frame_width,
            frame_height=self.frame_height,
            world_xyz=None if self.world_xyz is None else self.world_xyz[start:end],
            detected=None if self.detected is None else self.detected[start:end],
        )


class PoseEstimator(Protocol):
    """Anything that turns a clip into a `PoseSequence`."""

    def estimate(
        self, frames: NDArray[np.uint8], timestamps_s: NDArray[np.float64]
    ) -> PoseSequence:
        """Landmarks for a stack of RGB frames, shape (T, H, W, 3)."""
        ...
