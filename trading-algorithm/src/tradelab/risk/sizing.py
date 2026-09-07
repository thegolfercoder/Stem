"""Turning a strategy's opinion into a position size.

A strategy says *what* it wants to hold and in which direction. How much of the
portfolio that is worth is a risk decision, not a signal decision, and keeping
the two apart is what lets the same signal be run at two risk budgets without
touching the strategy.

Every sizer here is causal: it reads only the view it is handed, which ends at
the current bar.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

from tradelab.data.market import MarketView


class PositionSizer(ABC):
    """Rescale raw target weights into risk-adjusted target weights."""

    @abstractmethod
    def size(self, targets: dict[str, float], view: MarketView) -> dict[str, float]: ...

    @abstractmethod
    def describe(self) -> str: ...


@dataclass(frozen=True)
class Unsized(PositionSizer):
    """Pass the strategy's weights through untouched."""

    def size(self, targets: dict[str, float], view: MarketView) -> dict[str, float]:
        return dict(targets)

    def describe(self) -> str:
        return "none (strategy weights used as-is)"


@dataclass(frozen=True)
class FixedFractional(PositionSizer):
    """Give every non-zero signal the same fraction of equity."""

    fraction: float = 0.2

    def size(self, targets: dict[str, float], view: MarketView) -> dict[str, float]:
        return {
            symbol: float(np.sign(weight)) * self.fraction for symbol, weight in targets.items()
        }

    def describe(self) -> str:
        return f"fixed {self.fraction:.0%} of equity per position"


@dataclass(frozen=True)
class InverseVolatility(PositionSizer):
    """Weight inversely to each instrument's own trailing volatility.

    Equalises the risk each position contributes on a standalone basis. It does
    *not* equalise risk contribution in the portfolio sense, because it ignores
    correlation - which is the honest limitation of the approach and the reason
    ``VolatilityTarget`` exists to scale the whole book afterwards.
    """

    lookback: int = 60
    floor: float = 1e-4

    def size(self, targets: dict[str, float], view: MarketView) -> dict[str, float]:
        scores: dict[str, float] = {}
        for symbol, weight in targets.items():
            if weight == 0.0:
                scores[symbol] = 0.0
                continue
            closes = view.series(symbol, "close", lookback=self.lookback + 1).dropna()
            if len(closes) < max(10, self.lookback // 4):
                scores[symbol] = 0.0
                continue
            sigma = float(closes.pct_change().dropna().std(ddof=1))
            scores[symbol] = float(np.sign(weight)) / max(sigma, self.floor)

        total = sum(abs(value) for value in scores.values())
        if total == 0.0:
            return dict.fromkeys(targets, 0.0)
        return {symbol: value / total for symbol, value in scores.items()}

    def describe(self) -> str:
        return f"inverse trailing volatility over {self.lookback} bars, normalised to 100% gross"


@dataclass(frozen=True)
class VolatilityTarget(PositionSizer):
    """Scale the whole book so its ex-ante volatility hits an annual target.

    The forecast is the realised volatility of the weights' own recent returns,
    computed with the full covariance so correlation is accounted for. Realised
    volatility is a decent predictor of near-term volatility and a poor one
    across a regime break, so ``max_scale`` matters: without it a long calm
    stretch talks this sizer into a position that the following week destroys.

    ``max_scale`` caps the *multiplier* applied to the strategy's weights, not
    the resulting gross exposure - a book asked for at 60% gross and scaled by
    2.0 comes out at 120%, not at 200%. The cap on gross exposure itself lives
    in :class:`~tradelab.risk.limits.RiskLimits`, which is applied after this and
    has the final say.
    """

    annual_target: float = 0.10
    lookback: int = 60
    periods_per_year: int = 252
    max_scale: float = 2.0

    def size(self, targets: dict[str, float], view: MarketView) -> dict[str, float]:
        active = {symbol: weight for symbol, weight in targets.items() if weight != 0.0}
        if not active:
            return dict(targets)

        history = view.history("close", lookback=self.lookback + 1)[list(active)]
        returns = history.pct_change().dropna()
        if len(returns) < max(10, self.lookback // 4):
            return dict.fromkeys(targets, 0.0)

        weights = np.array([active[symbol] for symbol in history.columns], dtype=float)
        covariance = returns.cov().to_numpy()
        variance = float(weights @ covariance @ weights)
        if not np.isfinite(variance) or variance <= 0:
            return dict.fromkeys(targets, 0.0)

        forecast = np.sqrt(variance * self.periods_per_year)
        scale = min(self.annual_target / forecast, self.max_scale)
        return {symbol: weight * scale for symbol, weight in targets.items()}

    def describe(self) -> str:
        return (
            f"scaled to {self.annual_target:.0%} annualised volatility using a "
            f"{self.lookback}-bar covariance, scale factor capped at {self.max_scale:g}x"
        )
