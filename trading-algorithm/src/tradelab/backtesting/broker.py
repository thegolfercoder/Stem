"""Order execution: where an order meets the cost assumptions.

The broker is the only place that decides a fill price. Nothing else in the
engine is allowed to invent one, which keeps every cost assumption in a single
auditable object rather than scattered through the loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from tradelab.backtesting.costs import CommissionModel
from tradelab.backtesting.slippage import SlippageModel
from tradelab.types import Fill, Order, OrderReason


@dataclass(frozen=True)
class Rejection:
    """An order that could not be filled, and why. Rejections are reported, not hidden."""

    ts: pd.Timestamp
    symbol: str
    quantity: float
    reason: str


@dataclass
class ExecutionReport:
    fills: list[Fill] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    truncated: int = 0


class Broker:
    """Fills market orders at a reference price, adjusted for slippage and charged commission.

    ``max_participation`` caps an order at a fraction of the bar's volume. An
    order above the cap is *truncated* rather than rejected, because that is
    what a real execution algorithm would do - work the order and finish what it
    can - and the residual simply gets re-requested on the following bar by the
    engine's rebalancing logic.
    """

    def __init__(
        self,
        commission: CommissionModel,
        slippage: SlippageModel,
        *,
        max_participation: float | None = 0.10,
        allow_fractional: bool = False,
    ) -> None:
        self.commission = commission
        self.slippage = slippage
        self.max_participation = max_participation
        self.allow_fractional = allow_fractional

    def execute(
        self,
        orders: list[Order],
        *,
        ts: pd.Timestamp,
        reference_prices: pd.Series,
        volumes: pd.Series,
        volatilities: pd.Series,
    ) -> ExecutionReport:
        """Fill a batch of orders at one timestamp."""
        report = ExecutionReport()
        for order in orders:
            price = float(reference_prices.get(order.symbol, np.nan))
            if not np.isfinite(price) or price <= 0:
                report.rejections.append(
                    Rejection(ts, order.symbol, order.quantity, "no tradable price at this bar")
                )
                continue

            quantity = order.quantity
            volume = float(volumes.get(order.symbol, np.nan))
            if self.max_participation is not None and np.isfinite(volume) and volume > 0:
                allowed = volume * self.max_participation
                if abs(quantity) > allowed:
                    quantity = float(np.sign(quantity)) * allowed
                    report.truncated += 1

            if not self.allow_fractional:
                quantity = float(np.trunc(quantity))
            if quantity == 0.0:
                continue

            volatility = float(volatilities.get(order.symbol, np.nan))
            fill_price = self.slippage.fill_price(
                reference_price=price,
                quantity=quantity,
                bar_volume=volume if np.isfinite(volume) else 0.0,
                recent_volatility=volatility if np.isfinite(volatility) else 0.0,
            )
            report.fills.append(
                Fill(
                    ts=ts,
                    symbol=order.symbol,
                    quantity=quantity,
                    price=fill_price,
                    reference_price=price,
                    commission=self.commission.charge(quantity, fill_price),
                    reason=order.reason,
                )
            )
        return report

    def fill_at(
        self,
        *,
        ts: pd.Timestamp,
        symbol: str,
        quantity: float,
        price: float,
        reason: OrderReason,
    ) -> Fill:
        """A fill at an exact price, used for stop exits where the level is the price.

        Slippage is not applied on top: the stop level already represents the
        worst of the level and the bar's open, and charging spread again on a
        price that was itself chosen pessimistically would double-count.
        """
        if not self.allow_fractional:
            quantity = float(np.trunc(quantity))
        return Fill(
            ts=ts,
            symbol=symbol,
            quantity=quantity,
            price=price,
            reference_price=price,
            commission=self.commission.charge(quantity, price),
            reason=reason,
        )

    def describe(self) -> list[str]:
        lines = [
            f"commission: {self.commission.describe()}",
            f"slippage: {self.slippage.describe()}",
        ]
        if self.max_participation is not None:
            lines.append(f"participation cap: {self.max_participation:.0%} of bar volume")
        lines.append(
            "order sizing: whole units" if not self.allow_fractional else "fractional units"
        )
        return lines
