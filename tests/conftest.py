"""Shared fixtures.

The panels here are small and seeded. A test that takes four seconds because it
backtests sixteen years of data is a test people stop running.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from tradelab.data.market import MarketData
from tradelab.data.synthetic import SymbolSpec, generate_symbol, trading_calendar


@pytest.fixture(scope="session")
def calendar() -> pd.DatetimeIndex:
    return trading_calendar("2015-01-01", "2016-12-31")


@pytest.fixture(scope="session")
def panel(calendar: pd.DatetimeIndex) -> MarketData:
    """Three synthetic symbols over two years of business days."""
    specs = (
        SymbolSpec(name="AAA", annual_return=0.10, annual_vol=0.18, ar1=0.05),
        SymbolSpec(name="BBB", annual_return=0.04, annual_vol=0.25, ar1=-0.08),
        SymbolSpec(name="CCC", annual_return=0.0, annual_vol=0.20, stress_annual_drift=0.0),
    )
    root = np.random.SeedSequence(4242)
    return MarketData.from_symbol_frames(
        {
            spec.name: generate_symbol(spec, calendar, np.random.default_rng(child))
            for spec, child in zip(specs, root.spawn(len(specs)), strict=True)
        }
    )


@pytest.fixture
def flat_panel() -> MarketData:
    """A single symbol whose price never moves, for exact hand-checkable accounting."""
    index = pd.bdate_range("2020-01-01", periods=60, name="ts")
    frame = pd.DataFrame(
        {
            "open": 100.0,
            "high": 100.0,
            "low": 100.0,
            "close": 100.0,
            "volume": 1_000_000.0,
        },
        index=index,
    )
    return MarketData.from_symbol_frames({"FLAT": frame})


@pytest.fixture
def ramp_panel() -> MarketData:
    """A single symbol rising by exactly 1% a bar. Every number is checkable by hand."""
    index = pd.bdate_range("2020-01-01", periods=80, name="ts")
    close = 100.0 * 1.01 ** np.arange(len(index))
    frame = pd.DataFrame(
        {
            "open": close,
            "high": close * 1.001,
            "low": close * 0.999,
            "close": close,
            "volume": 5_000_000.0,
        },
        index=index,
    )
    return MarketData.from_symbol_frames({"RAMP": frame})
