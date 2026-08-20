"""The generator's own ground truth must be internally consistent.

If the generator is wrong, every acceptance test is measuring the wrong thing,
so its claims are checked against the signal it actually produced.
"""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.stft import StftConfig, stft
from launchmon.physics import speed_to_doppler_hz
from tests.synth.presets import IMPACT_TIME_S, radar_config
from tests.synth.radar import CosineMode, generate_shot


@pytest.mark.parametrize("launch_speed_mps", [15.0, 53.64, 74.66])
def test_the_ball_tone_appears_at_the_frequency_the_ground_truth_claims(
    launch_speed_mps: float,
) -> None:
    shot = generate_shot(radar_config(launch_speed_mps=launch_speed_mps, snr_db=None))
    config = StftConfig(sample_rate_hz=48_000.0, n_fft=2048, hop=512)
    result = stft(shot.ball_component, config)

    frame = int(np.searchsorted(result.times_s, IMPACT_TIME_S + 0.05))
    peak_hz = float(result.freqs_hz[int(np.argmax(result.magnitude[:, frame]))])
    expected_hz = float(speed_to_doppler_hz(shot.ground_truth.radial_launch_speed_mps))

    # Lower than the launch tone, because drag has been slowing the ball since impact.
    assert peak_hz < expected_hz
    assert peak_hz > 0.9 * expected_hz


def test_the_club_return_is_a_band_whose_upper_edge_is_the_head() -> None:
    """Modelling the club as one tone would flatter every estimator downstream."""
    shot = generate_shot(
        radar_config(launch_speed_mps=74.66, clubhead_speed_mps=50.45, snr_db=None)
    )
    config = StftConfig(sample_rate_hz=48_000.0, n_fft=2048, hop=512)
    result = stft(shot.club_component, config)

    frame = int(np.searchsorted(result.times_s, IMPACT_TIME_S)) - 4
    column = 20.0 * np.log10(np.maximum(result.magnitude[:, frame], 1e-15))
    head_hz = float(speed_to_doppler_hz(50.45))
    peak_hz = float(result.freqs_hz[int(np.argmax(column))])

    # The strongest bin sits below the head, and there is real energy up to it.
    assert peak_hz < head_hz
    in_band = (result.freqs_hz > 0.5 * head_hz) & (result.freqs_hz < head_hz)
    assert column[in_band].max() > column.max() - 20.0


def test_range_loss_shortens_the_ball_far_below_the_capture_window() -> None:
    """Received power falls as the fourth power of range, and it does so quickly."""
    shot = generate_shot(radar_config(launch_speed_mps=74.66, snr_db=None))
    truth = shot.ground_truth
    observable = truth.ball_observable_end_s - truth.ball_observable_start_s
    assert observable < 0.1 * shot.config.duration_s


def test_a_slower_ball_stays_in_the_beam_longer() -> None:
    fast = generate_shot(radar_config(launch_speed_mps=74.66, snr_db=None)).ground_truth
    slow = generate_shot(radar_config(launch_speed_mps=15.0, snr_db=None)).ground_truth
    assert slow.ball_observable_end_s > fast.ball_observable_end_s


def test_projection_reduces_the_observable_speed_below_the_true_one() -> None:
    shot = generate_shot(
        radar_config(launch_speed_mps=74.66, snr_db=None, cosine_mode=CosineMode.PROJECTED)
    )
    truth = shot.ground_truth
    assert truth.radial_launch_speed_mps < truth.launch_speed_mps
    assert truth.radial_launch_speed_mps > 0.95 * truth.launch_speed_mps


def test_disabling_noise_leaves_no_noise() -> None:
    shot = generate_shot(radar_config(launch_speed_mps=53.64, snr_db=None))
    assert np.all(shot.noise_component == 0.0)


def test_the_same_seed_gives_the_same_capture() -> None:
    first = generate_shot(radar_config(launch_speed_mps=53.64, snr_db=10.0, seed=42))
    second = generate_shot(radar_config(launch_speed_mps=53.64, snr_db=10.0, seed=42))
    assert np.array_equal(first.samples, second.samples)
