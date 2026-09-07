"""Checks that run before any bar reaches the engine.

A backtest on bad data is worse than no backtest, because it produces a number
that looks like a result. Every problem found here is either fatal or reported;
nothing is silently repaired.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume")


class DataQualityError(ValueError):
    """Raised for a defect that makes a backtest meaningless."""


@dataclass
class QualityReport:
    """What was found. Fatal problems raise; the rest are for the operator to weigh."""

    symbol: str
    rows: int
    first: pd.Timestamp | None
    last: pd.Timestamp | None
    warnings: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        if self.first is None or self.last is None:
            span = "empty"
        else:
            span = f"{self.first.date()}..{self.last.date()}"
        head = f"{self.symbol}: {self.rows} rows, {span}"
        if not self.warnings:
            return head + ", no warnings"
        return head + "\n  - " + "\n  - ".join(self.warnings)


def validate_ohlcv(
    frame: pd.DataFrame,
    *,
    symbol: str = "?",
    max_return: float = 0.5,
    allow_zero_volume: bool = True,
) -> QualityReport:
    """Validate one symbol's OHLCV table.

    Fatal (raises ``DataQualityError``):

    * a missing required column, or a column that is not numeric
    * a non-monotonic or duplicated index
    * a non-positive price
    * ``high < low``, or a close outside the bar's own high-low range

    Reported as warnings, because whether they matter depends on the instrument:
    gaps in the calendar, single-bar returns beyond ``max_return``, runs of
    identical closes, and zero-volume bars.
    """
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise DataQualityError(f"{symbol}: missing columns {missing}")
    if not isinstance(frame.index, pd.DatetimeIndex):
        raise DataQualityError(f"{symbol}: the index must be a DatetimeIndex")
    if not frame.index.is_monotonic_increasing:
        raise DataQualityError(f"{symbol}: the index is not sorted ascending")
    if frame.index.has_duplicates:
        duplicates = frame.index[frame.index.duplicated()][:3].tolist()
        raise DataQualityError(f"{symbol}: duplicate timestamps, first few {duplicates}")

    for column in REQUIRED_COLUMNS:
        if not pd.api.types.is_numeric_dtype(frame[column]):
            raise DataQualityError(f"{symbol}: column {column!r} is not numeric")

    prices = frame[["open", "high", "low", "close"]]
    if bool((prices.to_numpy() <= 0).any()):
        raise DataQualityError(f"{symbol}: a price is zero or negative")
    if bool((frame["high"] < frame["low"]).any()):
        raise DataQualityError(f"{symbol}: high is below low on at least one bar")
    outside = (frame["close"] > frame["high"]) | (frame["close"] < frame["low"])
    if bool(outside.any()):
        where = frame.index[outside][:3].tolist()
        raise DataQualityError(f"{symbol}: close outside the bar range, first few {where}")
    if bool((frame["volume"] < 0).any()):
        raise DataQualityError(f"{symbol}: negative volume")

    report = QualityReport(
        symbol=symbol,
        rows=len(frame),
        first=frame.index[0] if len(frame) else None,
        last=frame.index[-1] if len(frame) else None,
    )
    if len(frame) < 2:
        return report

    returns = frame["close"].pct_change().abs()
    extreme = int((returns > max_return).sum())
    if extreme:
        worst = float(returns.max())
        report.warnings.append(
            f"{extreme} bar(s) move more than {max_return:.0%} (largest {worst:.1%}); "
            "check for an unadjusted split or a bad print"
        )

    gaps = frame.index.to_series().diff().dropna()
    if len(gaps):
        typical = gaps.median()
        long_gaps = int((gaps > typical * 5).sum())
        if long_gaps:
            report.warnings.append(
                f"{long_gaps} gap(s) longer than five times the median spacing of {typical}"
            )

    flat = frame["close"].diff() == 0
    longest_flat = int(flat.groupby((~flat).cumsum()).sum().max()) if len(flat) else 0
    if longest_flat >= 5:
        report.warnings.append(
            f"a run of {longest_flat} bars with an unchanged close; the series may be stale"
        )

    zero_volume = int((frame["volume"] == 0).sum())
    if zero_volume and not allow_zero_volume:
        raise DataQualityError(f"{symbol}: {zero_volume} bar(s) with zero volume")
    if zero_volume:
        report.warnings.append(f"{zero_volume} bar(s) with zero volume")

    if bool(np.isnan(frame[list(REQUIRED_COLUMNS)].to_numpy()).any()):
        report.warnings.append("contains NaN; those bars will be treated as untradable")

    return report
