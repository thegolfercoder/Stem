"""Research strategies, and the contract they are written against.

To add one: subclass :class:`~tradelab.strategies.base.Strategy`, decorate it
with :func:`~tradelab.strategies.registry.register`, and import it here so the
registration runs.
"""

from tradelab.strategies.base import Strategy
from tradelab.strategies.benchmarks import BuyAndHold, Flat
from tradelab.strategies.mean_reversion import RSIReversion, ZScoreReversion
from tradelab.strategies.momentum import CrossSectionalMomentum, TimeSeriesMomentum
from tradelab.strategies.registry import available, build, get, register
from tradelab.strategies.trend import BreakoutTrend, MovingAverageCrossover

__all__ = [
    "BreakoutTrend",
    "BuyAndHold",
    "CrossSectionalMomentum",
    "Flat",
    "MovingAverageCrossover",
    "RSIReversion",
    "Strategy",
    "TimeSeriesMomentum",
    "ZScoreReversion",
    "available",
    "build",
    "get",
    "register",
]
