"""A starting configuration for the radar pipeline.

This is the configuration the golden vectors are generated with, so it is part
of the contract with the Swift port. It is a starting point chosen from what the
synthetic study showed, not a tuned optimum, and every value is overridable at
the call site because replay exists to vary them.
"""

from __future__ import annotations

from launchmon.dsp.interference import InterferenceConfig
from launchmon.dsp.pipeline import RadarPipelineConfig
from launchmon.dsp.ridge import RidgeConfig
from launchmon.dsp.segment import SegmentConfig
from launchmon.dsp.speed import BallSpeedConfig, ClubSpeedConfig, DecayFitMode
from launchmon.dsp.stft import StftConfig


def default_radar_pipeline(
    sample_rate_hz: float = 48_000.0,
    n_fft: int = 2048,
    hop: int = 512,
    drag_coefficient: float = 0.214,
    band_high_hz: float = 20_000.0,
    front_end_passband_hz: tuple[float, float] = (200.0, 15_000.0),
) -> RadarPipelineConfig:
    """The canonical radar pipeline configuration.

    The default transform is 2048 points with a 512-sample hop: 42.7 ms frames,
    23.44 Hz bins, 75 percent overlap. Both are arguments because the choice
    trades frequency resolution against the fact that a driven ball's tone sweeps
    downward within a single frame, and the right answer depends on the analogue
    front end.
    """
    return RadarPipelineConfig(
        stft=StftConfig(sample_rate_hz=sample_rate_hz, n_fft=n_fft, hop=hop),
        interference=InterferenceConfig(presence_fraction=0.8, margin_db=15.0),
        segment=SegmentConfig(
            search_start_s=0.02,
            search_end_s=0.60,
            band_low_hz=300.0,
            band_high_hz=band_high_hz,
            detection_margin_db=15.0,
            min_ball_to_club_ratio=1.05,
            club_edge_drop_db=12.0,
            envelope_window_s=0.001,
            onset_threshold_fraction=0.5,
            ball_band_margin_hz=600.0,
            plateau_window_s=0.010,
        ),
        club_ridge=RidgeConfig(
            band_low_hz=300.0,
            band_high_hz=band_high_hz,
            n_candidates=5,
            max_jump_hz=1500.0,
            jump_penalty_db_per_hz=0.01,
            min_snr_db=15.0,
        ),
        ball_ridge=RidgeConfig(
            band_low_hz=300.0,
            band_high_hz=band_high_hz,
            n_candidates=5,
            max_jump_hz=1500.0,
            jump_penalty_db_per_hz=0.01,
            min_snr_db=15.0,
        ),
        ball_speed=BallSpeedConfig(
            fit_mode=DecayFitMode.AUTO,
            drag_coefficient=drag_coefficient,
            min_frames=3,
            min_frames_free_k=8,
            max_condition_number=1.0e6,
            extrapolation_tolerance_multiple=3.0,
            max_extrapolation_fraction=0.01,
            max_weighted_residual_fraction=0.075,
        ),
        club_speed=ClubSpeedConfig(
            edge_drop_db=12.0,
            n_frames_before_impact=4,
            min_frames=3,
            band_high_hz=band_high_hz,
        ),
        front_end_passband_hz=front_end_passband_hz,
        implied_smash_bounds=(1.05, 1.60),
        ball_band_low_fraction=0.75,
    )
