"""The radar channel end to end: samples in, speeds and a reason for every refusal out.

Kept as its own module rather than folded into `speed`, because it is the unit
the Swift port reproduces and the unit the golden vectors pin: one function,
one configuration object, no state carried between calls, so replaying an
archived capture under altered settings is a matter of changing the argument.

A limitation worth stating plainly
----------------------------------
There is one class of fault this pipeline cannot detect from the signal, and it
is better to say so than to appear to guard against it.

If the analogue front end attenuates the ball's tone while passing the club's,
the club's own return becomes the strongest thing left, and the club is an
extended body whose band is wide. Part of that band then gets read as the ball,
and the clubhead estimate is drawn from the same distorted band - so the two
speeds are both wrong, and wrong *consistently*. Their ratio lands where a real
strike's would. No cross-check between them can catch this, because the
information that would settle it was destroyed before the converter.

What the pipeline can do is refuse to trust a tone its amplifier was never
specified to pass, and it does. What it cannot do is notice that the amplifier
is not the amplifier the configuration describes. That needs a front-end
verification step at startup - an injected tone, or a look at the shape of the
noise floor - and it belongs to the capture layer, not here.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from launchmon.dsp.interference import InterferenceConfig, suppress_stationary_bins
from launchmon.dsp.ridge import Ridge, RidgeConfig, extract_ridge
from launchmon.dsp.segment import SegmentConfig, Segments, segment_shot
from launchmon.dsp.speed import (
    BallSpeedConfig,
    BallSpeedEstimate,
    ClubSpeedConfig,
    estimate_ball_launch_speed,
    estimate_clubhead_speed,
)
from launchmon.dsp.stft import StftConfig, StftResult, slice_frames, stft
from launchmon.quantity import NoReading, Provenance, Quantity, Reading


class RadarPipelineConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    stft: StftConfig
    interference: InterferenceConfig
    segment: SegmentConfig
    club_ridge: RidgeConfig
    ball_ridge: RidgeConfig
    ball_speed: BallSpeedConfig
    club_speed: ClubSpeedConfig
    front_end_passband_hz: tuple[float, float] = Field(
        description=(
            "The passband the analogue chain ahead of the converter is specified for, "
            "taken from hardware configuration. A tone outside it has been through an "
            "unknown amount of attenuation and cannot be trusted, so a ball found "
            "there is refused rather than reported. This tests the configuration "
            "against the signal, not the hardware against itself."
        )
    )
    implied_smash_bounds: tuple[float, float] = Field(
        description=(
            "Range of ball-speed-to-clubhead-speed ratios accepted as a real strike. "
            "The two speeds are estimated from different parts of the capture by "
            "different methods, so their ratio is a genuine cross-check rather than a "
            "restatement. The upper bound follows from the rules of golf capping the "
            "coefficient of restitution, which caps how much faster than the head the "
            "ball can leave; the lower bound is a plausibility floor, since a ball "
            "barely faster than the head usually means the club has been mistaken for "
            "the ball rather than that a shot was struck badly. Both are provisional "
            "and configurable, and neither is an accuracy claim."
        )
    )
    ball_band_low_fraction: float = Field(
        description=(
            "Lower edge of the ball ridge's search band, as a fraction of the ball "
            "tone detected at impact. The ball only ever slows, so the band need not "
            "extend upward. Set too low it admits the collapsing club return, which "
            "for a club whose ball-to-clubhead speed ratio is small sits close to the "
            "ball tone; that overlap is a known limitation of separating the two by "
            "frequency alone."
        )
    )


class RadarResult(BaseModel):
    """Everything the radar channel produced for one capture, refusals included."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    segments: Segments | NoReading
    ball_launch_speed: BallSpeedEstimate
    clubhead_speed: Reading
    smash_factor: Reading
    n_suppressed_bins: int = 0
    spectrogram: StftResult | None = None
    club_ridge: Ridge | None = None
    ball_ridge: Ridge | None = None


def _refuse_all(
    segments: Segments | NoReading,
    refusal: NoReading,
    n_suppressed: int,
    spectrogram: StftResult | None,
) -> RadarResult:
    return RadarResult(
        segments=segments,
        ball_launch_speed=BallSpeedEstimate(reading=refusal),
        clubhead_speed=refusal,
        smash_factor=refusal,
        n_suppressed_bins=n_suppressed,
        spectrogram=spectrogram,
    )


