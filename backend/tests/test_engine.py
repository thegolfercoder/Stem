"""Tests for the discovery engine.

These assert on *behaviour a user would notice* — that drawing a parabola gets
you `x² - 3` and not a quintic that happens to fit — rather than on internal
call sequences. Recovery is checked across several noise seeds, because model
selection under noise is inherently probabilistic and a single lucky seed would
prove nothing.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.engine import scoring
from app.engine.fitting import discover
from app.engine.models import BY_KIND, REGISTRY, callable_for
from app.engine.preprocess import prepare

SEEDS = (1, 2, 3, 4, 5)


def sample_with_noise(fn, x: np.ndarray, seed: int, noise: float = 0.01) -> np.ndarray:
    """Evaluate `fn` on `x` and add noise proportional to the signal's range."""
    clean = fn(x)
    rng = np.random.default_rng(seed)
    scale = noise * max(float(np.ptp(clean)), 1e-9)
    return clean + rng.normal(0.0, scale, x.size)


# Each case: label, true function, sample grid, expected winning model kind.
RECOVERY_CASES = [
    ("linear", lambda x: 2 * x + 1, np.linspace(-5, 5, 60), "linear"),
    ("quadratic", lambda x: x**2 - 3, np.linspace(-4, 4, 60), "quadratic"),
    ("cubic", lambda x: x**3 - 2 * x, np.linspace(-3, 3, 70), "cubic"),
    ("exponential", lambda x: 2 * np.exp(0.5 * x), np.linspace(0, 4, 60), "exponential"),
    ("logarithmic", lambda x: 2 * np.log(x) + 1, np.linspace(0.5, 9, 60), "logarithmic"),
    ("sinusoidal", lambda x: 3 * np.sin(2 * x), np.linspace(0, 6, 120), "sinusoidal"),
    (
        "gaussian",
        lambda x: 4 * np.exp(-((x - 1) ** 2) / (2 * 0.8**2)),
        np.linspace(-3, 5, 80),
        "gaussian",
    ),
    ("sqrt", lambda x: 2 * np.sqrt(x), np.linspace(0.01, 9, 60), "sqrt"),
    ("absolute", lambda x: np.abs(x - 1), np.linspace(-4, 6, 80), "absolute"),
]


@pytest.mark.parametrize("label,fn,grid,expected", RECOVERY_CASES, ids=lambda v: v if isinstance(v, str) else "")
def test_recovers_the_generating_model(label, fn, grid, expected):
    """The generating family should win on a clear majority of noise draws."""
    wins = 0
    for seed in SEEDS:
        y = sample_with_noise(fn, grid, seed)
        result = discover(grid, y)
        if result["candidates"][0]["kind"] == expected:
            wins += 1
    assert wins >= 4, f"{label}: recovered the true family only {wins}/{len(SEEDS)} times"


@pytest.mark.parametrize("seed", SEEDS)
def test_recovers_exact_coefficients_when_data_is_clean(seed):
    """On noiseless data the reported equation should be the exact one."""
    x = np.linspace(-4, 4, 80)
    y = x**2 - 3
    result = discover(x, y)
    top = result["candidates"][0]
    assert top["kind"] == "quadratic"
    # Prettification should have recovered integers, not 0.9999998.
    assert top["text"].replace(" ", "") in {"y=x^2-3", "y=1*x^2-3"}
    assert top["metrics"]["r2"] > 0.9999


def test_piecewise_beats_polynomials_on_a_kink():
    """A genuine slope change should be reported as piecewise, not a curve."""
    x = np.linspace(-3, 5, 120)
    y = sample_with_noise(lambda v: np.where(v < 1, v, 3 * v - 2), x, seed=1, noise=0.004)
    result = discover(x, y)
    assert result["candidates"][0]["kind"] == "piecewise_linear_1"


def test_prefers_the_simpler_model_when_fits_are_equivalent():
    """A line must not lose to a quintic that fits it a hair better."""
    x = np.linspace(-5, 5, 100)
    y = sample_with_noise(lambda v: 2 * v + 1, x, seed=3)
    result = discover(x, y)
    top = result["candidates"][0]
    assert top["kind"] == "linear"
    assert top["complexity"] <= 1.0


def test_confidences_are_a_normalised_distribution():
    x = np.linspace(-4, 4, 60)
    y = sample_with_noise(lambda v: v**2 - 3, x, seed=2)
    result = discover(x, y)
    total = sum(c["confidence"] for c in result["candidates"])
    assert total == pytest.approx(1.0, abs=1e-6)
    # Ranked by score means ranked by confidence.
    confidences = [c["confidence"] for c in result["candidates"]]
    assert confidences == sorted(confidences, reverse=True)


