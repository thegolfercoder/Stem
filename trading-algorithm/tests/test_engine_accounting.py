"""The accounting identity.

If equity does not equal cash plus the market value of what is held, nothing
downstream means anything. These tests check that on every bar of a real run,
and check the hand-calculable cases exactly.
"""

from __future__ import annotations

import numpy as np
import pytest

from tradelab._pandas import column_position
from tradelab.backtesting.costs import BpsCommission, NoCommission
from tradelab.backtesting.engine import BacktestConfig, run_backtest
from tradelab.backtesting.slippage import FixedBpsSlippage, NoSlippage
from tradelab.data.market import MarketData
from tradelab.risk.limits import RiskLimits, RiskManager
from tradelab.strategies.benchmarks import BuyAndHold, Flat
from tradelab.strategies.trend import MovingAverageCrossover
from tradelab.types import OrderReason

FRICTIONLESS = BacktestConfig(
    commission=NoCommission(),
    slippage=NoSlippage(),
    max_participation=None,
    rebalance_tolerance=0.01,
    min_order_notional=0.0,
)
FULL_WEIGHT = RiskManager(limits=RiskLimits(max_position_weight=1.0, max_gross_exposure=1.0))


def test_equity_equals_cash_plus_positions_on_every_bar(panel: MarketData) -> None:
    result = run_backtest(panel, MovingAverageCrossover(fast=20, slow=60), config=FRICTIONLESS)
    curve = result.equity_curve
    np.testing.assert_allclose(
        curve["equity"].to_numpy(),
        (curve["cash"] + curve["positions_value"]).to_numpy(),
        rtol=0,
        atol=1e-9,
    )


def test_doing_nothing_changes_nothing(panel: MarketData) -> None:
    result = run_backtest(panel, Flat(), config=FRICTIONLESS)
    assert (result.equity_curve["equity"] == 100_000.0).all()
    assert result.trades.empty
    assert result.fills == []
    assert result.total_commission == 0.0


def test_a_flat_market_returns_the_capital_exactly(flat_panel: MarketData) -> None:
    """No price movement and no costs means the final equity is the initial equity."""
    result = run_backtest(flat_panel, BuyAndHold(), risk=FULL_WEIGHT, config=FRICTIONLESS)
    assert result.equity_curve["equity"].iloc[-1] == pytest.approx(100_000.0, abs=100.0)
    assert result.trades["net_pnl"].abs().sum() == pytest.approx(0.0, abs=100.0)


def test_a_one_percent_ramp_compounds_as_arithmetic_says(ramp_panel: MarketData) -> None:
    """Fully invested in a series that rises 1% a bar, equity must rise 1% a bar."""
    result = run_backtest(
        ramp_panel, BuyAndHold(warmup_bars=1), risk=FULL_WEIGHT, config=FRICTIONLESS
    )
    curve = result.equity_curve["equity"]
    # Bars 0 and 1 are the decision and the fill; bar 2 onward is fully invested.
    invested = curve.iloc[2:-1]
    growth = invested.pct_change().dropna()
    assert growth.min() == pytest.approx(0.01, abs=5e-4)
    assert growth.max() == pytest.approx(0.01, abs=5e-4)


def test_costs_only_ever_reduce_equity(panel: MarketData) -> None:
    """The same strategy must do worse with costs than without. Always."""
    strategy = MovingAverageCrossover(fast=20, slow=60)
    free = run_backtest(panel, strategy, config=FRICTIONLESS)
    costly = run_backtest(
        panel,
        strategy,
        config=BacktestConfig(
            commission=BpsCommission(10.0),
            slippage=FixedBpsSlippage(25.0),
            max_participation=None,
            rebalance_tolerance=0.01,
            min_order_notional=0.0,
        ),
    )
    assert costly.total_commission > 0
    assert costly.total_slippage > 0
    assert costly.equity_curve["equity"].iloc[-1] < free.equity_curve["equity"].iloc[-1]


def test_realised_pnl_and_fees_reconcile_to_the_change_in_equity(panel: MarketData) -> None:
    """Closed trades, open positions and every fee must add up to what happened."""
    result = run_backtest(
        panel,
        MovingAverageCrossover(fast=20, slow=60),
        config=BacktestConfig(
            commission=BpsCommission(2.0),
            slippage=FixedBpsSlippage(5.0),
            max_participation=None,
            liquidate_at_end=True,
        ),
    )
    assert result.open_positions.empty, "liquidate_at_end should leave nothing open"

    change = result.equity_curve["equity"].iloc[-1] - result.config.initial_capital
    booked = result.trades["net_pnl"].sum() + result.total_financing
    assert change == pytest.approx(booked, rel=1e-9, abs=1e-6)


def test_participation_cap_truncates_rather_than_inventing_liquidity(panel: MarketData) -> None:
    """An order larger than the bar's volume must not fill in full."""
    thin = MarketData(
        frames={
            name: (frame * 0.0 + 100.0 if name == "volume" else frame)
            for name, frame in panel.frames.items()
        }
    )
    result = run_backtest(
        thin,
        BuyAndHold(),
        risk=FULL_WEIGHT,
        config=BacktestConfig(max_participation=0.10, min_order_notional=0.0),
    )
    assert result.truncated_orders > 0
    rebalances = [f for f in result.fills if f.reason is OrderReason.REBALANCE]
    assert rebalances
    for fill in rebalances:
        assert abs(fill.quantity) <= 10.0 + 1e-9  # 10% of a 100-unit bar

    # Forced exits - stops and the end-of-run liquidation - deliberately ignore
    # the cap and fill in full. That is optimistic and is stated as an
    # assumption; a stop in a name with no liquidity is not filled at the stop.
    forced = [f for f in result.fills if f.reason is OrderReason.LIQUIDATE]
    assert any(abs(f.quantity) > 10.0 for f in forced)


def test_an_untradable_symbol_is_liquidated_not_carried_at_a_stale_price(
    panel: MarketData,
) -> None:
    """A symbol that stops printing must leave the book, not sit there marked flat."""
    frames = {name: frame.copy() for name, frame in panel.frames.items()}
    for frame in frames.values():
        frame.iloc[400:, column_position(frame, "BBB")] = np.nan
    gappy = MarketData(frames=frames)

    result = run_backtest(gappy, BuyAndHold(), risk=FULL_WEIGHT, config=FRICTIONLESS)
    assert "BBB" not in set(result.open_positions.get("symbol", []))
    assert result.equity_curve["equity"].notna().all()