def analyse_radar_capture(
    samples: NDArray[np.float64],
    config: RadarPipelineConfig,
    keep_intermediates: bool = False,
) -> RadarResult:
    """Run the radar channel over one capture.

    Args:
        samples: the digitised amplifier output, one channel.
        config: every parameter the pipeline uses. Nothing is read from a global.
        keep_intermediates: retain the spectrogram and ridges for the debug view
            and for replay diffing. Off by default so batch replays stay cheap.

    Returns:
        A result in which every unavailable number is an explicit refusal
        carrying its reason, never a substituted guess.
    """
    x = np.asarray(samples, dtype=np.float64)
    raw_spectrogram = stft(x, config.stft)
    # Stationary interferers are removed before anything tries to interpret the
    # spectrogram, because hum harmonics are tones and every later stage is
    # looking for tones.
    spectrogram, suppressed = suppress_stationary_bins(raw_spectrogram, config.interference)
    n_suppressed = int(np.count_nonzero(suppressed))

    segments = segment_shot(x, spectrogram, config.segment)

    if isinstance(segments, NoReading):
        return _refuse_all(
            segments, segments, n_suppressed, spectrogram if keep_intermediates else None
        )

    passband_low, passband_high = config.front_end_passband_hz
    if not passband_low <= segments.ball_tone_hz <= passband_high:
        return _refuse_all(
            segments,
            NoReading(
                reason=(
                    f"the tone taken for the ball sits at {segments.ball_tone_hz:.0f} Hz, "
                    f"outside the {passband_low:.0f} to {passband_high:.0f} Hz the "
                    "analogue chain is specified to pass; whatever reached the converter "
                    "there has been attenuated by an unknown amount"
                ),
                source="radar",
            ),
            n_suppressed,
            spectrogram if keep_intermediates else None,
        )

    club_ridge: Ridge | None = None
    ball_ridge: Ridge | None = None

    clubhead: Reading = NoReading(
        reason="no complete spectrogram frame lies wholly before impact", source="radar"
    )
    if segments.n_club_frames > 0:
        club_slice = slice_frames(spectrogram, *segments.club_frames)
        club_ridge = extract_ridge(club_slice, config.club_ridge)
        clubhead = estimate_clubhead_speed(
            spectrogram, club_ridge, segments, config.club_speed, segments.club_frames[0]
        )

    ball_estimate = BallSpeedEstimate(
        reading=NoReading(
            reason="no complete spectrogram frame lies wholly after impact", source="radar"
        )
    )
    if segments.n_ball_frames > 0:
        ball_slice = slice_frames(spectrogram, *segments.ball_frames)
        ball_tone_hz = 0.5 * (segments.ball_band_hz[0] + segments.ball_band_hz[1])
        ball_band = config.ball_ridge.model_copy(
            update={
                "band_low_hz": max(
                    config.ball_ridge.band_low_hz,
                    ball_tone_hz * config.ball_band_low_fraction,
                ),
                "band_high_hz": min(config.ball_ridge.band_high_hz, segments.ball_band_hz[1]),
            }
        )
        ball_ridge = extract_ridge(ball_slice, ball_band)
        ball_estimate = estimate_ball_launch_speed(ball_ridge, segments, config.ball_speed)

    # Cross-check. The two speeds come from different parts of the capture and
    # from different estimators, so their ratio tests both. A ratio outside what a
    # struck ball can produce means one of them is not measuring what it claims -
    # in practice the club's own return having been followed as though it were the
    # ball, which is a wrong number rather than a missing one.
    smash: Reading = NoReading(
        reason="smash factor needs both a ball speed and a clubhead speed", source="radar"
    )
    ball_reading = ball_estimate.reading
    if not isinstance(ball_reading, NoReading) and not isinstance(clubhead, NoReading):
        ratio = ball_reading.value / clubhead.value if clubhead.value > 0 else float("inf")
        low, high = config.implied_smash_bounds
        if not low <= ratio <= high:
            refusal = NoReading(
                reason=(
                    f"ball speed and clubhead speed imply a smash factor of {ratio:.2f}, "
                    f"outside the {low:.2f} to {high:.2f} a struck ball can produce; the "
                    "tone taken for the ball is not the ball"
                ),
                source="radar",
            )
            ball_estimate = ball_estimate.model_copy(update={"reading": refusal})
            smash = refusal
        else:
            smash = Quantity(value=ratio, unit="", provenance=Provenance.DERIVED, source="radar")

    return RadarResult(
        segments=segments,
        ball_launch_speed=ball_estimate,
        clubhead_speed=clubhead,
        smash_factor=smash,
        n_suppressed_bins=n_suppressed,
        spectrogram=spectrogram if keep_intermediates else None,
        club_ridge=club_ridge if keep_intermediates else None,
        ball_ridge=ball_ridge if keep_intermediates else None,
    )
