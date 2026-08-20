"""Ridge extraction: one frequency track through a spectrogram.

Two things make this harder than taking the largest bin in every frame.

*Sub-bin resolution is mandatory, not a refinement.* At 48 kHz with a
2048-point transform the bins are 23.44 Hz wide, which is 0.146 m/s. A chip at
15 m/s puts its tone at about 2.4 kHz, so a half-percent of that speed is
smaller than one bin. Any accuracy target below roughly one bin is a statement
about the interpolator, not about the transform, and it is worth being explicit
that this is what is being tested.

*A louder interferer will steal the track.* Mains hum and its harmonics can
exceed the ball return, and the club band and ball band coexist for a few
frames either side of impact. Picking the largest peak per frame independently
produces a track that jumps between them. This module therefore keeps several
candidates per frame and chooses the path through them that maximises total
magnitude against a penalty on frequency jumps, which is a Viterbi decode over
a trellis whose states are the candidate peaks.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from launchmon.dsp.stft import StftResult


class RidgeConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    band_low_hz: float = Field(description="Lowest frequency the track may occupy.")
    band_high_hz: float = Field(description="Highest frequency the track may occupy.")
    n_candidates: int = Field(description="Peaks kept per frame for the path search.")
    max_jump_hz: float = Field(
        description="Frame-to-frame frequency change beyond which a transition is forbidden."
    )
    jump_penalty_db_per_hz: float = Field(
        description=(
            "Cost in dB charged per Hz of frequency change, traded against the dB of "
            "magnitude gained by jumping. Larger values buy smoothness at the cost of "
            "the tracker's ability to follow a genuine fast chirp."
        )
    )
    min_snr_db: float = Field(
        description=(
            "Peak height above the frame's own noise floor below which a frame is "
            "marked invalid. Invalid frames are excluded from fits rather than "
            "interpolated over: a frame with no signal in it is not evidence.\n\n"
            "This has a floor that is not a matter of taste. The largest of N "
            "independent noise bins stands about 10*log10(ln(N)/ln(2)) decibels above "
            "their median simply because it is the largest of N, which is close to ten "
            "decibels for the eight hundred or so bins of a 48 kHz capture, and the "
            "tail reaches further. A threshold at or below that admits pure noise as "
            "signal, and the tracker then produces a confident frequency for a frame "
            "that contains nothing."
        )
    )


class Ridge(BaseModel):
    """A frequency track with per-frame validity. Never silently interpolated."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    times_s: NDArray[np.float64]
    freq_hz: NDArray[np.float64]
    magnitude_db: NDArray[np.float64]
    snr_db: NDArray[np.float64]
    valid: NDArray[np.bool_]

    @property
    def n_valid(self) -> int:
        return int(np.count_nonzero(self.valid))


def _parabolic_offset(log_mag: NDArray[np.float64], k: int) -> float:
    """Sub-bin peak offset, in bins, by a parabola through three log-magnitudes.

    Fitting in log magnitude rather than linear is what makes this accurate for
    a windowed sinusoid, whose main lobe is close to Gaussian and therefore close
    to a parabola once logged.
    """
    if k <= 0 or k >= log_mag.size - 1:
        return 0.0
    a, b, c = log_mag[k - 1], log_mag[k], log_mag[k + 1]
    denominator = a - 2.0 * b + c
    if denominator == 0.0:
        return 0.0
    offset = 0.5 * (a - c) / denominator
    # A parabola through a genuine local maximum cannot place the peak outside
    # the neighbouring bins; anything that does is a numerical artefact.
    return float(offset) if abs(offset) <= 1.0 else 0.0


