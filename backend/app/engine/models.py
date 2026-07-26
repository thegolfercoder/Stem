"""Symbolic model library.

Every candidate model is declared once, symbolically, as a SymPy expression.
Numeric evaluation (`callable_for`), LaTeX rendering and the infix template the
browser compiles for live slider editing are all derived from that single
declaration, so the three representations can never drift apart.

Models are grouped into families; the ranker keeps only the best member of each
family so the result list reads as a set of genuinely different hypotheses
rather than five flavours of polynomial.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np
import sympy as sp

X = sp.Symbol("x", real=True)

# Seeds are lists of candidate start vectors; the fitter multi-starts over them.
SeedFn = Callable[[np.ndarray, np.ndarray], list[list[float]]]
BoundsFn = Callable[[np.ndarray, np.ndarray], tuple[list[float], list[float]]]
GuardFn = Callable[[np.ndarray, np.ndarray], bool]

_INF = float("inf")


@dataclass(frozen=True)
class ModelSpec:
    """Declarative description of one candidate function family."""

    kind: str
    label: str
    family: str
    param_names: tuple[str, ...]
    #: Structural cost in "readability units" — how much mental effort the
    #: written form demands. Feeds the ranker's simplicity prior.
    complexity: float
    expr: Callable[[Sequence[sp.Symbol]], sp.Expr]
    seeds: SeedFn = field(default=lambda x, y: [[1.0]])
    bounds: BoundsFn | None = None
    #: Cheap pre-check: is this family even meaningful for the given data?
    guard: GuardFn = field(default=lambda x, y: True)
    #: Polynomial degree when the model is linear in its parameters, which lets
    #: the fitter solve it exactly instead of iterating.
    poly_degree: int | None = None
    #: Number of interior breakpoints for continuous piecewise-linear models.
    breakpoints: int = 0
    #: Optional post-fit rewrite into the family's canonical parameterisation.
    #: Applied before prettifying, so equivalent forms are recognisable.
    canonicalize: Callable[[list[float]], list[float]] | None = None
    #: Optional custom renderer returning `(latex, plain_text)`. Used where the
    #: generic printer would expose an implementation detail — the hinge models
    #: are built from `Abs` for correct vectorisation but must *read* as cases.
    render: Callable[[Sequence[sp.Expr]], tuple[str, str]] | None = None

    @property
    def n_params(self) -> int:
        return len(self.param_names)

    def symbols(self) -> list[sp.Symbol]:
        return [sp.Symbol(n, real=True) for n in self.param_names]

    def symbolic(self) -> sp.Expr:
        return self.expr(self.symbols())


# --------------------------------------------------------------------------
# Seed heuristics
# --------------------------------------------------------------------------


def relu(u: sp.Expr) -> sp.Expr:
    """Hinge `max(0, u)` written with `Abs` rather than `Max`.

    The two are algebraically identical, but SymPy's NumPy printer renders
    `Max` as `amax`, which *reduces* an array to a scalar instead of acting
    elementwise — silently collapsing any piecewise model into a constant.
    `Abs` maps to `numpy.abs` and vectorises correctly, so the hinge is built
    from it instead. Piecewise models supply their own LaTeX renderer, so this
    choice never reaches the reader.
    """
    return (u + sp.Abs(u)) / 2


def _span(v: np.ndarray) -> float:
    """Range of an array, never zero — used as a scale for heuristics."""
    s = float(np.max(v) - np.min(v))
    return s if s > 1e-12 else 1.0


def _linear_seed(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Ordinary least squares slope/intercept, used to seed many families."""
    slope, intercept = np.polyfit(x, y, 1)
    return float(slope), float(intercept)


