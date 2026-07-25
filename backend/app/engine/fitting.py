"""Fit every plausible model to a sample, then rank the survivors.

Three fitting strategies are used, chosen per model:

* **Exact linear least squares** for polynomials, which are linear in their
  parameters — no iteration, no seeds, no local minima.
* **Breakpoint search plus least squares** for continuous piecewise-linear
  models, which are linear in their parameters once the breakpoints are fixed.
* **Multi-start Levenberg–Marquardt / trust-region** for everything else, seeded
  by the family-specific heuristics in `models.py`.

The result of each is a `Candidate` carrying its parameters, diagnostics, and
the three representations the client needs (LaTeX, infix template, residuals).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
import sympy as sp
from scipy.optimize import curve_fit, least_squares

from . import prettify as pretty_mod
from . import scoring
from .models import REGISTRY, ModelSpec, X, callable_for
from .preprocess import Sample, prepare

#: Cap on how many models get the (relatively expensive) prettify treatment.
#: Anything below the top few is never going to be shown as the answer.
PRETTIFY_LIMIT = 5

#: At most this many members of one family are returned, so the list shows
#: genuinely different hypotheses rather than five polynomials.
MAX_PER_FAMILY = 2

#: Value substituted for non-finite model output during optimisation. Large
#: enough to be rejected, finite enough not to poison the Jacobian.
BLOWUP = 1e15

#: Residual share below which a fit counts as essentially exact (R² ≈ 0.99999),
#: letting the multi-start loop stop early.
EXCELLENT_FIT_FRACTION = 1e-5


@dataclass
class Candidate:
    spec: ModelSpec
    params: list[float]
    display: list[sp.Expr]
    snapped: list[bool]
    metrics: scoring.Metrics
    curvature: float
    score: float
    residuals: np.ndarray
    stderr: list[float | None] = field(default_factory=list)
    confidence: float = 0.0
    #: Shared effective sample size this candidate was scored at.
    n_effective: float | None = None


# --------------------------------------------------------------------------
# Numeric helpers
# --------------------------------------------------------------------------


def _safe_evaluator(spec: ModelSpec):
    """Wrap a model so out-of-domain parameters produce bad-but-finite output.

    Optimisers explore invalid regions (a negative argument to `log`, a pole
    landing on a sample). Returning NaN there aborts the fit; returning a huge
    residual simply steers the search away.
    """
    raw = callable_for(spec)

    def evaluate(x: np.ndarray, *params: float) -> np.ndarray:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with np.errstate(all="ignore"):
                try:
                    values = raw(x, *params)
                except (ValueError, ZeroDivisionError, TypeError, OverflowError):
                    return np.full(np.shape(x), BLOWUP, dtype=float)
        values = np.asarray(values, dtype=float)
        return np.nan_to_num(values, nan=BLOWUP, posinf=BLOWUP, neginf=-BLOWUP)

    return evaluate


def _hinge_design(x: np.ndarray, knots: Sequence[float]) -> np.ndarray:
    """Design matrix for a continuous piecewise-linear spline.

    Columns are ``[1, x - t₁, relu(x - t₁), relu(x - t₂), …]``. Continuity at
    each knot is structural, not a constraint that has to be enforced.
    """
    columns = [np.ones_like(x), x - knots[0]]
    columns.extend(np.maximum(0.0, x - knot) for knot in knots)
    return np.column_stack(columns)


# --------------------------------------------------------------------------
# Per-strategy fitters
# --------------------------------------------------------------------------


def _fit_polynomial(spec: ModelSpec, s: Sample) -> tuple[list[float], list[float | None]] | None:
    degree = spec.poly_degree
    assert degree is not None
    if s.n < degree + 1:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            if s.n > degree + 2:
                coefficients, covariance = np.polyfit(s.x, s.y, degree, cov=True)
                errors = [float(np.sqrt(abs(v))) for v in np.diag(covariance)]
            else:
                coefficients = np.polyfit(s.x, s.y, degree)
                errors = [None] * (degree + 1)
        except (np.linalg.LinAlgError, ValueError):
            return None
    if not np.all(np.isfinite(coefficients)):
        return None
    return [float(c) for c in np.atleast_1d(coefficients)], list(errors)


def _fit_piecewise(spec: ModelSpec, s: Sample) -> tuple[list[float], list[float | None]] | None:
    """Grid-search the breakpoints, solving exactly for the slopes at each."""
    n_knots = spec.breakpoints
    # Keep knots away from the very edges, where a segment would hold 1-2 points.
    grid = np.quantile(s.x, np.linspace(0.12, 0.88, 22))
    grid = np.unique(grid)
    if grid.size < n_knots + 1:
        return None

    best: tuple[float, list[float], np.ndarray] | None = None
    combinations: list[tuple[float, ...]] = (
        [(t,) for t in grid]
        if n_knots == 1
        else [
            (t1, t2)
            for i, t1 in enumerate(grid)
            for t2 in grid[i + 1 :]
            # Require real separation, or the two knots collapse into one.
            if t2 - t1 > 0.08 * (s.x[-1] - s.x[0])
        ]
    )

    for knots in combinations:
        design = _hinge_design(s.x, knots)
        try:
            solution, *_ = np.linalg.lstsq(design, s.y, rcond=None)
        except np.linalg.LinAlgError:
            continue
        residual = float(np.sum((s.y - design @ solution) ** 2))
        if best is None or residual < best[0]:
            best = (residual, list(knots), solution)

    if best is None:
        return None

    _, knots, solution = best
    # Unpack the hinge basis back into the model's declared parameter order.
    intercept = float(solution[0])
    slopes = [float(solution[1])]
    for delta in solution[2:]:
        slopes.append(slopes[-1] + float(delta))
    params = [*slopes, *knots, intercept]

    # Polish: let the knots move off the grid.
    evaluate = _safe_evaluator(spec)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            refined, covariance = curve_fit(
                evaluate, s.x, s.y, p0=params, maxfev=3000
            )
        if np.all(np.isfinite(refined)):
            polished_rss = float(np.sum((s.y - evaluate(s.x, *refined)) ** 2))
            if polished_rss <= best[0]:
                errors = [float(np.sqrt(abs(v))) for v in np.diag(covariance)]
                return [float(v) for v in refined], errors
    except (RuntimeError, ValueError, TypeError, np.linalg.LinAlgError):
        pass

    return params, [None] * len(params)


def _fit_nonlinear(spec: ModelSpec, s: Sample) -> tuple[list[float], list[float | None]] | None:
    """Multi-start curve fitting; the best converged start wins."""
    evaluate = _safe_evaluator(spec)
    bounds = spec.bounds(s.x, s.y) if spec.bounds else (-np.inf, np.inf)

    try:
        seeds = spec.seeds(s.x, s.y)
    except (ValueError, FloatingPointError, np.linalg.LinAlgError):
        return None

    total_variance = float(np.sum((s.y - np.mean(s.y)) ** 2))

    best: tuple[float, list[float], list[float | None]] | None = None
    for seed in seeds:
        if len(seed) != spec.n_params or not all(np.isfinite(seed)):
            continue
        clipped = list(seed)
        if isinstance(bounds, tuple) and isinstance(bounds[0], list):
            lower, upper = bounds
            clipped = [
                float(np.clip(value, low + 1e-9 if np.isfinite(low) else value,
                              high - 1e-9 if np.isfinite(high) else value))
                for value, low, high in zip(seed, lower, upper)
            ]
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                params, covariance = curve_fit(
                    evaluate,
                    s.x,
                    s.y,
                    p0=clipped,
                    bounds=bounds,
                    maxfev=2500,
                )
        except (RuntimeError, ValueError, TypeError, np.linalg.LinAlgError):
            continue

        if not np.all(np.isfinite(params)):
            continue
        residual = float(np.sum((s.y - evaluate(s.x, *params)) ** 2))
        if not np.isfinite(residual):
            continue
        with np.errstate(all="ignore"):
            errors = [
                float(np.sqrt(abs(v))) if np.isfinite(v) else None
                for v in np.diag(np.atleast_2d(covariance))
            ]
        if best is None or residual < best[0]:
            best = (residual, [float(p) for p in params], errors)

        # A near-exact fit cannot be improved on, and the remaining seeds are
        # only there to escape local minima. Stopping here is the difference
        # between one optimisation and six for every well-behaved input.
        if residual <= EXCELLENT_FIT_FRACTION * total_variance:
            break

    if best is None:
        return None
    return best[1], best[2]


def _make_refit(spec: ModelSpec, s: Sample):
    """Build the callback prettify uses to re-optimise unpinned parameters."""
    evaluate = _safe_evaluator(spec)
    bounds = spec.bounds(s.x, s.y) if spec.bounds else None

    def refit(mask: Sequence[bool], values: Sequence[float]) -> list[float] | None:
        free = [i for i, fixed in enumerate(mask) if not fixed]
        if not free:
            return list(values)

        template = list(values)

        def residuals(free_values: np.ndarray) -> np.ndarray:
            trial = list(template)
            for slot, value in zip(free, free_values):
                trial[slot] = float(value)
            return evaluate(s.x, *trial) - s.y

        if bounds is not None:
            lower = [bounds[0][i] for i in free]
            upper = [bounds[1][i] for i in free]
        else:
            lower, upper = -np.inf, np.inf

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                solution = least_squares(
                    residuals,
                    x0=[template[i] for i in free],
                    bounds=(lower, upper),
                    max_nfev=300,
                )
        except (ValueError, np.linalg.LinAlgError):
            return None

        if not solution.success and solution.status <= 0:
            return None
        result = list(template)
        for slot, value in zip(free, solution.x):
            result[slot] = float(value)
        return result

    return refit


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------


def _fit_spec(spec: ModelSpec, s: Sample) -> Candidate | None:
    if not spec.guard(s.x, s.y):
        return None

    if spec.poly_degree is not None:
        fitted = _fit_polynomial(spec, s)
    elif spec.breakpoints:
        fitted = _fit_piecewise(spec, s)
    else:
        fitted = _fit_nonlinear(spec, s)

    if fitted is None:
        return None
    params, stderr = fitted

    if spec.canonicalize is not None:
        params = spec.canonicalize(params)

    evaluate = _safe_evaluator(spec)
    predicted = evaluate(s.x, *params)
    if not np.all(np.isfinite(predicted)) or np.any(np.abs(predicted) >= BLOWUP):
        return None

    metrics = scoring.compute_metrics(s.y, predicted, spec.n_params)
    curvature = scoring.excess_curvature(s.x, s.y, predicted)

    return Candidate(
        spec=spec,
        params=params,
        display=[pretty_mod._significant(p) for p in params],
        snapped=[False] * len(params),
        metrics=metrics,
        curvature=curvature,
        score=scoring.combined_score(metrics, spec.complexity, curvature),
        residuals=s.y - predicted,
        stderr=stderr,
    )


def _rescore(candidate: Candidate, s: Sample, n_effective: float) -> None:
    """Recompute a candidate's metrics and score at a shared sample size."""
    candidate.n_effective = n_effective
    candidate.metrics = scoring.compute_metrics(
        s.y,
        s.y - candidate.residuals,
        candidate.spec.n_params,
        n_effective=n_effective,
    )
    candidate.score = scoring.combined_score(
        candidate.metrics, candidate.spec.complexity, candidate.curvature
    )


