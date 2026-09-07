"""Separating the data you are allowed to iterate on from the data you are not.

The single largest source of fake backtest results is testing an idea, changing
it, and testing it again on the same bars. Nothing in code can stop a person
doing that, but it can make the boundary explicit and make crossing it a
deliberate act rather than an oversight.

The convention this repository uses:

* **Development** - the early portion of history. Look at it as much as you
  like. Fit parameters here, plot here, change your mind here.
* **Out-of-sample** - the tail. Every evaluation on it is a draw from the same
  multiple-testing budget, so ``analytics.multiple_testing`` exists to discount
  the result by how many draws you have taken.

``walk_forward`` is the middle path: parameters are refit on a rolling window
and only ever applied forward, so every out-of-sample bar is scored by a model
that could not have seen it.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Split:
    """A named, closed date interval."""

    name: str
    start: pd.Timestamp
    end: pd.Timestamp

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise ValueError(f"split {self.name!r} starts after it ends")

    def mask(self, index: pd.DatetimeIndex) -> pd.Series:
        return pd.Series((index >= self.start) & (index <= self.end), index=index)

    def __str__(self) -> str:
        return f"{self.name} [{self.start.date()} .. {self.end.date()}]"


@dataclass(frozen=True)
class Fold:
    """One train/test pair of a walk-forward schedule."""

    index: int
    train: Split
    test: Split

    def __post_init__(self) -> None:
        if self.train.end >= self.test.start:
            raise ValueError(
                f"fold {self.index}: the training window ends at {self.train.end.date()}, "
                f"on or after the test window starts at {self.test.start.date()}"
            )


def date_split(
    index: pd.DatetimeIndex,
    development_end: str | pd.Timestamp,
) -> tuple[Split, Split]:
    """Cut history in two at ``development_end`` (inclusive of the development side).

    Returns ``(development, out_of_sample)``. Raises if either side is empty,
    because an out-of-sample period with no bars in it is a silent way to
    report an in-sample result as though it were honest.
    """
    if len(index) == 0:
        raise ValueError("cannot split an empty index")
    boundary = pd.Timestamp(development_end)
    development = index[index <= boundary]
    out_of_sample = index[index > boundary]
    if len(development) == 0:
        raise ValueError(f"no bars on or before {boundary.date()}")
    if len(out_of_sample) == 0:
        raise ValueError(f"no bars after {boundary.date()}")
    return (
        Split("development", development[0], development[-1]),
        Split("out_of_sample", out_of_sample[0], out_of_sample[-1]),
    )


def walk_forward(
    index: pd.DatetimeIndex,
    *,
    train_bars: int,
    test_bars: int,
    step_bars: int | None = None,
    anchored: bool = False,
) -> list[Fold]:
    """Build a rolling (or anchored) walk-forward schedule.

    ``anchored=True`` grows the training window from the start of history
    instead of sliding it, which is the right choice when you believe the
    relationship is stable and want every bar of evidence behind each refit.

    The last partial test window is dropped rather than shortened: comparing a
    fold scored over 11 bars against one scored over 250 is not a comparison.
    """
    if train_bars <= 0 or test_bars <= 0:
        raise ValueError("train_bars and test_bars must both be positive")
    step = step_bars if step_bars is not None else test_bars
    if step <= 0:
        raise ValueError("step_bars must be positive")

    folds: list[Fold] = []
    start = 0
    while True:
        train_end = start + train_bars
        test_end = train_end + test_bars
        if test_end > len(index):
            break
        train_start = 0 if anchored else start
        folds.append(
            Fold(
                index=len(folds),
                train=Split(f"train_{len(folds)}", index[train_start], index[train_end - 1]),
                test=Split(f"test_{len(folds)}", index[train_end], index[test_end - 1]),
            )
        )
        start += step
    if not folds:
        raise ValueError(
            f"{len(index)} bars is not enough for a {train_bars}+{test_bars} walk-forward schedule"
        )
    return folds
