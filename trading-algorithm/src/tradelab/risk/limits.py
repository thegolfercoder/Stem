"""Exposure limits and the drawdown kill switch.

These are the constraints that apply after sizing and regardless of what the
strategy asked for. A limit that a strategy can talk its way past is not a
limit, so the engine applies them last and unconditionally.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from tradelab.data.market import MarketView
from tradelab.risk.sizing import PositionSizer, Unsized


@dataclass(frozen=True)
class RiskLimits:
    """Hard caps on what the book may look like after sizing.

    Applied in order: per-symbol cap, then gross, then net. Gross is scaled
    proportionally when breached, which preserves the relative sizing the
    strategy asked for. Net is corrected by shrinking the offending side, so a
    long/short book stays hedged rather than being cut arbitrarily.
    """

    max_position_weight: float = 0.35
    max_gross_exposure: float = 1.0
    max_net_exposure: float = 1.0
    allow_shorts: bool = True

    def apply(self, targets: dict[str, float]) -> dict[str, float]:
        weights = dict(targets)
        if not self.allow_shorts:
            weights = {symbol: max(weight, 0.0) for symbol, weight in weights.items()}

        cap = self.max_position_weight
        weights = {symbol: float(np.clip(weight, -cap, cap)) for symbol, weight in weights.items()}

        gross = sum(abs(weight) for weight in weights.values())
        if gross > self.max_gross_exposure and gross > 0:
            scale = self.max_gross_exposure / gross
            weights = {symbol: weight * scale for symbol, weight in weights.items()}

        net = sum(weights.values())
        if abs(net) > self.max_net_exposure:
            excess = abs(net) - self.max_net_exposure
            side = np.sign(net)
            same_side = {s: w for s, w in weights.items() if np.sign(w) == side}
            same_side_gross = sum(abs(w) for w in same_side.values())
            if same_side_gross > 0:
                shrink = max(0.0, 1.0 - excess / same_side_gross)
                weights = {
                    symbol: weight * shrink if np.sign(weight) == side else weight
                    for symbol, weight in weights.items()
                }
        return weights

    def describe(self) -> str:
        shorts = "shorts allowed" if self.allow_shorts else "long only"
        return (
            f"max {self.max_position_weight:.0%} per position, "
            f"max {self.max_gross_exposure:.0%} gross, "
            f"max {self.max_net_exposure:.0%} net, {shorts}"
        )


@dataclass
class DrawdownGuard:
    """Flatten the book when drawdown from the high-water mark exceeds a threshold.

    Trading resumes after ``cooldown_bars``, and the high-water mark is reset to
    the equity at the moment of the halt. Without that reset the guard latches:
    a strategy that draws down 30% and never regains the old peak measures its
    drawdown against that peak forever, re-triggers on every bar, and stays flat
    for the rest of the backtest. That is not a kill switch, it is a delete
    switch, and it silently turned one of the configs in this repository into a
    zero-exposure run for its entire out-of-sample period before the reset was
    added.

    This is a capital-preservation rule, not an edge: stopping out of a drawdown
    locks in the loss and forfeits the recovery, and on most historical series it
    lowers terminal wealth versus a strategy that would eventually have
    recovered. It is here because a research result you cannot survive to
    collect is not a result.
    """

    max_drawdown: float = 0.25
    cooldown_bars: int = 20
    _peak: float = field(default=0.0, init=False)
    _halted_until: int = field(default=-1, init=False)
    _triggers: int = field(default=0, init=False)

    def observe(self, equity: float, bar_index: int) -> bool:
        """Record equity and return ``True`` when trading must stay halted."""
        self._peak = max(self._peak, equity)
        if self._peak > 0:
            drawdown = equity / self._peak - 1.0
            if drawdown <= -self.max_drawdown and bar_index > self._halted_until:
                self._halted_until = bar_index + self.cooldown_bars
                self._triggers += 1
                self._peak = equity
        return bar_index <= self._halted_until

    @property
    def trigger_count(self) -> int:
        return self._triggers

    def reset(self) -> None:
        """Clear the state so the guard can be reused across runs."""
        self._peak = 0.0
        self._halted_until = -1
        self._triggers = 0

    def describe(self) -> str:
        return (
            f"flatten at {self.max_drawdown:.0%} drawdown from the high-water mark, "
            f"resume after {self.cooldown_bars} bars, high-water mark reset on each trigger"
        )


@dataclass
class RiskManager:
    """Sizing then limits, in that order, with an optional kill switch."""

    limits: RiskLimits = field(default_factory=RiskLimits)
    sizer: PositionSizer = field(default_factory=Unsized)
    drawdown_guard: DrawdownGuard | None = None

    def target_weights(self, raw: dict[str, float], view: MarketView) -> dict[str, float]:
        return self.limits.apply(self.sizer.size(raw, view))

    def describe(self) -> list[str]:
        lines = [f"sizing: {self.sizer.describe()}", f"limits: {self.limits.describe()}"]
        if self.drawdown_guard is not None:
            lines.append(f"kill switch: {self.drawdown_guard.describe()}")
        return lines
