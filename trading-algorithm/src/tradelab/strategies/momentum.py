"""Momentum: cross-sectional and time-series.

Both are documented anomalies with decades of published evidence and both have
had long stretches of doing nothing at all, including a well-known crash in
2009. Nothing in this module is a claim that either works now.
"""

from __future__ import annotations

import numpy as np

from tradelab.data.market import MarketView
from tradelab.strategies.base import Strategy
from tradelab.strategies.indicators import total_return
from tradelab.strategies.registry import register


@register
class CrossSectionalMomentum(Strategy):
    """Rank the universe by past return, hold the winners, optionally short the losers.

    ``skip_bars`` drops the most recent month from the ranking window. That is
    the standard construction (12-1 momentum) and it exists because the most
    recent month reverses on average, so including it works against the signal.

    With a small universe the ranking is coarse - with four symbols and
    ``top_n=1`` this is close to a single-asset bet, and its results will be
    dominated by that one choice. Cross-sectional momentum is a large-universe
    strategy, and running it on a handful of instruments is a demonstration of
    the machinery rather than a test of the effect.
    """

    name = "xs_momentum"

    def __init__(
        self,
        lookback: int = 252,
        skip_bars: int = 21,
        top_n: int = 1,
        bottom_n: int = 0,
        symbols: tuple[str, ...] | None = None,
    ) -> None:
        if top_n < 1:
            raise ValueError("top_n must be at least 1")
        if bottom_n < 0:
            raise ValueError("bottom_n cannot be negative")
        self.lookback = lookback
        self.skip_bars = skip_bars
        self.top_n = top_n
        self.bottom_n = bottom_n
        self.symbols = symbols
        self._window = lookback + skip_bars + 2

    @property
    def warmup(self) -> int:
        return self.lookback + self.skip_bars + 1

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = list(self.symbols or view.tradable())
        scores = {
            symbol: total_return(
                view.series(symbol, "close", lookback=self._window).dropna(),
                self.lookback,
                self.skip_bars,
            )
            for symbol in universe
        }
        ranked = sorted(
            (symbol for symbol, score in scores.items() if np.isfinite(score)),
            key=lambda symbol: scores[symbol],
            reverse=True,
        )
        targets = dict.fromkeys(universe, 0.0)
        if len(ranked) < self.top_n + self.bottom_n:
            return targets

        longs = ranked[: self.top_n]
        shorts = ranked[-self.bottom_n :] if self.bottom_n else []
        legs = len(longs) + len(shorts)
        if legs == 0:
            return targets
        for symbol in longs:
            targets[symbol] = 1.0 / legs
        for symbol in shorts:
            targets[symbol] = -1.0 / legs
        return targets


@register
class TimeSeriesMomentum(Strategy):
    """Hold each instrument long or short according to the sign of its own past return.

    Unlike the cross-sectional version this makes an independent decision per
    instrument, so the whole book can be long, or flat, at once - which is both
    its appeal as a diversifier and the reason its drawdowns cluster.
    """

    name = "ts_momentum"

    def __init__(
        self,
        lookback: int = 126,
        allow_short: bool = True,
        min_absolute_return: float = 0.0,
        symbols: tuple[str, ...] | None = None,
    ) -> None:
        self.lookback = lookback
        self.allow_short = allow_short
        self.min_absolute_return = min_absolute_return
        self.symbols = symbols
        self._window = lookback + 2

    @property
    def warmup(self) -> int:
        return self.lookback + 1

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = list(self.symbols or view.tradable())
        targets: dict[str, float] = {}
        for symbol in universe:
            past = total_return(
                view.series(symbol, "close", lookback=self._window).dropna(), self.lookback
            )
            if not np.isfinite(past) or abs(past) < self.min_absolute_return:
                targets[symbol] = 0.0
                continue
            direction = float(np.sign(past))
            if direction < 0 and not self.allow_short:
                direction = 0.0
            targets[symbol] = direction

        active = sum(1 for weight in targets.values() if weight != 0.0)
        if active == 0:
            return targets
        return {symbol: weight / active for symbol, weight in targets.items()}
