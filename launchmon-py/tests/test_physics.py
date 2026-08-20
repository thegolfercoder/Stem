"""The physics must reproduce the figures the project was designed around."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.config import RadarGeometryConfig, cosine_correction_factor
from launchmon.physics import (
    ball_frontal_area_m2,
    doppler_hz_per_mps,
    doppler_hz_to_speed,
    drag_decay_speed,
    drag_decel_coefficient,
    speed_to_doppler_hz,
)


def test_doppler_sensitivity_is_derived_not_written_down() -> None:
    assert doppler_hz_per_mps() == pytest.approx(160.94, abs=0.01)


@pytest.mark.parametrize(
    ("speed_mps", "tone_hz"),
    [
        (74.66, 12_020.0),  # PGA driver ball, 167 mph
        (53.64, 8_630.0),  # PGA 7-iron ball, 120 mph
        (50.51, 8_130.0),  # PGA driver clubhead, 113 mph
        (62.58, 10_070.0),  # LPGA driver ball, 140 mph
        (15.00, 2_410.0),  # chip
    ],
)
def test_doppler_tone_table(speed_mps: float, tone_hz: float) -> None:
    # The brief quotes these to three significant figures; that is the tolerance.
    assert float(speed_to_doppler_hz(speed_mps)) == pytest.approx(tone_hz, abs=10.0)


def test_doppler_round_trip() -> None:
    speeds = np.array([15.0, 40.0, 74.66])
    assert doppler_hz_to_speed(speed_to_doppler_hz(speeds)) == pytest.approx(speeds)


def test_every_tone_sits_below_nyquist_at_48_khz() -> None:
    # 48 kHz is the ceiling iOS allows on USB audio input; nothing may assume more.
    assert float(speed_to_doppler_hz(100.0)) < 24_000.0


def test_ball_frontal_area() -> None:
    assert ball_frontal_area_m2() == pytest.approx(1.430e-3, rel=1e-3)


def test_drag_decay_is_the_exact_solution_of_the_ode() -> None:
    k = drag_decel_coefficient(0.214)
    t = np.linspace(0.0, 0.5, 5001)
    v = drag_decay_speed(t, 74.66, k)
    numerical = np.gradient(v, t)
    assert numerical[1:-1] == pytest.approx(-k * v[1:-1] ** 2, rel=1e-4)


@pytest.mark.parametrize(
    ("launch_angle_deg", "under_read_percent"),
    [(10.9, 1.0), (16.3, 2.2), (24.2, 4.8)],
)
def test_cosine_under_read_over_the_first_metre(
    launch_angle_deg: float, under_read_percent: float
) -> None:
    """A ground-level sensor 1.4 m behind the ball, averaged over the first metre."""
    geometry = RadarGeometryConfig(
        range_from_tee_m=1.4,
        height_m=0.05,
        tee_height_m=0.05,
        azimuth_beamwidth_deg=80.0,
        elevation_beamwidth_deg=40.0,
    )
    factor = cosine_correction_factor(geometry, launch_angle_deg, average_over_m=1.0)
    assert 100.0 * (1.0 - factor) == pytest.approx(under_read_percent, abs=0.3)


def test_mounting_height_changes_the_cosine_correction() -> None:
    """Tripod versus ground is not a detail: it moves the correction materially."""

    def factor(height_m: float) -> float:
        geometry = RadarGeometryConfig(
            range_from_tee_m=1.4,
            height_m=height_m,
            tee_height_m=0.05,
            azimuth_beamwidth_deg=80.0,
            elevation_beamwidth_deg=40.0,
        )
        return cosine_correction_factor(geometry, 10.9, average_over_m=1.0)

    ground, tripod = factor(0.05), factor(0.60)
    assert abs(ground - tripod) > 0.005
