"""Strategy behaviour, and the contract every strategy has to meet."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from tradelab.backtesting.engine import BacktestConfig, run_backtest
from tradelab.data.market import MarketData, MarketView
from tradelab.strategies import available, build
from tradelab.strategies.base import Strategy
from tradelab.strategies.benchmarks import BuyAndHold, Flat
from tradelab.strategies.indicators import (
    average_true_range,
    ou_half_life,
    rsi,
    sma,
    total_return,
    zscore,
)
from tradelab.strategies.mean_reversion import RSIReversion, ZScoreReversion
from tradelab.strategies.momentum import CrossSectionalMomentum, TimeSeriesMomentum
from tradelab.strategies.registry import register
from tradelab.strategies.trend import BreakoutTrend, MovingAverageCrossover

ALL = [
    MovingAverageCrossover(fast=10, slow=30),
    BreakoutTrend(entry_window=20, exit_window=8, atr_window=10),
    TimeSeriesMomentum(lookback=40),
    CrossSectionalMomentum(lookback=60, skip_bars=5),
    ZScoreReversion(lookback=15),
    RSIReversion(window=10),
    BuyAndHold(),
    Flat(),
]


@pytest.mark.parametrize("strategy", ALL, ids=lambda s: s.name)
def test_weights_are_finite_and_within_bounds(panel: MarketData, strategy: Strategy) -> None:
    for position in (5, 100, 300, len(panel) - 1):
        weights = strategy.generate(panel.view(position))
        assert set(weights) <= set(panel.symbols)
        for weight in weights.values():
            assert np.isfinite(weight)
            assert -1.0 - 1e-9 <= weight <= 1.0 + 1e-9


@pytest.mark.parametrize("strategy", ALL, ids=lambda s: s.name)
def test_gross_weight_never_exceeds_one(panel: MarketData, strategy: Strategy) -> None:
    """Before the risk layer, a strategy should not be asking for leverage."""
    for position in (80, 250, 450):
        weights = strategy.generate(panel.view(position))
        assert sum(abs(w) for w in weights.values()) <= 1.0 + 1e-9


@pytest.mark.parametrize("strategy", ALL, ids=lambda s: s.name)
def test_the_engine_holds_the_book_flat_through_the_warmup(
    panel: MarketData, strategy: Strategy
) -> None:
    """The warm-up guarantee belongs to the engine, not to the strategy.

    A strategy is free to return a weight from an indicator computed on eight
    observations; what must never happen is the engine acting on it. Declaring
    ``warmup`` too low is the mistake this catches, because the equity curve
    would then start with a stretch driven by indicators fitted to a handful of
    points.
    """
    result = run_backtest(panel, strategy, config=BacktestConfig(liquidate_at_end=False))
    warm = panel.index[strategy.warmup]
    assert all(fill.ts >= warm for fill in result.fills)


@pytest.mark.parametrize("strategy", ALL, ids=lambda s: s.name)
def test_reset_makes_a_strategy_reusable(panel: MarketData, strategy: Strategy) -> None:
    """Two runs of the same object must produce identical results."""
    config = BacktestConfig(liquidate_at_end=False)
    first = run_backtest(panel, strategy, config=config).equity_curve["equity"]
    second = run_backtest(panel, strategy, config=config).equity_curve["equity"]
    pd.testing.assert_series_equal(first, second)


@pytest.mark.parametrize("strategy", ALL, ids=lambda s: s.name)
def test_describe_and_parameters_are_usable_in_a_report(strategy: Strategy) -> None:
    assert strategy.describe().strip()
    assert isinstance(strategy.parameters(), dict)


def test_a_crossover_is_long_when_fast_is_above_slow() -> None:
    """A hand-made rising series: the fast average must be above the slow one."""
    index = pd.bdate_range("2020-01-01", periods=120, name="ts")
    close = pd.Series(np.linspace(50.0, 150.0, len(index)), index=index)
    frame = pd.DataFrame(
        {"open": close, "high": close * 1.01, "low": close * 0.99, "close": close, "volume": 1e6}
    )
    data = MarketData.from_symbol_frames({"UP": frame})
    weights = MovingAverageCrossover(fast=10, slow=30).generate(data.view(len(index) - 1))
    assert weights["UP"] == pytest.approx(1.0)


def test_a_crossover_is_flat_when_fast_is_below_slow() -> None:
    index = pd.bdate_range("2020-01-01", periods=120, name="ts")
    close = pd.Series(np.linspace(150.0, 50.0, len(index)), index=index)
    frame = pd.DataFrame(
        {"open": close, "high": close * 1.01, "low": close * 0.99, "close": close, "volume": 1e6}
    )
    data = MarketData.from_symbol_frames({"DOWN": frame})
    long_only = MovingAverageCrossover(fast=10, slow=30, allow_short=False)
    assert long_only.generate(data.view(len(index) - 1))["DOWN"] == pytest.approx(0.0)

    short_allowed = MovingAverageCrossover(fast=10, slow=30, allow_short=True)
    assert short_allowed.generate(data.view(len(index) - 1))["DOWN"] == pytest.approx(-1.0)


def test_confirmation_bars_suppress_a_one_bar_crossover() -> None:
    """A signal that flips and flips back inside the confirmation window is ignored."""
    index = pd.bdate_range("2020-01-01", periods=90, name="ts")
    close = pd.Series(np.linspace(50.0, 120.0, len(index)), index=index)
    close.iloc[-1] = 30.0  # one violent bar, enough to invert the short average
    frame = pd.DataFrame(
        {"open": close, "high": close * 1.01, "low": close * 0.99, "close": close, "volume": 1e6}
    )
    data = MarketData.from_symbol_frames({"BLIP": frame})
    view = data.view(len(index) - 1)
    patient = MovingAverageCrossover(fast=5, slow=20, allow_short=True, confirmation_bars=4)
    assert patient.generate(view)["BLIP"] == pytest.approx(0.0)


def test_strategies_reject_nonsense_parameters() -> None:
    with pytest.raises(ValueError, match="fast"):
        MovingAverageCrossover(fast=200, slow=50)
    with pytest.raises(ValueError, match="confirmation_bars"):
        MovingAverageCrossover(confirmation_bars=0)
    with pytest.raises(ValueError, match="exit_window"):
        BreakoutTrend(entry_window=10, exit_window=20)
    with pytest.raises(ValueError, match="entry_z"):
        ZScoreReversion(entry_z=0.2, exit_z=0.5)
    with pytest.raises(ValueError, match="oversold"):
        RSIReversion(oversold=80.0, overbought=20.0)
    with pytest.raises(ValueError, match="top_n"):
        CrossSectionalMomentum(top_n=0)


def test_the_registry_round_trips_every_registered_name() -> None:
    assert "ma_crossover" in available()
    for name in available():
        assert build(name).name == name


def test_registering_two_strategies_under_one_name_is_an_error() -> None:
    with pytest.raises(ValueError, match="both registered"):

        @register
        class Duplicate(Strategy):
            name = "ma_crossover"

            @property
            def warmup(self) -> int:
                return 1

            def generate(self, view: MarketView) -> dict[str, float]:
                return {}


def test_building_an_unknown_strategy_names_the_ones_that_exist() -> None:
    with pytest.raises(KeyError, match="registered"):
        build("no_such_strategy")


def test_sma_matches_the_arithmetic_mean() -> None:
    series = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    assert sma(series, 3) == pytest.approx(4.0)
    assert np.isnan(sma(series, 10))


def test_zscore_is_zero_at_the_mean_and_signed_away_from_it() -> None:
    series = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 3.0])
    assert zscore(series, 6) == pytest.approx(0.0, abs=1e-12)
    assert zscore(pd.Series([1.0, 1.0, 1.0, 5.0]), 4) > 0


def test_zscore_of_a_constant_series_is_undefined() -> None:
    assert np.isnan(zscore(pd.Series([3.0] * 20), 10))


def test_rsi_saturates_on_a_series_that_only_rises() -> None:
    assert rsi(pd.Series(np.arange(1.0, 40.0)), 14) == pytest.approx(100.0)
    assert rsi(pd.Series(np.arange(40.0, 1.0, -1.0)), 14) < 5.0


def test_atr_is_positive_and_grows_with_the_range() -> None:
    index = pd.bdate_range("2020-01-01", periods=60, name="ts")
    close = pd.Series(100.0, index=index)
    tight = pd.DataFrame(
        {"open": close, "high": close + 0.5, "low": close - 0.5, "close": close, "volume": 1e6}
    )
    wide = pd.DataFrame(
        {"open": close, "high": close + 5.0, "low": close - 5.0, "close": close, "volume": 1e6}
    )
    assert 0 < average_true_range(tight, 14) < average_true_range(wide, 14)


def test_total_return_skips_the_bars_it_is_told_to() -> None:
    series = pd.Series([100.0, 110.0, 121.0, 200.0])
    assert total_return(series, window=2, skip=1) == pytest.approx(0.21)


def test_ou_half_life_is_finite_for_a_reverting_series_and_nan_otherwise() -> None:
    rng = np.random.default_rng(11)
    reverting = [0.0]
    for _ in range(400):
        reverting.append(0.85 * reverting[-1] + rng.normal(0, 1))
    assert 0 < ou_half_life(pd.Series(reverting) + 100.0, 300) < 20

    trending = pd.Series(np.cumsum(rng.normal(0.5, 0.1, 400)) + 100.0)
    assert np.isnan(ou_half_life(trending, 300))


def test_a_new_strategy_needs_nothing_but_the_two_methods(panel: MarketData) -> None:
    """The extensibility claim in the README, checked rather than asserted in prose."""

    class AlwaysFirstSymbol(Strategy):
        name = "test_always_first_symbol"

        @property
        def warmup(self) -> int:
            return 2

        def generate(self, view: MarketView) -> dict[str, float]:
            return {view.symbols[0]: 0.5}

    result = run_backtest(panel, AlwaysFirstSymbol(), config=BacktestConfig())
    assert not result.trades.empty
    assert result.equity_curve["gross_exposure"].max() > 0.3
