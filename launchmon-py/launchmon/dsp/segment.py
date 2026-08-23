"""Finding impact, and splitting the capture into a club part and a ball part.

Impact matters twice over. It divides the capture into the two things being
measured, and it is the origin the ball's speed decay is extrapolated back to,
so an error in impact time becomes an error in launch speed. A driver ball slows
by roughly a quarter of a metre per second in ten milliseconds, so locating
impact only to the nearest spectrogram frame would spend a meaningful part of
the error budget on timing alone.

The radar's IF output is not an acoustic channel: there is no broadband click in
it, because it carries Doppler beat frequencies rather than sound. What impact
looks like here is a *discontinuity in the Doppler content* - a new, faster tone
appears where there was none, and the club return begins to collapse. The
acoustic impact marker lives on the club-mounted module alongside the IMU, in a
different clock domain, and is what aligns the IMU to this timeline; it does not
timestamp this stream.

What identifies the ball
------------------------
*When* impact happened and *which* tone is the ball are two separate questions,
and conflating them is what breaks this at poor signal-to-noise.

The frame is found from spectral flux: impact is where energy appears. That is
sound, because the ball's tone arrives in a single frame whereas the club's
sweeps up gradually across the whole downswing, so the club never produces a
comparable step.

Which tone is the ball cannot be answered the same way. Taking the largest peak,
or the largest change, picks the club as often as the ball once noise is
realistic: the clubhead passes closer to the sensor than the ball ever gets, and
its return is still growing as it comes down. An estimator that falls for this
does not fail loudly - it reports the clubhead speed as the ball speed, which is
a plausible number and a wrong one.

The ball is identified instead by the one thing that is certain: **the ball
leaves faster than the head that struck it.** Smash factor exceeds one for every
legal strike, so the ball's tone always lies above the club's. Both reference
frames are taken a whole window clear of impact, because a frame straddling
impact holds both and is evidence for neither.

What the ball must clear is the club's *whole band*, not the club's peak. The
club is an extended rotating body, so its return spans everything from the grip's
speed to the head's, and its strongest bin sits well below its upper edge. Search
above the peak and a large part of the club's own return is still in scope - and
an analogue front end that attenuates the ball will hand that part over as the
ball, at a speed that looks like a real one. So the floor for the ball search is
the upper edge of the club's band.

Detection is therefore two passes:

1. **Coarse.** Spectral flux locates the frame. Resolution is one hop.
2. **Fine.** The raw signal is band-passed around the identified ball band and
   its short-window envelope is followed back to the onset. Resolution is set by
   the envelope window rather than by the transform.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from scipy import signal as sps

from launchmon.dsp.ridge import band_upper_edge_hz
from launchmon.dsp.stft import StftResult
from launchmon.quantity import NoReading


class SegmentConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    search_start_s: float = Field(description="Earliest time impact is looked for.")
    search_end_s: float = Field(description="Latest time impact is looked for.")
    band_low_hz: float
    band_high_hz: float
    detection_margin_db: float = Field(
        description=(
            "How far a peak must stand above its own frame's noise floor to be "
            "accepted as a tone rather than a fluctuation."
        )
    )
    min_ball_to_club_ratio: float = Field(
        description=(
            "Smallest ratio between the ball's tone and the club's that will be "
            "accepted. This is the smash factor: the ball leaves faster than the head, "
            "so the ratio exceeds one for any legal strike. Nothing below it is "
            "treated as the ball."
        )
    )
    envelope_window_s: float = Field(
        description="RMS window for the fine onset search; sets the timing resolution."
    )
    onset_threshold_fraction: float = Field(
        description=(
            "Fraction of the post-impact envelope plateau at which onset is declared. "
            "A threshold, not a measurement: it trades timing bias against noise "
            "immunity and is a calibration."
        )
    )
    club_edge_drop_db: float = Field(
        description=(
            "How far below its peak the club's band is followed to find its upper "
            "edge, which is the floor for the ball search. The same threshold the "
            "clubhead speed estimator uses, and the same calibration."
        )
    )
    ball_band_margin_hz: float = Field(
        description="Half-width of the band-pass placed around the detected ball tone."
    )
    plateau_window_s: float = Field(
        description=(
            "Length of the post-impact stretch used to measure the ball return's "
            "level, for the fine onset search."
        )
    )


class Segments(BaseModel):
    """The capture divided at impact, with frames that straddle impact discarded."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    impact_time_s: float
    impact_time_coarse_s: float = Field(description="Frame-resolution estimate, before refinement.")
    impact_frame: int
    club_frames: tuple[int, int] = Field(description="Half-open frame range before impact.")
    ball_frames: tuple[int, int] = Field(description="Half-open frame range after impact.")
    ball_band_hz: tuple[float, float]
    ball_tone_hz: float = Field(description="Ball tone as identified at the impact frame.")
    club_tone_hz: float = Field(
        description="Strongest tone in the frame taken safely before impact."
    )
    club_band_edge_hz: float = Field(
        description="Upper edge of the club's band, which is the floor for the ball search."
    )

    @property
    def n_club_frames(self) -> int:
        return self.club_frames[1] - self.club_frames[0]

    @property
    def n_ball_frames(self) -> int:
        return self.ball_frames[1] - self.ball_frames[0]

    @property
    def apparent_speed_ratio(self) -> float:
        """Ball tone over club tone, which is the smash factor the radar implies.

        A diagnostic, not a reported quantity: it is derived from the club's
        Doppler rather than from the clubhead speed estimator, and it exists so
        that an implausible value can flag a mis-detection.
        """
        return self.ball_tone_hz / self.club_tone_hz if self.club_tone_hz > 0 else float("nan")


