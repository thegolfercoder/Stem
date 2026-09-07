"""The strategy contract.

A strategy answers one question: given everything visible up to and including
this bar, what fraction of equity would you like to hold in each symbol?

It does not place orders, does not know about cash, commission or slippage, and
cannot see its own positions unless it asks for them. That narrowness is what
makes strategies cheap to write, cheap to test in isolation, and impossible to
accidentally give a look at the future - the only data they get is a
``MarketView``, which ends at the current bar.

Adding a strategy is: subclass ``Strategy``, implement ``warmup`` and
``generate``, and register it. Nothing else in the framework needs to change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from tradelab.data.market import MarketView


class Strategy(ABC):
    """Base class for every strategy."""

    #: Shown in reports and used as the config key. Set it on the subclass.
    name: str = "unnamed"

    @property
    @abstractmethod
    def warmup(self) -> int:
        """Bars of history needed before the first signal is meaningful.

        The engine holds the book flat until this many bars have elapsed. Get it
        wrong on the low side and the first months of the backtest are driven by
        indicators computed on a handful of points, which is a real and commonly
        overlooked way to make an equity curve start with a lucky run.
        """

    @abstractmethod
    def generate(self, view: MarketView) -> dict[str, float]:
        """Target weights by symbol, as a signed fraction of equity.

        A symbol left out of the returned mapping is treated as a target of
        zero. Weights are what the strategy *wants*; the risk layer decides what
        it gets, and the sum is not required to be 1.
        """

    def reset(self) -> None:  # noqa: B027 - optional hook; most strategies are stateless
        """Clear any state carried between bars.

        The engine calls this before the first bar of every run. Strategies that
        remember something - a breakout that tracks whether it is already in a
        position, for instance - must clear it here, or a second backtest in the
        same process silently starts from the first one's ending state.
        """

    def parameters(self) -> dict[str, Any]:
        """The strategy's configuration, for the reproducibility block of a report."""
        return {
            key: value
            for key, value in vars(self).items()
            if not key.startswith("_") and isinstance(value, int | float | str | bool | tuple)
        }

    def describe(self) -> str:
        """One line for a report. Override when the default reads badly."""
        parameters = ", ".join(f"{key}={value}" for key, value in sorted(self.parameters().items()))
        return f"{self.name}({parameters})" if parameters else self.name

    def __repr__(self) -> str:
        return self.describe()
