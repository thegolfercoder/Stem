"""Two-channel (I/Q) radar capture to the one real channel the pipeline reads.

The radar pipeline was written for a single-channel module read as audio: a
real signal, whose spectrum cannot tell a target moving away from the sensor
from one moving toward it. The BGT24LTR11 ground unit delivers both mixer
outputs, I and Q, and the pair can. Expressed as z = I + jQ, a target moving
away appears at one sign of frequency and a target moving toward the sensor at
the other.

This module keeps the side that moves away - the clubhead in the downswing and
the ball after impact - and discards the other, which holds the backswing, the
golfer's body and anybody walking up to the unit. What it returns is the real
signal a single-channel radar would have produced had it seen only the
receding targets, so every stage of the existing pipeline, and every check in
it, applies unchanged.

Two corrections come first, because without them the separation fails:

* **DC.** Each mixer output sits on its own bias. Removed per channel.
* **Sampling skew.** The ESP32-C3 converts I and Q one after the other on one
  ADC, so Q is taken a fixed fraction of a sample after I. That delay is a
  frequency-dependent phase error between the channels, 67 degrees at 15 kHz
  for a half-sample lag at 40 kHz, and it leaks receding energy into the
  approaching side and back. It is removed exactly in the frequency domain,
  by a pure phase rotation with no amplitude loss.

Neither correction estimates anything from the data. Both use the capture's
own declared parameters, so replaying a capture under a different declaration
is a matter of changing the arguments.
"""

from __future__ import annotations

from typing import Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator


class IqCaptureFormat(BaseModel):
    """How a two-channel capture was taken. Comes from the capture's own header."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    sample_rate_hz: float = Field(description="Per channel.")
    q_lag_samples: float = Field(
        description=(
            "How far after I each Q sample was converted, in per-channel sample "
            "periods. 0.5 for two channels interleaved on one converter."
        )
    )
    receding_sign: int = Field(
        description=(
            "+1 if a target moving away from the radar appears at positive frequency "
            "in I + jQ, -1 if at negative. Set by which IF output is wired to which "
            "converter input; found once on the bench, then fixed for that unit."
        )
    )

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.receding_sign not in (-1, 1):
            raise ValueError("receding_sign must be +1 or -1")
        if self.sample_rate_hz <= 0:
            raise ValueError("sample_rate_hz must be positive")
        return self


def _signed_frequency_index(n: int) -> NDArray[np.float64]:
    k = np.arange(n, dtype=np.float64)
    return np.where(k < n / 2, k, k - n)


def aligned_complex(
    i: NDArray[np.floating], q: NDArray[np.floating], fmt: IqCaptureFormat
) -> NDArray[np.complex128]:
    """I + jQ with DC removed from each channel and Q moved back onto I's sample times.

    I and Q are real, so each one's spectrum is recovered separately from a
    single complex transform of I + jQ. Q's is then multiplied by
    exp(-j*2*pi*f*lag/fs), with f signed, which is the exact inverse of having
    sampled it `lag` samples late, before the two are recombined.
    """
    i = np.asarray(i, dtype=np.float64)
    q = np.asarray(q, dtype=np.float64)
    if i.shape != q.shape or i.ndim != 1:
        raise ValueError("I and Q must be one-dimensional and the same length")
    n = i.size
    i = i - i.mean()
    q = q - q.mean()
    i_spec = np.fft.fft(i)
    q_spec = np.fft.fft(q)
    k = _signed_frequency_index(n)
    if n % 2 == 0:
        k[n // 2] = 0.0  # Nyquist bin: real for real input, leave it alone
    q_spec = q_spec * np.exp(-2j * np.pi * k * fmt.q_lag_samples / n)
    return np.asarray(np.fft.ifft(i_spec + 1j * q_spec), dtype=np.complex128)


def receding_only(z: NDArray[np.complex128], receding_sign: int) -> NDArray[np.complex128]:
    """Keep the half of the spectrum that holds targets moving away from the radar."""
    n = z.size
    spec = np.fft.fft(z)
    k = _signed_frequency_index(n)
    keep = (k * receding_sign) > 0
    return np.asarray(np.fft.ifft(np.where(keep, spec, 0.0)), dtype=np.complex128)


def iq_to_receding_real(
    i: NDArray[np.floating], q: NDArray[np.floating], fmt: IqCaptureFormat
) -> NDArray[np.float64]:
    """The real signal of the receding targets alone, at the capture's own sample rate.

    A receding tone A*exp(j*w*t) comes back as A*cos(w*t): the same frequency
    and amplitude a single-channel radar would have recorded. Approaching
    targets contribute nothing.
    """
    z = receding_only(aligned_complex(i, q, fmt), fmt.receding_sign)
    if fmt.receding_sign < 0:
        z = np.conj(z)  # put the kept side at positive frequency
    return np.asarray(z.real, dtype=np.float64)


def image_rejection_db(
    i: NDArray[np.floating], q: NDArray[np.floating], fmt: IqCaptureFormat, tone_hz: float
) -> float:
    """How far a single receding tone's image sits below the tone, in dB.

    A bench diagnostic for a real capture of one moving target: it checks the
    declared skew and sign against the hardware. A low figure means the
    declaration is wrong, or the two channels' gains differ.
    """
    z = aligned_complex(i, q, fmt)
    n = z.size
    spec = np.abs(np.fft.fft(z * np.hanning(n))) ** 2
    freqs = np.fft.fftfreq(n, 1.0 / fmt.sample_rate_hz)
    want = fmt.receding_sign * tone_hz
    near = np.abs(freqs - want) < 3 * fmt.sample_rate_hz / n
    image = np.abs(freqs + want) < 3 * fmt.sample_rate_hz / n
    return float(10.0 * np.log10(spec[near].max() / max(spec[image].max(), 1e-300)))
