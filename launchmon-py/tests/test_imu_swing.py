"""Swing events and shaft rotation from the pod, scored against synthetic swings."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.imu.swing import ImuSwingConfig, analyse_imu_swing
from launchmon.imu.trace import trace_from_counts
from launchmon.quantity import NoReading, Provenance, Quantity
from tests.synth.imu import generate_imu_swing

CONFIG = ImuSwingConfig()


def _analyse(**kwargs: object):  # type: ignore[no-untyped-def]
    swing = generate_imu_swing(**kwargs)  # type: ignore[arg-type]
    trace = trace_from_counts(swing.t_us, swing.counts, clock="pod")
    return analyse_imu_swing(trace, CONFIG), swing.truth, trace


@pytest.mark.parametrize("seed", range(5))
@pytest.mark.parametrize("downswing_s", [0.22, 0.30])
def test_events_land_within_a_few_milliseconds(seed: int, downswing_s: float) -> None:
    result, truth, trace = _analyse(seed=seed, downswing_s=downswing_s)
    dt = trace.sample_period_s
    assert isinstance(result.impact_time_s, Quantity), result.impact_time_s
    assert abs(result.impact_time_s.value - truth.impact_s) <= 1.5 * dt
    assert isinstance(result.top_time_s, Quantity)
    assert abs(result.top_time_s.value - truth.top_s) < 0.002
    assert isinstance(result.takeaway_time_s, Quantity), result.takeaway_time_s
    assert abs(result.takeaway_time_s.value - truth.takeaway_s) < 0.015


def test_rates_are_measured_and_match_the_truth() -> None:
    result, truth, _ = _analyse()
    assert isinstance(result.peak_shaft_rate, Quantity)
    assert result.peak_shaft_rate.provenance is Provenance.MEASURED
    assert abs(result.peak_shaft_rate.value - truth.peak_rate_dps) / truth.peak_rate_dps < 0.03
    assert isinstance(result.shaft_rate_at_impact, Quantity)
    assert (
        abs(result.shaft_rate_at_impact.value - truth.rate_at_impact_dps) / truth.rate_at_impact_dps
        < 0.05
    )


def test_a_clipped_gyro_refuses_the_rate_but_keeps_the_timing() -> None:
    result, truth, trace = _analyse(downswing_peak_dps=2600.0)
    assert trace.gyro_clipped.any()
    assert isinstance(result.peak_shaft_rate, NoReading)
    assert "full scale" in result.peak_shaft_rate.reason
    assert isinstance(result.shaft_rate_at_impact, NoReading)
    assert isinstance(result.impact_time_s, Quantity)
    # At this speed the accelerometer is also at full scale along the shaft, which
    # hides part of the ring; the onset is found a sample or two late.
    assert abs(result.impact_time_s.value - truth.impact_s) <= 3 * trace.sample_period_s


def test_a_swing_without_a_strike_is_refused_with_a_reason() -> None:
    # No ball: no ring, and no sudden loss of rotation rate either.
    result, _, _ = _analyse(shock_g=0.0, impact_rate_drop=0.0)
    assert isinstance(result.impact_time_s, NoReading)
    assert "shock" in result.impact_time_s.reason
    assert isinstance(result.top_time_s, NoReading)


def test_an_expected_impact_narrows_the_search_to_the_right_shock() -> None:
    _, truth, _ = _analyse(clock_offset_s=12.0)
    expected = truth.impact_s + 0.02  # another sensor's impact, mapped with BLE-clock error
    narrowed = analyse_imu_swing(
        trace_from_counts(*_raw(clock_offset_s=12.0), clock="pod"),
        CONFIG,
        expected_impact_s=expected,
    )
    assert isinstance(narrowed.impact_time_s, Quantity)
    assert abs(narrowed.impact_time_s.value - truth.impact_s) < 0.002


def _raw(**kwargs: object) -> tuple[np.ndarray, np.ndarray]:
    s = generate_imu_swing(**kwargs)  # type: ignore[arg-type]
    return s.t_us, s.counts


def test_timestamps_that_wrap_are_unwrapped() -> None:
    s = generate_imu_swing(clock_offset_s=4294.0)  # 32-bit microseconds wrap at 4294.97 s
    wrapped = np.mod(s.t_us, 2**32)
    trace = trace_from_counts(wrapped, s.counts, clock="pod")
    assert np.all(np.diff(trace.t_s) > 0)
