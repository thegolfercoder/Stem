"""Sizing, limits, stops and the kill switch."""

from __future__ import annotations

import numpy as np
import pytest

from tradelab.backtesting.engine import BacktestConfig, run_backtest
from tradelab.data.market import MarketData
from tradelab.risk.limits import DrawdownGuard, RiskLimits, RiskManager
from tradelab.risk.sizing import FixedFractional, InverseVolatility, Unsized, VolatilityTarget
from tradelab.risk.stops import ATRStop, PercentStop, PositionState, TrailingStop
from tradelab.strategies.benchmarks import BuyAndHold
from tradelab.strategies.trend import MovingAverageCrossover
from tradelab.types import Bar, OrderReason


def test_per_position_cap_binds() -> None:
    limits = RiskLimits(max_position_weight=0.20, max_gross_exposure=10.0, max_net_exposure=10.0)
    result = limits.apply({"A": 0.9, "B": -0.5, "C": 0.05})
    assert result == pytest.approx({"A": 0.20, "B": -0.20, "C": 0.05})


def test_gross_cap_scales_proportionally() -> None:
    """Scaling preserves the relative sizing the strategy asked for."""
    limits = RiskLimits(max_position_weight=1.0, max_gross_exposure=1.0, max_net_exposure=10.0)
    result = limits.apply({"A": 0.8, "B": 0.4, "C": -0.8})
    assert sum(abs(w) for w in result.values()) == pytest.approx(1.0)
    assert result["A"] / result["B"] == pytest.approx(2.0)


def test_net_cap_shrinks_only_the_offending_side() -> None:
    limits = RiskLimits(max_position_weight=1.0, max_gross_exposure=10.0, max_net_exposure=0.2)
    result = limits.apply({"A": 0.6, "B": 0.4, "C": -0.3})
    assert sum(result.values()) == pytest.approx(0.2)
    assert result["C"] == pytest.approx(-0.3), "the short leg should be untouched"


def test_long_only_removes_shorts_entirely() -> None:
    limits = RiskLimits(allow_shorts=False)
    assert limits.apply({"A": -0.5, "B": 0.3}) == pytest.approx({"A": 0.0, "B": 0.3})


def test_limits_leave_a_conforming_book_alone() -> None:
    limits = RiskLimits(max_position_weight=0.5, max_gross_exposure=1.0, max_net_exposure=1.0)
    targets = {"A": 0.3, "B": 0.2}
    assert limits.apply(targets) == pytest.approx(targets)


def test_fixed_fractional_ignores_signal_strength_but_keeps_the_sign() -> None:
    sizer = FixedFractional(fraction=0.25)
    assert sizer.size({"A": 0.9, "B": -0.1, "C": 0.0}, None) == pytest.approx(  # type: ignore[arg-type]
        {"A": 0.25, "B": -0.25, "C": 0.0}
    )


def test_inverse_volatility_gives_the_quieter_instrument_more_weight(panel: MarketData) -> None:
    view = panel.view(300)
    weights = InverseVolatility(lookback=60).size(dict.fromkeys(panel.symbols, 1.0), view)
    volatility = {
        symbol: float(view.series(symbol, lookback=61).pct_change().std(ddof=1))
        for symbol in panel.symbols
    }
    quietest = min(volatility, key=lambda s: volatility[s])
    loudest = max(volatility, key=lambda s: volatility[s])
    assert weights[quietest] > weights[loudest]
    assert sum(abs(w) for w in weights.values()) == pytest.approx(1.0)


def test_volatility_target_scales_toward_the_requested_volatility(panel: MarketData) -> None:
    view = panel.view(400)
    sizer = VolatilityTarget(annual_target=0.05, lookback=60, max_scale=10.0)
    weights = sizer.size(dict.fromkeys(panel.symbols, 1.0 / len(panel.symbols)), view)

    history = view.history("close", lookback=61).pct_change().dropna()
    vector = np.array([weights[s] for s in history.columns])
    realised = float(np.sqrt(vector @ history.cov().to_numpy() @ vector) * np.sqrt(252))
    assert realised == pytest.approx(0.05, rel=1e-6)


def test_volatility_target_respects_the_scale_cap(panel: MarketData) -> None:
    """A very low-volatility estimate must not talk the sizer into unlimited leverage.

    The cap is on the multiplier, not the resulting gross: three weights of 0.25
    scaled by at most 1.5 come out at 1.125 gross, not 1.5.
    """
    raw = dict.fromkeys(panel.symbols, 0.25)
    sizer = VolatilityTarget(annual_target=5.0, lookback=60, max_scale=1.5)
    weights = sizer.size(raw, panel.view(400))
    assert sum(abs(w) for w in weights.values()) == pytest.approx(1.5 * sum(raw.values()))


def test_volatility_target_stands_down_when_there_is_not_enough_history(panel: MarketData) -> None:
    weights = VolatilityTarget(lookback=60).size(dict.fromkeys(panel.symbols, 0.3), panel.view(3))
    assert all(weight == 0.0 for weight in weights.values())


def test_sizers_pass_an_empty_book_through(panel: MarketData) -> None:
    for sizer in (Unsized(), FixedFractional(), InverseVolatility(), VolatilityTarget()):
        assert sizer.size({}, panel.view(300)) == {}