def _apply_prettify(candidate: Candidate, s: Sample) -> None:
    """Snap parameters in place and refresh every dependent diagnostic.

    `score` is deliberately left untouched. Snapping always costs a little
    accuracy, so recomputing the score here would penalise exactly the
    candidates that earned a readable form — and let un-prettified models
    leapfrog them. Ranking uses each family's best achievable fit; prettifying
    is a presentation step applied afterwards, to the models already chosen.
    The reported metrics *are* refreshed, so the quoted R² always describes the
    curve actually being drawn.
    """
    spec = candidate.spec
    evaluate = _safe_evaluator(spec)
    result = pretty_mod.prettify(
        spec,
        candidate.params,
        s.x,
        s.y,
        evaluate,
        refit=_make_refit(spec, s),
        stderr=candidate.stderr,
    )

    predicted = evaluate(s.x, *result.params)
    if not np.all(np.isfinite(predicted)):
        return

    candidate.params = result.params
    candidate.display = result.display
    candidate.snapped = result.snapped
    candidate.metrics = scoring.compute_metrics(
        s.y, predicted, spec.n_params, n_effective=candidate.n_effective
    )
    candidate.curvature = scoring.excess_curvature(s.x, s.y, predicted)
    candidate.residuals = s.y - predicted


def _singularities(spec: ModelSpec, params: Sequence[float]) -> list[float]:
    """Real poles of the fitted expression, so the renderer can break the line."""
    # Only rational models have poles, and `solve` is far too slow to call
    # speculatively on families that provably have none.
    if spec.family != "rational":
        return []
    try:
        expression = spec.expr([sp.Float(p) for p in params])
        denominator = sp.denom(sp.together(expression))
        if denominator.is_number:
            return []
        roots = sp.solve(sp.Eq(denominator, 0), X, dict=False)
    except (TypeError, ValueError, NotImplementedError, sp.SympifyError):
        return []

    poles: list[float] = []
    for root in roots:
        try:
            value = complex(root)
        except (TypeError, ValueError):
            continue
        if abs(value.imag) < 1e-9 and np.isfinite(value.real):
            poles.append(float(value.real))
    return sorted(poles)