def _dominant_frequency(x: np.ndarray, y: np.ndarray) -> float:
    """Angular frequency of the strongest non-DC component.

    The samples may be unevenly spaced (a freehand stroke never is), so the
    signal is first resampled onto a uniform grid, detrended, and then run
    through an FFT.
    """
    n = max(64, int(2 ** np.ceil(np.log2(max(len(x), 16)))))
    grid = np.linspace(float(x.min()), float(x.max()), n)
    resampled = np.interp(grid, x, y)
    slope, intercept = np.polyfit(grid, resampled, 1)
    detrended = resampled - (slope * grid + intercept)
    spectrum = np.abs(np.fft.rfft(detrended * np.hanning(n)))
    spectrum[0] = 0.0
    dx = float(grid[1] - grid[0])
    freqs = np.fft.rfftfreq(n, d=dx)
    peak = int(np.argmax(spectrum))
    cycles_per_unit = float(freqs[peak])
    if cycles_per_unit <= 0:
        # Fall back to "roughly one cycle across the window".
        cycles_per_unit = 1.0 / _span(x)
    return 2.0 * np.pi * cycles_per_unit


def _sin_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    amp = _span(y) / 2.0
    offset = float(np.mean(y))
    w = _dominant_frequency(x, y)
    # The FFT pins the frequency but says nothing reliable about phase, so scan.
    return [
        [amp, w, phase, offset]
        for phase in (0.0, np.pi / 2, np.pi, 3 * np.pi / 2)
    ] + [[amp, w / 2, 0.0, offset], [amp, w * 2, 0.0, offset]]


def _damped_sin_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    amp = _span(y) / 2.0
    w = _dominant_frequency(x, y)
    decay = 1.0 / _span(x)
    return [[amp, decay, w, phase] for phase in (0.0, np.pi / 2, np.pi)]


def _exp_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed a*exp(b*x)+c by linearising log(y-c) for several guesses of c."""
    out: list[list[float]] = []
    lo, hi = float(np.min(y)), float(np.max(y))
    pad = 0.1 * _span(y)
    for c in (lo - pad, 0.0, hi + pad):
        shifted = y - c
        sign = 1.0 if np.mean(shifted) >= 0 else -1.0
        mag = np.abs(shifted)
        usable = mag > 1e-9
        if usable.sum() < 3:
            continue
        b, log_a = np.polyfit(x[usable], np.log(mag[usable]), 1)
        out.append([sign * float(np.exp(log_a)), float(b), float(c)])
    slope, intercept = _linear_seed(x, y)
    out.append([1.0, slope / max(abs(intercept), 1.0), 0.0])
    return out or [[1.0, 1.0, 0.0]]


def _log_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed a*ln(x-h)+c; h must stay strictly left of the data."""
    lo = float(np.min(x))
    out: list[list[float]] = []
    for frac in (0.05, 0.5, 1.0):
        h = lo - frac * _span(x)
        a, c = np.polyfit(np.log(x - h), y, 1)
        out.append([float(a), float(h), float(c)])
    return out


def _power_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed a*x**b + c on a log-log fit of the strictly positive samples."""
    c = float(np.min(y)) - 0.05 * _span(y)
    ok = (x > 1e-9) & ((y - c) > 1e-9)
    seeds: list[list[float]] = []
    if ok.sum() >= 3:
        b, log_a = np.polyfit(np.log(x[ok]), np.log(y[ok] - c), 1)
        seeds.append([float(np.exp(log_a)), float(b), c])
    seeds.extend([[1.0, 2.0, 0.0], [1.0, 0.5, 0.0], [1.0, -1.0, 0.0]])
    return seeds


def _sqrt_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    lo = float(np.min(x))
    a = _span(y) / max(np.sqrt(_span(x)), 1e-9)
    sign = 1.0 if y[-1] >= y[0] else -1.0
    return [
        [sign * a, lo - 1e-3 * _span(x), float(np.min(y))],
        [sign * a, lo - _span(x), float(np.mean(y))],
    ]


def _logistic_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    lo, hi = float(np.min(y)), float(np.max(y))
    midpoint_index = int(np.argmin(np.abs(y - (lo + hi) / 2)))
    x0 = float(x[midpoint_index])
    k = 4.0 / _span(x)
    rising = y[-1] >= y[0]
    return [
        [hi - lo, k if rising else -k, x0, lo],
        [hi - lo, (k if rising else -k) * 4, x0, lo],
    ]


def _gaussian_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    baseline = float(np.median(y))
    peak_index = int(np.argmax(np.abs(y - baseline)))
    amp = float(y[peak_index] - baseline)
    return [
        [amp, float(x[peak_index]), _span(x) / 6.0, baseline],
        [amp, float(x[peak_index]), _span(x) / 2.0, baseline],
    ]


def _tanh_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    lo, hi = float(np.min(y)), float(np.max(y))
    mid = int(np.argmin(np.abs(y - (lo + hi) / 2)))
    sign = 1.0 if y[-1] >= y[0] else -1.0
    return [[(hi - lo) / 2, sign * 4.0 / _span(x), float(x[mid]), (hi + lo) / 2]]


def _abs_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed a*|x-h|+c from the extremum, which sits at the vertex."""
    seeds = []
    for index, sign in ((int(np.argmin(y)), 1.0), (int(np.argmax(y)), -1.0)):
        h = float(x[index])
        c = float(y[index])
        a = sign * _span(y) / max(_span(x) / 2, 1e-9)
        seeds.append([a, h, c])
    return seeds


