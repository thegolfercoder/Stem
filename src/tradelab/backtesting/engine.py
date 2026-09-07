"""The event loop.

One pass over the bars, in order, with a strict rule about what is known when.
The ordering inside a bar is the whole design:

1. **Execute** the orders decided at the *previous* bar's close, at this bar's
   open, through the broker's cost models.
2. **Check stops** against this bar's high and low, and exit anything triggered.
3. **Accrue** borrow cost on shorts and interest on cash.
4. **Mark** the book to this bar's close and write one row of the equity curve.
5. **Decide** - hand the strategy a view that ends at this bar and record the
   orders it implies, to be executed at the next bar's open.

Step 5 happens after step 4, and its orders are not touched until the next
iteration. That single bar of separation between deciding and trading is what
makes look-ahead bias structurally impossible rather than a discipline. The
proof is ``tests/test_no_lookahead.py``, which reruns a backtest on data
truncated at each bar and asserts the orders are identical.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd

from tradelab._pandas import cell, column_position
from tradelab.backtesting.broker import Broker, Rejection
from tradelab.backtesting.costs import BpsCommission, CommissionModel
from tradelab.backtesting.portfolio import Portfolio
from tradelab.backtesting.slippage import SlippageModel, VolumeShareSlippage
from tradelab.data.market import MarketData
from tradelab.risk.limits import RiskManager
from tradelab.risk.stops import PositionState, StopRule
from tradelab.strategies.base import Strategy
from tradelab.types import Fill, Order, OrderReason


@dataclass(frozen=True)
class BacktestConfig:
    """Everything about a run that is not the strategy or the data.

    Defaults are deliberately conservative. ``BpsCommission(2.0)`` and
    ``VolumeShareSlippage()`` together cost roughly 5-8 bps per side on a small
    order, which is in the right neighbourhood for liquid US equities at retail
    scale and far too cheap for anything illiquid.
    """

    initial_capital: float = 100_000.0
    commission: CommissionModel = field(default_factory=lambda: BpsCommission(2.0))
    slippage: SlippageModel = field(default_factory=VolumeShareSlippage)
    max_participation: float | None = 0.10
    allow_fractional: bool = False

    #: Minimum change in target weight before an order is generated. Rebalancing
    #: on every one-basis-point drift turns a good strategy into a commission
    #: generator, and this is the single most under-tuned parameter in retail
    #: backtests.
    rebalance_tolerance: float = 0.02
    min_order_notional: float = 250.0

    annual_borrow_rate: float = 0.03
    annual_cash_rate: float = 0.0
    periods_per_year: int = 252

    stop: StopRule | None = None
    atr_window: int = 20
    volatility_window: int = 20

    #: Close every position on the final bar so the trade log is complete and no
    #: unrealised PnL is left to flatter the result. Charged at the final close
    #: through the normal cost models.
    liquidate_at_end: bool = True

    def describe(self) -> list[str]:
        lines = [
            f"initial capital: {self.initial_capital:,.0f}",
            f"rebalance tolerance: {self.rebalance_tolerance:.1%} of equity",
            f"minimum order: {self.min_order_notional:,.0f} notional",
            f"borrow rate on shorts: {self.annual_borrow_rate:.1%} a year",
            f"interest on cash: {self.annual_cash_rate:.1%} a year",
        ]
        if self.stop is not None:
            lines.append(f"stop rule: {self.stop.describe()}")
        lines.append(
            "final bar: all positions liquidated at the close"
            if self.liquidate_at_end
            else "final bar: open positions left open and excluded from the trade log"
        )
        return lines


@dataclass(frozen=True, slots=True)
class Decision:
    """The target weights a strategy asked for at one bar, after the risk layer.

    Recorded because the equity curve is a lagging, lossy view of what the
    strategy actually decided: two different decisions can produce the same
    equity for a while. The look-ahead test compares decisions rather than
    equity for exactly that reason - see ``tests/test_no_lookahead.py``.
    """

    ts: pd.Timestamp
    position: int
    targets: dict[str, float]
    halted: bool


@dataclass
class BacktestResult:
    """Everything a run produced. Analytics are computed from this, not during it."""

    strategy: str
    strategy_parameters: dict[str, object]
    equity_curve: pd.DataFrame
    trades: pd.DataFrame
    fills: list[Fill]
    decisions: list[Decision]
    rejections: list[Rejection]
    symbols: list[str]
    start: pd.Timestamp
    end: pd.Timestamp
    warmup_bars: int
    config: BacktestConfig
    risk_description: list[str]
    total_commission: float
    total_slippage: float
    total_financing: float
    truncated_orders: int
    halted_bars: int
    open_positions: pd.DataFrame

    @property
    def returns(self) -> pd.Series:
        """Per-bar simple returns of the equity curve, warm-up included.

        The warm-up bars are flat by construction, which drags the mean and the
        volatility down. ``analytics.metrics.summarise`` trims them for exactly
        that reason.
        """
        return self.equity_curve["equity"].pct_change().fillna(0.0)

    def assumptions(self) -> list[str]:
        broker_lines = Broker(self.config.commission, self.config.slippage).describe()
        return [*self.config.describe(), *broker_lines, *self.risk_description]


def _causal_volatility(closes: pd.DataFrame, window: int) -> pd.DataFrame:
    """Trailing return volatility, shifted so bar i only sees through bar i-1.

    The shift matters: execution happens at bar i's open, and a volatility
    estimate that included bar i's close would be information from after the
    trade. It is a small leak and it is exactly the kind that flatters a
    volatility-scaled slippage model.
    """
    return closes.pct_change().rolling(window, min_periods=max(2, window // 2)).std(ddof=1).shift(1)


def _causal_atr(data: MarketData, window: int) -> pd.DataFrame:
    """Wilder ATR per symbol, shifted by one bar for the same reason."""
    high, low, close = data.field("high"), data.field("low"), data.field("close")
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            (high - low).stack(future_stack=True),
            (high - previous_close).abs().stack(future_stack=True),
            (low - previous_close).abs().stack(future_stack=True),
        ],
        axis=1,
    ).max(axis=1)
    frame = true_range.unstack()
    return frame.ewm(alpha=1 / window, adjust=False, min_periods=window).mean().shift(1)


def run_backtest(
    data: MarketData,
    strategy: Strategy,
    *,
    risk: RiskManager | None = None,
    config: BacktestConfig | None = None,
) -> BacktestResult:
    """Run one strategy over one panel of data and return everything it produced."""
    if len(data) < 2:
        raise ValueError("a backtest needs at least two bars")

    config = config or BacktestConfig()
    risk = risk or RiskManager()
    strategy.reset()
    if risk.drawdown_guard is not None:
        risk.drawdown_guard.reset()

    broker = Broker(
        config.commission,
        config.slippage,
        max_participation=config.max_participation,
        allow_fractional=config.allow_fractional,
    )
    portfolio = Portfolio(
        config.initial_capital,
        annual_borrow_rate=config.annual_borrow_rate,
        annual_cash_rate=config.annual_cash_rate,
        periods_per_year=config.periods_per_year,
    )

    opens, highs, lows = data.field("open"), data.field("high"), data.field("low")
    closes, volumes = data.field("close"), data.field("volume")
    volatility = _causal_volatility(closes, config.volatility_window)
    atr = _causal_atr(data, config.atr_window)
    # The most recent close observed at or before each bar. Forward filling only
    # ever looks backwards, so this is causal; it is the exit price of last
    # resort when an instrument stops printing entirely.
    last_close = closes.ffill()

    pending: list[Order] = []
    states: dict[str, PositionState] = {}
    decisions: list[Decision] = []
    rejections: list[Rejection] = []
    truncated = 0
    halted_bars = 0
    index = data.index
    last_bar = len(index) - 1

    for i in range(len(index)):
        ts = index[i]

        if pending:
            report = broker.execute(
                pending,
                ts=ts,
                reference_prices=opens.iloc[i],
                volumes=volumes.iloc[i],
                volatilities=volatility.iloc[i],
            )
            for fill in report.fills:
                portfolio.apply_fill(fill)
                _sync_state(
                    states, fill, atr_value=cell(atr, i, column_position(closes, fill.symbol))
                )
            rejections.extend(report.rejections)
            truncated += report.truncated
            pending = []

        if config.stop is not None and portfolio.positions:
            _apply_stops(
                config.stop,
                states,
                portfolio,
                broker,
                ts=ts,
                index_position=i,
                opens=opens,
                highs=highs,
                lows=lows,
            )

        _liquidate_untradable(
            portfolio,
            broker,
            ts=ts,
            closes=closes.iloc[i],
            opens=opens.iloc[i],
            fallback=last_close.iloc[i],
            states=states,
        )

        portfolio.accrue_financing(closes.iloc[i])

        if i == last_bar and config.liquidate_at_end and portfolio.positions:
            _liquidate_all(portfolio, broker, ts=ts, prices=closes.iloc[i], states=states)

        point = portfolio.mark(ts, closes.iloc[i])

        if i == last_bar:
            break

        halted = False
        if risk.drawdown_guard is not None:
            halted = risk.drawdown_guard.observe(point.equity, i)
            halted_bars += int(halted)

        if i + 1 < strategy.warmup or halted or point.equity <= 0:
            targets: dict[str, float] = dict.fromkeys(portfolio.positions, 0.0)
        else:
            view = data.view(i)
            targets = risk.target_weights(strategy.generate(view), view)
            for symbol in portfolio.positions:
                targets.setdefault(symbol, 0.0)

        decisions.append(
            Decision(ts=ts, position=i, targets=dict(sorted(targets.items())), halted=halted)
        )
        pending = _orders_from_targets(
            targets,
            portfolio=portfolio,
            prices=closes.iloc[i],
            equity=point.equity,
            config=config,
        )

    equity_curve = portfolio.equity_curve()
    return BacktestResult(
        strategy=strategy.name,
        strategy_parameters=strategy.parameters(),
        equity_curve=equity_curve,
        trades=portfolio.trade_log(),
        fills=portfolio.fills,
        decisions=decisions,
        rejections=rejections,
        symbols=data.symbols,
        start=index[0],
        end=index[-1],
        warmup_bars=strategy.warmup,
        config=config,
        risk_description=risk.describe(),
        total_commission=portfolio.total_commission,
        total_slippage=portfolio.total_slippage,
        total_financing=portfolio.total_financing,
        truncated_orders=truncated,
        halted_bars=halted_bars,
        open_positions=portfolio.open_positions(),
    )


def _orders_from_targets(
    targets: dict[str, float],
    *,
    portfolio: Portfolio,
    prices: pd.Series,
    equity: float,
    config: BacktestConfig,
) -> list[Order]:
    """Translate target weights into the orders that close the gap.

    Sized off the current bar's close because that is the last price the
    decision could have used; the fill happens at the next open and will differ.
    That difference is real execution uncertainty and is left in rather than
    engineered away.
    """
    orders: list[Order] = []
    if equity <= 0:
        return orders

    for symbol, weight in targets.items():
        price = float(prices.get(symbol, np.nan))
        if not np.isfinite(price) or price <= 0:
            continue

        current = portfolio.quantity(symbol)
        current_weight = current * price / equity
        exiting = weight == 0.0 and current != 0.0
        if not exiting and abs(weight - current_weight) < config.rebalance_tolerance:
            continue

        target_quantity = weight * equity / price
        if not config.allow_fractional:
            target_quantity = float(np.trunc(target_quantity))
        delta = target_quantity - current
        if delta == 0.0:
            continue
        if not exiting and abs(delta) * price < config.min_order_notional:
            continue
        orders.append(Order(symbol=symbol, quantity=delta, reason=OrderReason.REBALANCE))
    return orders


def _sync_state(states: dict[str, PositionState], fill: Fill, atr_value: float) -> None:
    """Keep the stop-tracking state in step with the position it describes."""
    state = states.get(fill.symbol)
    direction = int(np.sign(fill.quantity))
    if state is None:
        states[fill.symbol] = PositionState(
            symbol=fill.symbol,
            direction=direction,
            entry_price=fill.price,
            entry_atr=atr_value if np.isfinite(atr_value) else 0.0,
            best_price=fill.price,
        )
    elif state.direction != direction:
        # A flip closes the old position and opens a new one; the stop resets with it.
        states[fill.symbol] = PositionState(
            symbol=fill.symbol,
            direction=direction,
            entry_price=fill.price,
            entry_atr=atr_value if np.isfinite(atr_value) else 0.0,
            best_price=fill.price,
        )


def _apply_stops(
    stop: StopRule,
    states: dict[str, PositionState],
    portfolio: Portfolio,
    broker: Broker,
    *,
    ts: pd.Timestamp,
    index_position: int,
    opens: pd.DataFrame,
    highs: pd.DataFrame,
    lows: pd.DataFrame,
) -> None:
    from tradelab.types import Bar

    for symbol in list(portfolio.positions):
        state = states.get(symbol)
        if state is None:
            continue
        column = column_position(opens, symbol)
        # `close` carries the open deliberately: a stop is evaluated against the
        # bar as it unfolds, and this bar's close is not known when it trips.
        bar = Bar(
            ts=ts,
            symbol=symbol,
            open=cell(opens, index_position, column),
            high=cell(highs, index_position, column),
            low=cell(lows, index_position, column),
            close=cell(opens, index_position, column),
            volume=0.0,
        )
        if not np.isfinite(bar.open):
            continue
        state.update(bar)
        price = stop.triggered(state, bar)
        if price is None:
            continue
        quantity = -portfolio.quantity(symbol)
        if quantity == 0.0:
            continue
        portfolio.apply_fill(
            broker.fill_at(
                ts=ts, symbol=symbol, quantity=quantity, price=price, reason=OrderReason.STOP_LOSS
            )
        )
        states.pop(symbol, None)


def _liquidate_untradable(
    portfolio: Portfolio,
    broker: Broker,
    *,
    ts: pd.Timestamp,
    closes: pd.Series,
    opens: pd.Series,
    fallback: pd.Series,
    states: dict[str, PositionState],
) -> None:
    """Close any holding whose symbol has no close at this bar.

    The alternative - carrying the position at a stale price - is how a delisted
    or halted instrument ends up marked at its last good print forever, which
    turns a total loss into a flat line on the equity curve.

    The exit price is this bar's open where there is one, and otherwise the last
    close the instrument printed. Neither is a price anybody could be sure of
    getting for a name that has stopped trading, and the second is optimistic:
    an instrument that halts and never reopens rarely does so at its last quote.
    ``docs/ASSUMPTIONS.md`` says so, and this is one of the places where a
    backtest cannot substitute for knowing what happened to the security.
    """
    for symbol in list(portfolio.positions):
        if np.isfinite(float(closes.get(symbol, np.nan))):
            continue
        price = float(opens.get(symbol, np.nan))
        if not np.isfinite(price):
            price = float(fallback.get(symbol, np.nan))
        if not np.isfinite(price) or price <= 0:
            continue
        portfolio.apply_fill(
            broker.fill_at(
                ts=ts,
                symbol=symbol,
                quantity=-portfolio.quantity(symbol),
                price=price,
                reason=OrderReason.LIQUIDATE,
            )
        )
        states.pop(symbol, None)


def _liquidate_all(
    portfolio: Portfolio,
    broker: Broker,
    *,
    ts: pd.Timestamp,
    prices: pd.Series,
    states: dict[str, PositionState],
) -> None:
    for symbol in list(portfolio.positions):
        price = float(prices.get(symbol, np.nan))
        if not np.isfinite(price):
            continue
        portfolio.apply_fill(
            broker.fill_at(
                ts=ts,
                symbol=symbol,
                quantity=-portfolio.quantity(symbol),
                price=price,
                reason=OrderReason.LIQUIDATE,
            )
        )
        states.pop(symbol, None)


def with_costs(
    config: BacktestConfig, commission: CommissionModel, slippage: SlippageModel
) -> BacktestConfig:
    """A copy of ``config`` under different cost assumptions, for sensitivity runs."""
    return replace(config, commission=commission, slippage=slippage)