def _slider(name: str, value: float, error: float | None) -> dict[str, Any]:
    """A slider range wide enough to explore, tight enough to be usable."""
    magnitude = max(abs(value), 1e-3)
    low, high = value - 2 * magnitude, value + 2 * magnitude
    return {
        "name": name,
        "value": value,
        "min": low,
        "max": high,
        "step": (high - low) / 400.0,
        "stderr": error,
    }


def _serialise(candidate: Candidate, s: Sample) -> dict[str, Any]:
    spec = candidate.spec
    return {
        "kind": spec.kind,
        "label": spec.label,
        "family": spec.family,
        "latex": pretty_mod.to_latex(spec, candidate.display),
        "text": pretty_mod.to_plain_text(spec, candidate.display),
        "template": pretty_mod.to_template(spec),
        "expression": pretty_mod.to_expression(spec, candidate.display),
        "params": [
            _slider(name, value, error)
            for name, value, error in zip(
                spec.param_names,
                candidate.params,
                candidate.stderr or [None] * spec.n_params,
            )
        ],
        "exact": any(candidate.snapped),
        "complexity": spec.complexity,
        "smoothness_penalty": candidate.curvature,
        "score": candidate.score,
        "confidence": candidate.confidence,
        "metrics": candidate.metrics.as_dict(),
        "residuals": [float(v) for v in candidate.residuals],
        "singularities": _singularities(spec, candidate.params),
        "domain": {"x_min": float(s.x[0]), "x_max": float(s.x[-1])},
    }


