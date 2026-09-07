"""The view is the look-ahead barrier. These tests describe exactly what it exposes."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from tradelab._pandas import as_float, cell
from tradelab.data.market import MarketData, MarketView


def test_view_ends_at_its_own_bar(panel: MarketData) -> None:
    view = panel.view(100)
    assert view.now == panel.index[100]
    for field in ("open", "high", "low", "close", "volume"):
        history = view.history(field)
        assert len(history) == 101
        assert history.index[-1] == panel.index[100]


def test_view_series_matches_the_panel_exactly(panel: MarketData) -> None:
    view = panel.view(250)
    expected = panel.field("close")["AAA"].iloc[:251]
    pd.testing.assert_series_equal(view.series("AAA"), expected)


def test_lookback_trims_from_the_recent_end(panel: MarketData) -> None:
    view = panel.view(300)
    window = view.series("BBB", lookback=20)
    assert len(window) == 20
    assert window.index[-1] == panel.index[300]
    assert window.index[0] == panel.index[281]


def test_lookback_longer_than_history_returns_what_exists(panel: MarketData) -> None:
    view = panel.view(5)
    assert len(view.series("AAA", lookback=500)) == 6


def test_zero_or_negative_lookback_is_an_error(panel: MarketData) -> None:
    view = panel.view(10)
    with pytest.raises(ValueError, match="lookback must be positive"):
        view.series("AAA", lookback=0)
    with pytest.raises(ValueError, match="lookback must be positive"):
        view.history("close", lookback=-3)


def test_view_outside_the_panel_is_an_error(panel: MarketData) -> None:
    with pytest.raises(IndexError):
        MarketView(panel, len(panel))
    with pytest.raises(IndexError):
        MarketView(panel, -1)


def test_mutating_what_the_view_returned_cannot_reach_the_panel(panel: MarketData) -> None:
    """A strategy that edits its own copy must not corrupt the run."""
    before = cell(panel.field("close"), 50, 0)
    view = panel.view(50)

    borrowed_series = view.series("AAA")
    borrowed_series.iloc[-1] = 1e9
    borrowed_frame = view.history("close")
    borrowed_frame.iloc[-1, 0] = 1e9

    assert cell(panel.field("close"), 50, 0) == before
    assert as_float(view.series("AAA").iloc[-1]) == before


def test_tradable_excludes_symbols_with_no_price() -> None:
    index = pd.bdate_range("2021-01-01", periods=10, name="ts")
    good = pd.DataFrame(
        {"open": 10.0, "high": 10.0, "low": 10.0, "close": 10.0, "volume": 1000.0}, index=index
    )
    patchy = good.copy()
    patchy.loc[patchy.index[5], :] = np.nan
    data = MarketData.from_symbol_frames({"GOOD": good, "PATCHY": patchy})
    assert set(data.view(4).tradable()) == {"GOOD", "PATCHY"}
    assert set(data.view(5).tradable()) == {"GOOD"}


def test_panel_rejects_unsorted_or_duplicated_timestamps() -> None:
    index = pd.DatetimeIndex(["2021-01-04", "2021-01-04"], name="ts")
    frame = pd.DataFrame(
        {"open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0}, index=index
    )
    with pytest.raises(ValueError, match="duplicate timestamps"):
        MarketData.from_symbol_frames({"DUP": frame})
