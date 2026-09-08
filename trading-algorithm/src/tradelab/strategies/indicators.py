"""Indicator primitives.

Every function here takes a series that ends at the current bar and returns a
value for that bar, so none of them can look forward. ``pandas.rolling`` is
backward-looking by construction, which is why it is used rather than anything
centred.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats


def sma(series: pd.Series, window: int) -> float:
    """Simple moving average of the last ``window`` observations."""
    if len(series) < window:
        return float("nan")
    return float(series.iloc[-window:].mean())


def ema(series: pd.Series, span: int) -> float:
    """Exponential moving average, evaluated at the last observation."""
    if len(series) < span:
        return float("nan")
    return float(series.ewm(span=span, adjust=False).mean().iloc[-1])


def rolling_volatility(series: pd.Series, window: int) -> float:
    """Standard deviation of simple returns over ``window`` bars."""
    returns = series.pct_change().dropna()
    if len(returns) < window:
        return float("nan")
    return float(returns.iloc[-window:].std(ddof=1))


def average_true_range(frame: pd.DataFrame, window: int = 14) -> float:
    """Wilder's ATR, evaluated at the last bar.

    True range uses the previous close, so the first bar of any window has no
    defined value and is dropped rather than filled with the high-low range.
    """
    if len(frame) < window + 1:
        return float("nan")
    high, low, close = frame["high"], frame["low"], frame["close"]
    previous_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - previous_close).abs(), (low - previous_close).abs()],
        axis=1,
    ).max(axis=1)
    return float(true_range.ewm(alpha=1 / window, adjust=False).mean().iloc[-1])


def zscore(series: pd.Series, window: int) -> float:
    """How many trailing standard deviations the last value sits from its mean."""
    if len(series) < window:
        return float("nan")
    window_values = series.iloc[-window:]
    sigma = float(window_values.std(ddof=1))
    if sigma == 0 or not np.isfinite(sigma):
        return float("nan")
    return float((series.iloc[-1] - window_values.mean()) / sigma)


def rsi(series: pd.Series, window: int = 14) -> float:
    """Wilder's relative strength index at the last bar, on a 0-100 scale."""
    if len(series) < window + 1:
        return float("nan")
    delta = series.diff().dropna()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, adjust=False).mean().iloc[-1]
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, adjust=False).mean().iloc[-1]
    if loss == 0:
        return 100.0
    return float(100.0 - 100.0 / (1.0 + gain / loss))


def total_return(series: pd.Series, window: int, skip: int = 0) -> float:
    """Return over ``window`` bars, optionally skipping the most recent ``skip``.

    The skip is the standard construction for cross-sectional momentum: the most
    recent month tends to reverse, so it is excluded from the ranking signal.
    """
    needed = window + skip + 1
    if len(series) < needed:
        return float("nan")
    end = series.iloc[-(skip + 1)]
    start = series.iloc[-(window + skip + 1)]
    if start <= 0:
        return float("nan")
    return float(end / start - 1.0)


def ou_half_life(series: pd.Series, window: int, *, significance: float = 0.05) -> float:
    """Half-life of mean reversion under an Ornstein-Uhlenbeck fit.

    Regresses the one-bar change on the lagged level. A negative slope implies
    mean reversion with half-life ``-ln(2) / ln(1 + slope)``.

    The slope has to be *significantly* negative, not merely negative. A trending
    random walk fits a slope a hair below zero often enough, and reporting the
    half-life that follows - six thousand bars, say - is worse than reporting
    nothing: it is a number, so it gets used. NaN is returned in that case, and
    callers treat NaN as "this series is not currently mean-reverting".

    The p-value is the two-sided one from the regression, which is conservative
    for what is really a one-sided question, and no correction is made for the
    fact that this test is run on every bar. Neither matters for the use here -
    gating an entry - but both would matter if the output were quoted as
    evidence that a series is stationary.
    """
    if len(series) < window + 1:
        return float("nan")
    values = series.iloc[-(window + 1) :].to_numpy(dtype=float)
    lagged, delta = values[:-1], np.diff(values)
    if np.ptp(lagged) == 0:
        return float("nan")
    result = stats.linregress(lagged, delta)
    slope = float(result.slope)
    if slope >= 0 or not np.isfinite(slope) or slope <= -1:
        return float("nan")
    if float(result.pvalue) > significance:
        return float("nan")
    return float(-np.log(2.0) / np.log1p(slope))
