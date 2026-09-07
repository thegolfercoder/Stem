"""Loading, validating and splitting."""

from __future__ import annotations

import itertools
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from tradelab.data.loaders import load_directory, load_table
from tradelab.data.market import MarketData
from tradelab.data.splits import Fold, Split, date_split, walk_forward
from tradelab.data.synthetic import DEFAULT_SPECS, SymbolSpec, generate_panel
from tradelab.data.validation import DataQualityError, validate_ohlcv


def good_frame(rows: int = 40) -> pd.DataFrame:
    index = pd.bdate_range("2021-01-04", periods=rows, name="ts")
    close = 100.0 + np.arange(rows) * 0.5
    return pd.DataFrame(
        {
            "open": close - 0.2,
            "high": close + 0.6,
            "low": close - 0.7,
            "close": close,
            "volume": 1_000_000.0,
        },
        index=index,
    )


def test_a_clean_frame_passes_with_no_warnings() -> None:
    report = validate_ohlcv(good_frame(), symbol="OK")
    assert report.warnings == []
    assert report.rows == 40


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda f: f.drop(columns=["volume"]), "missing columns"),
        (lambda f: f.iloc[::-1], "not sorted"),
        (lambda f: pd.concat([f, f.iloc[[0]]]).sort_index(), "duplicate timestamps"),
        (
            lambda f: f.assign(close=f["close"].mask(f.index == f.index[3], -1.0)),
            "zero or negative",
        ),
        (lambda f: f.assign(high=f["low"] - 1.0), "high is below low"),
        (lambda f: f.assign(close=f["high"] + 5.0), "close outside the bar range"),
        (lambda f: f.assign(volume=-1.0), "negative volume"),
    ],
)
def test_fatal_defects_raise(mutate: object, message: str) -> None:
    with pytest.raises(DataQualityError, match=message):
        validate_ohlcv(mutate(good_frame()), symbol="BAD")  # type: ignore[operator]


def test_an_unadjusted_split_is_reported_as_a_warning_not_silently_accepted() -> None:
    frame = good_frame()
    frame.iloc[20:] = frame.iloc[20:] / 3.0
    report = validate_ohlcv(frame, symbol="SPLIT")
    assert any("move more than" in warning for warning in report.warnings)


def test_a_stale_series_is_reported() -> None:
    frame = good_frame()
    frame.iloc[10:20] = frame.iloc[10].to_numpy()
    report = validate_ohlcv(frame, symbol="STALE")
    assert any("unchanged close" in warning for warning in report.warnings)


def test_column_aliases_are_recognised(tmp_path: Path) -> None:
    frame = (
        good_frame()
        .reset_index()
        .rename(columns={"ts": "Date", "close": "Adj Close", "volume": "Vol"})
    )
    path = tmp_path / "aapl.csv"
    frame.to_csv(path, index=False)
    loaded = load_table(path)
    assert list(loaded.columns) == ["open", "high", "low", "close", "volume"]
    assert isinstance(loaded.index, pd.DatetimeIndex)


def test_loading_a_directory_names_symbols_after_the_files(tmp_path: Path) -> None:
    for name in ("aaa", "bbb"):
        good_frame().to_csv(tmp_path / f"{name}.csv")
    data, reports = load_directory(tmp_path)
    assert data.symbols == ["AAA", "BBB"]
    assert len(reports) == 2


def test_requesting_a_symbol_that_is_not_there_is_an_error(tmp_path: Path) -> None:
    good_frame().to_csv(tmp_path / "aaa.csv")
    with pytest.raises(FileNotFoundError, match="not found"):
        load_directory(tmp_path, symbols=["AAA", "ZZZ"])


def test_an_empty_directory_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_directory(tmp_path)


def test_symbols_are_outer_joined_and_gaps_left_as_nan() -> None:
    long = good_frame(40)
    short = good_frame(40).iloc[10:]
    data = MarketData.from_symbol_frames({"LONG": long, "SHORT": short})
    assert len(data) == 40
    assert bool(data.field("close")["SHORT"].iloc[:10].isna().all())


def test_date_split_puts_the_boundary_bar_in_development() -> None:
    index = pd.bdate_range("2015-01-01", periods=500, name="ts")
    development, out_of_sample = date_split(index, "2016-01-04")
    assert development.end == pd.Timestamp("2016-01-04")
    assert out_of_sample.start > development.end


