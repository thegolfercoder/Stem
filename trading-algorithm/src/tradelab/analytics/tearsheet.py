"""Rendering a run as text.

The tear sheet always prints the assumptions next to the results. A performance
table without the cost model, the sizing rule and the sample period beside it is
not a result anybody can check, and separating the two is how a number ends up
quoted somewhere with its caveats stripped off.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

import numpy as np
import pandas as pd

from tradelab.analytics.metrics import PerformanceSummary, summarise

_LAYOUT: tuple[tuple[str, str, str], ...] = (
    ("Return", "total_return", "percent"),
    ("CAGR", "cagr", "percent"),
    ("Annualised volatility", "annualised_volatility", "percent"),
    ("Sharpe ratio", "sharpe_ratio", "ratio"),
    ("  standard error", "sharpe_standard_error", "ratio"),
    ("Sortino ratio", "sortino_ratio", "ratio"),
    ("Calmar ratio", "calmar_ratio", "ratio"),
    ("Maximum drawdown", "max_drawdown", "percent"),
    ("Trades", "trades", "count"),
    ("Win rate", "win_rate", "percent"),
    ("Profit factor", "profit_factor", "ratio"),
    ("Payoff ratio", "payoff_ratio", "ratio"),
    ("Average trade PnL", "average_trade_pnl", "money"),
    ("Exposure (bars with a position)", "exposure", "percent"),
    ("Average gross exposure", "average_gross_exposure", "percent"),
    ("Annualised turnover", "annualised_turnover", "ratio"),
    ("Return skew", "skew", "ratio"),
    ("Excess kurtosis", "excess_kurtosis", "ratio"),
    ("Lag-1 autocorrelation", "return_autocorrelation", "ratio"),
    ("P(Sharpe > 0)", "probabilistic_sharpe_ratio", "percent"),
    ("Commission paid", "total_commission", "money"),
    ("Slippage paid", "total_slippage", "money"),
)


def _format(value: object, kind: str) -> str:
    if value is None:
        return "-"
    if not isinstance(value, int | float | np.integer | np.floating):
        return str(value)
    number = float(value)
    if not np.isfinite(number):
        return "inf" if number == float("inf") else "n/a"
    if kind == "percent":
        return f"{number:.2%}"
    if kind == "ratio":
        return f"{number:.2f}"
    if kind == "money":
        return f"{number:,.0f}"
    return f"{int(number)}"


def format_summary(summary: PerformanceSummary, *, title: str = "") -> str:
    """One run as an aligned key-value block."""
    lines: list[str] = []
    if title:
        lines += [title, "=" * len(title)]
    lines.append(
        f"{summary.start.date()} to {summary.end.date()}  "
        f"({summary.bars} bars, {summary.periods_per_year}/year)"
    )
    lines.append("")
    width = max(len(label) for label, _, _ in _LAYOUT)
    for label, attribute, kind in _LAYOUT:
        lines.append(f"{label:<{width}}  {_format(getattr(summary, attribute), kind):>12}")

    drawdown_note = (
        f"never recovered by {summary.end.date()}"
        if summary.max_drawdown_recovered is None
        else f"recovered {summary.max_drawdown_recovered.date()}"
    )
    if summary.max_drawdown_peak is not None and summary.max_drawdown_trough is not None:
        lines.append("")
        lines.append(
            f"Worst drawdown ran {summary.max_drawdown_peak.date()} -> "
            f"{summary.max_drawdown_trough.date()}, {drawdown_note}."
        )
    return "\n".join(lines)


def comparison_table(
    summaries: dict[str, PerformanceSummary],
    *,
    columns: Sequence[str] = (
        "cagr",
        "annualised_volatility",
        "sharpe_ratio",
        "sortino_ratio",
        "max_drawdown",
        "win_rate",
        "profit_factor",
        "trades",
        "exposure",
        "probabilistic_sharpe_ratio",
    ),
) -> pd.DataFrame:
    """Several runs side by side, one row each."""
    return pd.DataFrame(
        {
            name: {column: getattr(summary, column) for column in columns}
            for name, summary in summaries.items()
        }
    ).T


def to_markdown(frame: pd.DataFrame, *, float_format: str = "{:.3f}") -> str:
    """A markdown table, without pulling in the optional tabulate dependency."""
    formatted = frame.copy()
    for column in formatted.columns:
        if pd.api.types.is_float_dtype(formatted[column]):
            formatted[column] = formatted[column].map(
                lambda value: "n/a" if not np.isfinite(value) else float_format.format(value)
            )
        else:
            formatted[column] = formatted[column].astype(str)

    headers = [str(formatted.index.name or "")] + [str(column) for column in formatted.columns]
    widths = [
        max(len(headers[0]), *(len(str(index)) for index in formatted.index)),
        *(
            max(len(str(column)), *(len(value) for value in formatted[column]))
            for column in formatted.columns
        ),
    ]
    rows = [
        "| "
        + " | ".join(header.ljust(width) for header, width in zip(headers, widths, strict=True))
        + " |",
        "| " + " | ".join("-" * width for width in widths) + " |",
    ]
    for index, row in formatted.iterrows():
        cells = [str(index).ljust(widths[0])]
        cells += [
            str(row[column]).rjust(width)
            for column, width in zip(formatted.columns, widths[1:], strict=True)
        ]
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


def report(result: object, *, title: str = "", risk_free_rate: float = 0.0) -> str:
    """A full tear sheet: performance, then the assumptions that produced it."""
    summary = summarise(result, risk_free_rate=risk_free_rate)
    assumptions: Iterable[str] = getattr(result, "assumptions")()  # noqa: B009
    strategy = getattr(result, "strategy", "?")
    parameters = getattr(result, "strategy_parameters", {})

    sections = [format_summary(summary, title=title or f"strategy: {strategy}")]
    sections.append("")
    sections.append("Assumptions")
    sections.append("-----------")
    sections.append(f"strategy parameters: {parameters}")
    sections.extend(assumptions)

    rejections = getattr(result, "rejections", [])
    truncated = getattr(result, "truncated_orders", 0)
    if rejections or truncated:
        sections.append("")
        sections.append("Execution notes")
        sections.append("---------------")
        if rejections:
            sections.append(f"{len(rejections)} order(s) rejected for want of a tradable price")
        if truncated:
            sections.append(f"{truncated} order(s) truncated by the participation cap")
    return "\n".join(sections)
