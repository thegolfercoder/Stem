"""Performance measurement.

Every function states its convention, because most of these numbers have more
than one defensible definition and a report that does not say which one it used
is not reproducible. Where a choice was made, the docstring says what it was and
what the alternative would have done.

Nothing here rounds, smooths or annualises away a small sample. A Sharpe ratio
computed on two years of daily data has a standard error of roughly 0.7, and
``sharpe_standard_error`` returns it so that a report can print it beside the
point estimate instead of pretending it is not there.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from scipy import stats

from tradelab._pandas import datetime_index, float_series

TRADING_DAYS = 252
EULER_MASCHERONI = 0.5772156649015329


def infer_periods_per_year(index: pd.DatetimeIndex) -> int:
    """Guess the sampling frequency from the median gap between bars.

    Business-daily data comes back as 252, weekly as 52, monthly as 12. Anything
    it cannot recognise falls back to 252 with the reasoning that daily is the
    overwhelmingly common case - pass ``periods_per_year`` explicitly when it
    is not.
    """
    if len(index) < 3:
        return TRADING_DAYS
    median_days = float(pd.Series(index).diff().dropna().dt.total_seconds().median()) / 86400.0
    if median_days <= 0:
        return TRADING_DAYS
    if median_days < 2:
        return TRADING_DAYS
    if median_days < 10:
        return 52
    if median_days < 45:
        return 12
    if median_days < 130:
        return 4
    return 1


def to_returns(equity: pd.Series) -> pd.Series:
    """Simple per-period returns of an equity curve."""
    return equity.pct_change().dropna()


def total_return(equity: pd.Series) -> float:
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return float("nan")
    return float(equity.iloc[-1] / equity.iloc[0] - 1.0)


def cagr(equity: pd.Series) -> float:
    """Compound annual growth rate over the *calendar* span of the curve.

    Calendar years, not bar count divided by 252. The two differ by a percent or
    so on a typical equity series and the calendar version is the one that
    answers "what did this return per year", which is the question being asked.

    Returns NaN if the curve ever reached zero or below: a strategy that lost
    everything has no annualised rate, and reporting one is meaningless.
    """
    if len(equity) < 2 or equity.iloc[0] <= 0 or equity.iloc[-1] <= 0:
        return float("nan")
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    if years <= 0:
        return float("nan")
    return float((equity.iloc[-1] / equity.iloc[0]) ** (1.0 / years) - 1.0)


def annualised_volatility(returns: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    """Sample standard deviation of returns, scaled by the square root of time.

    The square-root scaling assumes returns are serially uncorrelated. They are
    not - trend-following returns are positively autocorrelated and mean
    reversion negatively - so this understates the volatility of the first and
    overstates the second. It is reported anyway because it is the universal
    convention, and the autocorrelation is reported beside it so the reader can
    discount accordingly.
    """
    if len(returns) < 2:
        return float("nan")
    return float(returns.std(ddof=1) * np.sqrt(periods_per_year))


def _is_degenerate(sigma: float, values: pd.Series) -> bool:
    """Whether a standard deviation is zero for practical purposes.

    ``sigma == 0`` is the wrong test. The sample standard deviation of a hundred
    identical floats is around 1e-19 rather than exactly zero, and dividing by it
    produces a Sharpe ratio of 7e16 - a number that looks like a result and is
    an artefact of floating point. The comparison has to be relative to the
    magnitude of the returns themselves, because a series of 1e-6 returns is a
    perfectly ordinary intraday sample and not degenerate at all.
    """
    if not np.isfinite(sigma):
        return True
    scale = float(np.max(np.abs(values.to_numpy()))) if len(values) else 0.0
    return sigma <= 1e-12 * max(scale, 1e-300)


def _excess(returns: pd.Series, annual_rate: float, periods_per_year: int) -> pd.Series:
    """Returns net of a risk-free rate, de-annualised geometrically."""
    if annual_rate == 0.0:
        return returns
    per_period = (1.0 + annual_rate) ** (1.0 / periods_per_year) - 1.0
    return float_series(returns - per_period)


def sharpe_ratio(
    returns: pd.Series,
    *,
    risk_free_rate: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """Annualised Sharpe ratio of excess returns.

    Arithmetic mean over sample standard deviation, times the square root of the
    period count. Report it with ``sharpe_standard_error`` beside it; the point
    estimate on a short sample is close to uninformative on its own.
    """
    excess = _excess(returns, risk_free_rate, periods_per_year)
    if len(excess) < 2:
        return float("nan")
    sigma = float(excess.std(ddof=1))
    if _is_degenerate(sigma, excess):
        return float("nan")
    return float(excess.mean() / sigma * np.sqrt(periods_per_year))


def sortino_ratio(
    returns: pd.Series,
    *,
    minimum_acceptable_return: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """Annualised Sortino ratio.

    Downside deviation uses the *full* sample in the denominator - squared
    shortfalls summed over every period and divided by the total count, not only
    the losing ones. That is the definition in Sortino's own work. Dividing by
    the count of losing periods instead inflates the ratio, sometimes by a lot,
    and is common enough in retail tools to be worth naming.
    """
    if len(returns) < 2:
        return float("nan")
    mar_per_period = (1.0 + minimum_acceptable_return) ** (1.0 / periods_per_year) - 1.0
    shortfall = np.minimum(returns.to_numpy() - mar_per_period, 0.0)
    downside = float(np.sqrt(np.mean(shortfall**2)))
    if _is_degenerate(downside, returns):
        return float("inf") if returns.mean() > mar_per_period else float("nan")
    excess = float(returns.mean() - mar_per_period)
    return float(excess / downside * np.sqrt(periods_per_year))


@dataclass(frozen=True)
class Drawdown:
    """The worst peak-to-trough decline, and how long it took to get back."""

    depth: float
    peak: pd.Timestamp | None
    trough: pd.Timestamp | None
    recovered: pd.Timestamp | None
    drawdown_bars: int
    recovery_bars: int | None


def drawdown_series(equity: pd.Series) -> pd.Series:
    """Fractional decline from the running high-water mark, at every bar."""
    return equity / equity.cummax() - 1.0


def max_drawdown(equity: pd.Series) -> Drawdown:
    """The deepest drawdown, with its dates and durations.

    ``recovered`` is None when the curve never regained the prior peak, which is
    the case that matters most and the one a single depth number hides.
    """
    if len(equity) < 2:
        return Drawdown(float("nan"), None, None, None, 0, None)

    curve = drawdown_series(equity)
    trough_position = int(np.argmin(curve.to_numpy()))
    depth = float(curve.iloc[trough_position])
    trough = equity.index[trough_position]

    running_max = equity.iloc[: trough_position + 1]
    peak_position = int(np.argmax(running_max.to_numpy()))
    peak = equity.index[peak_position]

    after = equity.iloc[trough_position:]
    recovered_mask = after >= equity.iloc[peak_position]
    if bool(recovered_mask.any()):
        recovery_position = int(np.argmax(recovered_mask.to_numpy()))
        recovered = after.index[recovery_position]
        recovery_bars = recovery_position
    else:
        recovered = None
        recovery_bars = None

    return Drawdown(
        depth=depth,
        peak=peak,
        trough=trough,
        recovered=recovered,
        drawdown_bars=trough_position - peak_position,
        recovery_bars=recovery_bars,
    )


def calmar_ratio(equity: pd.Series) -> float:
    """CAGR divided by the absolute maximum drawdown."""
    depth = max_drawdown(equity).depth
    growth = cagr(equity)
    if not np.isfinite(depth) or depth == 0 or not np.isfinite(growth):
        return float("nan")
    return float(growth / abs(depth))


def win_rate(trades: pd.DataFrame) -> float:
    """Fraction of closed round trips with positive PnL *after* costs."""
    if trades.empty:
        return float("nan")
    return float((trades["net_pnl"] > 0).mean())


def profit_factor(trades: pd.DataFrame) -> float:
    """Gross profit divided by gross loss, both after costs.

    Returns infinity when there were no losing trades, which on any real sample
    means the sample is too small rather than that the strategy cannot lose.
    """
    if trades.empty:
        return float("nan")
    profit = float(trades.loc[trades["net_pnl"] > 0, "net_pnl"].sum())
    loss = float(-trades.loc[trades["net_pnl"] < 0, "net_pnl"].sum())
    if loss == 0:
        return float("inf") if profit > 0 else float("nan")
    return profit / loss


def payoff_ratio(trades: pd.DataFrame) -> float:
    """Average win divided by the absolute average loss."""
    if trades.empty:
        return float("nan")
    wins = trades.loc[trades["net_pnl"] > 0, "net_pnl"]
    losses = trades.loc[trades["net_pnl"] < 0, "net_pnl"]
    if losses.empty or wins.empty:
        return float("nan")
    return float(wins.mean() / abs(losses.mean()))


def exposure(equity_curve: pd.DataFrame) -> float:
    """Fraction of bars with any position on. Not the same as average leverage."""
    if equity_curve.empty:
        return float("nan")
    return float((equity_curve["gross_exposure"].abs() > 1e-9).mean())


def average_gross_exposure(equity_curve: pd.DataFrame) -> float:
    """Time-weighted mean gross exposure, including the flat bars."""
    if equity_curve.empty:
        return float("nan")
    return float(equity_curve["gross_exposure"].mean())


def annualised_turnover(equity_curve: pd.DataFrame, periods_per_year: int = TRADING_DAYS) -> float:
    """Traded notional per year as a multiple of equity, counting both sides."""
    if equity_curve.empty:
        return float("nan")
    return float(equity_curve["turnover"].mean() * periods_per_year)


def sharpe_standard_error(
    returns: pd.Series, *, periods_per_year: int = TRADING_DAYS, risk_free_rate: float = 0.0
) -> float:
    """Standard error of the annualised Sharpe ratio under an iid assumption.

    Lo (2002): the per-period estimator has variance ``(1 + SR^2 / 2) / n``. The
    iid assumption is the weak part - autocorrelated returns have a larger true
    standard error than this - so treat it as a lower bound on the uncertainty.
    """
    n = len(returns)
    if n < 3:
        return float("nan")
    excess = _excess(returns, risk_free_rate, periods_per_year)
    sigma = float(excess.std(ddof=1))
    if _is_degenerate(sigma, excess):
        return float("nan")
    per_period = float(excess.mean() / sigma)
    return float(np.sqrt((1.0 + 0.5 * per_period**2) / n) * np.sqrt(periods_per_year))


def probabilistic_sharpe_ratio(
    returns: pd.Series,
    *,
    benchmark_sharpe: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """Probability the true Sharpe exceeds ``benchmark_sharpe`` (Bailey & Lopez de Prado, 2012).

    Corrects for sample length, skew and kurtosis, all three of which make a
    naive Sharpe ratio look more certain than it is: negative skew and fat tails
    both widen the estimator's true distribution. A PSR below about 0.95 against
    a zero benchmark means the sample cannot distinguish the strategy from noise.
    """
    n = len(returns)
    if n < 4:
        return float("nan")
    values = returns.to_numpy(dtype=float)
    sigma = float(values.std(ddof=1))
    if _is_degenerate(sigma, returns):
        return float("nan")

    observed = float(values.mean() / sigma)
    benchmark = benchmark_sharpe / np.sqrt(periods_per_year)
    skew = float(stats.skew(values, bias=False))
    kurtosis = float(stats.kurtosis(values, fisher=False, bias=False))

    denominator = 1.0 - skew * observed + 0.25 * (kurtosis - 1.0) * observed**2
    if denominator <= 0:
        return float("nan")
    statistic = (observed - benchmark) * np.sqrt(n - 1) / np.sqrt(denominator)
    return float(stats.norm.cdf(statistic))


def deflated_sharpe_ratio(
    returns: pd.Series,
    *,
    trials: int,
    trial_sharpe_std: float,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """PSR against the Sharpe you would expect from the *best* of ``trials`` attempts.

    This is the number that answers "I tried thirty variants and kept the best
    one - how impressed should I be?" The answer is usually: much less than the
    raw Sharpe suggests. ``trial_sharpe_std`` is the dispersion of annualised
    Sharpe ratios across the variants tried, which the research script computes
    from the runs it actually performed rather than assuming.

    Honest use requires counting every variant tested, including the ones
    abandoned before they were written down. That count is not something code
    can verify, which is why ``docs/ASSUMPTIONS.md`` asks for it to be recorded.
    """
    if trials < 1:
        raise ValueError("trials must be at least 1")
    if trials == 1:
        return probabilistic_sharpe_ratio(returns, periods_per_year=periods_per_year)
    if trial_sharpe_std <= 0:
        return float("nan")

    quantile = 1.0 - 1.0 / trials
    expected_max = trial_sharpe_std * (
        (1.0 - EULER_MASCHERONI) * stats.norm.ppf(quantile)
        + EULER_MASCHERONI * stats.norm.ppf(1.0 - 1.0 / (trials * np.e))
    )
    return probabilistic_sharpe_ratio(
        returns, benchmark_sharpe=float(expected_max), periods_per_year=periods_per_year
    )


@dataclass(frozen=True)
class PerformanceSummary:
    """The full set of statistics for one run. Every field is documented in the README."""

    start: pd.Timestamp
    end: pd.Timestamp
    bars: int
    periods_per_year: int

    total_return: float
    cagr: float
    annualised_volatility: float
    sharpe_ratio: float
    sharpe_standard_error: float
    sortino_ratio: float
    calmar_ratio: float

    max_drawdown: float
    max_drawdown_peak: pd.Timestamp | None
    max_drawdown_trough: pd.Timestamp | None
    max_drawdown_recovered: pd.Timestamp | None
    max_drawdown_bars: int

    trades: int
    win_rate: float
    profit_factor: float
    payoff_ratio: float
    average_trade_pnl: float
    average_bars_held: float

    exposure: float
    average_gross_exposure: float
    annualised_turnover: float

    skew: float
    excess_kurtosis: float
    return_autocorrelation: float
    probabilistic_sharpe_ratio: float

    total_commission: float
    total_slippage: float
    total_financing: float

    def to_series(self) -> pd.Series:
        return pd.Series(asdict(self))

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def summarise(
    result: object,
    *,
    risk_free_rate: float = 0.0,
    periods_per_year: int | None = None,
    trim_warmup: bool = True,
) -> PerformanceSummary:
    """Compute every statistic for one ``BacktestResult``.

    ``trim_warmup`` drops the leading bars during which the strategy was held
    flat by design. Leaving them in makes volatility look lower and Sharpe look
    higher than the strategy earned, purely because a stretch of exactly-zero
    returns was averaged in. It is a small effect on a long backtest and a large
    one on a short backtest with a 200-bar warm-up.
    """
    from tradelab.backtesting.engine import BacktestResult  # circular at module scope

    if not isinstance(result, BacktestResult):  # pragma: no cover - defensive
        raise TypeError("summarise expects a BacktestResult")

    curve = result.equity_curve
    if trim_warmup and result.warmup_bars > 0:
        curve = curve.iloc[min(result.warmup_bars, len(curve) - 2) :]
    equity = curve["equity"]
    returns = to_returns(equity)
    ppy = periods_per_year or infer_periods_per_year(datetime_index(result.equity_curve.index))

    drawdown = max_drawdown(equity)
    trades = result.trades
    autocorrelation = (
        float(returns.autocorr(lag=1)) if len(returns) > 3 and returns.std() > 0 else float("nan")
    )

    return PerformanceSummary(
        start=equity.index[0],
        end=equity.index[-1],
        bars=len(equity),
        periods_per_year=ppy,
        total_return=total_return(equity),
        cagr=cagr(equity),
        annualised_volatility=annualised_volatility(returns, ppy),
        sharpe_ratio=sharpe_ratio(returns, risk_free_rate=risk_free_rate, periods_per_year=ppy),
        sharpe_standard_error=sharpe_standard_error(
            returns, periods_per_year=ppy, risk_free_rate=risk_free_rate
        ),
        sortino_ratio=sortino_ratio(
            returns, minimum_acceptable_return=risk_free_rate, periods_per_year=ppy
        ),
        calmar_ratio=calmar_ratio(equity),
        max_drawdown=drawdown.depth,
        max_drawdown_peak=drawdown.peak,
        max_drawdown_trough=drawdown.trough,
        max_drawdown_recovered=drawdown.recovered,
        max_drawdown_bars=drawdown.drawdown_bars,
        trades=len(trades),
        win_rate=win_rate(trades),
        profit_factor=profit_factor(trades),
        payoff_ratio=payoff_ratio(trades),
        average_trade_pnl=float(trades["net_pnl"].mean()) if not trades.empty else float("nan"),
        average_bars_held=float(trades["bars_held"].mean()) if not trades.empty else float("nan"),
        exposure=exposure(curve),
        average_gross_exposure=average_gross_exposure(curve),
        annualised_turnover=annualised_turnover(curve, ppy),
        skew=float(stats.skew(returns, bias=False)) if len(returns) > 3 else float("nan"),
        excess_kurtosis=(
            float(stats.kurtosis(returns, bias=False)) if len(returns) > 3 else float("nan")
        ),
        return_autocorrelation=autocorrelation,
        probabilistic_sharpe_ratio=probabilistic_sharpe_ratio(returns, periods_per_year=ppy),
        total_commission=result.total_commission,
        total_slippage=result.total_slippage,
        total_financing=result.total_financing,
    )