def spectral_flux(
    result: StftResult, band_low_hz: float, band_high_hz: float
) -> NDArray[np.float64]:
    """Half-wave-rectified frame-to-frame increase in magnitude, summed over a band.

    Rectifying matters: impact is the arrival of new energy, and energy leaving
    the band as the club return collapses must not be allowed to cancel it out.
    """
    freqs = result.freqs_hz
    lo = int(np.searchsorted(freqs, band_low_hz, side="left"))
    hi = int(np.searchsorted(freqs, band_high_hz, side="right"))
    band = result.magnitude[lo:hi, :]
    flux = np.sum(np.maximum(np.diff(band, axis=1), 0.0), axis=0)
    return np.concatenate(([0.0], flux))


def strongest_tone_hz(
    result: StftResult,
    frame: int,
    band_low_hz: float,
    band_high_hz: float,
    margin_db: float,
) -> float | None:
    """Frequency of the strongest peak in a frame, or None if nothing clears the floor.

    The floor is the median of the band, which a few strong tones cannot drag
    upward. Returning None rather than the largest bin present is deliberate:
    "the loudest noise" is not a tone.
    """
    freqs = result.freqs_hz
    lo = int(np.searchsorted(freqs, band_low_hz, side="left"))
    hi = int(np.searchsorted(freqs, band_high_hz, side="right"))
    if hi - lo < 3:
        return None
    log_mag = 20.0 * np.log10(np.maximum(result.magnitude[lo:hi, frame], 1e-15))
    floor = float(np.median(log_mag))
    peak = int(np.argmax(log_mag))
    if log_mag[peak] < floor + margin_db:
        return None
    return float(freqs[lo + peak])


def _rms_envelope(x: NDArray[np.float64], window_samples: int) -> NDArray[np.float64]:
    """Centred moving-RMS envelope."""
    window_samples = max(3, window_samples | 1)
    kernel = np.ones(window_samples, dtype=np.float64) / window_samples
    return np.sqrt(np.convolve(x**2, kernel, mode="same"))


def _refine_impact_time(
    samples: NDArray[np.float64],
    sample_rate_hz: float,
    coarse_time_s: float,
    frame_duration_s: float,
    ball_band_hz: tuple[float, float],
    config: SegmentConfig,
) -> float:
    """Walk the ball-band envelope back from its plateau to its onset.

    The coarse estimate can sit up to half a frame either side of impact, because
    a frame reports the average of its whole span. Every reference window here is
    therefore placed at least half a frame clear of it: the noise floor is read
    from before that interval, the ball's level from after it, and the onset is
    searched for between them.

    The band-pass is applied forwards and backwards, so it is zero-phase and
    smears the onset symmetrically rather than delaying it, and the RMS window is
    centred for the same reason. Neither needs a timing correction, and none is
    applied. A residual bias remains and is toward early: the ball's return is
    decaying from the moment it starts, so the plateau read after impact sits
    below the level at impact, which lowers the threshold and brings the crossing
    forward. It grows with ball speed, because a faster ball leaves the beam sooner.

    Returns the coarse estimate unchanged whenever the signal does not support a
    finer answer, rather than inventing precision the data does not carry.
    """
    nyquist = 0.5 * sample_rate_hz
    low = max(ball_band_hz[0], 1.0) / nyquist
    high = min(ball_band_hz[1], nyquist * 0.999) / nyquist
    if not 0.0 < low < high < 1.0:
        return coarse_time_s
    sos = sps.butter(4, [low, high], btype="bandpass", output="sos")
    band_limited = np.asarray(sps.sosfiltfilt(sos, samples), dtype=np.float64)

    window_samples = round(config.envelope_window_s * sample_rate_hz)
    envelope = _rms_envelope(band_limited, window_samples)

    radius = round(0.5 * frame_duration_s * sample_rate_hz)
    coarse_sample = round(coarse_time_s * sample_rate_hz)
    search_lo = coarse_sample - radius
    search_hi = coarse_sample + radius
    floor_lo = coarse_sample - 3 * radius
    plateau_hi = search_hi + round(config.plateau_window_s * sample_rate_hz)
    if floor_lo < 0 or plateau_hi > envelope.size or radius < window_samples:
        return coarse_time_s

    floor = float(np.median(envelope[floor_lo:search_lo]))
    plateau = float(np.median(envelope[search_hi:plateau_hi]))
    if plateau <= floor:
        return coarse_time_s

    threshold = floor + config.onset_threshold_fraction * (plateau - floor)
    index = search_hi
    while index > search_lo and envelope[index] > threshold:
        index -= 1
    if index <= search_lo:
        # The envelope never fell back to the floor inside the search window, so
        # the onset is not where the coarse pass said it was.
        return coarse_time_s
    return float(index) / sample_rate_hz


