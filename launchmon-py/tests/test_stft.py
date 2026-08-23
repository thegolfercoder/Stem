"""The STFT's conventions are a contract with the Swift port, so they are pinned."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.stft import StftConfig, hann_periodic, slice_frames, stft


@pytest.fixture
def config() -> StftConfig:
    return StftConfig(sample_rate_hz=48_000.0, n_fft=2048, hop=512)


def test_canonical_framing_matches_the_designed_figures(config: StftConfig) -> None:
    assert config.frame_duration_s == pytest.approx(42.7e-3, abs=0.1e-3)
    assert config.bin_width_hz == pytest.approx(23.44, abs=0.01)
    assert config.hop / config.n_fft == 0.25  # 75 percent overlap


def test_hann_is_periodic_not_symmetric() -> None:
    w = hann_periodic(8)
    assert w[0] == pytest.approx(0.0)
    # A periodic window does not return to zero at the last sample; a symmetric
    # one does. vDSP's default differs, so the port must build this formula.
    assert w[-1] > 0.0
    assert w == pytest.approx(0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(8) / 8)))


def test_frame_times_are_frame_centres(config: StftConfig) -> None:
    result = stft(np.zeros(48_000), config)
    assert result.times_s[0] == pytest.approx(config.n_fft / 2.0 / config.sample_rate_hz)
    assert np.diff(result.times_s) == pytest.approx(config.hop_duration_s)


def test_magnitude_scaling_returns_the_amplitude_of_a_bin_centred_sinusoid(
    config: StftConfig,
) -> None:
    # Placed exactly on a bin so that no scalloping loss is involved.
    freq = 100 * config.bin_width_hz
    t = np.arange(48_000) / config.sample_rate_hz
    result = stft(0.8 * np.cos(2.0 * np.pi * freq * t), config)
    assert result.magnitude[:, 10].max() == pytest.approx(0.8, rel=1e-3)


def test_only_whole_frames_are_used(config: StftConfig) -> None:
    result = stft(np.zeros(config.n_fft + config.hop + 5), config)
    assert result.n_frames == 2


def test_signal_shorter_than_one_frame_is_an_error_not_a_result(config: StftConfig) -> None:
    with pytest.raises(ValueError, match="shorter than one"):
        stft(np.zeros(config.n_fft - 1), config)


def test_slice_frames_preserves_frequencies_and_times(config: StftConfig) -> None:
    result = stft(np.zeros(48_000), config)
    part = slice_frames(result, 5, 12)
    assert part.n_frames == 7
    assert part.freqs_hz is result.freqs_hz
    assert part.times_s == pytest.approx(result.times_s[5:12])


def test_slice_frames_rejects_a_range_outside_the_spectrogram(config: StftConfig) -> None:
    result = stft(np.zeros(48_000), config)
    with pytest.raises(ValueError):
        slice_frames(result, 0, result.n_frames + 1)
