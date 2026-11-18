"""Two-channel (I/Q) captures with known ground truth, for the ground unit's radar.

Built on the single-channel generator rather than beside it: the club and ball
returns come from `generate_shot`, so their physics is the physics every other
radar test is scored against. They are made into the receding half of an
analytic signal, which is what an I/Q front end sees from targets moving away.
Then come the things a single channel cannot show:

* an approaching target - the golfer, or the backswing - on the other sign of
  frequency, which the I/Q path has to reject;
* the ESP32-C3's half-sample lag between the I and Q conversions;
* independent noise and DC bias on each channel.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict
from scipy import signal as sps

from launchmon.ingest.iq import IqCaptureFormat
from tests.synth.presets import radar_config
from tests.synth.radar import SyntheticRadarShot, generate_shot

GROUND_UNIT_FS_HZ = 40_000.0


class SyntheticIqShot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    i: NDArray[np.float64]
    q: NDArray[np.float64]
    fmt: IqCaptureFormat
    single_channel: SyntheticRadarShot
    approaching_tone_hz: float


def _delay(x: NDArray[np.complex128], samples: float) -> NDArray[np.complex128]:
    """Fractional delay by a frequency-domain phase ramp (circular, exact for band-limited x)."""
    n = x.size
    k = np.fft.fftfreq(n) * n
    return np.asarray(np.fft.ifft(np.fft.fft(x) * np.exp(-2j * np.pi * k * samples / n)))


def generate_iq_shot(
    *,
    launch_speed_mps: float,
    receding_sign: int = 1,
    q_lag_samples: float = 0.5,
    approaching_tone_hz: float = 2_500.0,
    approaching_amplitude: float = 3.0,
    noise_rms: float = 0.002,
    seed: int = 0,
    **kwargs: object,
) -> SyntheticIqShot:
    cfg = radar_config(launch_speed_mps=launch_speed_mps, seed=seed, **kwargs)  # type: ignore[arg-type]
    cfg = cfg.model_copy(update={"sample_rate_hz": GROUND_UNIT_FS_HZ})
    shot = generate_shot(cfg)
    n = shot.samples.size
    t = np.arange(n) / GROUND_UNIT_FS_HZ

    # Receding returns as the positive-frequency analytic signal of what a single
    # channel recorded (club + ball, after the front end, without its noise).
    receding = sps.hilbert(shot.club_component + shot.ball_component)
    # A strong target walking toward the unit, steady over the whole capture.
    approaching = approaching_amplitude * np.exp(-2j * np.pi * approaching_tone_hz * t)
    z = np.asarray(receding + approaching, dtype=np.complex128)
    if receding_sign < 0:
        z = np.conj(z)

    rng = np.random.default_rng(seed + 100)
    i = z.real + noise_rms * rng.standard_normal(n) + 1.65
    # Q is converted q_lag_samples after I: it sees the signal that much later.
    q = _delay(z, -q_lag_samples).imag + noise_rms * rng.standard_normal(n) + 1.62
    return SyntheticIqShot(
        i=np.asarray(i, dtype=np.float64),
        q=np.asarray(q, dtype=np.float64),
        fmt=IqCaptureFormat(
            sample_rate_hz=GROUND_UNIT_FS_HZ,
            q_lag_samples=q_lag_samples,
            receding_sign=receding_sign,
        ),
        single_channel=shot,
        approaching_tone_hz=approaching_tone_hz,
    )
