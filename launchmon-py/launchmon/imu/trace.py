"""IMU samples in physical units, with the sensor's own limits carried alongside.

The pod streams raw counts. Converting them here, once, keeps every later
stage in degrees per second and g, and keeps the record of which samples sat
at full scale: a clipped sample is not a measurement of the rate, only a lower
bound on it, and anything computed across one has to say so.
"""

from __future__ import annotations

from typing import Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

# Datasheet sensitivities of the LSM6DS3TR-C and LSM6DSOX at the ranges the pod
# firmware sets: +/-2000 dps and +/-16 g.
GYRO_DPS_PER_LSB_2000 = 0.070
ACCEL_G_PER_LSB_16 = 0.000488
CLIP_COUNTS = 32_700


class ImuTrace(BaseModel):
    """One stretch of 6-axis samples on one clock."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    t_s: NDArray[np.float64] = Field(description="Sample times, s, on the clock named in `clock`.")
    gyro_dps: NDArray[np.float64] = Field(description="(n, 3) angular rate, deg/s, pod axes.")
    accel_g: NDArray[np.float64] = Field(description="(n, 3) specific force, g, pod axes.")
    gyro_clipped: NDArray[np.bool_] = Field(description="(n,) any gyro axis at full scale.")
    accel_clipped: NDArray[np.bool_] = Field(description="(n,) any accel axis at full scale.")
    gyro_full_scale_dps: float
    accel_full_scale_g: float
    clock: str = Field(description="Which clock t_s is on, e.g. 'ground', 'pod', 'shot'.")

    @model_validator(mode="after")
    def _shapes(self) -> Self:
        n = self.t_s.size
        if self.gyro_dps.shape != (n, 3) or self.accel_g.shape != (n, 3):
            raise ValueError("gyro and accel must be (n, 3) with n matching t_s")
        if self.gyro_clipped.shape != (n,) or self.accel_clipped.shape != (n,):
            raise ValueError("clip masks must be (n,)")
        if n > 1 and np.any(np.diff(self.t_s) <= 0):
            raise ValueError("sample times must be strictly increasing")
        return self

    @property
    def n(self) -> int:
        return int(self.t_s.size)

    @property
    def sample_period_s(self) -> float:
        """Median spacing: the measured rate, not the nominal ODR."""
        return float(np.median(np.diff(self.t_s))) if self.n > 1 else float("nan")

    def gyro_magnitude_dps(self) -> NDArray[np.float64]:
        return np.asarray(np.linalg.norm(self.gyro_dps, axis=1), dtype=np.float64)

    def accel_magnitude_g(self) -> NDArray[np.float64]:
        return np.asarray(np.linalg.norm(self.accel_g, axis=1), dtype=np.float64)

    def shifted(self, offset_s: float, clock: str) -> ImuTrace:
        """The same samples with offset_s added to every time, relabelled to `clock`."""
        return self.model_copy(update={"t_s": self.t_s + offset_s, "clock": clock})


def trace_from_counts(
    t_us: NDArray[np.integer] | NDArray[np.floating],
    counts: NDArray[np.integer],
    *,
    clock: str,
    gyro_dps_per_lsb: float = GYRO_DPS_PER_LSB_2000,
    accel_g_per_lsb: float = ACCEL_G_PER_LSB_16,
    clip_counts: int = CLIP_COUNTS,
) -> ImuTrace:
    """Raw pod counts (n, 6) in register order gx gy gz ax ay az, to physical units.

    Timestamps are unwrapped: the pod and the ground unit both stamp samples with
    32-bit microsecond counters, which wrap every 71.6 minutes.
    """
    c = np.asarray(counts, dtype=np.int64)
    if c.ndim != 2 or c.shape[1] != 6:
        raise ValueError("counts must be (n, 6): gx gy gz ax ay az")
    t = np.asarray(t_us, dtype=np.float64)
    if t.size > 1:
        steps = np.diff(t)
        steps = np.where(steps < -(2.0**31), steps + 2.0**32, steps)
        t = np.concatenate(([t[0]], t[0] + np.cumsum(steps)))
    clipped = np.abs(c) >= clip_counts
    return ImuTrace(
        t_s=t * 1e-6,
        gyro_dps=c[:, :3].astype(np.float64) * gyro_dps_per_lsb,
        accel_g=c[:, 3:].astype(np.float64) * accel_g_per_lsb,
        gyro_clipped=np.asarray(clipped[:, :3].any(axis=1), dtype=np.bool_),
        accel_clipped=np.asarray(clipped[:, 3:].any(axis=1), dtype=np.bool_),
        gyro_full_scale_dps=32_768 * gyro_dps_per_lsb,
        accel_full_scale_g=32_768 * accel_g_per_lsb,
        clock=clock,
    )
