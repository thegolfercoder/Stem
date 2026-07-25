"""Goodness-of-fit metrics and the ranking policy.

The product promise is "return the simplest equation that accurately explains
the data", so ranking cannot be pure error minimisation — a quintic will always
beat a line on residuals. Three forces are combined:

1. **Evidence** — corrected Akaike information criterion (AICc), which already
   trades likelihood against parameter count and corrects for small samples.
2. **Readability** — a structural cost per model family, so `2x + 1` is
   preferred over an equivalent-fitting `2.001x + 0.999 + 0.0001 sin(x)`.
3. **Smoothness** — an explicit penalty when the fitted curve oscillates more
   than the data it is explaining, which is what over-fitted polynomials do
   between sample points.

Confidence is reported as Akaike weights over the combined score: a proper
normalised measure of relative support, not an invented percentage.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

#: Weight on the readability prior. Scaled by log(n) so that the prior keeps
#: some bite as datasets grow instead of being swamped by the likelihood term.
SIMPLICITY_WEIGHT = 1.6

#: Weight on excess curvature. Deliberately larger than the simplicity weight:
#: visible ringing is a worse failure than an extra parameter.
SMOOTHNESS_WEIGHT = 7.0


@dataclass(frozen=True)
class Metrics:
    n: int
    #: Sample count after discounting for serial correlation; the value the
    #: information criteria are actually evaluated at.
    n_effective: float
    k: int
    rss: float
    r2: float
    adjusted_r2: float
    rmse: float
    mae: float
    max_error: float
    aic: float
    aicc: float
    bic: float

    def as_dict(self) -> dict[str, float | int]:
        return {
            "n": self.n,
            "n_effective": self.n_effective,
            "k": self.k,
            "rss": self.rss,
            "r2": self.r2,
            "adjusted_r2": self.adjusted_r2,
            "rmse": self.rmse,
            "mae": self.mae,
            "max_error": self.max_error,
            "aic": self.aic,
            "aicc": self.aicc,
            "bic": self.bic,
        }


#: Autocorrelation is estimated from a finite residual series and is itself
#: noisy, so it is clamped before use. The cap also bounds how far the effective
#: sample size can fall: at ρ = 0.8 it is n/9.
MAX_TRUSTED_AUTOCORRELATION = 0.8


def effective_sample_size(residuals: np.ndarray) -> float:
    """Discount the sample count for serial correlation in the residuals.

    Information criteria assume independent observations. That holds for
    scattered measurements, but not for the inputs this product is built
    around: a traced screenshot or a freehand stroke yields hundreds of points
    whose residuals are dominated by smooth systematic error — pixel
    quantisation, a wobbling hand — rather than independent noise.

    Left uncorrected, a 350-point trace makes an R² difference in the fifth
    decimal place look like overwhelming evidence, and a sinusoid beats the
    parabola that actually drew the picture. Deflating by the standard
    ``n·(1-ρ)/(1+ρ)`` factor restores the intended balance, and costs nothing
    on genuinely independent data, where ρ ≈ 0 leaves n untouched.
    """
    n = int(residuals.size)
    if n < 4:
        return float(n)

    centred = residuals - np.mean(residuals)
    denominator = float(np.sum(centred**2))
    if denominator <= 1e-300:
        return float(n)

    rho = float(np.sum(centred[:-1] * centred[1:]) / denominator)
    rho = float(np.clip(rho, 0.0, MAX_TRUSTED_AUTOCORRELATION))
    return max(4.0, n * (1.0 - rho) / (1.0 + rho))


def compute_metrics(
    y: np.ndarray,
    y_hat: np.ndarray,
    k: int,
    n_effective: float | None = None,
) -> Metrics:
    """Standard regression diagnostics plus information criteria.

    The information criteria use the Gaussian-likelihood form
    ``n·ln(RSS/n) + penalty``, which is the usual choice when the noise scale is
    itself estimated from the residuals, evaluated at the *effective* sample
    size rather than the raw point count.

    `n_effective` must be supplied by the caller whenever the result will be
    compared against other candidates. Information criteria are only comparable
    when every model is scored against the same data *and* the same sample
    count; letting each candidate deflate n by its own residual correlation
    inverts the comparison, rewarding models whose residuals are the most
    structured. The caller therefore measures the correlation once, from the
    most accurate fit available, and applies it to every candidate.
    """
    residuals = y - y_hat
    n = int(y.size)
    rss = float(np.sum(residuals**2))
    total = float(np.sum((y - np.mean(y)) ** 2))

    # A perfectly flat target has no variance to explain; treat an exact fit as
    # R² = 1 and anything else as 0 rather than dividing by zero.
    if total <= 1e-15:
        r2 = 1.0 if rss <= 1e-15 else 0.0
    else:
        r2 = 1.0 - rss / total

    denominator = n - k - 1
    adjusted_r2 = 1.0 - (1.0 - r2) * (n - 1) / denominator if denominator > 0 else r2

    # Floor the RSS at the precision the data can actually resolve. Below this
    # the fit is exact to machine precision, and the remaining differences are
    # rounding artefacts — without the floor, an RSS of 1e-25 versus 1e-24
    # reads as overwhelming evidence, and the more elaborate model wins a tie
    # it should have lost on simplicity.
    safe_rss = max(rss, 1e-12 * max(total, 1e-300), 1e-300)
    n_eff = (
        float(n_effective)
        if n_effective is not None
        else effective_sample_size(residuals)
    )
    log_likelihood_term = n_eff * math.log(safe_rss / n_eff) if n_eff > 0 else 0.0
    aic = log_likelihood_term + 2 * k
    correction = (
        (2 * k * (k + 1)) / (n_eff - k - 1)
        if n_eff - k - 1 > 0
        else 4.0 * k * (k + 1)
    )
    aicc = aic + correction
    bic = log_likelihood_term + k * math.log(max(n_eff, 2))

    return Metrics(
        n=n,
        n_effective=float(n_eff),
        k=k,
        rss=rss,
        r2=float(r2),
        adjusted_r2=float(adjusted_r2),
        rmse=float(math.sqrt(rss / n)) if n else float("inf"),
        mae=float(np.mean(np.abs(residuals))) if n else float("inf"),
        max_error=float(np.max(np.abs(residuals))) if n else float("inf"),
        aic=float(aic),
        aicc=float(aicc),
        bic=float(bic),
    )


def _mean_abs_second_difference(values: np.ndarray) -> float:
    if values.size < 3:
        return 0.0
    return float(np.mean(np.abs(np.diff(values, n=2))))


def excess_curvature(x: np.ndarray, y: np.ndarray, y_hat: np.ndarray) -> float:
    """How much more the model wiggles than the data does, in log units.

    Both curves are interpolated onto a common uniform grid so the measure is
    independent of sample spacing. The data's own curvature is measured after a
    short moving average, so that point noise is not mistaken for structure and
    used to excuse a genuinely oscillating model.

    Returns 0 when the model is no wigglier than the data.
    """
    if x.size < 5:
        return 0.0

    grid = np.linspace(float(x[0]), float(x[-1]), min(256, max(32, x.size)))
    model_curve = np.interp(grid, x, y_hat)
    data_curve = np.interp(grid, x, y)

    window = max(3, grid.size // 32)
    kernel = np.ones(window) / window
    smoothed = np.convolve(data_curve, kernel, mode="same")
    # Convolution tapers the ends; ignore them.
    smoothed = smoothed[window:-window] if smoothed.size > 2 * window else smoothed
    trimmed_model = (
        model_curve[window:-window] if model_curve.size > 2 * window else model_curve
    )

    model_curvature = _mean_abs_second_difference(trimmed_model)
    data_curvature = _mean_abs_second_difference(smoothed)

    # Scale relative to the vertical extent so the measure is unit-free.
    scale = float(np.max(data_curve) - np.min(data_curve)) or 1.0
    floor = 1e-4 * scale
    ratio = (model_curvature + floor) / (data_curvature + floor)
    return float(max(0.0, math.log(ratio)))


def combined_score(
    metrics: Metrics,
    complexity: float,
    curvature: float,
    *,
    simplicity_weight: float = SIMPLICITY_WEIGHT,
    smoothness_weight: float = SMOOTHNESS_WEIGHT,
) -> float:
    """AICc plus the readability and smoothness priors. Lower is better."""
    # Scaled by the same effective sample size the AICc term uses, so the priors
    # keep their relative weight instead of being swamped on dense inputs.
    scale = math.log(max(metrics.n_effective, 3.0))
    return (
        metrics.aicc
        + simplicity_weight * complexity * scale
        + smoothness_weight * curvature * scale
    )


def akaike_weights(scores: list[float]) -> list[float]:
    """Normalised relative support for each candidate, summing to 1.

    Standard Akaike weights: ``exp(-Δ/2)`` normalised. Because our score is AICc
    plus additive priors, the same transform applies unchanged.
    """
    if not scores:
        return []
    finite = [s for s in scores if math.isfinite(s)]
    if not finite:
        return [1.0 / len(scores)] * len(scores)

    best = min(finite)
    raw = [
        math.exp(-0.5 * min(s - best, 700.0)) if math.isfinite(s) else 0.0
        for s in scores
    ]
    total = sum(raw)
    if total <= 0:
        return [1.0 / len(scores)] * len(scores)
    return [value / total for value in raw]