def discover(
    xs: Sequence[float],
    ys: Sequence[float],
    *,
    max_results: int = 6,
    kinds: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Fit, score and rank candidate equations for a sample.

    `kinds` restricts the search to named models; by default the whole registry
    is tried. Confidence is reported as Akaike weights over the returned set, so
    the displayed percentages sum to 100.
    """
    sample = prepare(xs, ys)
    allowed = set(kinds) if kinds else None

    candidates: list[Candidate] = []
    for spec in REGISTRY:
        if allowed is not None and spec.kind not in allowed:
            continue
        fitted = _fit_spec(spec, sample)
        if fitted is not None:
            candidates.append(fitted)

    if not candidates:
        return {
            "candidates": [],
            "sample": _sample_payload(sample),
            "notes": [*sample.notes, "No model could be fitted to this input"],
        }

    # Measure residual correlation once, from the most accurate fit available,
    # and re-score every candidate against that shared effective sample size so
    # the information criteria are comparable.
    most_accurate = min(candidates, key=lambda c: c.metrics.rss)
    shared_n_eff = scoring.effective_sample_size(most_accurate.residuals)
    for candidate in candidates:
        _rescore(candidate, sample, shared_n_eff)

    candidates.sort(key=lambda c: c.score)

    # Diversify: cap each family, so the list is a set of real alternatives.
    selected: list[Candidate] = []
    per_family: dict[str, int] = {}
    for candidate in candidates:
        family = candidate.spec.family
        if per_family.get(family, 0) >= MAX_PER_FAMILY:
            continue
        per_family[family] = per_family.get(family, 0) + 1
        selected.append(candidate)
        if len(selected) >= max_results:
            break

    for candidate, weight in zip(
        selected, scoring.akaike_weights([c.score for c in selected])
    ):
        candidate.confidence = weight

    # Only the models that will actually be shown are worth prettifying.
    for candidate in selected:
        _apply_prettify(candidate, sample)

    return {
        "candidates": [_serialise(c, sample) for c in selected],
        "sample": _sample_payload(sample),
        "notes": list(sample.notes),
        "considered": len(candidates),
    }


def _sample_payload(sample: Sample) -> dict[str, Any]:
    return {
        "x": [float(v) for v in sample.x],
        "y": [float(v) for v in sample.y],
        "n": sample.n,
        "is_function": sample.is_function,
    }
