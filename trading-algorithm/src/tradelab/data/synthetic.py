"""A seeded synthetic market, so the repository has something to run on.

This exists because a portfolio repository cannot redistribute licensed vendor
data, and because a reader should be able to clone it and get a result in one
command. It is *not* a stand-in for real data, and the properties below are the
reason:

* the price processes are generated with a known drift, a known volatility and,
  for two of the four symbols, a known amount of autocorrelation
* a trend-following rule therefore has a trend to find in ``SYN_TREND``, and a
  mean-reversion rule has mean reversion to find in ``SYN_MEANREV``, because
  those properties were put there on purpose

A strategy that makes money on this data has demonstrated that the code works.
It has demonstrated nothing whatsoever about markets. ``SYN_RANDOM`` is included
as the control: it is a driftless random walk, and any strategy showing a strong
result on it is telling you about the backtester, not about the strategy.

The generator is deterministic given ``seed``, so ``tradelab generate`` reproduces
the checked-in files byte for byte.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SymbolSpec:
    """The generating process for one synthetic instrument.

    ``ar1`` is the autocorrelation of daily log returns: positive gives
    momentum, negative gives mean reversion.

    The two-state regime is what gives the series volatility clustering and fat
    tails rather than the clean Gaussian a single-state model would produce. The
    chain is deliberately asymmetric - ``stress_entry`` is small and
    ``stress_exit`` is large - so the stressed state is rare and short, the way
    it is in the equity series this is loosely shaped after. A symmetric chain
    puts the series in a high-volatility bear regime half the time, which drags
    the unconditional drift below zero and produces a "market" that goes
    steadily to nothing.

    ``annual_return`` and ``annual_vol`` are the **unconditional** targets for
    the whole series, not the parameters of either state. The calm-state drift
    and volatility are solved for so that the mixture hits them, which is the
    only way to specify this process that stays interpretable: set the calm
    drift directly and adding a stress regime silently changes the long-run
    return as well as the volatility, so no two symbols are comparable.

    These are population values. A sixteen-year sample of an 18%-volatility
    series has a standard error on its annualised return of roughly 4.5
    percentage points, so the *realised* figures differ, and
    ``scripts/describe_sample_data.py`` prints what the checked-in files
    actually came out at.
    """

    name: str
    annual_return: float
    annual_vol: float
    ar1: float = 0.0
    stress_annual_drift: float = -0.30
    stress_vol_multiple: float = 2.2
    stress_entry: float = 0.008
    stress_exit: float = 0.05
    start_price: float = 100.0
    description: str = ""

    def __post_init__(self) -> None:
        if not -0.95 < self.ar1 < 0.95:
            raise ValueError("ar1 must be inside (-0.95, 0.95) for the process to be stationary")
        if not 0 < self.stress_entry < 1 or not 0 < self.stress_exit <= 1:
            raise ValueError("regime probabilities must lie in (0, 1]")
        if self.annual_vol <= 0:
            raise ValueError("annual_vol must be positive")

    @property
    def stress_fraction(self) -> float:
        """Long-run share of days spent in the stressed state."""
        return self.stress_entry / (self.stress_entry + self.stress_exit)

    @property
    def calm_vol(self) -> float:
        """Calm-state volatility that makes the mixture's variance ``annual_vol ** 2``."""
        f = self.stress_fraction
        return float(self.annual_vol / np.sqrt((1.0 - f) + f * self.stress_vol_multiple**2))

    @property
    def calm_drift(self) -> float:
        """Calm-state drift that makes the mixture's log growth match ``annual_return``.

        Solves ``(1-f)(mu_c - sigma_c^2/2) + f(mu_s - sigma_s^2/2) = ln(1 + target)``
        for ``mu_c``. The variance terms are the Ito correction: a regime that is
        merely more volatile lowers the compound return even with an unchanged
        arithmetic drift, and leaving that out is what made the first version of
        this generator produce four series that all went to nearly nothing.
        """
        f = self.stress_fraction
        target_log = float(np.log1p(self.annual_return))
        return float(
            (target_log + 0.5 * self.annual_vol**2 - f * self.stress_annual_drift) / (1.0 - f)
        )


DEFAULT_SPECS: tuple[SymbolSpec, ...] = (
    SymbolSpec(
        name="SYN_TREND",
        annual_return=0.08,
        annual_vol=0.18,
        ar1=0.06,
        description="equity-like drift with mildly positive return autocorrelation",
    ),
    SymbolSpec(
        name="SYN_MEANREV",
        annual_return=0.05,
        annual_vol=0.22,
        ar1=-0.10,
        description="lower drift with negative return autocorrelation",
    ),
    SymbolSpec(
        name="SYN_RANDOM",
        annual_return=0.0,
        annual_vol=0.20,
        ar1=0.0,
        stress_annual_drift=0.0,
        description="zero expected growth, no autocorrelation - the control series",
    ),
    SymbolSpec(
        name="SYN_MIXED",
        annual_return=0.06,
        annual_vol=0.28,
        ar1=0.03,
        stress_annual_drift=-0.40,
        stress_vol_multiple=3.0,
        stress_entry=0.012,
        stress_exit=0.04,
        description="high volatility with deeper and longer stress regimes",
    ),
)