def _frame_candidates(
    log_mag: NDArray[np.float64],
    freqs: NDArray[np.float64],
    lo: int,
    hi: int,
    n_candidates: int,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Interpolated frequencies and magnitudes of the strongest local maxima in band."""
    band = log_mag[lo:hi]
    interior = np.flatnonzero((band[1:-1] >= band[:-2]) & (band[1:-1] > band[2:])) + 1
    if interior.size == 0:
        peak = int(np.argmax(band))
        interior = np.array([peak])
    order = interior[np.argsort(band[interior])[::-1][:n_candidates]]

    bin_width = float(freqs[1] - freqs[0])
    freq_out = np.empty(order.size, dtype=np.float64)
    mag_out = np.empty(order.size, dtype=np.float64)
    for i, local_k in enumerate(order):
        k = int(local_k) + lo
        offset = _parabolic_offset(log_mag, k)
        freq_out[i] = freqs[k] + offset * bin_width
        mag_out[i] = log_mag[k]
    return freq_out, mag_out


def extract_ridge(result: StftResult, config: RidgeConfig) -> Ridge:
    """Track one frequency through the spectrogram by penalised path search.

    The returned track always spans every frame. Frames whose peak did not clear
    `min_snr_db` above their own noise floor are marked invalid; downstream fits
    must honour that mask.
    """
    freqs = result.freqs_hz
    lo = int(np.searchsorted(freqs, config.band_low_hz, side="left"))
    hi = int(np.searchsorted(freqs, config.band_high_hz, side="right"))
    if hi - lo < 3:
        raise ValueError("ridge band spans fewer than three bins")

    n_frames = result.n_frames
    log_mag = 20.0 * np.log10(np.maximum(result.magnitude, 1e-15))

    cand_f: list[NDArray[np.float64]] = []
    cand_m: list[NDArray[np.float64]] = []
    noise_floor = np.empty(n_frames, dtype=np.float64)
    for frame in range(n_frames):
        column = log_mag[:, frame]
        f, m = _frame_candidates(column, freqs, lo, hi, config.n_candidates)
        cand_f.append(f)
        cand_m.append(m)
        # Median of the band is a noise-floor estimate that a handful of strong
        # tones cannot drag upward.
        noise_floor[frame] = float(np.median(column[lo:hi]))

    # Viterbi forward pass: score in dB, transitions charged per Hz of movement.
    scores: list[NDArray[np.float64]] = [cand_m[0].copy()]
    backpointers: list[NDArray[np.intp]] = [np.zeros(cand_m[0].size, dtype=np.intp)]
    for frame in range(1, n_frames):
        jump = np.abs(cand_f[frame][:, None] - cand_f[frame - 1][None, :])
        transition = np.where(
            jump > config.max_jump_hz, -np.inf, -config.jump_penalty_db_per_hz * jump
        )
        total = scores[-1][None, :] + transition
        best = np.argmax(total, axis=1)
        best_score = total[np.arange(total.shape[0]), best]
        # A frame whose every transition is forbidden restarts the path there
        # rather than forcing an impossible jump.
        restart = ~np.isfinite(best_score)
        best_score = np.where(restart, 0.0, best_score)
        scores.append(cand_m[frame] + best_score)
        backpointers.append(np.where(restart, -1, best))

    path = np.empty(n_frames, dtype=np.intp)
    path[-1] = int(np.argmax(scores[-1]))
    for frame in range(n_frames - 1, 0, -1):
        previous = backpointers[frame][path[frame]]
        path[frame - 1] = previous if previous >= 0 else np.argmax(cand_m[frame - 1])

    freq_track = np.array([cand_f[i][path[i]] for i in range(n_frames)], dtype=np.float64)
    mag_track = np.array([cand_m[i][path[i]] for i in range(n_frames)], dtype=np.float64)
    snr_track = mag_track - noise_floor

    return Ridge(
        times_s=result.times_s.copy(),
        freq_hz=freq_track,
        magnitude_db=mag_track,
        snr_db=snr_track,
        valid=snr_track >= config.min_snr_db,
    )


def band_upper_edge_hz(
    result: StftResult,
    frame: int,
    peak_freq_hz: float,
    edge_drop_db: float,
    band_high_hz: float,
) -> float:
    """Highest frequency in a frame still within `edge_drop_db` of the band's peak.

    The clubhead is the fastest point on a rotating shaft, so the club's return
    is a band whose *upper edge* is the head and whose peak is somewhere below it,
    at whatever weighted centre the shaft's scatterers produce. Reading the peak
    reports something slower than the clubhead.

    `edge_drop_db` is a calibration against reference clubhead speeds, not a
    measurement, and no accuracy claim attaches to any value of it before that
    calibration exists.
    """
    freqs = result.freqs_hz
    log_mag = 20.0 * np.log10(np.maximum(result.magnitude[:, frame], 1e-15))
    peak_bin = int(np.argmin(np.abs(freqs - peak_freq_hz)))
    threshold = log_mag[peak_bin] - edge_drop_db
    hi = int(np.searchsorted(freqs, band_high_hz, side="right"))

    k = peak_bin
    while k + 1 < hi and log_mag[k + 1] >= threshold:
        k += 1
    if k == peak_bin:
        return float(peak_freq_hz)
    # Linear interpolation in dB across the crossing gives sub-bin placement.
    if k + 1 < hi and log_mag[k] > threshold > log_mag[k + 1]:
        span = log_mag[k] - log_mag[k + 1]
        fraction = (log_mag[k] - threshold) / span if span > 0 else 0.0
        return float(freqs[k] + fraction * (freqs[k + 1] - freqs[k]))
    return float(freqs[k])
