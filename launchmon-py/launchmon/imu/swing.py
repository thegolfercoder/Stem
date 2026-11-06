"""Swing timing and shaft rotation from the club-mounted IMU.

What the pod can measure well, and what it cannot
--------------------------------------------------
The gyro sees the shaft's rotation directly and at 1.66 kHz, so the moments the
swing changes character are sharp in it: the shaft starts turning at the
takeaway, nearly stops as it reverses at the top, and the impact arrives as a
shock in the accelerometer within a sample or two. Those three times are what
this module produces, and they are what the other sensors are aligned by.

The rotation rate is reported as measured, and refused where the gyro was at
full scale: a clipped sample says only that the rate was at least 2000 deg/s,
and a fast downswing can exceed that. The pod is not asked for the face, the
path or the plane of the swing. A single IMU at this price cannot give them
reliably, and the instrument does not report them.

Definitions match swingml's, so the two can be compared: the backswing runs
from the takeaway (swingml's "address") to the top, and the downswing from the
top to impact.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from launchmon.imu.trace import ImuTrace
from launchmon.quantity import NoReading, Provenance, Quantity, Reading


class ImuSwingConfig(BaseModel):
    """Thresholds for finding the swing's events. Calibrations, not measurements."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    smoothing_s: float = Field(
        default=0.003,
        description="Moving-average length on the rotation rate before events are found.",
    )
    still_dps: float = Field(
        default=30.0,
        description=(
            "Rotation rate below which the shaft is taken to be still. The takeaway is "
            "found where the rate leaves this level, then extrapolated back to zero."
        ),
    )
    backswing_min_dps: float = Field(
        default=100.0, description="A backswing must turn the shaft at least this fast."
    )
    top_fraction: float = Field(
        default=0.5,
        description="At the top the rate must fall below this fraction of the downswing peak.",
    )
    downswing_s: tuple[float, float] = Field(
        default=(0.10, 1.00), description="How long a downswing can take (as swingml)."
    )
    backswing_s: tuple[float, float] = Field(
        default=(0.30, 2.50), description="How long a backswing can take (as swingml)."
    )
    shock_min_g: float = Field(
        default=1.5,
        description=(
            "Smallest sample-to-sample jump in specific force accepted as the impact "
            "shock. Ball strike rings the shaft far harder than anything in the swing."
        ),
    )
    shock_snr: float = Field(
        default=8.0,
        description="The shock must stand this many times above the trace's median jump.",
    )
    impact_search_s: float = Field(
        default=0.05,
        description=(
            "Half-width of the window searched for the shock when another sensor has "
            "said roughly when impact was. Covers the BLE clock mapping's uncertainty."
        ),
    )
    impact_rate_window_s: float = Field(
        default=0.003, description="The rate at impact is averaged over this long just before it."
    )


