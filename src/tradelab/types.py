"""Value types shared by every layer of the framework.

Everything here is immutable. The engine, the broker and the analytics layer all
hand these objects to each other, and a mutable record that one layer quietly
edits after another has read it is the kind of bug that shows up as an
unexplained equity curve six months later.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import pandas as pd


class OrderReason(StrEnum):
    """Why an order exists. Kept on the fill so a trade log can be audited."""

    REBALANCE = "rebalance"
    STOP_LOSS = "stop_loss"
    RISK_LIMIT = "risk_limit"
    LIQUIDATE = "liquidate"


@dataclass(frozen=True, slots=True)
class Bar:
    """One period of OHLCV for one symbol."""

    ts: pd.Timestamp
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class Order:
    """A market order for the *next* bar.

    ``quantity`` is signed and expressed in units of the instrument: positive is
    a buy, negative is a sell. There is no order type field because the engine
    only supports market-on-open execution; see ``docs/ASSUMPTIONS.md`` for why
    limit orders are deliberately absent rather than merely unimplemented.
    """

    symbol: str
    quantity: float
    reason: OrderReason = OrderReason.REBALANCE

    def __post_init__(self) -> None:
        if self.quantity == 0.0:
            raise ValueError("an order for zero units should not be created")


@dataclass(frozen=True, slots=True)
class Fill:
    """The result of an order meeting the market.

    ``price`` is the price actually paid, slippage included. ``reference_price``
    is what the order would have filled at with no slippage, which is what makes
    the cost attribution in the tear sheet possible.
    """

    ts: pd.Timestamp
    symbol: str
    quantity: float
    price: float
    reference_price: float
    commission: float
    reason: OrderReason

    @property
    def notional(self) -> float:
        """Signed cash flow of the trade itself, before commission."""
        return self.quantity * self.price

    @property
    def slippage_cost(self) -> float:
        """Cash lost to slippage. Always non-negative for the models shipped."""
        return abs(self.quantity) * abs(self.price - self.reference_price)


@dataclass(frozen=True, slots=True)
class Position:
    """A holding in one symbol, with the cost basis needed for trade accounting."""

    symbol: str
    quantity: float
    average_price: float

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0.0

    def market_value(self, price: float) -> float:
        return self.quantity * price


@dataclass(frozen=True, slots=True)
class Trade:
    """A round trip: a position opened from flat and closed back to flat.

    Trades are the unit that win rate and profit factor are computed over. A
    position that is added to or trimmed is still one trade; a position that
    flips from long to short closes one trade and opens another.

    ``gross_pnl`` is what the round trip would have earned filling at the
    reference prices - the open the order was sized against - with commission
    and slippage stripped out. ``net_pnl`` is what it actually earned. Keeping
    the two apart is what makes the cost attribution in the tear sheet possible,
    and getting it wrong is easy: an early version of this class computed PnL
    from fill prices, which already contain slippage, and then subtracted
    slippage again as a fee. Every trade was reported worse than it was, and the
    trade log stopped reconciling to the equity curve. ``tests`` now check that
    reconciliation on every run.
    """

    symbol: str
    direction: int
    entry_ts: pd.Timestamp
    exit_ts: pd.Timestamp
    entry_price: float
    exit_price: float
    max_quantity: float
    gross_pnl: float
    commission: float
    slippage: float
    bars_held: int
    exit_reason: OrderReason

    @property
    def fees(self) -> float:
        """Everything the round trip cost to put on and take off."""
        return self.commission + self.slippage

    @property
    def net_pnl(self) -> float:
        """Profit after commission and slippage. This is the number that counts."""
        return self.gross_pnl - self.fees

    @property
    def is_win(self) -> bool:
        return self.net_pnl > 0.0

    @property
    def return_on_notional(self) -> float:
        """Net PnL as a fraction of the capital the trade tied up at its largest."""
        notional = abs(self.max_quantity) * self.entry_price
        if notional == 0.0:
            return 0.0
        return self.net_pnl / notional
