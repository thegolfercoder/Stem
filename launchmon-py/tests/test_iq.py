"""The I/Q path: the ground unit's two-channel capture into the existing radar pipeline."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.pipeline import analyse_radar_capture
from launchmon.dsp.presets import ground_unit_radar_pipeline
from launchmon.ingest.iq import IqCaptureFormat, image_rejection_db, iq_to_receding_real
from launchmon.quantity import NoReading
from tests.synth.iq import GROUND_UNIT_FS_HZ, generate_iq_shot

PIPELINE_40K = ground_unit_radar_pipeline()


def _tone(n: int, f_hz: float, fs: float, lag: float) -> tuple[np.ndarray, np.ndarray]:
    t = np.arange(n) / fs
    return np.cos(2 * np.pi * f_hz * t), np.sin(2 * np.pi * f_hz * (t + lag / fs))


@pytest.mark.parametrize("f_hz", [500.0, 5_000.0, 14_500.0])
def test_the_skew_correction_recovers_the_image_rejection(f_hz: float) -> None:
    fs, n = GROUND_UNIT_FS_HZ, 8192
    i, q = _tone(n, f_hz, fs, lag=0.5)
    right = IqCaptureFormat(sample_rate_hz=fs, q_lag_samples=0.5, receding_sign=1)
    wrong = IqCaptureFormat(sample_rate_hz=fs, q_lag_samples=0.0, receding_sign=1)
    corrected = image_rejection_db(i, q, right, f_hz)
    uncorrected = image_rejection_db(i, q, wrong, f_hz)
    # Without the correction the image is within a few dB of the tone near 15 kHz.
    assert corrected > 60.0
    assert corrected > uncorrected + 20.0


def test_an_approaching_target_is_removed_and_a_receding_one_kept() -> None:
    fs, n = GROUND_UNIT_FS_HZ, 8192
    t = np.arange(n) / fs
    lag = 0.5
    i = np.cos(2 * np.pi * 3_000 * t) + 2.0 * np.cos(2 * np.pi * 1_200 * t)
    q = np.sin(2 * np.pi * 3_000 * (t + lag / fs)) - 2.0 * np.sin(
        2 * np.pi * 1_200 * (t + lag / fs)
    )
    x = iq_to_receding_real(
        i, q, IqCaptureFormat(sample_rate_hz=fs, q_lag_samples=lag, receding_sign=1)
    )
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, 1 / fs)
    at = lambda f: spec[np.abs(freqs - f) < 10].max()  # noqa: E731
    assert 20 * np.log10(at(3_000) / at(1_200)) > 60.0


@pytest.mark.parametrize("receding_sign", [1, -1])
@pytest.mark.parametrize("launch_speed_mps", [25.0, 53.64, 74.66])
def test_launch_speed_through_the_iq_path_matches_the_single_channel_result(
    launch_speed_mps: float, receding_sign: int
) -> None:
    shot = generate_iq_shot(launch_speed_mps=launch_speed_mps, receding_sign=receding_sign)
    x = iq_to_receding_real(shot.i, shot.q, shot.fmt)
    result = analyse_radar_capture(x, PIPELINE_40K)
    reading = result.ball_launch_speed.reading
    assert not isinstance(reading, NoReading), reading
    truth = shot.single_channel.ground_truth.radial_launch_speed_mps
    assert abs(reading.value - truth) / truth < 0.005


def test_without_the_iq_path_the_approaching_target_is_taken_for_a_tone() -> None:
    """Why the conversion exists: on I alone the walker's tone is just another tone."""
    shot = generate_iq_shot(launch_speed_mps=40.0, approaching_amplitude=3.0)
    n = shot.i.size
    freqs = np.fft.rfftfreq(n, 1 / GROUND_UNIT_FS_HZ)
    near = np.abs(freqs - shot.approaching_tone_hz) < 20

    def level(x: np.ndarray) -> float:
        return float(np.abs(np.fft.rfft((x - x.mean()) * np.hanning(n)))[near].max())

    i_only = level(shot.i)
    through = level(iq_to_receding_real(shot.i, shot.q, shot.fmt))
    assert 20 * np.log10(i_only / through) > 40.0