def _bar(low: float, high: float, open_: float) -> Bar:
    import pandas as pd

    return Bar(pd.Timestamp("2020-01-02"), "X", open_, high, low, open_, 1000.0)


def test_percent_stop_fires_when_the_low_reaches_the_level() -> None:
    state = PositionState("X", 1, entry_price=100.0, entry_atr=2.0, best_price=100.0)
    stop = PercentStop(fraction=0.10)
    assert stop.triggered(state, _bar(low=91.0, high=101.0, open_=99.0)) is None
    assert stop.triggered(state, _bar(low=89.0, high=101.0, open_=99.0)) == pytest.approx(90.0)


def test_a_gap_through_the_stop_fills_at_the_open_not_the_stop() -> None:
    """The pessimistic choice, and the one that matches what a real gap does."""
    state = PositionState("X", 1, entry_price=100.0, entry_atr=2.0, best_price=100.0)
    fill = PercentStop(fraction=0.10).triggered(state, _bar(low=80.0, high=86.0, open_=85.0))
    assert fill == pytest.approx(85.0)


def test_short_stops_fire_on_the_high() -> None:
    state = PositionState("X", -1, entry_price=100.0, entry_atr=2.0, best_price=100.0)
    stop = PercentStop(fraction=0.10)
    assert stop.triggered(state, _bar(low=99.0, high=109.0, open_=101.0)) is None
    assert stop.triggered(state, _bar(low=99.0, high=111.0, open_=101.0)) == pytest.approx(110.0)


def test_atr_stop_scales_with_the_entry_bar_atr() -> None:
    quiet = PositionState("X", 1, entry_price=100.0, entry_atr=1.0, best_price=100.0)
    noisy = PositionState("X", 1, entry_price=100.0, entry_atr=5.0, best_price=100.0)
    stop = ATRStop(multiple=3.0)
    assert stop.level(quiet) == pytest.approx(97.0)
    assert stop.level(noisy) == pytest.approx(85.0)


def test_atr_stop_stands_down_when_atr_is_unknown() -> None:
    state = PositionState("X", 1, entry_price=100.0, entry_atr=0.0, best_price=100.0)
    assert np.isnan(ATRStop().level(state))
    assert ATRStop().triggered(state, _bar(low=1.0, high=2.0, open_=1.5)) is None


def test_a_trailing_stop_only_ever_rises_for_a_long() -> None:
    state = PositionState("X", 1, entry_price=100.0, entry_atr=2.0, best_price=100.0)
    stop = TrailingStop(multiple=3.0)
    first = stop.level(state)
    state.update(_bar(low=99.0, high=120.0, open_=105.0))
    assert stop.level(state) > first
    state.update(_bar(low=95.0, high=110.0, open_=100.0))
    assert stop.level(state) == pytest.approx(120.0 - 6.0)


def test_drawdown_guard_halts_then_resumes() -> None:
    guard = DrawdownGuard(max_drawdown=0.20, cooldown_bars=5)
    assert not guard.observe(100.0, 0)
    assert not guard.observe(90.0, 1)
    assert guard.observe(75.0, 2), "a 25% drawdown must halt"
    assert guard.observe(76.0, 5), "still inside the cooldown"
    assert not guard.observe(77.0, 8), "cooldown is over"
    assert guard.trigger_count == 1


def test_drawdown_guard_does_not_latch_forever() -> None:
    """The bug this test exists for: a guard measuring against a peak it can never
    regain re-triggers on every bar and leaves the book flat for the rest of the run."""
    guard = DrawdownGuard(max_drawdown=0.20, cooldown_bars=5)
    guard.observe(100.0, 0)
    guard.observe(70.0, 1)
    halted = [guard.observe(70.0 + bar * 0.01, bar) for bar in range(2, 200)]
    assert not all(halted)
    assert guard.trigger_count == 1


def test_the_kill_switch_flattens_the_book_in_a_real_run(panel: MarketData) -> None:
    risk = RiskManager(
        limits=RiskLimits(max_position_weight=1.0),
        drawdown_guard=DrawdownGuard(max_drawdown=0.02, cooldown_bars=10),
    )
    result = run_backtest(panel, BuyAndHold(), risk=risk, config=BacktestConfig())
    assert result.halted_bars > 0
    assert (result.equity_curve["gross_exposure"] < 1e-9).any()


def test_a_stop_produces_a_stop_loss_exit_in_a_real_run(panel: MarketData) -> None:
    result = run_backtest(
        panel,
        MovingAverageCrossover(fast=10, slow=30),
        config=BacktestConfig(stop=PercentStop(fraction=0.03)),
    )
    reasons = set(result.trades["exit_reason"])
    assert OrderReason.STOP_LOSS.value in reasons


def test_a_tighter_stop_produces_more_stop_exits(panel: MarketData) -> None:
    def stop_exits(fraction: float) -> int:
        result = run_backtest(
            panel,
            MovingAverageCrossover(fast=10, slow=30),
            config=BacktestConfig(stop=PercentStop(fraction=fraction)),
        )
        return int((result.trades["exit_reason"] == OrderReason.STOP_LOSS.value).sum())

    assert stop_exits(0.02) > stop_exits(0.20)
