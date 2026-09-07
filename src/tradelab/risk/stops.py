"""Stop rules, and the per-position state they need.

A stop is checked against the bar that follows the one it was set on, using
that bar's high and low. When a bar gaps straight through the stop level the
fill is taken at the open, not the stop price - assuming otherwise is how a
backtest gives itself a floor that does not exist in a real gap down.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np

from tradelab.types import Bar


@dataclass
class PositionState:
    """What the engine remembers about an open position, for stops only."""

    symbol: str
    direction: int
    entry_price: float
    entry_atr: float
    best_price: float
    bars_held: int = 0
    extras: dict[str, float] = field(default_factory=dict)

    def update(self, bar: Bar) -> None:
        self.bars_held += 1
        if self.direction > 0:
            self.best_price = max(self.best_price, bar.high)
        else:
            self.best_price = min(self.best_price, bar.low)


class StopRule(ABC):
    """Decide whether an open position should be closed on this bar."""

    @abstractmethod
    def level(self, state: PositionState) -> float:
        """The price at which the stop sits for this bar."""

    @abstractmethod
    def describe(self) -> str: ...

    def triggered(self, state: PositionState, bar: Bar) -> float | None:
        """The fill price if the stop trips on ``bar``, otherwise ``None``.

        A long is stopped when the bar's low reaches the level; a short when the
        high does. If the bar opened beyond the level the position is filled at
        the open instead, which is worse and is the point.
        """
        stop = self.level(state)
        if not np.isfinite(stop):
            return None
        if state.direction > 0:
            if bar.low <= stop:
                return min(stop, bar.open)
        elif bar.high >= stop:
            return max(stop, bar.open)
        return None


@dataclass(frozen=True)
class PercentStop(StopRule):
    """A fixed percentage below (long) or above (short) the entry price."""

    fraction: float = 0.10

    def level(self, state: PositionState) -> float:
        return state.entry_price * (1.0 - state.direction * self.fraction)

    def describe(self) -> str:
        return f"hard stop {self.fraction:.0%} from entry"


@dataclass(frozen=True)
class ATRStop(StopRule):
    """A stop a multiple of the entry-bar ATR away.

    Scales the stop distance to the instrument's own noise, so the same rule can
    run across a quiet bond proxy and a volatile small cap without stopping the
    second one out on ordinary movement.
    """

    multiple: float = 3.0

    def level(self, state: PositionState) -> float:
        if state.entry_atr <= 0:
            return float("nan")
        return state.entry_price - state.direction * self.multiple * state.entry_atr

    def describe(self) -> str:
        return f"stop {self.multiple:g} x entry-bar ATR from entry"


@dataclass(frozen=True)
class TrailingStop(StopRule):
    """A stop that follows the best price reached since entry and never retreats."""

    multiple: float = 3.0
    use_atr: bool = True
    fraction: float = 0.10

    def level(self, state: PositionState) -> float:
        if self.use_atr:
            if state.entry_atr <= 0:
                return float("nan")
            distance = self.multiple * state.entry_atr
        else:
            distance = state.best_price * self.fraction
        return state.best_price - state.direction * distance

    def describe(self) -> str:
        basis = f"{self.multiple:g} x entry-bar ATR" if self.use_atr else f"{self.fraction:.0%}"
        return f"trailing stop {basis} below the best price since entry"
