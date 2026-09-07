"""Slippage models.

Slippage is an assumption, not a measurement. Nothing in a daily OHLCV file
tells you what you would actually have paid, so every model here is a guess with
a stated shape, and the honest way to use them is to re-run a result under the
pessimistic one and see whether it survives.

The default is deliberately not the cheapest option. A backtest that only works
at zero cost is a backtest that does not work.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np


class SlippageModel(ABC):
    """Turn an intended execution price into the one the fill actually gets."""

    @abstractmethod
    def fill_price(
        self,
        *,
        reference_price: float,
        quantity: float,
        bar_volume: float,
        recent_volatility: float,
    ) -> float:
        """The execution price. Must be worse than ``reference_price`` for the
        side being traded, or equal to it - never better."""

    @abstractmethod
    def describe(self) -> str: ...

    @staticmethod
    def _apply(reference_price: float, quantity: float, penalty_fraction: float) -> float:
        """Push the price against the trader by ``penalty_fraction``."""
        direction = 1.0 if quantity > 0 else -1.0
        return reference_price * (1.0 + direction * max(penalty_fraction, 0.0))


@dataclass(frozen=True)
class NoSlippage(SlippageModel):
    """Fills at the reference price. Only appropriate for testing the engine."""

    def fill_price(
        self,
        *,
        reference_price: float,
        quantity: float,
        bar_volume: float,
        recent_volatility: float,
    ) -> float:
        return reference_price

    def describe(self) -> str:
        return "none (fills at the reference price)"


@dataclass(frozen=True)
class FixedBpsSlippage(SlippageModel):
    """A constant cost in basis points, standing in for half the bid-ask spread.

    Independent of order size, which makes it optimistic for anything large
    relative to the traded volume. It is the right model when your positions are
    small enough that spread dominates impact, and the wrong one otherwise.
    """

    bps: float = 5.0

    def fill_price(
        self,
        *,
        reference_price: float,
        quantity: float,
        bar_volume: float,
        recent_volatility: float,
    ) -> float:
        return self._apply(reference_price, quantity, self.bps * 1e-4)

    def describe(self) -> str:
        return f"{self.bps:g} bps, size-independent (half-spread proxy)"


@dataclass(frozen=True)
class VolumeShareSlippage(SlippageModel):
    """Spread plus square-root market impact in the share of volume taken.

    Impact is modelled as ``coefficient * volatility * sqrt(participation)``,
    the square-root law that shows up repeatedly in the execution literature.
    The *shape* is well supported; the coefficient is a guess and is the first
    thing to vary in a sensitivity check.

    ``max_participation`` caps how much of a bar's volume an order may take.
    Beyond the cap the order is truncated by the broker rather than filled at a
    fantasy price - a backtest that quietly trades 400% of a day's volume is the
    classic way to manufacture a small-cap strategy that cannot exist.
    """

    spread_bps: float = 3.0
    coefficient: float = 0.6
    max_participation: float = 0.10

    def fill_price(
        self,
        *,
        reference_price: float,
        quantity: float,
        bar_volume: float,
        recent_volatility: float,
    ) -> float:
        penalty = self.spread_bps * 1e-4
        if bar_volume > 0 and np.isfinite(bar_volume):
            participation = min(abs(quantity) / bar_volume, self.max_participation)
            penalty += self.coefficient * max(recent_volatility, 0.0) * np.sqrt(participation)
        return self._apply(reference_price, quantity, float(penalty))

    def describe(self) -> str:
        return (
            f"{self.spread_bps:g} bps spread + {self.coefficient:g} * sigma * "
            f"sqrt(participation), participation capped at {self.max_participation:.0%}"
        )


@dataclass(frozen=True)
class VolatilityScaledSlippage(SlippageModel):
    """Cost as a fraction of the instrument's own recent volatility.

    Useful across instruments whose spreads differ by orders of magnitude, where
    a single bps figure would be far too wide for one and far too tight for
    another.
    """

    fraction: float = 0.05
    floor_bps: float = 1.0

    def fill_price(
        self,
        *,
        reference_price: float,
        quantity: float,
        bar_volume: float,
        recent_volatility: float,
    ) -> float:
        penalty = max(self.fraction * max(recent_volatility, 0.0), self.floor_bps * 1e-4)
        return self._apply(reference_price, quantity, penalty)

    def describe(self) -> str:
        return f"{self.fraction:.0%} of trailing daily sigma, floor {self.floor_bps:g} bps"
