"""Position and trade accounting, at the level of individual fills."""

from __future__ import annotations

import pandas as pd
import pytest

from tradelab.backtesting.portfolio import Portfolio
from tradelab.types import Fill, OrderReason

TS = pd.Timestamp("2021-01-04")


def fill(
    quantity: float,
    price: float,
    *,
    commission: float = 0.0,
    reference: float | None = None,
    day: int = 4,
    reason: OrderReason = OrderReason.REBALANCE,
) -> Fill:
    return Fill(
        ts=pd.Timestamp(f"2021-01-{day:02d}"),
        symbol="X",
        quantity=quantity,
        price=price,
        reference_price=price if reference is None else reference,
        commission=commission,
        reason=reason,
    )


def prices(value: float) -> pd.Series:
    return pd.Series({"X": value})


def test_a_buy_moves_cash_and_creates_a_position() -> None:
    portfolio = Portfolio(10_000.0)
    portfolio.apply_fill(fill(10, 100.0, commission=5.0))
    assert portfolio.cash == pytest.approx(10_000 - 1000 - 5)
    assert portfolio.quantity("X") == 10
    assert portfolio.positions["X"].average_price == pytest.approx(100.0)
    assert portfolio.equity(prices(100.0)) == pytest.approx(9995.0)


def test_adding_to_a_position_averages_the_cost() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(10, 100.0))
    portfolio.apply_fill(fill(30, 120.0, day=5))
    assert portfolio.quantity("X") == 40
    assert portfolio.positions["X"].average_price == pytest.approx((10 * 100 + 30 * 120) / 40)


def test_closing_a_position_books_one_trade() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(10, 100.0, commission=1.0))
    portfolio.mark(TS, prices(100.0))
    portfolio.apply_fill(fill(-10, 130.0, commission=1.0, day=5))

    assert portfolio.quantity("X") == 0
    assert "X" not in portfolio.positions
    assert len(portfolio.trades) == 1

    trade = portfolio.trades[0]
    assert trade.direction == 1
    assert trade.gross_pnl == pytest.approx(300.0)
    assert trade.commission == pytest.approx(2.0)
    assert trade.net_pnl == pytest.approx(298.0)
    assert trade.is_win


def test_a_losing_trade_is_recorded_as_one() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(10, 100.0))
    portfolio.apply_fill(fill(-10, 80.0, day=5))
    trade = portfolio.trades[0]
    assert trade.net_pnl == pytest.approx(-200.0)
    assert not trade.is_win


def test_a_short_that_falls_is_a_win() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(-10, 100.0))
    assert portfolio.cash == pytest.approx(101_000.0)
    portfolio.apply_fill(fill(10, 70.0, day=5))
    trade = portfolio.trades[0]
    assert trade.direction == -1
    assert trade.gross_pnl == pytest.approx(300.0)


def test_a_partial_close_does_not_end_the_trade() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(100, 50.0))
    portfolio.apply_fill(fill(-40, 60.0, day=5))
    assert portfolio.trades == []
    assert portfolio.quantity("X") == 60
    assert portfolio.positions["X"].average_price == pytest.approx(50.0)

    portfolio.apply_fill(fill(-60, 70.0, day=6))
    assert len(portfolio.trades) == 1
    assert portfolio.trades[0].gross_pnl == pytest.approx(40 * 10 + 60 * 20)


def test_a_flip_closes_one_trade_and_opens_another() -> None:
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(10, 100.0))
    portfolio.apply_fill(fill(-25, 120.0, day=5))

    assert len(portfolio.trades) == 1
    assert portfolio.trades[0].direction == 1
    assert portfolio.trades[0].gross_pnl == pytest.approx(200.0)
    assert portfolio.quantity("X") == -15
    assert portfolio.positions["X"].average_price == pytest.approx(120.0)


def test_slippage_is_charged_once_not_twice() -> None:
    """gross_pnl is measured before costs; net_pnl subtracts them exactly once."""
    portfolio = Portfolio(100_000.0)
    portfolio.apply_fill(fill(10, 101.0, reference=100.0))  # paid 1.00 a unit of slippage
    portfolio.apply_fill(fill(-10, 109.0, reference=110.0, day=5))  # gave up 1.00 a unit

    trade = portfolio.trades[0]
    assert trade.slippage == pytest.approx(20.0)
    assert trade.gross_pnl == pytest.approx(100.0)  # 110 - 100 on ten units
    assert trade.net_pnl == pytest.approx(80.0)  # what the cash actually did


def test_borrow_accrues_on_shorts_and_not_on_longs() -> None:
    short = Portfolio(100_000.0, annual_borrow_rate=0.05, periods_per_year=252)
    short.apply_fill(fill(-100, 50.0))
    charged = short.accrue_financing(prices(50.0))
    assert charged == pytest.approx(-5000 * 0.05 / 252)

    long = Portfolio(100_000.0, annual_borrow_rate=0.05, periods_per_year=252)
    long.apply_fill(fill(100, 50.0))
    assert long.accrue_financing(prices(50.0)) == pytest.approx(0.0)


def test_interest_accrues_on_idle_cash() -> None:
    portfolio = Portfolio(100_000.0, annual_cash_rate=0.04, periods_per_year=252)
    assert portfolio.accrue_financing(pd.Series(dtype="float64")) == pytest.approx(
        100_000 * 0.04 / 252
    )


def test_marking_records_exposure_and_turnover() -> None:
    portfolio = Portfolio(10_000.0)
    portfolio.apply_fill(fill(50, 100.0))
    point = portfolio.mark(TS, prices(100.0))
    assert point.equity == pytest.approx(10_000.0)
    assert point.gross_exposure == pytest.approx(0.5)
    assert point.net_exposure == pytest.approx(0.5)
    assert point.turnover == pytest.approx(0.5)

    later = portfolio.mark(pd.Timestamp("2021-01-05"), prices(100.0))
    assert later.turnover == pytest.approx(0.0), "turnover is per bar, not cumulative"


def test_a_short_book_shows_negative_net_and_positive_gross() -> None:
    portfolio = Portfolio(10_000.0)
    portfolio.apply_fill(fill(-50, 100.0))
    point = portfolio.mark(TS, prices(100.0))
    assert point.gross_exposure == pytest.approx(0.5)
    assert point.net_exposure == pytest.approx(-0.5)


def test_holding_something_with_no_price_is_refused_rather_than_guessed() -> None:
    portfolio = Portfolio(10_000.0)
    portfolio.apply_fill(fill(10, 100.0))
    with pytest.raises(ValueError, match="no price at this bar"):
        portfolio.equity(pd.Series({"X": float("nan")}))


def test_an_empty_portfolio_produces_empty_but_well_formed_reports() -> None:
    portfolio = Portfolio(10_000.0)
    assert portfolio.equity_curve().empty
    assert list(portfolio.trade_log().columns)
    assert portfolio.open_positions().empty


def test_a_zero_quantity_order_cannot_be_constructed() -> None:
    from tradelab.types import Order

    with pytest.raises(ValueError, match="zero units"):
        Order(symbol="X", quantity=0.0)