def test_a_split_with_an_empty_side_is_an_error() -> None:
    index = pd.bdate_range("2015-01-01", periods=100, name="ts")
    with pytest.raises(ValueError, match="no bars after"):
        date_split(index, "2030-01-01")
    with pytest.raises(ValueError, match="no bars on or before"):
        date_split(index, "2000-01-01")


def test_walk_forward_folds_never_overlap_and_always_move_forward() -> None:
    index = pd.bdate_range("2015-01-01", periods=1000, name="ts")
    folds = walk_forward(index, train_bars=250, test_bars=125)
    assert len(folds) > 1
    for fold in folds:
        assert fold.train.end < fold.test.start
    for earlier, later in itertools.pairwise(folds):
        assert later.test.start > earlier.test.start


def test_anchored_walk_forward_grows_the_training_window() -> None:
    index = pd.bdate_range("2015-01-01", periods=1000, name="ts")
    folds = walk_forward(index, train_bars=250, test_bars=125, anchored=True)
    assert all(fold.train.start == folds[0].train.start for fold in folds)
    assert folds[-1].train.end > folds[0].train.end


def test_walk_forward_drops_a_partial_final_window() -> None:
    index = pd.bdate_range("2015-01-01", periods=400, name="ts")
    folds = walk_forward(index, train_bars=250, test_bars=100)
    assert len(folds) == 1


def test_walk_forward_needs_enough_bars() -> None:
    index = pd.bdate_range("2015-01-01", periods=50, name="ts")
    with pytest.raises(ValueError, match="not enough"):
        walk_forward(index, train_bars=250, test_bars=125)


def test_a_fold_that_trains_on_its_own_test_window_cannot_be_constructed() -> None:
    early = Split("train", pd.Timestamp("2020-01-01"), pd.Timestamp("2020-06-01"))
    overlapping = Split("test", pd.Timestamp("2020-03-01"), pd.Timestamp("2020-09-01"))
    with pytest.raises(ValueError, match="test window starts"):
        Fold(index=0, train=early, test=overlapping)


def test_the_synthetic_generator_is_deterministic() -> None:
    first = generate_panel(start="2020-01-01", end="2020-12-31", seed=99)
    second = generate_panel(start="2020-01-01", end="2020-12-31", seed=99)
    for symbol, frame in first.items():
        pd.testing.assert_frame_equal(frame, second[symbol])


def test_a_different_seed_gives_a_different_market() -> None:
    first = generate_panel(start="2020-01-01", end="2020-12-31", seed=1)
    second = generate_panel(start="2020-01-01", end="2020-12-31", seed=2)
    assert not first["SYN_TREND"]["close"].equals(second["SYN_TREND"]["close"])


def test_generated_bars_are_internally_consistent() -> None:
    for symbol, frame in generate_panel(start="2019-01-01", end="2021-12-31").items():
        validate_ohlcv(frame, symbol=symbol)  # raises on any structural defect


def test_the_generator_hits_its_stated_targets_within_sampling_error() -> None:
    """The specs claim an unconditional CAGR and volatility. Check they are true.

    The tolerances are wide because they have to be: sixteen years of an
    18%-volatility series has a standard error on its annualised return of
    roughly 4.5 percentage points. A tight tolerance here would be a test that
    fails whenever the seed changes, which is worse than no test.
    """
    from tradelab.analytics.metrics import annualised_volatility, cagr, to_returns

    panel = generate_panel(start="2010-01-04", end="2025-12-31")
    specs = {spec.name: spec for spec in DEFAULT_SPECS}
    for name, frame in panel.items():
        spec = specs[name]
        assert cagr(frame["close"]) == pytest.approx(spec.annual_return, abs=0.06)
        assert annualised_volatility(to_returns(frame["close"])) == pytest.approx(
            spec.annual_vol, rel=0.20
        )


def test_the_generator_produces_the_autocorrelation_it_claims() -> None:
    panel = generate_panel(start="2010-01-04", end="2025-12-31")
    specs = {spec.name: spec for spec in DEFAULT_SPECS}
    for name, frame in panel.items():
        observed = float(np.log(frame["close"]).diff().dropna().autocorr(lag=1))
        assert observed == pytest.approx(specs[name].ar1, abs=0.035)


def test_a_non_stationary_specification_is_rejected() -> None:
    with pytest.raises(ValueError, match="stationary"):
        SymbolSpec(name="X", annual_return=0.05, annual_vol=0.2, ar1=0.99)
