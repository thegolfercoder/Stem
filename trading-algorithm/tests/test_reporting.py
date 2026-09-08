"""Tear sheets and charts. Cheap tests, but a broken report is a broken deliverable."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from tradelab.analytics import plots
from tradelab.analytics.metrics import summarise
from tradelab.analytics.tearsheet import comparison_table, format_summary, report, to_markdown
from tradelab.backtesting.engine import BacktestConfig, run_backtest
from tradelab.data.market import MarketData
from tradelab.strategies.benchmarks import BuyAndHold
from tradelab.strategies.trend import MovingAverageCrossover


@pytest.fixture(scope="module")
def result(panel: MarketData) -> object:
    return run_backtest(panel, MovingAverageCrossover(fast=20, slow=60), config=BacktestConfig())


def test_a_report_carries_its_assumptions(result: object) -> None:
    """A performance table with no cost model beside it is not a result."""
    text = report(result, title="check")
    assert "check" in text
    assert "Assumptions" in text
    assert "commission:" in text
    assert "slippage:" in text
    assert "strategy parameters:" in text


def test_a_summary_prints_every_headline_number(result: object) -> None:
    text = format_summary(summarise(result))
    for label in ("CAGR", "Sharpe ratio", "Maximum drawdown", "Win rate", "Profit factor"):
        assert label in text


def test_missing_values_print_as_words_not_as_nan(panel: MarketData) -> None:
    """`nan` in a table reads as a bug. `n/a` reads as an answer."""
    from tradelab.strategies.benchmarks import Flat

    text = format_summary(summarise(run_backtest(panel, Flat())))
    assert "nan" not in text.lower()
    assert "n/a" in text


def test_comparison_table_has_one_row_per_run(panel: MarketData) -> None:
    summaries = {
        "trend": summarise(run_backtest(panel, MovingAverageCrossover(fast=20, slow=60))),
        "hold": summarise(run_backtest(panel, BuyAndHold())),
    }
    table = comparison_table(summaries)
    assert list(table.index) == ["trend", "hold"]
    assert "sharpe_ratio" in table.columns


def test_markdown_tables_are_rectangular() -> None:
    frame = pd.DataFrame({"a": [1.0, float("nan")], "b": [3.5, 4.25]}, index=["x", "y"])
    frame.index.name = "row"
    lines = to_markdown(frame).splitlines()
    assert len(lines) == 4
    assert len({line.count("|") for line in lines}) == 1
    assert "n/a" in lines[3]


def test_charts_render_and_save(result: object, tmp_path: Path) -> None:
    curve = result.equity_curve["equity"]  # type: ignore[attr-defined]
    saved = [
        plots.save(plots.equity_curves({"strategy": curve}), tmp_path / "equity.png"),
        plots.save(plots.return_distribution(curve.pct_change().dropna()), tmp_path / "dist.png"),
        plots.save(plots.exposure_chart(result.equity_curve), tmp_path / "exposure.png"),  # type: ignore[attr-defined]
    ]
    for path in saved:
        assert path.exists()
        assert path.stat().st_size > 1000


def test_charts_do_not_need_a_display() -> None:
    """The CI runner has no display; matplotlib must already be on a headless backend."""
    import matplotlib

    assert matplotlib.get_backend().lower() == "agg"


def test_equity_chart_handles_a_curve_that_never_moves() -> None:
    index = pd.bdate_range("2020-01-01", periods=50, name="ts")
    flat = pd.Series(np.full(len(index), 100_000.0), index=index)
    figure = plots.equity_curves({"flat": flat})
    assert figure is not None
