"""Convenience builders for synthetic radar configurations.

These are starting points for tests and sweeps, not defaults for the pipeline.
Nothing in `launchmon` reads them.
"""

from __future__ import annotations

from tests.synth.radar import (
    BallSynthConfig,
    ClubSynthConfig,
    CosineMode,
    FrontEndSynthConfig,
    GeometrySynthConfig,
    HumSynthConfig,
    NoiseSynthConfig,
    RadarSynthConfig,
)

SAMPLE_RATE_HZ = 48_000.0
CAPTURE_WINDOW_S = 0.7
IMPACT_TIME_S = 0.25


def radar_config(
    *,
    launch_speed_mps: float,
    clubhead_speed_mps: float | None = None,
    launch_angle_deg: float = 10.9,
    snr_db: float | None = 20.0,
    seed: int = 0,
    cosine_mode: CosineMode = CosineMode.ALONG_BEAM,
    hum: bool = False,
    passband: tuple[float | None, float | None] = (200.0, 15_000.0),
    drag_coefficient: float = 0.214,
    range_envelope: bool = True,
    beam_envelope: bool = True,
    bit_depth: int | None = 24,
    duration_s: float = CAPTURE_WINDOW_S,
    impact_time_s: float = IMPACT_TIME_S,
    club_weight_exponent: float = 6.0,
    n_scatterers: int = 24,
) -> RadarSynthConfig:
    """Build a configuration for one shot at a given launch speed.

    `clubhead_speed_mps` defaults to a smash factor of 1.48, which is a plausible
    driver figure used only to place the club band somewhere sensible relative to
    the ball band. It is a generator input, never an assumption of the pipeline.
    """
    if clubhead_speed_mps is None:
        clubhead_speed_mps = launch_speed_mps / 1.48
    return RadarSynthConfig(
        sample_rate_hz=SAMPLE_RATE_HZ,
        duration_s=duration_s,
        impact_time_s=impact_time_s,
        club=ClubSynthConfig(
            peak_speed_mps=clubhead_speed_mps,
            downswing_duration_s=0.25,
            profile_exponent=1.6,
            n_scatterers=n_scatterers,
            radius_fraction_min=0.25,
            weight_exponent=club_weight_exponent,
            collapse_time_constant_s=0.02,
            amplitude=1.0,
        ),
        ball=BallSynthConfig(
            launch_speed_mps=launch_speed_mps,
            launch_angle_deg=launch_angle_deg,
            drag_coefficient=drag_coefficient,
            amplitude=0.5,
        ),
        geometry=GeometrySynthConfig(
            sensor_range_m=1.4,
            sensor_height_m=0.05,
            tee_height_m=0.05,
            azimuth_beamwidth_deg=80.0,
            elevation_beamwidth_deg=40.0,
            cosine_mode=cosine_mode,
            range_envelope=range_envelope,
            beam_envelope=beam_envelope,
        ),
        noise=NoiseSynthConfig(snr_db=snr_db, window_s=0.05, seed=seed),
        hum=(
            HumSynthConfig(
                fundamental_hz=100.0, n_harmonics=8, level_dbc=12.0, harmonic_rolloff_db=3.0
            )
            if hum
            else None
        ),
        front_end=FrontEndSynthConfig(
            passband_low_hz=passband[0],
            passband_high_hz=passband[1],
            filter_order=2,
            dc_offset=0.3,
            bit_depth=bit_depth,
            full_scale=4.0,
        ),
    )