TRADING_DAYS_PER_YEAR = 252


def _regime_path(rng: np.random.Generator, n: int, entry: float, exit_: float) -> np.ndarray:
    """A two-state Markov chain: 0 is calm, 1 is stressed."""
    draws = rng.random(n)
    states = np.zeros(n, dtype=np.int8)
    state = 0
    for i in range(n):
        threshold = entry if state == 0 else exit_
        if draws[i] < threshold:
            state = 1 - state
        states[i] = state
    return states


def generate_symbol(
    spec: SymbolSpec,
    index: pd.DatetimeIndex,
    rng: np.random.Generator,
    *,
    intraday_steps: int = 8,
) -> pd.DataFrame:
    """Generate one symbol's OHLCV series.

    Daily log returns are an AR(1) process whose innovation variance and drift
    depend on the regime. The high and low come from simulating
    ``intraday_steps`` sub-moves within the day and taking their running
    extremes, which produces a high-low range that widens with volatility the
    way a real one does - a range drawn independently of the close would let a
    stop-loss model look far better than it should.
    """
    n = len(index)
    dt = 1.0 / TRADING_DAYS_PER_YEAR
    regimes = _regime_path(rng, n, spec.stress_entry, spec.stress_exit)

    calm_vol, calm_drift = spec.calm_vol, spec.calm_drift
    vol = np.where(regimes == 1, calm_vol * spec.stress_vol_multiple, calm_vol)
    drift = np.where(regimes == 1, spec.stress_annual_drift, calm_drift)
    daily_vol = vol * np.sqrt(dt)
    daily_drift = drift * dt - 0.5 * daily_vol**2

    # Scaling the innovation by sqrt(1 - ar1^2) keeps the *realised* volatility
    # of the AR(1) process equal to `annual_vol`. Without it, adding
    # autocorrelation quietly changes the volatility too, and any comparison
    # between the symbols is then confounded by two differences instead of one.
    innovations = rng.standard_normal(n) * daily_vol * np.sqrt(1.0 - spec.ar1**2)
    log_returns = np.empty(n)
    previous = 0.0
    for i in range(n):
        previous = spec.ar1 * previous + innovations[i]
        log_returns[i] = daily_drift[i] + previous

    close = spec.start_price * np.exp(np.cumsum(log_returns))
    previous_close = np.concatenate([[spec.start_price], close[:-1]])

    # An overnight gap takes a share of the day's move; the rest happens intraday.
    gap_share = rng.uniform(0.05, 0.35, size=n)
    open_ = previous_close * np.exp(log_returns * gap_share)

    step_sigma = daily_vol / np.sqrt(intraday_steps)
    steps = rng.standard_normal((n, intraday_steps)) * step_sigma[:, None]
    steps -= steps.mean(axis=1, keepdims=True)  # a bridge: intraday noise nets to zero
    path = np.log(open_)[:, None] + np.cumsum(steps, axis=1)
    remainder = np.log(close) - np.log(open_)
    path += remainder[:, None] * np.linspace(1 / intraday_steps, 1.0, intraday_steps)[None, :]

    high = np.maximum(np.exp(path).max(axis=1), np.maximum(open_, close))
    low = np.minimum(np.exp(path).min(axis=1), np.minimum(open_, close))

    # Volume is lognormal around a slowly drifting base and rises with the day's
    # absolute move, which is the one volume-price relationship robust enough to
    # be worth building in: participation models in the cost layer read it.
    base = 1_000_000 * np.exp(np.cumsum(rng.standard_normal(n) * 0.004))
    shock = 1.0 + 3.0 * np.abs(log_returns) / np.maximum(daily_vol, 1e-9) * 0.25
    volume = np.round(base * shock * np.exp(rng.standard_normal(n) * 0.25))

    return pd.DataFrame(
        {
            "open": np.round(open_, 4),
            "high": np.round(high, 4),
            "low": np.round(low, 4),
            "close": np.round(close, 4),
            "volume": volume,
        },
        index=index,
    )


def trading_calendar(start: str, end: str) -> pd.DatetimeIndex:
    """Weekdays between two dates. No holiday calendar; see docs/ASSUMPTIONS.md."""
    return pd.bdate_range(start=start, end=end, name="ts")


def generate_panel(
    *,
    start: str = "2010-01-04",
    end: str = "2025-12-31",
    seed: int = 20240101,
    specs: tuple[SymbolSpec, ...] = DEFAULT_SPECS,
) -> dict[str, pd.DataFrame]:
    """Generate the full set of synthetic symbols.

    Each symbol draws from its own child generator seeded off ``seed``, so
    adding a symbol to ``specs`` does not change the series of the ones already
    there - which keeps a checked-in dataset stable as the generator grows.
    """
    index = trading_calendar(start, end)
    root = np.random.SeedSequence(seed)
    children = root.spawn(len(specs))
    return {
        spec.name: generate_symbol(spec, index, np.random.default_rng(child))
        for spec, child in zip(specs, children, strict=True)
    }
