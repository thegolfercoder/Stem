"""Benchmarks.

Every result in this repository is reported next to buy-and-hold on the same
data, over the same period, through the same cost model. A strategy that
returned 9% a year is not interesting until you know whether holding the
universe returned 4% or 14%.
"""

from __future__ import annotations

from tradelab.data.market import MarketView
from tradelab.strategies.base import Strategy
from tradelab.strategies.registry import register


@register
class BuyAndHold(Strategy):
    """Equal-weight the universe on the first bar after warm-up and hold.

    The engine still rebalances toward the target weights as prices drift, which
    makes this an equal-weight rebalanced portfolio rather than a strict
    buy-once. ``rebalance_tolerance`` on the engine controls how far it is
    allowed to drift first, and setting it high approximates true buy-and-hold.
    """

    name = "buy_and_hold"

    def __init__(self, symbols: tuple[str, ...] | None = None, warmup_bars: int = 1) -> None:
        self.symbols = symbols
        self.warmup_bars = warmup_bars

    @property
    def warmup(self) -> int:
        return self.warmup_bars

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = list(self.symbols or view.tradable())
        if not universe:
            return {}
        weight = 1.0 / len(universe)
        return dict.fromkeys(universe, weight)


@register
class Flat(Strategy):
    """Hold nothing, ever. The control case for the engine's own tests."""

    name = "flat"

    @property
    def warmup(self) -> int:
        return 0

    def generate(self, view: MarketView) -> dict[str, float]:
        return {}
