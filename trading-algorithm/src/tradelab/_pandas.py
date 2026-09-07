"""Narrow, typed accessors over pandas.

``DataFrame.iat`` is declared as returning a union of a dozen types, because in
general a frame can hold anything. Every frame in this package is float64 by
construction - ``MarketData`` enforces it - so wrapping the two or three
accessors that appear on the hot path is cheaper than casting at forty call
sites, and keeps the type checker useful rather than suppressed.

These are deliberately not re-exported from the package: they are plumbing.
"""

from __future__ import annotations

from typing import Any, cast

import pandas as pd


def as_float(value: Any) -> float:
    """A scalar out of a pandas container, as a float."""
    return float(value)


def cell(frame: pd.DataFrame, row: int, column: int) -> float:
    """One cell of a numeric frame by integer position."""
    return as_float(frame.iat[row, column])


def column_position(frame: pd.DataFrame, name: str) -> int:
    """Integer position of a named column.

    ``Index.get_loc`` may return a slice or a boolean mask when the index has
    duplicates. The panels here never do - ``MarketData`` rejects them - so
    anything other than an integer is a bug rather than a case to handle.
    """
    position = frame.columns.get_loc(name)
    if not isinstance(position, int):  # pragma: no cover - defensive
        raise KeyError(f"column {name!r} is not unique in this frame")
    return position


def datetime_index(index: pd.Index) -> pd.DatetimeIndex:
    """Assert an index is a DatetimeIndex, and say so if it is not."""
    if not isinstance(index, pd.DatetimeIndex):
        raise TypeError(f"expected a DatetimeIndex, got {type(index).__name__}")
    return index


def float_series(series: Any) -> pd.Series:
    """Identity, but typed - for the places a stub loses the element type."""
    return cast(pd.Series, series)
