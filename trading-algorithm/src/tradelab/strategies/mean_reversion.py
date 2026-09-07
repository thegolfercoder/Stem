"""Mean reversion.

The mirror image of trend following: a high win rate, a low payoff ratio, and a
tail risk that a summary statistic hides. A mean-reversion rule buys things that
are falling, which works until the thing that is falling has a reason to be, so
these strategies are the ones where the stop rules in ``tradelab.risk.stops``
earn their place.
"""

from __future__ import annotations

import numpy as np

from tradelab.data.market import MarketView
from tradelab.strategies.base import Strategy
from tradelab.strategies.indicators import ou_half_life, rsi, zscore
from tradelab.strategies.registry import register


@register
class ZScoreReversion(Strategy):
    """Fade deviations from a trailing mean, sized by how far the price has moved.

    Entry at ``entry_z`` standard deviations, exit at ``exit_z``, which gives
    the rule hysteresis: without a separate exit threshold the position churns
    every time the z-score crosses back and forth over one level.

    ``require_reversion`` gates entries on an Ornstein-Uhlenbeck half-life
    estimate being finite and shorter than ``max_half_life``. That is a test of
    whether the series is currently mean-reverting at all, and it is the honest
    version of the caveat this strategy needs: applying a reversion rule to a
    trending series is a reliable way to lose money slowly.
    """

    name = "zscore_reversion"

    def __init__(
        self,
        lookback: int = 20,
        entry_z: float = 1.5,
        exit_z: float = 0.3,
        allow_short: bool = True,
        require_reversion: bool = False,
        max_half_life: int = 30,
        symbols: tuple[str, ...] | None = None,
    ) -> None:
        if entry_z <= exit_z:
            raise ValueError("entry_z must be above exit_z or the position never closes")
        self.lookback = lookback
        self.entry_z = entry_z
        self.exit_z = exit_z
        self.allow_short = allow_short
        self.require_reversion = require_reversion
        self.max_half_life = max_half_life
        self.symbols = symbols
        self._window = max(lookback, max_half_life) + 2
        self._held: dict[str, float] = {}

    def reset(self) -> None:
        self._held = {}

    @property
    def warmup(self) -> int:
        return max(self.lookback, self.max_half_life if self.require_reversion else 0) + 1

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = list(self.symbols or view.tradable())
        targets: dict[str, float] = {}
        for symbol in universe:
            closes = view.series(symbol, "close", lookback=self._window).dropna()
            score = zscore(closes, self.lookback)
            held = self._held.get(symbol, 0.0)

            if not np.isfinite(score) or (held != 0.0 and abs(score) <= self.exit_z):
                held = 0.0
            elif held == 0.0 and abs(score) >= self.entry_z:
                direction = -float(np.sign(score))
                if direction < 0 and not self.allow_short:
                    direction = 0.0
                if direction != 0.0 and self.require_reversion:
                    half_life = ou_half_life(closes, max(self.lookback, self.max_half_life))
                    if not np.isfinite(half_life) or half_life > self.max_half_life:
                        direction = 0.0
                held = direction

            self._held[symbol] = held
            targets[symbol] = held

        active = sum(1 for weight in targets.values() if weight != 0.0)
        if active == 0:
            return targets
        return {symbol: weight / active for symbol, weight in targets.items()}


@register
class RSIReversion(Strategy):
    """Buy oversold, sell overbought, on Wilder's RSI.

    Included because it is the rule most retail backtests are built on, and
    because running it beside ``ZScoreReversion`` on the same data shows how
    much of a result comes from the indicator and how much from the exit logic
    - usually far more of the latter than people expect.
    """

    name = "rsi_reversion"

    def __init__(
        self,
        window: int = 14,
        oversold: float = 30.0,
        overbought: float = 70.0,
        exit_level: float = 50.0,
        allow_short: bool = False,
        symbols: tuple[str, ...] | None = None,
    ) -> None:
        if not 0 < oversold < exit_level < overbought < 100:
            raise ValueError("levels must satisfy 0 < oversold < exit_level < overbought < 100")
        self.window = window
        self.oversold = oversold
        self.overbought = overbought
        self.exit_level = exit_level
        self.allow_short = allow_short
        self.symbols = symbols
        self._window = window * 4
        self._held: dict[str, float] = {}

    def reset(self) -> None:
        self._held = {}

    @property
    def warmup(self) -> int:
        return self.window * 3

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = list(self.symbols or view.tradable())
        targets: dict[str, float] = {}
        for symbol in universe:
            value = rsi(view.series(symbol, "close", lookback=self._window).dropna(), self.window)
            held = self._held.get(symbol, 0.0)

            if (
                not np.isfinite(value)
                or (held > 0 and value >= self.exit_level)
                or (held < 0 and value <= self.exit_level)
            ):
                held = 0.0
            elif held == 0.0:
                if value <= self.oversold:
                    held = 1.0
                elif value >= self.overbought and self.allow_short:
                    held = -1.0

            self._held[symbol] = held
            targets[symbol] = held

        active = sum(1 for weight in targets.values() if weight != 0.0)
        if active == 0:
            return targets
        return {symbol: weight / active for symbol, weight in targets.items()}
