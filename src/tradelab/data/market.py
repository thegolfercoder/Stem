"""The panel of prices, and the windowed view a strategy is allowed to see.

``MarketView`` is the single most important class in this repository. Every
number a strategy sees comes through it, and it cannot return a value dated
later than the bar it was constructed for. That is what makes look-ahead bias a
structural impossibility here rather than a thing you have to remember not to
do. ``tests/test_no_lookahead.py`` is the proof.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from tradelab._pandas import cell, datetime_index
from tradelab.types import Bar

FIELDS: Final = ("open", "high", "low", "close", "volume")


class LookAheadError(RuntimeError):
    """Raised when something asks a view for data it is not entitled to see."""


@dataclass(frozen=True)
class MarketData:
    """A time-aligned panel of OHLCV data for one or more symbols.

    Stored one wide frame per field (rows are timestamps, columns are symbols)
    rather than one frame per symbol, because every hot path in the engine wants
    a cross-section of all symbols at one timestamp.
    """

    frames: dict[str, pd.DataFrame]

    def __post_init__(self) -> None:
        missing = set(FIELDS) - set(self.frames)
        if missing:
            raise ValueError(f"market data is missing fields: {sorted(missing)}")
        reference = self.frames["close"]
        for field, frame in self.frames.items():
            if not frame.index.equals(reference.index):
                raise ValueError(f"field {field!r} is not aligned on the shared index")
            if list(frame.columns) != list(reference.columns):
                raise ValueError(f"field {field!r} does not carry the same symbols")
        if not reference.index.is_monotonic_increasing:
            raise ValueError("the index must be sorted ascending in time")
        if reference.index.has_duplicates:
            raise ValueError("the index contains duplicate timestamps")

    @classmethod
    def from_symbol_frames(cls, tables: dict[str, pd.DataFrame]) -> MarketData:
        """Build a panel from ``{symbol: ohlcv frame}``.

        Symbols are outer-joined onto the union of their timestamps. A symbol
        with no observation at a timestamp is left as NaN rather than forward
        filled: the engine treats NaN as "not tradable at this bar", and
        silently inventing a price for a day an instrument did not trade is
        exactly the sort of quiet fabrication this framework is built to avoid.
        """
        if not tables:
            raise ValueError("no symbols supplied")
        symbols = sorted(tables)
        index = tables[symbols[0]].index
        for symbol in symbols[1:]:
            index = index.union(tables[symbol].index)
        frames = {
            field: pd.DataFrame(
                {symbol: tables[symbol][field].reindex(index) for symbol in symbols},
                index=index,
            ).astype("float64")
            for field in FIELDS
        }
        return cls(frames=frames)

    @property
    def index(self) -> pd.DatetimeIndex:
        return datetime_index(self.frames["close"].index)

    @property
    def symbols(self) -> list[str]:
        return [str(column) for column in self.frames["close"].columns]

    def __len__(self) -> int:
        return len(self.index)

    def field(self, name: str) -> pd.DataFrame:
        if name not in self.frames:
            raise KeyError(f"unknown field {name!r}; have {sorted(self.frames)}")
        return self.frames[name]

    def view(self, position: int) -> MarketView:
        """The view a strategy gets at bar ``position``."""
        return MarketView(self, position)

    def slice(self, start: pd.Timestamp | None, end: pd.Timestamp | None) -> MarketData:
        """A closed-interval date slice, used to separate development from test data."""
        mask = np.ones(len(self.index), dtype=bool)
        if start is not None:
            mask &= self.index >= start
        if end is not None:
            mask &= self.index <= end
        return MarketData(frames={name: frame.loc[mask] for name, frame in self.frames.items()})

    def bar(self, position: int, symbol: str) -> Bar:
        return Bar(
            ts=self.index[position],
            symbol=symbol,
            open=cell(self.frames["open"], position, self.column_index(symbol)),
            high=cell(self.frames["high"], position, self.column_index(symbol)),
            low=cell(self.frames["low"], position, self.column_index(symbol)),
            close=cell(self.frames["close"], position, self.column_index(symbol)),
            volume=cell(self.frames["volume"], position, self.column_index(symbol)),
        )

    def column_index(self, symbol: str) -> int:
        """Integer position of a symbol in the panel's columns."""
        try:
            return self.symbols.index(symbol)
        except ValueError as exc:  # pragma: no cover - defensive
            raise KeyError(f"unknown symbol {symbol!r}") from exc


class MarketView:
    """Everything visible to a strategy at one point in time, and nothing else.

    A view is constructed for bar ``position``. Every accessor returns data up
    to *and including* that bar. There is no accessor that returns a later value
    and no way to reach the underlying panel, so a strategy cannot read
    tomorrow's price even by accident.

    The engine additionally executes the orders a strategy produces at the
    *next* bar's open, so even the current bar's close - which the strategy is
    allowed to see - is not a price it can trade at.
    """

    __slots__ = ("_data", "_position")

    def __init__(self, data: MarketData, position: int) -> None:
        if not 0 <= position < len(data):
            raise IndexError(f"position {position} is outside the panel")
        self._data = data
        self._position = position

    @property
    def position(self) -> int:
        """The integer offset of the current bar in the full panel."""
        return self._position

    @property
    def now(self) -> pd.Timestamp:
        """The timestamp of the current bar."""
        return self._data.index[self._position]

    @property
    def symbols(self) -> list[str]:
        return self._data.symbols

    def bar(self, symbol: str) -> Bar:
        """The current bar for one symbol."""
        return self._data.bar(self._position, symbol)

    def price(self, symbol: str) -> float:
        """The current close. NaN when the symbol did not trade at this bar."""
        return cell(self._data.frames["close"], self._position, self._data.column_index(symbol))

    def prices(self) -> pd.Series:
        """The cross-section of current closes, indexed by symbol."""
        return self._data.frames["close"].iloc[self._position].copy()

    def history(self, field: str = "close", lookback: int | None = None) -> pd.DataFrame:
        """A wide frame of one field, ending at the current bar.

        ``lookback`` trims to the most recent N bars. Asking for more history
        than exists returns what there is rather than raising, so a strategy's
        warm-up logic stays in one place - its ``warmup`` declaration - instead
        of being duplicated as defensive checks in every indicator.
        """
        frame = self._data.field(field).iloc[: self._position + 1]
        if lookback is not None:
            if lookback <= 0:
                raise ValueError("lookback must be positive")
            frame = frame.iloc[-lookback:]
        return frame.copy()

    def series(self, symbol: str, field: str = "close", lookback: int | None = None) -> pd.Series:
        """One symbol's history of one field, ending at the current bar.

        Selects the column before slicing rather than after. Going through
        ``history`` would copy every symbol's window to return one of them,
        which on the per-bar hot path costs proportionally to the size of the
        universe for no reason.
        """
        if lookback is not None and lookback <= 0:
            raise ValueError("lookback must be positive")
        column = self._data.field(field)[symbol]
        end = self._position + 1
        start = max(0, end - lookback) if lookback is not None else 0
        return column.iloc[start:end].copy()

    def ohlcv(self, symbol: str, lookback: int | None = None) -> pd.DataFrame:
        """One symbol's full OHLCV history, ending at the current bar."""
        return pd.DataFrame(
            {field: self.series(symbol, field, lookback) for field in FIELDS},
        )

    def tradable(self) -> Sequence[str]:
        """Symbols with a usable price at the current bar."""
        prices = self.prices()
        return [str(symbol) for symbol in prices.index[prices.notna()]]

    def __repr__(self) -> str:
        return f"MarketView(now={self.now.date()}, bars_visible={self._position + 1})"