def _hyperbola_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed a/(x-h)+c with the pole placed just outside the sampled window."""
    lo, hi = float(np.min(x)), float(np.max(x))
    pad = 0.05 * _span(x)
    return [
        [_span(y) * _span(x), lo - pad, float(np.median(y))],
        [-_span(y) * _span(x), hi + pad, float(np.median(y))],
        [_span(y), (lo + hi) / 2, float(np.median(y))],
    ]


def _rational_seeds(x: np.ndarray, y: np.ndarray) -> list[list[float]]:
    """Seed (a*x+b)/(x+c) — a Möbius curve with one pole and one asymptote."""
    lo, hi = float(np.min(x)), float(np.max(x))
    horizontal = float(np.median(y))
    return [
        [horizontal, float(np.mean(y)), -(lo - 0.05 * _span(x))],
        [horizontal, float(np.mean(y)), -(hi + 0.05 * _span(x))],
        [0.0, 1.0, 0.0],
    ]


# --------------------------------------------------------------------------
# Guards
# --------------------------------------------------------------------------


def _needs_positive_x(x: np.ndarray, y: np.ndarray) -> bool:
    """Power laws are only well posed when most of the domain is positive."""
    return bool(np.mean(x > 1e-9) > 0.8)


def _needs_oscillation(x: np.ndarray, y: np.ndarray) -> bool:
    """Require at least a few sign changes about the mean before trying waves."""
    centred = y - np.mean(y)
    crossings = int(np.sum(np.diff(np.signbit(centred)) != 0))
    return crossings >= 2


def _enough_for(n_params: int) -> GuardFn:
    """A model with k parameters needs more than k+1 points to be meaningful."""

    def guard(x: np.ndarray, y: np.ndarray) -> bool:
        return len(x) >= n_params + 2

    return guard


def _and(*guards: GuardFn) -> GuardFn:
    def combined(x: np.ndarray, y: np.ndarray) -> bool:
        return all(g(x, y) for g in guards)

    return combined


# --------------------------------------------------------------------------
# Bounds
# --------------------------------------------------------------------------


def _shift_floor(x: np.ndarray) -> float:
    """Lower bound for a horizontal shift that must sit left of the data.

    Without a floor the optimiser drives the shift towards minus infinity, where
    `log(x - h)` flattens into a constant and the model becomes degenerate. It
    wanders there for thousands of evaluations before giving up — this single
    bound was worth several seconds per fit. A few data spans of headroom is far
    more than any genuine shift needs.
    """
    return float(np.min(x)) - 20.0 * _span(x)


def _log_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    # The shift must keep x-h strictly positive across the whole sample.
    return (
        [-_INF, _shift_floor(x), -_INF],
        [_INF, float(np.min(x)) - 1e-6, _INF],
    )


def _sqrt_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    return (
        [-_INF, _shift_floor(x), -_INF],
        [_INF, float(np.min(x)) - 1e-9, _INF],
    )


def _gaussian_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    # Width is strictly positive and capped so the bell cannot flatten into a
    # constant, which would make the model unidentifiable.
    return (
        [-_INF, -_INF, 1e-6, -_INF],
        [_INF, _INF, 10.0 * _span(x), _INF],
    )


def _rate_limit(x: np.ndarray) -> float:
    """Largest exponential rate that stays representable across the domain.

    Without this the optimiser wanders into `exp(400·x)`, where every value
    overflows to infinity, the Jacobian is meaningless, and the fit burns
    thousands of function evaluations before giving up.
    """
    return 40.0 / max(_span(x), 1e-9)


def _exp_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    rate = _rate_limit(x)
    return ([-_INF, -rate, -_INF], [_INF, rate, _INF])


def _damped_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    rate = _rate_limit(x)
    spacing = _span(x) / max(len(x) - 1, 1)
    return (
        [-_INF, -rate, 0.0, -4 * np.pi],
        [_INF, rate, np.pi / max(spacing, 1e-9), 4 * np.pi],
    )


def _logistic_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    rate = _rate_limit(x)
    return ([-_INF, -rate, -_INF, -_INF], [_INF, rate, _INF, _INF])


def _tanh_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    rate = _rate_limit(x)
    return ([-_INF, -rate, -_INF, -_INF], [_INF, rate, _INF, _INF])


def _sin_bounds(x: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    # Cap frequency at the Nyquist limit of the sample spacing: anything faster
    # is aliasing, not signal.
    spacing = _span(x) / max(len(x) - 1, 1)
    max_w = np.pi / max(spacing, 1e-9)
    return ([-_INF, 0.0, -4 * np.pi, -_INF], [_INF, max_w, 4 * np.pi, _INF])


# --------------------------------------------------------------------------
# Canonical forms
# --------------------------------------------------------------------------


def _wrap_phase(phi: float) -> float:
    """Fold a phase into (-π, π]."""
    return float((phi + np.pi) % (2 * np.pi) - np.pi)


def _canonical_wave(params: list[float], amp: int, phase: int) -> list[float]:
    """Force a positive amplitude and a principal-valued phase.

    A sine fit is only identified up to `A → -A, φ → φ + π` and whole turns of
    φ. Left alone, the optimiser happily returns `3·sin(2x + 6.28)`, which is
    `3·sin(2x)` written unrecognisably — and no amount of parameter snapping
    can rescue it, because 6.28 really is the fitted value.
    """
    out = list(params)
    if out[amp] < 0:
        out[amp] = -out[amp]
        out[phase] += np.pi
    out[phase] = _wrap_phase(out[phase])
    return out


def _canon_sine(params: list[float]) -> list[float]:
    # (A, omega, phi, C) — omega is held non-negative by its bounds.
    return _canonical_wave(params, amp=0, phase=2)


def _canon_damped(params: list[float]) -> list[float]:
    # (A, k, omega, phi)
    return _canonical_wave(params, amp=0, phase=3)


# --------------------------------------------------------------------------
# Custom renderers
# --------------------------------------------------------------------------


def _cases(branches: Sequence[tuple[sp.Expr, str, str]]) -> tuple[str, str]:
    """Assemble a LaTeX `cases` block and a plain-text equivalent."""
    rows = " \\\\ ".join(
        f"{sp.latex(body)} & \\text{{if }} {condition_latex}"
        for body, condition_latex, _ in branches
    )
    lines = "; ".join(
        f"{sp.sstr(body).replace('**', '^')} for {condition_text}"
        for body, _, condition_text in branches
    )
    return (
        f"y = \\begin{{cases}} {rows} \\end{{cases}}",
        f"y = {lines}",
    )


def _render_piecewise_1(p: Sequence[sp.Expr]) -> tuple[str, str]:
    m1, m2, t1, c = p
    return _cases(
        [
            (c + m1 * (X - t1), f"x < {sp.latex(t1)}", f"x < {t1}"),
            (c + m2 * (X - t1), f"x \\geq {sp.latex(t1)}", f"x >= {t1}"),
        ]
    )


def _render_piecewise_2(p: Sequence[sp.Expr]) -> tuple[str, str]:
    m1, m2, m3, t1, t2, c = p
    # The third segment starts from where the second one ended, which is what
    # keeps the rendered form continuous at t2.
    joined = c + m2 * (t2 - t1)
    return _cases(
        [
            (c + m1 * (X - t1), f"x < {sp.latex(t1)}", f"x < {t1}"),
            (
                c + m2 * (X - t1),
                f"{sp.latex(t1)} \\leq x < {sp.latex(t2)}",
                f"{t1} <= x < {t2}",
            ),
            (joined + m3 * (X - t2), f"x \\geq {sp.latex(t2)}", f"x >= {t2}"),
        ]
    )


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

REGISTRY: tuple[ModelSpec, ...] = (
    ModelSpec(
        kind="constant",
        label="Constant",
        family="polynomial",
        param_names=("c",),
        complexity=0.5,
        expr=lambda p: p[0] + 0 * X,
        poly_degree=0,
    ),
    ModelSpec(
        kind="linear",
        label="Linear",
        family="polynomial",
        param_names=("m", "b"),
        complexity=1.0,
        expr=lambda p: p[0] * X + p[1],
        poly_degree=1,
    ),
    ModelSpec(
        kind="quadratic",
        label="Quadratic",
        family="polynomial",
        param_names=("a", "b", "c"),
        complexity=2.0,
        expr=lambda p: p[0] * X**2 + p[1] * X + p[2],
        poly_degree=2,
    ),
    ModelSpec(
        kind="cubic",
        label="Cubic",
        family="polynomial",
        param_names=("a", "b", "c", "d"),
        complexity=3.2,
        expr=lambda p: p[0] * X**3 + p[1] * X**2 + p[2] * X + p[3],
        poly_degree=3,
    ),
    ModelSpec(
        kind="quartic",
        label="Quartic",
        family="polynomial",
        param_names=("a", "b", "c", "d", "e"),
        complexity=5.0,
        expr=lambda p: p[0] * X**4 + p[1] * X**3 + p[2] * X**2 + p[3] * X + p[4],
        poly_degree=4,
    ),
    ModelSpec(
        kind="quintic",
        label="Quintic",
        family="polynomial",
        param_names=("a", "b", "c", "d", "e", "f"),
        complexity=7.0,
        expr=lambda p: (
            p[0] * X**5 + p[1] * X**4 + p[2] * X**3 + p[3] * X**2 + p[4] * X + p[5]
        ),
        poly_degree=5,
    ),
    ModelSpec(
        kind="exponential",
        label="Exponential",
        family="exponential",
        param_names=("a", "b", "c"),
        complexity=3.0,
        expr=lambda p: p[0] * sp.exp(p[1] * X) + p[2],
        seeds=_exp_seeds,
        bounds=_exp_bounds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="logarithmic",
        label="Logarithmic",
        family="logarithmic",
        param_names=("a", "h", "c"),
        complexity=3.2,
        expr=lambda p: p[0] * sp.log(X - p[1]) + p[2],
        seeds=_log_seeds,
        bounds=_log_bounds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="power",
        label="Power law",
        family="power",
        param_names=("a", "b", "c"),
        complexity=3.5,
        expr=lambda p: p[0] * X ** p[1] + p[2],
        seeds=_power_seeds,
        guard=_and(_enough_for(3), _needs_positive_x),
    ),
    ModelSpec(
        kind="sqrt",
        label="Square root",
        family="power",
        param_names=("a", "h", "c"),
        complexity=3.0,
        expr=lambda p: p[0] * sp.sqrt(X - p[1]) + p[2],
        seeds=_sqrt_seeds,
        bounds=_sqrt_bounds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="sinusoidal",
        label="Sinusoidal",
        family="periodic",
        param_names=("A", "omega", "phi", "C"),
        complexity=4.5,
        expr=lambda p: p[0] * sp.sin(p[1] * X + p[2]) + p[3],
        seeds=_sin_seeds,
        bounds=_sin_bounds,
        canonicalize=_canon_sine,
        guard=_and(_enough_for(4), _needs_oscillation),
    ),
    ModelSpec(
        kind="damped_sine",
        label="Damped oscillation",
        family="periodic",
        param_names=("A", "k", "omega", "phi"),
        complexity=6.5,
        expr=lambda p: p[0] * sp.exp(-p[1] * X) * sp.sin(p[2] * X + p[3]),
        seeds=_damped_sin_seeds,
        bounds=_damped_bounds,
        canonicalize=_canon_damped,
        guard=_and(_enough_for(4), _needs_oscillation),
    ),
    ModelSpec(
        kind="logistic",
        label="Logistic",
        family="sigmoid",
        param_names=("L", "k", "x0", "c"),
        complexity=5.0,
        expr=lambda p: p[0] / (1 + sp.exp(-p[1] * (X - p[2]))) + p[3],
        seeds=_logistic_seeds,
        bounds=_logistic_bounds,
        guard=_enough_for(4),
    ),
    ModelSpec(
        kind="tanh",
        label="Hyperbolic tangent",
        family="sigmoid",
        param_names=("a", "k", "h", "c"),
        complexity=5.0,
        expr=lambda p: p[0] * sp.tanh(p[1] * (X - p[2])) + p[3],
        seeds=_tanh_seeds,
        bounds=_tanh_bounds,
        guard=_enough_for(4),
    ),
    ModelSpec(
        kind="gaussian",
        label="Gaussian",
        family="bell",
        param_names=("A", "mu", "sigma", "c"),
        complexity=5.0,
        expr=lambda p: p[0] * sp.exp(-((X - p[1]) ** 2) / (2 * p[2] ** 2)) + p[3],
        seeds=_gaussian_seeds,
        bounds=_gaussian_bounds,
        guard=_enough_for(4),
    ),
    ModelSpec(
        kind="hyperbola",
        label="Inverse",
        family="rational",
        param_names=("a", "h", "c"),
        complexity=3.5,
        expr=lambda p: p[0] / (X - p[1]) + p[2],
        seeds=_hyperbola_seeds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="rational",
        label="Rational (Möbius)",
        family="rational",
        param_names=("a", "b", "c"),
        complexity=4.5,
        expr=lambda p: (p[0] * X + p[1]) / (X + p[2]),
        seeds=_rational_seeds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="absolute",
        label="Absolute value",
        family="piecewise",
        param_names=("a", "h", "c"),
        complexity=3.5,
        expr=lambda p: p[0] * sp.Abs(X - p[1]) + p[2],
        seeds=_abs_seeds,
        guard=_enough_for(3),
    ),
    ModelSpec(
        kind="piecewise_linear_1",
        label="Piecewise linear",
        family="piecewise",
        param_names=("m1", "m2", "t1", "c"),
        complexity=5.5,
        # Hinge form: continuous by construction, linear in (m1, m2, c).
        expr=lambda p: p[3] + p[0] * (X - p[2]) + (p[1] - p[0]) * relu(X - p[2]),
        breakpoints=1,
        render=_render_piecewise_1,
        guard=_enough_for(5),
    ),
    ModelSpec(
        kind="piecewise_linear_2",
        label="Piecewise linear (3 segments)",
        family="piecewise",
        param_names=("m1", "m2", "m3", "t1", "t2", "c"),
        complexity=8.0,
        expr=lambda p: (
            p[5]
            + p[0] * (X - p[3])
            + (p[1] - p[0]) * relu(X - p[3])
            + (p[2] - p[1]) * relu(X - p[4])
        ),
        breakpoints=2,
        render=_render_piecewise_2,
        guard=_enough_for(8),
    ),
)

BY_KIND: dict[str, ModelSpec] = {spec.kind: spec for spec in REGISTRY}


# --------------------------------------------------------------------------
# Compiled numeric evaluation
# --------------------------------------------------------------------------

_lambdified: dict[str, Callable[..., np.ndarray]] = {}


def callable_for(spec: ModelSpec) -> Callable[..., np.ndarray]:
    """Return (and memoise) a NumPy-vectorised f(x, *params) for a model."""
    fn = _lambdified.get(spec.kind)
    if fn is None:
        compiled = sp.lambdify((X, *spec.symbols()), spec.symbolic(), modules="numpy")

        def evaluate(x: np.ndarray, *params: float, _c=compiled) -> np.ndarray:
            # Broadcast to the shape of x — a constant model collapses to a
            # scalar that the caller still expects as a full array.
            result = _c(x, *params)
            return np.broadcast_to(np.asarray(result, dtype=float), np.shape(x)).copy()

        fn = evaluate
        _lambdified[spec.kind] = fn
    return fn
