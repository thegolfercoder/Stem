"""Locating impact, and refusing to mistake the club for the ball."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.presets import default_radar_pipeline
from launchmon.dsp.segment import Segments, segment_shot
from launchmon.dsp.stft import stft
from launchmon.quantity import NoReading
from tests.synth.presets import IMPACT_TIME_S, radar_config
from tests.synth.radar import SyntheticRadarShot, generate_shot


def _segment(**kwargs: object) -> tuple[SyntheticRadarShot, Segments | NoReading]:
    config = default_radar_pipeline()
    shot = generate_shot(radar_config(**kwargs))  # type: ignore[arg-type]
    return shot, segment_shot(shot.samples, stft(shot.samples, config.stft), config.segment)


@pytest.mark.parametrize("launch_speed_mps", [15.0, 25.0, 53.64, 74.66])
def test_fine_pass_locates_impact_far_better_than_frame_resolution(
    launch_speed_mps: float,
) -> None:
    """Impact timing is part of the speed error budget, so a frame is not good enough."""
    _, segments = _segment(launch_speed_mps=launch_speed_mps, snr_db=20.0)
    assert not isinstance(segments, NoReading)

    fine = abs(segments.impact_time_s - IMPACT_TIME_S)
    coarse = abs(segments.impact_time_coarse_s - IMPACT_TIME_S)
    assert fine < coarse
    assert fine < 2.0e-3


@pytest.mark.parametrize("launch_speed_mps", [15.0, 53.64, 74.66])
def test_the_ball_is_identified_not_the_club(launch_speed_mps: float) -> None:
    """The failure this guards against returns clubhead speed as ball speed."""
    from launchmon.physics import speed_to_doppler_hz

    shot, segments = _segment(launch_speed_mps=launch_speed_mps, snr_db=10.0)
    assert not isinstance(segments, NoReading)

    expected = float(speed_to_doppler_hz(shot.ground_truth.radial_launch_speed_mps))
    assert segments.ball_tone_hz == pytest.approx(expected, rel=0.05)
    # Ball above club is the physical fact the identification rests on.
    assert segments.ball_tone_hz > segments.club_tone_hz
    assert segments.apparent_speed_ratio > 1.0


def test_frames_straddling_impact_belong_to_neither_side() -> None:
    config = default_radar_pipeline()
    _, segments = _segment(launch_speed_mps=53.64, snr_db=20.0)
    assert not isinstance(segments, NoReading)

    impact_sample = segments.impact_time_s * config.stft.sample_rate_hz
    last_club_end = (segments.club_frames[1] - 1) * config.stft.hop + config.stft.n_fft
    first_ball_start = segments.ball_frames[0] * config.stft.hop
    assert last_club_end <= impact_sample
    assert first_ball_start >= impact_sample


def test_noise_alone_is_refused_rather_than_segmented() -> None:
    config = default_radar_pipeline()
    rng = np.random.default_rng(3)
    samples = rng.standard_normal(int(0.7 * 48_000))
    result = segment_shot(samples, stft(samples, config.stft), config.segment)
    assert isinstance(result, NoReading)
    assert result.reason