def test_all_candidates_share_one_effective_sample_size():
    """Information criteria are only comparable at a common sample size."""
    x = np.linspace(-4, 4, 200)
    y = sample_with_noise(lambda v: v**2 - 3, x, seed=1)
    result = discover(x, y)
    sizes = {c["metrics"]["n_effective"] for c in result["candidates"]}
    assert len(sizes) == 1


def test_effective_sample_size_discounts_correlated_residuals():
    n = 400
    white = np.random.default_rng(0).normal(size=n)
    # A smooth ramp is perfectly correlated point-to-point.
    correlated = np.cumsum(white)

    assert scoring.effective_sample_size(white) == pytest.approx(n, rel=0.15)
    assert scoring.effective_sample_size(correlated) < n / 5


def test_reported_metrics_describe_the_prettified_curve():
    """The quoted R² must match the equation shown, not a discarded one."""
    x = np.linspace(-4, 4, 60)
    y = sample_with_noise(lambda v: v**2 - 3, x, seed=1)
    result = discover(x, y)
    top = result["candidates"][0]

    spec = BY_KIND[top["kind"]]
    evaluate = callable_for(spec)
    sample = prepare(x, y)
    predicted = evaluate(sample.x, *[p["value"] for p in top["params"]])
    recomputed = scoring.compute_metrics(
        sample.y, predicted, spec.n_params, n_effective=top["metrics"]["n_effective"]
    )
    assert recomputed.r2 == pytest.approx(top["metrics"]["r2"], abs=1e-9)
    assert top["residuals"] == pytest.approx(list(sample.y - predicted), abs=1e-9)


def test_every_model_template_evaluates_with_its_declared_parameters():
    """The template shipped to the browser must match the model's parameters."""
    x = np.array([0.5, 1.0, 1.5, 2.0])
    for spec in REGISTRY:
        evaluate = callable_for(spec)
        values = evaluate(x, *[0.7 + 0.1 * i for i in range(spec.n_params)])
        assert np.shape(values) == np.shape(x), f"{spec.kind} did not broadcast"


def test_piecewise_evaluates_elementwise():
    """Guards the `Max` -> `amax` trap that collapsed piecewise models."""
    spec = BY_KIND["piecewise_linear_1"]
    evaluate = callable_for(spec)
    x = np.linspace(-3, 5, 50)
    # m1=1, m2=3, t1=1, c=1  ->  y = x below the knot, 3x-2 above it.
    values = evaluate(x, 1.0, 3.0, 1.0, 1.0)
    expected = np.where(x < 1, x, 3 * x - 2)
    assert values == pytest.approx(expected, abs=1e-9)


def test_sinusoid_phase_is_canonical():
    """A 2π phase offset must not survive into the reported equation."""
    x = np.linspace(0, 6, 120)
    y = 3 * np.sin(2 * x + 2 * np.pi)
    result = discover(x, y)

    wave = next(c for c in result["candidates"] if c["kind"] == "sinusoidal")
    phases = {p["name"]: p["value"] for p in wave["params"]}
    assert abs(phases["phi"]) <= np.pi + 1e-6
    # The full turn should have been absorbed, leaving a bare `sin(2x)`.
    assert phases["phi"] == pytest.approx(0.0, abs=1e-6)
    assert wave["text"].replace(" ", "") == "y=3*sin(2*x)"


def test_exact_fits_are_broken_by_simplicity_not_rounding_noise():
    """Two models that both fit perfectly must be separated by complexity.

    Below machine precision the residuals are rounding artefacts; ranking on
    them would hand the win to whichever elaborate model happened to round
    better.
    """
    x = np.linspace(0, 6, 120)
    result = discover(x, 3 * np.sin(2 * x))
    assert result["candidates"][0]["kind"] == "sinusoidal"


def test_rational_model_reports_its_pole():
    x = np.linspace(0.4, 6, 80)
    result = discover(x, 1.0 / x)
    poles = {
        tuple(np.round(c["singularities"], 6))
        for c in result["candidates"]
        if c["family"] == "rational"
    }
    assert poles, "no rational candidate was returned"
    assert any(0.0 in p for p in poles)


def test_handles_duplicate_and_non_finite_input():
    x = [1.0, 1.0, 2.0, 3.0, float("nan"), 4.0, 5.0]
    y = [2.0, 4.0, 5.0, 7.0, 1.0, 9.0, 11.0]
    result = discover(x, y)
    assert result["candidates"]
    assert result["sample"]["n"] == 5
    assert any("non-finite" in note for note in result["notes"])


def test_rejects_input_with_no_usable_points():
    with pytest.raises(ValueError):
        discover([float("nan"), float("inf")], [1.0, 2.0])


def test_detects_input_that_is_not_a_function():
    """A drawn circle is not y = f(x) and should be flagged as such."""
    angle = np.linspace(0, 2 * np.pi, 200)
    result = discover(np.cos(angle), np.sin(angle))
    assert result["sample"]["is_function"] is False
    assert any("single-valued" in note for note in result["notes"])
