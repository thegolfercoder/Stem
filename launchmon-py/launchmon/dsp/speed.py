"""Turning frequency tracks into speeds.

Ball launch speed
-----------------
The radar sees the ball only after it has already begun to slow, and it sees it
for a surprisingly short time: received power falls as the fourth power of range,
so the return from a driven ball drops twenty decibels within a few metres of the
tee. The launch speed is therefore not observed. It is obtained by fitting the
speed decay over whatever window the ball remained visible and evaluating that
fit at impact.

The fit uses the exact solution of quadratic drag, v(t) = v0 / (1 + k*v0*t),
because that is the form the physics produces over a short, nearly straight
stretch of flight. Two free parameters is one more than a short observation
window can always support, so the estimator can also hold k at a value derived
from a supplied drag coefficient and fit only v0. Which of the two it used is
reported, never guessed at by the caller.

Clubhead speed
--------------
A club is a rigid body rotating about a centre up in the golfer's arms. Every
point along the shaft moves at a different speed, so the return occupies a band
whose *upper edge* is the head. The strongest bin sits below that edge, at
whatever weighted centre the shaft's scatterers happen to produce, so reading
the peak reports something slower than the clubhead. This module reads the upper
edge instead, at a level threshold that is a calibration against reference
clubhead speeds and not a measurement.
"""

from __future__ import annotations

from enum import StrEnum

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from scipy import optimize

from launchmon.dsp.ridge import Ridge, band_upper_edge_hz
from launchmon.dsp.segment import Segments
from launchmon.dsp.stft import StftResult
from launchmon.physics import doppler_hz_to_speed, drag_decel_coefficient
from launchmon.quantity import NoReading, Provenance, Quantity, Reading

# Physically plausible range of the drag coefficient of a golf ball in flight,
# used only to bound the free-k fit so it cannot wander somewhere unphysical.
# These are bounds on a search, not a claim about any particular ball.
DRAG_COEFFICIENT_BOUNDS: tuple[float, float] = (0.15, 0.60)


class DecayFitMode(StrEnum):
    FREE_K = "free_k"
    """Fit both launch speed and the drag term. Needs a long enough observation
    window that the speed measurably changed within it."""

    FIXED_K = "fixed_k"
    """Fit launch speed only, holding the drag term at the supplied value. The
    honest choice when the ball was visible too briefly to constrain both."""

    AUTO = "auto"
    """Attempt FREE_K and fall back to FIXED_K when the fit is ill-conditioned."""


class BallSpeedConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    fit_mode: DecayFitMode
    drag_coefficient: float = Field(
        description=(
            "Used for FIXED_K, and as the starting point for FREE_K. Provisional "
            "until the Stage 2 trajectory fit replaces it."
        )
    )
    min_frames: int = Field(description="Valid ball frames below which no reading is produced.")
    min_frames_free_k: int = Field(
        description="Valid ball frames below which FREE_K is not attempted."
    )
    max_condition_number: float = Field(
        description=(
            "Condition number of the fit's Jacobian above which FREE_K is judged "
            "ill-conditioned and AUTO falls back. A numerical criterion on the fit, "
            "not a statement about accuracy."
        )
    )
    extrapolation_tolerance_multiple: float = Field(
        description=(
            "How much further than the drag model predicts the fit is allowed to move "
            "the answer between the first observed frame and impact. The ball is never "
            "seen at impact - the first usable frame sits tens of milliseconds later - "
            "so the launch speed is always an extrapolation back across that gap. The "
            "size of that gap is known and so is the deceleration across it, which "
            "bounds how far the extrapolation can legitimately reach. A fit that "
            "travels much further is not describing the ball's decay; it is following "
            "something else down."
        )
    )
    max_extrapolation_fraction: float = Field(
        description=(
            "Floor under the tolerance above, so that a slow ball, whose modelled loss "
            "over the gap is nearly nothing, is not held to an impossible standard."
        )
    )
    max_weighted_residual_fraction: float = Field(
        description=(
            "Amplitude-weighted RMS fit residual, as a fraction of the fitted speed, "
            "above which the decay model is judged not to describe the track. A "
            "goodness-of-fit criterion, not an error bar."
        )
    )


class ClubSpeedConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    edge_drop_db: float = Field(
        description=(
            "How far below the club band's peak the upper edge is read. A "
            "calibration against reference clubhead speeds; no accuracy claim "
            "attaches to any value before that calibration exists."
        )
    )
    n_frames_before_impact: int = Field(
        description="Frames immediately before impact searched for the peak clubhead speed."
    )
    min_frames: int = Field(description="Valid club frames below which no reading is produced.")
    band_high_hz: float


