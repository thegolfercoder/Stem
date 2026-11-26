"""Club-mounted IMU swings with known ground truth.

A deliberately simple model of what the pod sees, built to test event finding
and clock alignment rather than to imitate a golfer:

* the shaft turns mainly about one pod axis, one way through the backswing and
  the other way through the downswing, so the rotation rate passes close to
  zero at the top;
* centripetal acceleration grows with the square of the rotation rate;
* impact rings the shaft: a damped oscillation in specific force, and the
  rotation rate drops as the club gives up energy to the ball;
* sensor noise, quantisation to raw counts, and clipping at full scale.

Times are on the pod's own clock, offset by `clock_offset_s` from the swing's
timeline, so alignment can be scored against a known offset.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from launchmon.imu.trace import ACCEL_G_PER_LSB_16, GYRO_DPS_PER_LSB_2000


class ImuSwingTruth(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    takeaway_s: float
    top_s: float
    impact_s: float
    peak_rate_dps: float
    rate_at_impact_dps: float


class SyntheticImuSwing(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    t_us: NDArray[np.float64]
    counts: NDArray[np.int64]
    truth: ImuSwingTruth


def generate_imu_swing(
    *,
    fs_hz: float = 1666.0,
    takeaway_s: float = 1.0,
    backswing_s: float = 0.80,
    downswing_s: float = 0.27,
    backswing_peak_dps: float = 350.0,
    downswing_peak_dps: float = 1500.0,
    impact_rate_drop: float = 0.15,
    pod_radius_m: float = 0.10,
    shock_g: float = 10.0,
    gyro_noise_dps: float = 2.0,
    accel_noise_g: float = 0.02,
    duration_s: float = 2.6,
    clock_offset_s: float = 0.0,
    timestamp_jitter_us: float = 20.0,
    seed: int = 0,
) -> SyntheticImuSwing:
    rng = np.random.default_rng(seed)
    n = round(duration_s * fs_hz)
    t = np.arange(n) / fs_hz
    top = takeaway_s + backswing_s
    impact = top + downswing_s

    rate = np.zeros(n)
    bs = (t >= takeaway_s) & (t < top)
    rate[bs] = -backswing_peak_dps * np.sin(np.pi * (t[bs] - takeaway_s) / backswing_s)
    ds = (t >= top) & (t < impact)
    rate[ds] = downswing_peak_dps * ((t[ds] - top) / downswing_s) ** 2
    after = t >= impact
    rate[after] = downswing_peak_dps * (1 - impact_rate_drop) * np.exp(-(t[after] - impact) / 0.15)

    gyro = np.stack([0.15 * rate, rate, 0.08 * np.abs(rate)], axis=1)
    gyro += gyro_noise_dps * rng.standard_normal((n, 3))

    omega = np.radians(rate)
    accel = np.zeros((n, 3))
    accel[:, 0] = omega**2 * pod_radius_m / 9.80665  # centripetal, along the shaft
    accel[:, 2] = 1.0  # gravity, roughly
    ring = np.zeros(n)
    k = after
    ring[k] = (
        shock_g
        * np.exp(-(t[k] - impact) / 0.004)
        * np.sin(2 * np.pi * 380.0 * (t[k] - impact) + 0.6)
    )
    accel += np.stack([ring, 0.7 * ring, 0.4 * ring], axis=1)
    accel += accel_noise_g * rng.standard_normal((n, 3))

    counts = np.concatenate(
        [np.round(gyro / GYRO_DPS_PER_LSB_2000), np.round(accel / ACCEL_G_PER_LSB_16)], axis=1
    )
    counts = np.clip(counts, -32768, 32767).astype(np.int64)

    t_us = (t + clock_offset_s) * 1e6 + timestamp_jitter_us * rng.standard_normal(n)
    t_us = np.maximum.accumulate(t_us + np.arange(n) * 1e-3)  # keep strictly increasing
    mag = np.linalg.norm(gyro, axis=1)
    pre = (t >= impact - 0.003) & (t < impact)
    return SyntheticImuSwing(
        t_us=t_us,
        counts=counts,
        truth=ImuSwingTruth(
            takeaway_s=takeaway_s + clock_offset_s,
            top_s=top + clock_offset_s,
            impact_s=impact + clock_offset_s,
            peak_rate_dps=float(mag[(t >= top) & (t < impact)].max()),
            rate_at_impact_dps=float(mag[pre].mean()),
        ),
    )
