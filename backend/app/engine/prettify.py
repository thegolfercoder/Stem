"""Make fitted equations readable without making them wrong.

A least-squares fit returns values like ``1.9999983`` and ``3.14159012``. A
human reading the result wants ``2`` and ``π``. This module proposes "nicer"
values for each parameter in order of how nice they are, and accepts a proposal
only when the fit quality survives it — so readability is bought explicitly, and
never at the cost of accuracy beyond a stated tolerance.

Whenever a parameter is snapped, the remaining free parameters are re-fitted
around it. Rounding `a` to 2 and then letting `b` and `c` re-optimise recovers
far more exact forms than rounding every parameter independently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np
import sympy as sp

from .models import ModelSpec

#: A snap is accepted when it costs less than this relative increase in RSS...
RSS_TOLERANCE = 0.02
#: ...and drops R² by no more than this, which guards the near-perfect-fit case
#: where a 2% RSS increase is still numerically tiny.
R2_TOLERANCE = 0.001
#: How many standard errors away a nice value may sit and still count as
#: statistically indistinguishable from the fitted one.
SIGMA_TOLERANCE = 2.5
#: Fallback pre-filter width, as a fraction of the parameter's magnitude, used
#: when no standard error is available (piecewise fits, singular covariance).
PREFILTER_FRACTION = 0.05

#: Signature of the callback that re-optimises the free parameters while some
#: are pinned. Returns None when the constrained fit fails to converge.
RefitFn = Callable[[Sequence[bool], Sequence[float]], list[float] | None]


@dataclass(frozen=True)
class Pretty:
    """The outcome of prettifying one fit."""

    params: list[float]
    #: SymPy objects used for rendering — `Integer(2)`, `Rational(1, 2)`, `pi`.
    display: list[sp.Expr]
    snapped: list[bool]

    @property
    def any_snapped(self) -> bool:
        return any(self.snapped)


def _significant(value: float, digits: int = 4) -> sp.Expr:
    """Round to `digits` significant figures for display."""
    if value == 0 or not np.isfinite(value):
        return sp.Float(0.0)
    magnitude = int(np.floor(np.log10(abs(value))))
    quantum = 10.0 ** (magnitude - digits + 1)
    return sp.Float(round(value / quantum) * quantum, digits)


def _candidates(value: float) -> list[sp.Expr]:
    """Nicer-looking stand-ins for a float, best-looking first.

    Ordering encodes what "simple" means to a reader: zero and small integers
    beat simple fractions, which beat multiples of π, which beat rounded
    decimals.
    """
    out: list[sp.Expr] = []
    seen: set[str] = set()

    def push(candidate: sp.Expr) -> None:
        # Reject anything with a huge denominator or that is not finite; those
        # are "nice" only in a formal sense.
        try:
            numeric = float(candidate)
        except (TypeError, ValueError):
            return
        if not np.isfinite(numeric):
            return
        key = sp.srepr(candidate)
        if key not in seen:
            seen.add(key)
            out.append(candidate)

    push(sp.Integer(0))
    push(sp.Integer(round(value)))

    for denominator in (2, 3, 4, 5, 6, 8, 10):
        push(sp.Rational(round(value * denominator), denominator))

    for constant, symbol in ((float(sp.pi), sp.pi), (float(sp.E), sp.E)):
        ratio = value / constant
        for denominator in (1, 2, 3, 4, 6):
            numerator = round(ratio * denominator)
            # `37π/6` is not a nice number, it is a coincidence. Only small
            # multiples are plausible as the value a human actually meant.
            if numerator and abs(numerator) <= 8:
                push(sp.Rational(numerator, denominator) * symbol)

    for digits in (1, 2, 3, 4):
        push(_significant(value, digits))

    return out


def prettify(
    spec: ModelSpec,
    params: Sequence[float],
    x: np.ndarray,
    y: np.ndarray,
    evaluate: Callable[..., np.ndarray],
    refit: RefitFn | None = None,
    stderr: Sequence[float | None] | None = None,
    *,
    rss_tolerance: float = RSS_TOLERANCE,
    r2_tolerance: float = R2_TOLERANCE,
) -> Pretty:
    """Snap parameters to nicer values wherever the fit can afford it.

    A proposal is accepted when either test passes:

    * **Statistical** — the nice value lies within `SIGMA_TOLERANCE` standard
      errors of the fitted one, so the data cannot tell them apart. This is what
      recovers `2` from a noisy `2.04`.
    * **Numerical** — substituting it barely moves the RSS. This covers exact or
      near-exact data, where the standard error collapses to zero and the
      statistical test would reject everything.

    Candidates are tried in order of niceness, so when several pass, the nicest
    wins — without this ordering, dense families like multiples of π always beat
    plain integers simply by landing closer to the noise.
    """
    current = [float(p) for p in params]
    display: list[sp.Expr] = [_significant(p) for p in current]
    snapped = [False] * len(current)
    errors = list(stderr) if stderr is not None else [None] * len(current)

    total_variance = float(np.sum((y - np.mean(y)) ** 2))

    def rss_of(values: Sequence[float]) -> float:
        with np.errstate(all="ignore"):
            predicted = evaluate(x, *values)
        if not np.all(np.isfinite(predicted)):
            return float("inf")
        return float(np.sum((y - predicted) ** 2))

    baseline = rss_of(current)
    if not np.isfinite(baseline):
        return Pretty(params=current, display=display, snapped=snapped)

    # An absolute floor keeps the tolerance meaningful when the baseline RSS is
    # essentially zero (a synthetic curve fitted exactly).
    scale_floor = 1e-12 * max(total_variance, 1.0)

    for index in range(len(current)):
        fitted = current[index]
        error = errors[index] if index < len(errors) else None
        # Pre-filter width: anything further away than this cannot plausibly
        # pass either test, and skipping it avoids an expensive refit.
        reach = max(
            SIGMA_TOLERANCE * error if error and np.isfinite(error) else 0.0,
            PREFILTER_FRACTION * max(abs(fitted), 1e-9),
        )

        for candidate in _candidates(fitted):
            distance = abs(float(candidate) - fitted)
            if distance > reach:
                continue

            trial = list(current)
            trial[index] = float(candidate)

            # Let the still-free parameters absorb the change: pinning `a` to 2
            # and re-optimising `b` and `c` recovers exact forms that snapping
            # each parameter independently would miss.
            if refit is not None and len(current) > 1:
                mask = [i == index or snapped[i] for i in range(len(current))]
                if not all(mask):
                    adjusted = refit(mask, trial)
                    if adjusted is not None:
                        trial = adjusted

            candidate_rss = rss_of(trial)
            if not np.isfinite(candidate_rss):
                continue

            indistinguishable = (
                error is not None
                and np.isfinite(error)
                and error > 0
                and distance <= SIGMA_TOLERANCE * error
            )
            costs_nothing = (
                candidate_rss <= baseline * (1 + rss_tolerance) + scale_floor
            )
            r2_drop = (
                (candidate_rss - baseline) / total_variance
                if total_variance > 1e-15
                else 0.0
            )

            # Whichever test admitted it, a snap may never visibly degrade the
            # curve, so the R² guard applies to both.
            if (indistinguishable or costs_nothing) and r2_drop <= r2_tolerance:
                current = trial
                display[index] = candidate
                snapped[index] = True
                baseline = min(baseline, candidate_rss)
                break

    # Parameters that resisted snapping still need a readable rendering.
    for index, was_snapped in enumerate(snapped):
        if not was_snapped:
            display[index] = _significant(current[index])

    return Pretty(params=current, display=display, snapped=snapped)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def to_latex(spec: ModelSpec, display: Sequence[sp.Expr]) -> str:
    """LaTeX for the fitted equation, with `y =` on the front."""
    if spec.render is not None:
        return spec.render(list(display))[0]
    # Deliberately no `simplify` pass: it is slow, it can rewrite the expression
    # into a form that no longer mirrors the model that was actually fitted, and
    # on some Float values it raises from deep inside SymPy's polynomial code.
    # SymPy's constructors already fold the trivial cases (`0*x`, `1*x`).
    return f"y = {sp.latex(spec.expr(list(display)))}"


def to_template(spec: ModelSpec) -> str:
    """Infix form with parameter names intact, e.g. ``a*exp(b*x) + c``.

    The browser compiles this once and re-evaluates it as sliders move, which is
    what makes live editing instant — no server round-trip per frame.
    """
    return sp.sstr(spec.symbolic())


def to_expression(spec: ModelSpec, display: Sequence[sp.Expr]) -> str:
    """Infix form with the fitted numbers substituted, for copy/paste."""
    return sp.sstr(spec.expr(list(display)))


def to_plain_text(spec: ModelSpec, display: Sequence[sp.Expr]) -> str:
    """A `y = ...` string using conventional maths notation rather than Python."""
    if spec.render is not None:
        return spec.render(list(display))[1]
    body = sp.sstr(spec.expr(list(display))).replace("**", "^")
    return f"y = {body}"
