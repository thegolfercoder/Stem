"""Reading historical data off disk.

CSV and Parquet, one file per symbol. The column names the loader expects are
listed in ``data/README.md`` along with what to do if your provider uses
different ones.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from tradelab.data.market import MarketData
from tradelab.data.validation import QualityReport, validate_ohlcv

_ALIASES: dict[str, str] = {
    "date": "ts",
    "datetime": "ts",
    "timestamp": "ts",
    "time": "ts",
    "adj close": "close",
    "adj_close": "close",
    "adjusted_close": "close",
    "vol": "volume",
}


def _normalise_columns(frame: pd.DataFrame) -> pd.DataFrame:
    renamed = {}
    for column in frame.columns:
        key = str(column).strip().lower()
        renamed[column] = _ALIASES.get(key, key)
    return frame.rename(columns=renamed)


def load_table(path: Path | str, *, timestamp_column: str = "ts") -> pd.DataFrame:
    """Read one symbol's OHLCV file into a timestamp-indexed frame.

    ``.csv``, ``.csv.gz``, ``.parquet`` and ``.pq`` are recognised. Column names
    are lower-cased and a few common provider spellings are mapped onto the
    canonical ones - notably that an ``adj close`` column becomes ``close``,
    because a backtest wants the total-return series, not the raw print.
    """
    path = Path(path)
    suffixes = {suffix.lower() for suffix in path.suffixes}
    if {".parquet", ".pq"} & suffixes:
        frame = pd.read_parquet(path)
    elif ".csv" in suffixes:
        frame = pd.read_csv(path)
    else:
        raise ValueError(f"unsupported file type: {path.name}")

    frame = _normalise_columns(frame)
    if timestamp_column not in frame.columns:
        if frame.index.name and str(frame.index.name).lower() in {"ts", "date", "datetime"}:
            frame = frame.reset_index()
            frame = _normalise_columns(frame)
        else:
            raise ValueError(f"{path.name}: no {timestamp_column!r} column found")

    frame[timestamp_column] = pd.to_datetime(frame[timestamp_column], utc=False)
    frame = frame.set_index(timestamp_column).sort_index()
    frame.index.name = "ts"
    keep = [c for c in ("open", "high", "low", "close", "volume") if c in frame.columns]
    return frame[keep].astype("float64")


def load_frame(
    path: Path | str,
    *,
    symbol: str | None = None,
    validate: bool = True,
) -> tuple[str, pd.DataFrame, QualityReport | None]:
    """Load one file and, unless told otherwise, validate it."""
    path = Path(path)
    name = symbol or path.name.split(".")[0].upper()
    frame = load_table(path)
    report = validate_ohlcv(frame, symbol=name) if validate else None
    return name, frame, report


def load_directory(
    directory: Path | str,
    *,
    symbols: list[str] | None = None,
    pattern: str = "*",
    validate: bool = True,
) -> tuple[MarketData, list[QualityReport]]:
    """Load every recognised file in a directory into one aligned panel.

    The symbol name is the file stem, upper-cased: ``data/sample/msft.csv``
    becomes ``MSFT``. Pass ``symbols`` to load a subset.
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise NotADirectoryError(f"{directory} is not a directory")

    tables: dict[str, pd.DataFrame] = {}
    reports: list[QualityReport] = []
    wanted = {s.upper() for s in symbols} if symbols else None

    candidates = sorted(
        p
        for p in directory.glob(pattern)
        if p.is_file() and {".csv", ".parquet", ".pq"} & {s.lower() for s in p.suffixes}
    )
    for path in candidates:
        name, frame, report = load_frame(path, validate=validate)
        if wanted is not None and name not in wanted:
            continue
        tables[name] = frame
        if report is not None:
            reports.append(report)

    if not tables:
        raise FileNotFoundError(f"no usable data files in {directory}")
    if wanted is not None:
        missing = wanted - set(tables)
        if missing:
            raise FileNotFoundError(
                f"requested symbols not found in {directory}: {sorted(missing)}"
            )

    return MarketData.from_symbol_frames(tables), reports
