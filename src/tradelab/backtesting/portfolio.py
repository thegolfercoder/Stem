"""Cash, positions, and the trade log.

Average-cost accounting throughout. The invariant that the tests hold this class
to is that ``equity`` always equals ``cash + sum(quantity * price)``, and that
the sum of realised trade PnL plus unrealised PnL plus every fee ever charged
reconciles to the change in equity. If that identity breaks, nothing downstream
is worth reading.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from tradelab.types import Fill, OrderReason, Position, Trade


@dataclass
class _Episode:
    """A position's life from flat to flat, accumulating into a ``Trade``."""

    symbol: str
    direction: int
    entry_ts: pd.Timestamp
    entry_price: float
    max_quantity: float
    #: Realised at *fill* prices, so slippage is already inside it.
    realised_pnl: float = 0.0
    commission: float = 0.0
    slippage: float = 0.0
    bars: int = 0


@dataclass
class EquityPoint:
    """One row of the equity curve."""

    ts: pd.Timestamp
    cash: float
    positions_value: float
    equity: float
    gross_exposure: float
    net_exposure: float
    turnover: float


class InsufficientCapitalError(RuntimeError):
    """Raised when a fill would drive equity to zero or below."""


class Portfolio:
    """Positions, cash and the record of what happened.

    Shorting is permitted and is modelled as a negative quantity: the proceeds
    land in cash immediately and a borrow fee accrues daily on the absolute
    market value. That is a simplification - real borrow is instrument-specific,
    varies day to day, and can be recalled - and it is stated as an assumption
    rather than buried.
    """

    def __init__(
        self,
        initial_capital: float,
        *,
        annual_borrow_rate: float = 0.03,
        annual_cash_rate: float = 0.0,
        periods_per_year: int = 252,
    ) -> None:
        if initial_capital <= 0:
            raise ValueError("initial_capital must be positive")
        self.initial_capital = float(initial_capital)
        self.cash = float(initial_capital)
        self.annual_borrow_rate = annual_borrow_rate
        self.annual_cash_rate = annual_cash_rate
        self.periods_per_year = periods_per_year

        self.positions: dict[str, Position] = {}
        self.trades: list[Trade] = []
        self.fills: list[Fill] = []
        self.equity_points: list[EquityPoint] = []

        self.total_commission = 0.0
        self.total_slippage = 0.0
        self.total_financing = 0.0

        self._episodes: dict[str, _Episode] = {}
        self._pending_turnover = 0.0

    # ------------------------------------------------------------------ state

    def quantity(self, symbol: str) -> float:
        position = self.positions.get(symbol)
        return position.quantity if position else 0.0

    def positions_value(self, prices: pd.Series) -> float:
        total = 0.0
        for symbol, position in self.positions.items():
            price = float(prices.get(symbol, np.nan))
            if np.isnan(price):
                raise ValueError(
                    f"holding {symbol} but no price at this bar; "
                    "the engine liquidates untradable symbols rather than marking them stale"
                )
            total += position.quantity * price
        return total

    def equity(self, prices: pd.Series) -> float:
        return self.cash + self.positions_value(prices)

    def gross_exposure(self, prices: pd.Series) -> float:
        return sum(
            abs(position.quantity) * float(prices[symbol])
            for symbol, position in self.positions.items()
        )

    def weights(self, prices: pd.Series) -> dict[str, float]:
        """Current portfolio weights by symbol, as a fraction of equity."""
        equity = self.equity(prices)
        if equity <= 0:
            return dict.fromkeys(self.positions, 0.0)
        return {
            symbol: position.quantity * float(prices[symbol]) / equity
            for symbol, position in self.positions.items()
        }

    # ------------------------------------------------------------------ fills

    def apply_fill(self, fill: Fill) -> None:
        """Book a fill: move cash, update the position, and advance the episode."""
        self.cash -= fill.notional + fill.commission
        self.total_commission += fill.commission
        self.total_slippage += fill.slippage_cost
        self._pending_turnover += abs(fill.notional)
        self.fills.append(fill)

        existing = self.positions.get(fill.symbol)
        previous_quantity = existing.quantity if existing else 0.0
        previous_average = existing.average_price if existing else 0.0
        new_quantity = previous_quantity + fill.quantity

        if previous_quantity == 0.0:
            self._open_episode(fill)
            average = fill.price
        elif np.sign(fill.quantity) == np.sign(previous_quantity):
            episode = self._episodes[fill.symbol]
            self._charge(episode, fill)
            episode.max_quantity = max(episode.max_quantity, abs(new_quantity))
            average = (
                previous_average * previous_quantity + fill.price * fill.quantity
            ) / new_quantity
        else:
            closed = min(abs(fill.quantity), abs(previous_quantity))
            realised = closed * (fill.price - previous_average) * np.sign(previous_quantity)
            episode = self._episodes[fill.symbol]
            episode.realised_pnl += float(realised)
            self._charge(episode, fill)

            if abs(fill.quantity) < abs(previous_quantity):
                average = previous_average
            else:
                self._close_episode(fill.symbol, fill, exit_price=fill.price)
                if new_quantity != 0.0:
                    self._open_episode(fill, quantity=new_quantity)
                    average = fill.price
                else:
                    average = 0.0

        if new_quantity == 0.0:
            self.positions.pop(fill.symbol, None)
        else:
            self.positions[fill.symbol] = Position(fill.symbol, new_quantity, average)

        if self.cash < -self.initial_capital * 10:
            raise InsufficientCapitalError(
                f"cash fell to {self.cash:,.0f} on {fill.ts.date()}; "
                "leverage limits are misconfigured"
            )

    @staticmethod
    def _charge(episode: _Episode, fill: Fill) -> None:
        episode.commission += fill.commission
        episode.slippage += fill.slippage_cost

    def _open_episode(self, fill: Fill, quantity: float | None = None) -> None:
        size = quantity if quantity is not None else fill.quantity
        episode = _Episode(
            symbol=fill.symbol,
            direction=int(np.sign(size)),
            entry_ts=fill.ts,
            entry_price=fill.price,
            max_quantity=abs(size),
        )
        # A fill that flips a position pays its costs into the episode it closes,
        # not the one it opens, so only a fresh entry is charged here.
        if quantity is None:
            self._charge(episode, fill)
        self._episodes[fill.symbol] = episode

    def _close_episode(self, symbol: str, fill: Fill, exit_price: float) -> None:
        episode = self._episodes.pop(symbol)
        self.trades.append(
            Trade(
                symbol=symbol,
                direction=episode.direction,
                entry_ts=episode.entry_ts,
                exit_ts=fill.ts,
                entry_price=episode.entry_price,
                exit_price=exit_price,
                max_quantity=episode.max_quantity,
                # Realised PnL is measured at fill prices, which already carry
                # the slippage; adding it back recovers the reference-price
                # figure, so that net_pnl = realised - commission exactly.
                gross_pnl=episode.realised_pnl + episode.slippage,
                commission=episode.commission,
                slippage=episode.slippage,
                bars_held=episode.bars,
                exit_reason=fill.reason,
            )
        )

    # ------------------------------------------------------------- accounting

    def accrue_financing(self, prices: pd.Series) -> float:
        """One period of borrow cost on shorts and interest on idle cash."""
        borrow_base = sum(
            abs(position.quantity) * float(prices[symbol])
            for symbol, position in self.positions.items()
            if position.quantity < 0
        )
        borrow = borrow_base * self.annual_borrow_rate / self.periods_per_year
        interest = max(self.cash, 0.0) * self.annual_cash_rate / self.periods_per_year
        net = interest - borrow
        self.cash += net
        self.total_financing += net
        return net

    def mark(self, ts: pd.Timestamp, prices: pd.Series) -> EquityPoint:
        """Record one row of the equity curve and advance every open episode."""
        for episode in self._episodes.values():
            episode.bars += 1

        positions_value = self.positions_value(prices)
        equity = self.cash + positions_value
        gross = self.gross_exposure(prices)
        denominator = equity if equity > 0 else float("nan")
        point = EquityPoint(
            ts=ts,
            cash=self.cash,
            positions_value=positions_value,
            equity=equity,
            gross_exposure=gross / denominator,
            net_exposure=positions_value / denominator,
            turnover=self._pending_turnover / denominator if denominator == denominator else 0.0,
        )
        self._pending_turnover = 0.0
        self.equity_points.append(point)
        return point

    # ---------------------------------------------------------------- reports

    def equity_curve(self) -> pd.DataFrame:
        """The equity curve and exposure history as a frame indexed by timestamp."""
        if not self.equity_points:
            return pd.DataFrame(
                columns=[
                    "cash",
                    "positions_value",
                    "equity",
                    "gross_exposure",
                    "net_exposure",
                    "turnover",
                ],
                index=pd.DatetimeIndex([], name="ts"),
            )
        frame = pd.DataFrame([vars(point) for point in self.equity_points]).set_index("ts")
        frame.index.name = "ts"
        return frame

    def trade_log(self) -> pd.DataFrame:
        """One row per closed round trip. Open positions at the end are excluded."""
        if not self.trades:
            return pd.DataFrame(
                columns=[
                    "symbol",
                    "direction",
                    "entry_ts",
                    "exit_ts",
                    "entry_price",
                    "exit_price",
                    "max_quantity",
                    "gross_pnl",
                    "commission",
                    "slippage",
                    "fees",
                    "net_pnl",
                    "bars_held",
                    "exit_reason",
                    "return_on_notional",
                ]
            )
        return pd.DataFrame(
            [
                {
                    "symbol": trade.symbol,
                    "direction": trade.direction,
                    "entry_ts": trade.entry_ts,
                    "exit_ts": trade.exit_ts,
                    "entry_price": trade.entry_price,
                    "exit_price": trade.exit_price,
                    "max_quantity": trade.max_quantity,
                    "gross_pnl": trade.gross_pnl,
                    "commission": trade.commission,
                    "slippage": trade.slippage,
                    "fees": trade.fees,
                    "net_pnl": trade.net_pnl,
                    "bars_held": trade.bars_held,
                    "exit_reason": trade.exit_reason.value,
                    "return_on_notional": trade.return_on_notional,
                }
                for trade in self.trades
            ]
        )

    def open_positions(self) -> pd.DataFrame:
        if not self.positions:
            return pd.DataFrame(columns=["symbol", "quantity", "average_price"])
        return pd.DataFrame(
            [
                {
                    "symbol": position.symbol,
                    "quantity": position.quantity,
                    "average_price": position.average_price,
                }
                for position in self.positions.values()
            ]
        )

    def liquidation_reason(self) -> OrderReason:  # pragma: no cover - trivial
        return OrderReason.LIQUIDATE
