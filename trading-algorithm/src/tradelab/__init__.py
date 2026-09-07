"""tradelab - an event-driven backtesting framework for systematic trading research.

This is research software. It is not connected to a broker, it does not place
orders, and nothing it produces is financial advice. See the README for what the
results in this repository do and do not demonstrate.
"""

from tradelab.backtesting.engine import BacktestConfig, BacktestResult, run_backtest
from tradelab.data.market import MarketData, MarketView
from tradelab.risk.limits import RiskLimits, RiskManager
from tradelab.strategies.base import Strategy

__version__ = "0.1.0"

__all__ = [
    "BacktestConfig",
    "BacktestResult",
    "MarketData",
    "MarketView",
    "RiskLimits",
    "RiskManager",
    "Strategy",
    "__version__",
    "run_backtest",
]