class BallSpeedEstimate(BaseModel):
    """A launch speed with the diagnostics needed to judge how it was obtained.

    The diagnostics describe the fit, not the accuracy of the answer. No field
    here is an error bar, and none should be presented as one.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    reading: Reading
    fit_mode_used: DecayFitMode | None = None
    n_frames_used: int = 0
    observation_span_s: float = 0.0
    rms_residual_mps: float | None = None
    weighted_residual_fraction: float | None = None
    extrapolation_fraction: float | None = None
    drag_k_per_m: float | None = None
    condition_number: float | None = None


def _decay_residual(
    params: NDArray[np.float64],
    t_s: NDArray[np.float64],
    speed_mps: NDArray[np.float64],
    weights: NDArray[np.float64],
    fixed_k: float | None,
) -> NDArray[np.float64]:
    v0 = params[0]
    k = fixed_k if fixed_k is not None else params[1]
    model = v0 / (1.0 + k * v0 * t_s)
    return np.asarray(weights * (speed_mps - model))


def _fit_decay(
    t_s: NDArray[np.float64],
    speed_mps: NDArray[np.float64],
    weights: NDArray[np.float64],
    k_initial: float,
    k_bounds: tuple[float, float],
    fixed_k: float | None,
) -> tuple[float, float, float, NDArray[np.float64]]:
    """Least-squares fit of v(t) = v0/(1+k*v0*t). Returns v0, k, cost and residuals."""
    v0_initial = float(speed_mps[0]) if speed_mps.size else 0.0
    if fixed_k is not None:
        x0 = np.array([v0_initial])
        bounds = (np.array([0.0]), np.array([np.inf]))
    else:
        x0 = np.array([v0_initial, k_initial])
        bounds = (np.array([0.0, k_bounds[0]]), np.array([np.inf, k_bounds[1]]))

    solution = optimize.least_squares(
        _decay_residual, x0, bounds=bounds, args=(t_s, speed_mps, weights, fixed_k)
    )
    v0 = float(solution.x[0])
    k = fixed_k if fixed_k is not None else float(solution.x[1])
    return v0, k, float(solution.cost), np.asarray(solution.jac, dtype=np.float64)


def estimate_ball_launch_speed(
    ridge: Ridge, segments: Segments, config: BallSpeedConfig
) -> BallSpeedEstimate:
    """Radial launch speed at impact, from the ball segment's frequency track.

    The result is the speed *along the radar's line of sight*. Correcting it to
    the ball's true speed needs the launch angle, which this function is
    deliberately not given: the cosine correction belongs to fusion, where either
    a per-club prior or a camera-measured angle can supply the angle.
    """
    valid = ridge.valid
    if int(np.count_nonzero(valid)) < config.min_frames:
        return BallSpeedEstimate(
            reading=NoReading(
                reason=(
                    f"ball visible in {int(np.count_nonzero(valid))} usable frames, "
                    f"fewer than the {config.min_frames} required to fit its decay"
                ),
                source="radar",
            ),
            n_frames_used=int(np.count_nonzero(valid)),
        )

    t = ridge.times_s[valid] - segments.impact_time_s
    speed = doppler_hz_to_speed(ridge.freq_hz[valid])
    # Weight by amplitude: a frame twenty decibels down carries a tenth the say.
    weights = 10.0 ** (ridge.snr_db[valid] / 20.0)
    weights = weights / weights.max()
    span = float(t[-1] - t[0])

    k_nominal = drag_decel_coefficient(config.drag_coefficient)
    k_bounds = (
        drag_decel_coefficient(DRAG_COEFFICIENT_BOUNDS[0]),
        drag_decel_coefficient(DRAG_COEFFICIENT_BOUNDS[1]),
    )

    wanted_free_k = config.fit_mode in (DecayFitMode.FREE_K, DecayFitMode.AUTO)
    enough_frames = int(np.count_nonzero(valid)) >= config.min_frames_free_k
    condition: float | None = None

    if wanted_free_k and enough_frames:
        v0, k, _cost, jac = _fit_decay(t, speed, weights, k_nominal, k_bounds, None)
        condition = float(np.linalg.cond(jac))
        ill_conditioned = not np.isfinite(condition) or condition > config.max_condition_number
        if ill_conditioned and config.fit_mode is DecayFitMode.AUTO:
            v0, k, _cost, jac = _fit_decay(t, speed, weights, k_nominal, k_bounds, k_nominal)
            mode = DecayFitMode.FIXED_K
        elif ill_conditioned:
            return BallSpeedEstimate(
                reading=NoReading(
                    reason=(
                        "free drag fit is ill-conditioned over an observation window of "
                        f"{span * 1e3:.0f} ms; the ball did not stay in the beam long "
                        "enough to constrain both launch speed and drag"
                    ),
                    source="radar",
                ),
                fit_mode_used=DecayFitMode.FREE_K,
                n_frames_used=int(np.count_nonzero(valid)),
                observation_span_s=span,
                condition_number=condition,
            )
        else:
            mode = DecayFitMode.FREE_K
    else:
        v0, k, _cost, _ = _fit_decay(t, speed, weights, k_nominal, k_bounds, k_nominal)
        mode = DecayFitMode.FIXED_K

    residuals = _decay_residual(np.array([v0, k]), t, speed, np.ones_like(weights), None)
    rms_residual = float(np.sqrt(np.mean(residuals**2)))
    weighted = _decay_residual(np.array([v0, k]), t, speed, weights, None)
    weighted_fraction = (
        float(np.sqrt(np.sum(weighted**2) / np.sum(weights**2)) / v0) if v0 > 0 else float("inf")
    )

    # How far the fit reached back from the first frame it actually saw, against
    # how far the drag model says the ball could have travelled in that time.
    first_observed = float(speed[0])
    gap_s = float(t[0])
    extrapolation = v0 / first_observed if first_observed > 0 else float("inf")
    modelled_loss = abs(1.0 - 1.0 / (1.0 + k * v0 * gap_s)) if gap_s > 0 else 0.0
    allowed = max(
        config.max_extrapolation_fraction,
        config.extrapolation_tolerance_multiple * modelled_loss,
    )

    def with_reading(reading: Reading) -> BallSpeedEstimate:
        """Every return from here carries the same diagnostics, refusals included.

        A refusal that arrives without the numbers behind it cannot be argued
        with, and the no-reading rate is one of the results this has to produce.
        """
        return BallSpeedEstimate(
            reading=reading,
            fit_mode_used=mode,
            n_frames_used=int(np.count_nonzero(valid)),
            observation_span_s=span,
            rms_residual_mps=rms_residual,
            weighted_residual_fraction=weighted_fraction,
            extrapolation_fraction=extrapolation - 1.0,
            drag_k_per_m=k,
            condition_number=condition,
        )

    if abs(extrapolation - 1.0) > allowed:
        return with_reading(
            NoReading(
                reason=(
                    f"decay fit extrapolates {100 * (extrapolation - 1.0):+.1f} percent "
                    f"back to impact across a {gap_s * 1e3:.0f} ms gap in which drag "
                    f"accounts for at most {100 * allowed:.1f} percent; the fit is not "
                    "following the ball"
                ),
                source="radar",
            )
        )

    if weighted_fraction > config.max_weighted_residual_fraction:
        return with_reading(
            NoReading(
                reason=(
                    f"decay model leaves a weighted residual of "
                    f"{100 * weighted_fraction:.1f} percent of the fitted speed; the "
                    "frequency track is not a decaying ball"
                ),
                source="radar",
            )
        )

    return with_reading(
        Quantity(value=v0, unit="m/s", provenance=Provenance.MEASURED, source="radar")
    )


def estimate_clubhead_speed(
    result: StftResult,
    ridge: Ridge,
    segments: Segments,
    config: ClubSpeedConfig,
    club_frame_offset: int,
) -> Reading:
    """Peak clubhead speed, read from the upper edge of the club's return band.

    Args:
        result: the full spectrogram, needed to read band shape rather than just
            the tracked peak.
        ridge: the ridge extracted over the club frames only.
        segments: impact and the frame ranges.
        config: edge threshold and search extent.
        club_frame_offset: index in `result` of the first club frame, since the
            ridge was extracted from a slice.
    """
    valid = np.flatnonzero(ridge.valid)
    if valid.size < config.min_frames:
        return NoReading(
            reason=(
                f"club return usable in {valid.size} frames, fewer than the "
                f"{config.min_frames} required"
            ),
            source="radar",
        )

    search = valid[valid >= max(0, ridge.valid.size - config.n_frames_before_impact)]
    if search.size == 0:
        search = valid[-1:]

    edges_hz = [
        band_upper_edge_hz(
            result,
            int(local) + club_frame_offset,
            float(ridge.freq_hz[local]),
            config.edge_drop_db,
            config.band_high_hz,
        )
        for local in search
    ]
    peak_speed = float(np.max(doppler_hz_to_speed(np.asarray(edges_hz))))

    return Quantity(
        value=peak_speed,
        unit="m/s",
        provenance=Provenance.MEASURED,
        source="radar",
    )