class ImuSwing(BaseModel):
    """Everything the pod gave for one swing, on the clock its trace was on."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    clock: str
    impact_time_s: Reading
    top_time_s: Reading
    takeaway_time_s: Reading
    peak_shaft_rate: Reading
    shaft_rate_at_impact: Reading
    backswing_duration: Reading
    downswing_duration: Reading
    sample_period_s: float = Field(description="Measured median spacing of the samples.")


def _smooth(x: NDArray[np.float64], n: int) -> NDArray[np.float64]:
    if n <= 1:
        return x
    kernel = np.ones(n) / n
    return np.asarray(np.convolve(x, kernel, mode="same"), dtype=np.float64)


def _time(value: float, source: str = "imu") -> Quantity:
    return Quantity(value=value, unit="s", provenance=Provenance.MEASURED, source=source)


def _refuse(reason: str) -> NoReading:
    return NoReading(reason=reason, source="imu")


def find_impact_shock(
    trace: ImuTrace, config: ImuSwingConfig, expected_s: float | None = None
) -> Reading:
    """Time of the impact shock: the first sample of the sharpest jump in specific force.

    With `expected_s` (another sensor's impact, mapped onto this trace's clock)
    the search is confined to that neighbourhood; without it, to the stretch
    around the fastest rotation, which a struck shot reaches at or just before
    impact.
    """
    t = trace.t_s
    if trace.n < 16:
        return _refuse("too few samples")
    jerk = np.abs(np.diff(trace.accel_magnitude_g()))
    t_jerk = 0.5 * (t[1:] + t[:-1])  # a jump sits between its two samples
    if expected_s is not None:
        lo, hi = expected_s - config.impact_search_s, expected_s + config.impact_search_s
    else:
        w = trace.gyro_magnitude_dps()
        t_peak = float(t[int(np.argmax(w))])
        lo, hi = t_peak - 0.15, t_peak + 0.15
    window = np.flatnonzero((t_jerk >= lo) & (t_jerk <= hi))
    if window.size == 0:
        return _refuse("no samples in the impact search window")
    peak = float(jerk[window].max())
    floor = float(np.median(jerk))
    if peak < config.shock_min_g:
        return _refuse(
            f"no impact shock: the largest jump in specific force near impact is "
            f"{peak:.2f} g, below the {config.shock_min_g:.1f} g a strike produces"
        )
    if floor > 0 and peak < config.shock_snr * floor:
        return _refuse("no impact shock that stands clear of the swing's own vibration")
    onset = window[np.argmax(jerk[window] >= 0.5 * peak)]
    return _time(float(t_jerk[onset]))


def _refine_top(trace: ImuTrace, w: NDArray[np.float64], i_coarse: int, bs_hi: float) -> float:
    """The moment the backswing's rotation reaches zero.

    The slowest point is a poor estimate on its own: the downswing starts gently,
    so the rate sits near zero for several milliseconds after the reversal and
    noise decides where in that stretch the minimum falls. The backswing side is
    different. The shaft decelerates steeply into the top, so the rotation
    projected onto the backswing's own axis crosses zero cleanly, and a line
    through its last stretch places the crossing to a fraction of a sample.
    Falls back to the slowest point if no clean crossing is found near it.
    """
    t = trace.t_s
    win = np.flatnonzero((t >= t[i_coarse] - bs_hi) & (t < t[i_coarse]))
    if win.size < 8:
        return float(t[i_coarse])
    i_bs = int(win[np.argmax(w[win])])
    axis = trace.gyro_dps[i_bs] / max(float(np.linalg.norm(trace.gyro_dps[i_bs])), 1e-9)
    s = trace.gyro_dps @ axis  # positive through the backswing
    after = np.flatnonzero(s[i_bs:] <= 0.0)
    if after.size == 0:
        return float(t[i_coarse])
    i_zero = i_bs + int(after[0])
    seg = np.arange(i_bs, i_zero)
    seg = seg[(s[seg] > 0) & (s[seg] <= 0.3 * s[i_bs])]
    if seg.size >= 3:
        slope, intercept = np.polyfit(t[seg], s[seg], 1)
        t_zero = -intercept / slope if slope < 0 else float(t[i_zero])
    else:
        t_zero = float(t[i_zero])
    # Trust the crossing only if it sits near the slowest point.
    return float(t_zero) if abs(t_zero - t[i_coarse]) < 0.05 else float(t[i_coarse])


def analyse_imu_swing(
    trace: ImuTrace, config: ImuSwingConfig, expected_impact_s: float | None = None
) -> ImuSwing:
    t = trace.t_s
    dt = trace.sample_period_s
    w = _smooth(trace.gyro_magnitude_dps(), max(1, round(config.smoothing_s / dt)))

    def done(**fields: Reading) -> ImuSwing:
        refusal = fields.get("impact_time_s", _refuse("no swing"))
        empty: dict[str, Reading] = {
            k: refusal if isinstance(refusal, NoReading) else _refuse("depends on a refused event")
            for k in ImuSwing.model_fields
            if k not in ("clock", "sample_period_s")
        }
        empty.update(fields)
        return ImuSwing(clock=trace.clock, sample_period_s=dt, **empty)

    impact = find_impact_shock(trace, config, expected_impact_s)
    if isinstance(impact, NoReading):
        return done(impact_time_s=impact)
    t_imp = impact.value
    i_imp = int(np.searchsorted(t, t_imp))

    # --- Top: the slowest point between the plausible downswing limits --------
    ds_lo, ds_hi = config.downswing_s
    top_win = np.flatnonzero((t >= t_imp - ds_hi) & (t <= t_imp - ds_lo))
    if top_win.size < 3:
        return done(
            impact_time_s=impact, top_time_s=_refuse("trace does not reach back to the top")
        )
    i_top = int(top_win[np.argmin(w[top_win])])
    peak_ds = float(np.max(w[i_top:i_imp])) if i_imp > i_top else 0.0
    if w[i_top] > config.top_fraction * peak_ds:
        return done(
            impact_time_s=impact,
            top_time_s=_refuse("no clear transition: the shaft never slowed at the top"),
        )
    bs_lo, bs_hi = config.backswing_s
    t_top = _refine_top(trace, w, i_top, bs_hi)
    top = _time(t_top)
    i_top = int(np.clip(np.searchsorted(t, t_top), 0, trace.n - 1))

    # --- Takeaway: back from the backswing's fastest point to where the shaft was still
    bs_win = np.flatnonzero((t >= t[i_top] - bs_hi) & (t < t[i_top]))
    takeaway: Reading
    if bs_win.size == 0 or float(np.max(w[bs_win])) < config.backswing_min_dps:
        takeaway = _refuse("no backswing found before the top")
    else:
        i_bs = int(bs_win[np.argmax(w[bs_win])])
        still = np.flatnonzero(w[: i_bs + 1] < config.still_dps)
        if still.size == 0:
            takeaway = _refuse("the trace starts after the takeaway")
        else:
            i0 = int(still[-1])
            # The rate leaves rest roughly linearly; extrapolate the climb from
            # still_dps to three times it back to zero, so the result does not
            # depend on where the threshold was set.
            climb = np.flatnonzero(w[i0 : i_bs + 1] <= 3 * config.still_dps) + i0
            if climb.size >= 3:
                slope, intercept = np.polyfit(t[climb], w[climb], 1)
                t0 = -intercept / slope if slope > 0 else float(t[i0])
                t0 = float(np.clip(t0, t[max(0, i0 - 50)], t[i0 + 1]))
            else:
                t0 = float(t[i0])
            span = t[i_top] - t0
            takeaway = (
                _time(t0)
                if bs_lo <= span <= bs_hi
                else _refuse(f"a {span:.2f} s backswing is outside the plausible range")
            )

    # --- Rotation rates -------------------------------------------------------
    clipped_ds = bool(trace.gyro_clipped[i_top : i_imp + 1].any())
    peak_rate: Reading = (
        _refuse("gyro at full scale during the downswing: the peak rate is unknown")
        if clipped_ds
        else Quantity(value=peak_ds, unit="deg/s", provenance=Provenance.MEASURED, source="imu")
    )
    n_rate = max(1, round(config.impact_rate_window_s / dt))
    pre = slice(max(i_top, i_imp - n_rate), i_imp)
    rate_at_impact: Reading = (
        _refuse("gyro at full scale just before impact")
        if trace.gyro_clipped[pre].any()
        else Quantity(
            value=float(trace.gyro_magnitude_dps()[pre].mean()),
            unit="deg/s",
            provenance=Provenance.MEASURED,
            source="imu",
        )
    )

    backswing: Reading = (
        Quantity(
            value=1000.0 * (top.value - takeaway.value),
            unit="ms",
            provenance=Provenance.MEASURED,
            source="imu",
        )
        if isinstance(takeaway, Quantity)
        else _refuse("needs the takeaway")
    )
    downswing = Quantity(
        value=1000.0 * (t_imp - top.value), unit="ms", provenance=Provenance.MEASURED, source="imu"
    )
    return ImuSwing(
        clock=trace.clock,
        impact_time_s=impact,
        top_time_s=top,
        takeaway_time_s=takeaway,
        peak_shaft_rate=peak_rate,
        shaft_rate_at_impact=rate_at_impact,
        backswing_duration=backswing,
        downswing_duration=downswing,
        sample_period_s=dt,
    )