def segment_shot(
    samples: NDArray[np.float64], result: StftResult, config: SegmentConfig
) -> Segments | NoReading:
    """Locate impact and split the capture, or explain why it could not be done."""
    times = result.times_s
    searchable = np.flatnonzero((times >= config.search_start_s) & (times <= config.search_end_s))
    searchable = searchable[searchable > 0]
    if searchable.size == 0:
        return NoReading(
            reason="impact search window contains no complete spectrogram frames",
            source="radar",
        )

    flux = spectral_flux(result, config.band_low_hz, config.band_high_hz)
    masked = np.full(flux.shape, -np.inf)
    masked[searchable] = flux[searchable]
    impact_frame = int(np.argmax(masked))
    if not np.isfinite(masked[impact_frame]) or masked[impact_frame] <= 0.0:
        return NoReading(
            reason="no rise in spectral energy inside the impact search window", source="radar"
        )
    coarse_time = float(times[impact_frame])

    # Step a whole window clear of impact in each direction: a frame that
    # straddles impact holds both the club and the ball and identifies neither.
    frames_per_window = int(np.ceil(result.config.n_fft / result.config.hop))
    club_frame = impact_frame - frames_per_window
    ball_frame = impact_frame + frames_per_window
    if club_frame < 0 or ball_frame >= result.n_frames:
        return NoReading(
            reason=(
                "impact detected too close to the edge of the capture to read the club "
                "and ball tones from frames clear of it"
            ),
            source="radar",
        )

    club_tone = strongest_tone_hz(
        result, club_frame, config.band_low_hz, config.band_high_hz, config.detection_margin_db
    )
    if club_tone is None:
        return NoReading(
            reason="no club return above the noise floor in the frame before impact",
            source="radar",
        )

    # The floor for the ball search is the top of the club's band, not its peak.
    club_edge = band_upper_edge_hz(
        result, club_frame, club_tone, config.club_edge_drop_db, config.band_high_hz
    )
    search_floor = max(club_edge, club_tone * config.min_ball_to_club_ratio)

    ball_tone = strongest_tone_hz(
        result, ball_frame, search_floor, config.band_high_hz, config.detection_margin_db
    )
    if ball_tone is None:
        return NoReading(
            reason=(
                "no tone appeared above the club's own band after impact; a struck ball "
                f"always leaves faster than the head, so nothing below "
                f"{search_floor:.0f} Hz can be the ball"
            ),
            source="radar",
        )

    ball_band = (
        max(config.band_low_hz, ball_tone - config.ball_band_margin_hz),
        min(config.band_high_hz, ball_tone + config.ball_band_margin_hz),
    )

    impact_time = _refine_impact_time(
        samples,
        result.config.sample_rate_hz,
        coarse_time,
        result.config.frame_duration_s,
        ball_band,
        config,
    )

    # A frame that straddles impact contains both the club and the ball and is
    # evidence for neither. Keep only frames wholly on one side.
    hop = result.config.hop
    n_fft = result.config.n_fft
    impact_sample = impact_time * result.config.sample_rate_hz
    frame_start = np.arange(result.n_frames) * hop
    frame_end = frame_start + n_fft

    club_indices = np.flatnonzero(frame_end <= impact_sample)
    ball_indices = np.flatnonzero(frame_start >= impact_sample)
    club_range = (int(club_indices[0]), int(club_indices[-1]) + 1) if club_indices.size else (0, 0)
    ball_range = (int(ball_indices[0]), int(ball_indices[-1]) + 1) if ball_indices.size else (0, 0)

    return Segments(
        impact_time_s=impact_time,
        impact_time_coarse_s=coarse_time,
        impact_frame=impact_frame,
        club_frames=club_range,
        ball_frames=ball_range,
        ball_band_hz=ball_band,
        ball_tone_hz=ball_tone,
        club_tone_hz=club_tone,
        club_band_edge_hz=club_edge,
    )
