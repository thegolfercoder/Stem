"""Performance statistics, checked against arithmetic that can be done by hand."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from tradelab.analytics import metrics


def curve(values: list[float], start: str = "2020-01-01") -> pd.Series:
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values), name="ts"))


def test_cagr_on_an_exact_doubling_over_two_years() -> None:
    index = pd.DatetimeIndex(["2020-01-01", "2022-01-01"], name="ts")
    equity = pd.Series([100.0, 200.0], index=index)
    years = (index[-1] - index[0]).days / 365.25
    assert metrics.cagr(equity) == pytest.approx(2 ** (1 / years) - 1)


def test_cagr_is_undefined_after_a_total_loss() -> None:
    assert np.isnan(metrics.cagr(curve([100.0, 50.0, 0.0])))


def test_total_return_is_end_over_start() -> None:
    assert metrics.total_return(curve([100.0, 150.0])) == pytest.approx(0.5)


def test_annualised_volatility_scales_by_root_time() -> None:
    rng = np.random.default_rng(0)
    returns = pd.Series(rng.normal(0.0, 0.01, size=2000))
    assert metrics.annualised_volatility(returns, 252) == pytest.approx(
        float(returns.std(ddof=1)) * np.sqrt(252)
    )


def test_sharpe_of_a_constant_return_is_undefined_not_infinite() -> None:
    """Zero variance has no Sharpe ratio. Returning inf here would poison a table."""
    assert np.isnan(metrics.sharpe_ratio(pd.Series([0.001] * 100)))


def test_sharpe_matches_the_definition() -> None:
    rng = np.random.default_rng(1)
    returns = pd.Series(rng.normal(0.0005, 0.01, size=1000))
    expected = float(returns.mean() / returns.std(ddof=1) * np.sqrt(252))
    assert metrics.sharpe_ratio(returns, periods_per_year=252) == pytest.approx(expected)


def test_a_risk_free_rate_lowers_the_sharpe_ratio() -> None:
    rng = np.random.default_rng(2)
    returns = pd.Series(rng.normal(0.0006, 0.01, size=1500))
    assert metrics.sharpe_ratio(returns, risk_free_rate=0.04) < metrics.sharpe_ratio(returns)


def test_sortino_exceeds_sharpe_when_the_downside_is_the_smaller_half() -> None:
    """Right-skewed returns: penalising only the downside must flatter the ratio."""
    values = np.concatenate([np.full(180, 0.002), np.full(20, -0.004)])
    returns = pd.Series(values)
    assert metrics.sortino_ratio(returns) > metrics.sharpe_ratio(returns)


def test_sortino_uses_the_full_sample_in_the_denominator() -> None:
    """The common wrong version divides by the count of losing periods only."""
    returns = pd.Series([0.01, 0.01, 0.01, -0.02])
    shortfall = np.minimum(returns.to_numpy(), 0.0)
    downside = np.sqrt(np.mean(shortfall**2))  # divided by 4, not by 1
    expected = returns.mean() / downside * np.sqrt(252)
    assert metrics.sortino_ratio(returns) == pytest.approx(expected)


def test_max_drawdown_finds_the_deepest_decline_and_its_dates() -> None:
    equity = curve([100.0, 120.0, 60.0, 90.0, 130.0, 110.0])
    drawdown = metrics.max_drawdown(equity)
    assert drawdown.depth == pytest.approx(-0.5)
    assert drawdown.peak == equity.index[1]
    assert drawdown.trough == equity.index[2]
    assert drawdown.recovered == equity.index[4]


def test_max_drawdown_reports_no_recovery_when_there_was_none() -> None:
    drawdown = metrics.max_drawdown(curve([100.0, 200.0, 80.0, 90.0, 95.0]))
    assert drawdown.depth == pytest.approx(-0.6)
    assert drawdown.recovered is None


def test_a_monotonically_rising_curve_has_no_drawdown() -> None:
    assert metrics.max_drawdown(curve([100.0, 101.0, 102.0, 103.0])).depth == pytest.approx(0.0)


def _trades(net: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"net_pnl": net})


def test_win_rate_and_profit_factor() -> None:
    trades = _trades([100.0, -50.0, 200.0, -25.0])
    assert metrics.win_rate(trades) == pytest.approx(0.5)
    assert metrics.profit_factor(trades) == pytest.approx(300 / 75)
    assert metrics.payoff_ratio(trades) == pytest.approx(150 / 37.5)


def test_profit_factor_is_infinite_only_when_nothing_lost() -> None:
    assert metrics.profit_factor(_trades([10.0, 20.0])) == float("inf")
    assert np.isnan(metrics.profit_factor(_trades([])))


def test_a_break_even_trade_counts_as_neither_win_nor_loss() -> None:
    trades = _trades([100.0, 0.0, -100.0])
    assert metrics.win_rate(trades) == pytest.approx(1 / 3)
    assert metrics.profit_factor(trades) == pytest.approx(1.0)


def test_infer_periods_per_year_recognises_common_frequencies() -> None:
    assert metrics.infer_periods_per_year(pd.bdate_range("2020-01-01", periods=300)) == 252
    assert metrics.infer_periods_per_year(pd.date_range("2020-01-01", periods=60, freq="W")) == 52
    assert metrics.infer_periods_per_year(pd.date_range("2020-01-01", periods=60, freq="ME")) == 12


def test_sharpe_standard_error_shrinks_with_more_data() -> None:
    rng = np.random.default_rng(3)
    short = pd.Series(rng.normal(0.0005, 0.01, size=250))
    long = pd.Series(rng.normal(0.0005, 0.01, size=4000))
    assert metrics.sharpe_standard_error(short) > metrics.sharpe_standard_error(long)


def test_probabilistic_sharpe_rises_with_sample_length() -> None:
    """The same Sharpe measured over more data is more believable, and PSR says so."""
    rng = np.random.default_rng(4)
    short = pd.Series(rng.normal(0.0004, 0.01, size=200))
    long = pd.Series(np.tile(short.to_numpy(), 12))
    assert metrics.probabilistic_sharpe_ratio(long) > metrics.probabilistic_sharpe_ratio(short)


def test_probabilistic_sharpe_is_a_probability() -> None:
    rng = np.random.default_rng(5)
    returns = pd.Series(rng.normal(0.0003, 0.012, size=800))
    assert 0.0 <= metrics.probabilistic_sharpe_ratio(returns) <= 1.0


def test_deflating_for_more_trials_lowers_the_verdict() -> None:
    """Trying thirty variants and keeping the best is worth less than trying one."""
    rng = np.random.default_rng(6)
    returns = pd.Series(rng.normal(0.0006, 0.01, size=1500))
    one = metrics.deflated_sharpe_ratio(returns, trials=1, trial_sharpe_std=0.5)
    thirty = metrics.deflated_sharpe_ratio(returns, trials=30, trial_sharpe_std=0.5)
    assert thirty < one


def test_negative_skew_and_fat_tails_lower_the_probabilistic_sharpe() -> None:
    """Two samples, same mean and standard deviation, different shape."""
    rng = np.random.default_rng(7)
    symmetric = rng.normal(0.0005, 0.01, size=2000)
    skewed = np.concatenate([rng.normal(0.0011, 0.006, size=1900), rng.normal(-0.011, 0.02, 100)])
    skewed = (skewed - skewed.mean()) / skewed.std(ddof=1) * symmetric.std(ddof=1)
    skewed = skewed + symmetric.mean()
    assert metrics.probabilistic_sharpe_ratio(
        pd.Series(skewed)
    ) < metrics.probabilistic_sharpe_ratio(pd.Series(symmetric))


def test_metrics_return_nan_rather_than_raising_on_an_empty_sample() -> None:
    empty = pd.Series(dtype="float64")
    assert np.isnan(metrics.cagr(empty))
    assert np.isnan(metrics.annualised_volatility(empty))
    assert np.isnan(metrics.sharpe_ratio(empty))
    assert np.isnan(metrics.sortino_ratio(empty))
    assert np.isnan(metrics.max_drawdown(empty).depth)
