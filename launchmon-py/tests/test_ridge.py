"""Sub-bin accuracy, and refusing to be led away by a louder interferer."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.ridge import RidgeConfig, extract_ridge
from launchmon.dsp.stft import StftConfig, stft
from launchmon.physics import speed_to_doppler_hz


@pytest.fixture
def stft_config() -> StftConfig:
    return StftConfig(sample_rate_hz=48_000.0, n_fft=2048, hop=512)


@pytest.fixture
def ridge_config() -> RidgeConfig:
    return RidgeConfig(
        band_low_hz=300.0,
        band_high_hz=20_000.0,
        n_candidates=5,
        max_jump_hz=1_500.0,
        jump_penalty_db_per_hz=0.01,
        min_snr_db=15.0,
    )


@pytest.mark.parametrize("speed_mps", [15.0, 25.0, 53.64, 74.66])
def test_sub_bin_interpolation_beats_the_bin_width(
    speed_mps: float, stft_config: StftConfig, ridge_config: RidgeConfig
) -> None:
    """A half-percent of a chip's speed is smaller than one bin, so this must hold.

    At 23.44 Hz bins a 15 m/s chip's tone is about 2.4 kHz, and half a percent of
    that is roughly half a bin. Any accuracy target below one bin is a statement
    about this interpolator.
    """
    freq = float(speed_to_doppler_hz(speed_mps))
    t = np.arange(int(0.3 * 48_000)) / 48_000.0
    rng = np.random.default_rng(0)
    signal = np.cos(2.0 * np.pi * freq * t) + 1e-3 * rng.standard_normal(t.size)

    ridge = extract_ridge(stft(signal, stft_config), ridge_config)
    error_hz = np.abs(ridge.freq_hz[ridge.valid] - freq)

    assert ridge.n_valid == ridge.times_s.size
    assert error_hz.max() < 0.1 * stft_config.bin_width_hz


def test_path_search_resists_noise_that_a_per_frame_peak_pick_would_follow(
    stft_config: StftConfig, ridge_config: RidgeConfig
) -> None:
    """This is what the trellis buys, and it is worth being precise about it.

    Penalised path search does not defeat an interferer that is genuinely
    stronger than the signal across the whole capture - nothing operating inside
    a single band can, and the pipeline handles that case by narrowing the band
    around the tone it identified at impact. What it does defeat is a noise
    excursion that momentarily out-peaks the real tone in one frame, which an
    independent per-frame pick follows and a continuity-penalised path does not.
    """
    freq = float(speed_to_doppler_hz(40.0))
    fs = stft_config.sample_rate_hz
    t = np.arange(int(0.4 * fs)) / fs
    rng = np.random.default_rng(7)
    signal = np.cos(2.0 * np.pi * freq * t) + 1.6 * rng.standard_normal(t.size)

    result = stft(signal, stft_config)
    ridge = extract_ridge(result, ridge_config)

    lo = int(np.searchsorted(result.freqs_hz, ridge_config.band_low_hz))
    hi = int(np.searchsorted(result.freqs_hz, ridge_config.band_high_hz))
    naive = result.freqs_hz[lo + np.argmax(result.magnitude[lo:hi, :], axis=0)]

    ridge_error = np.abs(ridge.freq_hz[ridge.valid] - freq)
    naive_error = np.abs(naive[ridge.valid] - freq)
    assert ridge_error.max() <= naive_error.max()
    assert np.abs(np.diff(ridge.freq_hz[ridge.valid])).max() <= ridge_config.max_jump_hz


def test_ridge_tracks_a_downward_chirp(stft_config: StftConfig, ridge_config: RidgeConfig) -> None:
    """A ball's tone sweeps down under drag; the tracker must follow, not smooth it away."""
    fs = stft_config.sample_rate_hz
    t = np.arange(int(0.4 * fs)) / fs
    start_hz, end_hz = float(speed_to_doppler_hz(74.66)), float(speed_to_doppler_hz(70.0))
    rate = (end_hz - start_hz) / t[-1]
    phase = 2.0 * np.pi * (start_hz * t + 0.5 * rate * t**2)
    ridge = extract_ridge(stft(np.cos(phase), stft_config), ridge_config)

    expected = start_hz + rate * ridge.times_s[ridge.valid]
    assert np.abs(ridge.freq_hz[ridge.valid] - expected).max() < stft_config.bin_width_hz


def test_frames_without_signal_are_marked_invalid_not_interpolated(
    stft_config: StftConfig, ridge_config: RidgeConfig
) -> None:
    """A frame with nothing in it is not evidence, and must not be filled in."""
    rng = np.random.default_rng(1)
    signal = rng.standard_normal(int(0.3 * 48_000))
    ridge = extract_ridge(stft(signal, stft_config), ridge_config)
    assert ridge.n_valid == 0


def test_a_band_narrower_than_three_bins_is_an_error(stft_config: StftConfig) -> None:
    narrow = RidgeConfig(
        band_low_hz=1000.0,
        band_high_hz=1010.0,
        n_candidates=3,
        max_jump_hz=100.0,
        jump_penalty_db_per_hz=0.01,
        min_snr_db=15.0,
    )
    with pytest.raises(ValueError, match="three bins"):
        extract_ridge(stft(np.zeros(48_000), stft_config), narrow)
