"""Running a config over a chosen slice of history.

This is the layer the CLI and the research script share. The subtle part is what
"out of sample" means operationally: the strategy needs its indicators warm on
the first out-of-sample bar, so the *run* starts before the boundary and the
*measurement* starts at it. Backtesting from a standing start on the first
out-of-sample day would instead measure a strategy that spent its first two
hundred bars flat, which is a different and much less interesting thing.

Nothing here lets the out-of-sample period influence a decision made before it:
the run is a single forward pass, and trimming happens afterwards on the
recorded output.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, replace
from typing import Literal

import pandas as pd

from tradelab.analytics.metrics import PerformanceSummary, summarise
from tradelab.backtesting.engine import BacktestResult, run_backtest
from tradelab.config import RunConfig
from tradelab.data.loaders import load_directory
from tradelab.data.market import MarketData
from tradelab.data.splits import date_split

SplitName = Literal["development", "out_of_sample", "all"]


@dataclass(frozen=True)
class SplitRun:
    """One config evaluated over one slice of history."""

    name: str
    split: SplitName
    result: BacktestResult
    summary: PerformanceSummary


def load_data(config: RunConfig, *, quiet: bool = False) -> MarketData:
    """Load and validate the data a config points at, reporting any warnings."""
    data, reports = load_directory(config.data.directory, symbols=config.data.symbols)
    if not quiet:
        for quality in reports:
            for warning in quality.warnings:
                print(f"  data warning [{quality.symbol}]: {warning}", file=sys.stderr)
    if config.data.start or config.data.end:
        data = data.slice(
            pd.Timestamp(config.data.start) if config.data.start else None,
            pd.Timestamp(config.data.end) if config.data.end else None,
        )
    return data


def select_split(data: MarketData, config: RunConfig, split: SplitName) -> MarketData:
    """The bars to run over for a chosen split.

    The out-of-sample case keeps everything up to the end of the sample so the
    warm-up happens on development data; the measurement window is trimmed
    afterwards by :func:`trim_to_split`.
    """
    if split == "all" or config.data.development_end is None:
        return data
    development, out_of_sample = date_split(data.index, config.data.development_end)
    if split == "out_of_sample":
        return data.slice(None, out_of_sample.end)
    return data.slice(development.start, development.end)


def trim_to_split(result: BacktestResult, config: RunConfig, split: SplitName) -> BacktestResult:
    """Restrict a finished run's records to the measurement window."""
    if split != "out_of_sample" or config.data.development_end is None:
        return result
    boundary = pd.Timestamp(config.data.development_end)

    curve = result.equity_curve.loc[result.equity_curve.index > boundary]
    if curve.empty:
        raise ValueError("no bars after the development boundary")
    trades = result.trades
    if not trades.empty:
        trades = trades.loc[trades["exit_ts"] > boundary].reset_index(drop=True)

    result.equity_curve = curve
    result.trades = trades
    result.decisions = [d for d in result.decisions if d.ts > boundary]
    result.fills = [f for f in result.fills if f.ts > boundary]
    # The warm-up already happened on development data, so none of these bars
    # should be trimmed a second time when the summary is computed.
    result.warmup_bars = 0
    result.start = curve.index[0]
    return result


def run_split(config: RunConfig, split: SplitName, *, quiet: bool = False) -> SplitRun:
    """Run one config over one split and summarise it."""
    data = select_split(load_data(config, quiet=quiet), config, split)
    result = run_backtest(data, config.strategy, risk=config.risk, config=config.backtest)
    result = trim_to_split(result, config, split)
    return SplitRun(name=config.name, split=split, result=result, summary=summarise(result))


def with_data_directory(config: RunConfig, directory: str | None) -> RunConfig:
    """Point a config at a different data directory without editing the file."""
    if not directory:
        return config
    return replace(config, data=replace(config.data, directory=directory))
