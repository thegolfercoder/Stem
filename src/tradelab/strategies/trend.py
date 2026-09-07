"""Moving-average trend following.

The oldest systematic strategy there is, and the one with the longest published
record of both working and failing. It is included here because its behaviour is
well understood - long stretches of small losses punctuated by a few large gains,
a low win rate and a high payoff ratio - which makes it a good test of whether
the analytics layer is describing a strategy honestly.
"""

from __future__ import annotations

import numpy as np

from tradelab.data.market import MarketView
from tradelab.strategies.base import Strategy
from tradelab.strategies.indicators import average_true_range
from tradelab.strategies.registry import register


@register
class MovingAverageCrossover(Strategy):
    """Long when the fast average is above the slow one, flat or short otherwise.

    The signal is evaluated on the current bar's close and acted on at the next
    bar's open, so the crossover the strategy trades on is one it could actually
    have seen.

    ``confirmation_bars`` requires the sign to persist before the position
    changes, which cuts the whipsaw trades that dominate this rule's cost in
    range-bound markets. It is a genuine parameter, not a free lunch: it also
    delays entry into the trends that pay for everything else.
    """

    name = "ma_crossover"

    def __init__(
        self,
        fast: int = 50,
        slow: int = 200,
        symbols: tuple[str, ...] | None = None,
        allow_short: bool = False,
        confirmation_bars: int = 1,
    ) -> None:
        if fast >= slow:
            raise ValueError(f"fast ({fast}) must be shorter than slow ({slow})")
        if confirmation_bars < 1:
            raise ValueError("confirmation_bars must be at least 1")
        self.fast = fast
        self.slow = slow
        self.symbols = symbols
        self.allow_short = allow_short
        self.confirmation_bars = confirmation_bars
        self._window = slow + confirmation_bars + 1

    @property
    def warmup(self) -> int:
        return self.slow + self.confirmation_bars

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = self.symbols or view.tradable()
        targets: dict[str, float] = {}
        for symbol in universe:
            closes = view.series(symbol, "close", lookback=self._window).dropna()
            if len(closes) < self.warmup:
                targets[symbol] = 0.0
                continue

            spread = (closes.rolling(self.fast).mean() - closes.rolling(self.slow).mean()).iloc[
                -self.confirmation_bars :
            ]
            if spread.isna().any():
                targets[symbol] = 0.0
                continue

            signs = np.sign(spread.to_numpy())
            if len(np.unique(signs)) != 1:
                targets[symbol] = 0.0
                continue

            direction = float(signs[0])
            if direction < 0 and not self.allow_short:
                direction = 0.0
            targets[symbol] = direction

        active = sum(1 for weight in targets.values() if weight != 0.0)
        if active == 0:
            return targets
        return {symbol: weight / active for symbol, weight in targets.items()}


@register
class BreakoutTrend(Strategy):
    """Donchian channel breakout with an ATR-scaled position.

    Enters long on a new ``entry_window`` high and exits on an
    ``exit_window`` low, the structure the original Turtle rules used. Position
    size is inversely proportional to ATR so each position risks a comparable
    fraction of equity, which is where most of this rule's robustness comes from
    - the entry itself is close to arbitrary.
    """

    name = "breakout"

    def __init__(
        self,
        entry_window: int = 55,
        exit_window: int = 20,
        atr_window: int = 20,
        risk_fraction: float = 0.02,
        symbols: tuple[str, ...] | None = None,
    ) -> None:
        if exit_window >= entry_window:
            raise ValueError("exit_window should be shorter than entry_window")
        self.entry_window = entry_window
        self.exit_window = exit_window
        self.atr_window = atr_window
        self.risk_fraction = risk_fraction
        self.symbols = symbols
        self._window = max(entry_window, atr_window * 4) + 1
        self._state: dict[str, float] = {}

    def reset(self) -> None:
        self._state = {}

    @property
    def warmup(self) -> int:
        return max(self.entry_window, self.atr_window) + 1

    def generate(self, view: MarketView) -> dict[str, float]:
        universe = self.symbols or view.tradable()
        targets: dict[str, float] = {}
        for symbol in universe:
            frame = view.ohlcv(symbol, lookback=self._window).dropna()
            if len(frame) < self.warmup:
                targets[symbol] = 0.0
                self._state[symbol] = 0.0
                continue

            close = float(frame["close"].iloc[-1])
            prior = frame.iloc[:-1]
            entry_level = float(prior["high"].iloc[-self.entry_window :].max())
            exit_level = float(prior["low"].iloc[-self.exit_window :].min())
            held = self._state.get(symbol, 0.0)

            if held == 0.0 and close > entry_level:
                atr = average_true_range(frame, self.atr_window)
                if np.isfinite(atr) and atr > 0:
                    # Weight so that a move of one ATR costs `risk_fraction` of equity.
                    held = min(self.risk_fraction * close / atr, 1.0)
            elif held > 0.0 and close < exit_level:
                held = 0.0

            self._state[symbol] = held
            targets[symbol] = held

        gross = sum(abs(weight) for weight in targets.values())
        if gross > 1.0:
            targets = {symbol: weight / gross for symbol, weight in targets.items()}
        return targets
