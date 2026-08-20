"""Short-time Fourier transform.

The Swift port builds this from vDSP: window multiply, `vDSP_ctoz`, FFT,
`vDSP_zvmags`. There is no built-in STFT in Accelerate, so the framing, the
window and the normalisation are all decisions this module has to state
explicitly rather than inherit from a library, or the two implementations will
disagree in ways the golden vectors will catch but not explain.

Conventions fixed here and binding on the port:

* **Window**: periodic Hann, w[n] = 0.5*(1 - cos(2*pi*n/N)) for n in [0, N).
  Periodic, not symmetric. vDSP's Hann variants differ; the port must build the
  window from this formula rather than trust a default.
* **Framing**: frame k covers samples [k*hop, k*hop + n_fft). Only whole frames
  are used; the tail is dropped and nothing is zero-padded.
* **Frame time**: the *centre* of the frame, (k*hop + n_fft/2) / fs. A frame
  reports the signal's average behaviour over its own span, so attributing it
  to the centre is what makes a ridge time-aligned.
* **Scaling**: magnitude is |rfft(x*w)| * 2 / sum(w), so a full-scale sinusoid
  well inside the band reads back its own amplitude.
"""

from __future__ import annotations

from typing import Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StftConfig(BaseModel):
    """Framing parameters. Carried into the golden vectors so the port matches."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    sample_rate_hz: float
    n_fft: int = Field(description="Window length in samples; also the transform length.")
    hop: int = Field(description="Advance between frame starts, in samples.")

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.n_fft <= 0 or self.n_fft % 2 != 0:
            raise ValueError("n_fft must be positive and even")
        if not 0 < self.hop <= self.n_fft:
            raise ValueError("hop must be positive and no larger than n_fft")
        return self

    @property
    def frame_duration_s(self) -> float:
        return self.n_fft / self.sample_rate_hz

    @property
    def bin_width_hz(self) -> float:
        return self.sample_rate_hz / self.n_fft

    @property
    def hop_duration_s(self) -> float:
        return self.hop / self.sample_rate_hz


class StftResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    config: StftConfig
    freqs_hz: NDArray[np.float64]
    times_s: NDArray[np.float64] = Field(description="Centre time of each frame.")
    magnitude: NDArray[np.float64] = Field(description="Shape (n_freqs, n_frames), linear.")

    @property
    def n_frames(self) -> int:
        return int(self.magnitude.shape[1])

    def frame_start_sample(self, frame: int) -> int:
        return frame * self.config.hop


def hann_periodic(n: int) -> NDArray[np.float64]:
    """Periodic Hann window, w[n] = 0.5*(1 - cos(2*pi*n/N)).

    Written out rather than taken from a library so that the Swift port has an
    unambiguous definition to reproduce.
    """
    return 0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(n, dtype=np.float64) / n))


def stft(samples: NDArray[np.float64], config: StftConfig) -> StftResult:
    """Framed, windowed magnitude spectrogram.

    Raises:
        ValueError: if the signal is shorter than one frame. A capture too short
            to analyse is an input error, not a result.
    """
    x = np.asarray(samples, dtype=np.float64)
    n = x.size
    if n < config.n_fft:
        raise ValueError(f"signal of {n} samples is shorter than one {config.n_fft}-sample frame")

    n_frames = 1 + (n - config.n_fft) // config.hop
    window = hann_periodic(config.n_fft)
    starts = np.arange(n_frames) * config.hop
    frames = x[starts[:, None] + np.arange(config.n_fft)[None, :]] * window[None, :]

    spectra = np.fft.rfft(frames, axis=1)
    magnitude = np.abs(spectra).T * (2.0 / window.sum())

    freqs = np.fft.rfftfreq(config.n_fft, d=1.0 / config.sample_rate_hz)
    times = (starts + config.n_fft / 2.0) / config.sample_rate_hz

    return StftResult(
        config=config,
        freqs_hz=np.asarray(freqs, dtype=np.float64),
        times_s=np.asarray(times, dtype=np.float64),
        magnitude=np.asarray(magnitude, dtype=np.float64),
    )


def slice_frames(result: StftResult, start_frame: int, end_frame: int) -> StftResult:
    """A view of a contiguous half-open frame range as a spectrogram in its own right.

    Ridge extraction is run separately on the club side and the ball side of
    impact. Running one tracker across the boundary would either forbid the jump
    from club tone to ball tone, and follow the wrong one, or permit jumps large
    enough that the tracker is free to wander for the rest of the capture.
    """
    if not 0 <= start_frame <= end_frame <= result.n_frames:
        raise ValueError(f"frame range [{start_frame}, {end_frame}) outside 0..{result.n_frames}")
    return StftResult(
        config=result.config,
        freqs_hz=result.freqs_hz,
        times_s=result.times_s[start_frame:end_frame],
        magnitude=result.magnitude[:, start_frame:end_frame],
    )
