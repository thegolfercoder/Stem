"""The test this repository exists to be able to pass.

The claim is that no decision the engine makes at bar *k* depends on any bar
after *k*. Two independent checks are made, because they catch different things
and the obvious one alone is not enough.

**Future perturbation** is the primary check. Replace every bar after *k* with
different prices, rerun, and compare the *decisions* the strategy made at bars
0..k. Nothing after bar *k* is legitimately visible to any of them, so every
decision must be byte-identical. This catches a leak of any horizon, including a
one-bar peek.

**Prefix invariance** is the secondary check. Truncate the panel at bar *k* and
compare the equity curve over the bars the two runs share. This catches leakage
that is not per-bar at all: a rolling statistic computed over the whole sample,
a normalisation fitted to data the strategy should not have had, a stop level
derived from a global maximum.

Prefix invariance on its own is *not sufficient*, and it is worth being precise
about why, because it is the check most backtesting repositories ship. Truncating
at bar *k* removes bar *k+1*, so a strategy that peeks exactly one bar ahead
makes its last visible decision at bar *k-1* using bar *k* - which is present in
both runs. The decision that would have differed is the one at bar *k*, and its
effect lands at bar *k+1*, outside the compared window. The truncated run and
the full run agree, and the leak goes undetected. That failure is demonstrated
below by ``test_prefix_invariance_alone_misses_a_one_bar_peek``, and it is the
reason the perturbation check exists.

``test_perturbation_catches_a_one_bar_peek`` is the other half: a check that
compares a system against itself passes trivially when the comparison is wrong,
so a deliberately cheating strategy is run through the detector and asserted to
fail it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from tradelab._pandas import cell
from tradelab.backtesting.costs import BpsCommission, NoCommission
from tradelab.backtesting.engine import BacktestConfig, run_backtest
from tradelab.backtesting.slippage import FixedBpsSlippage, NoSlippage
from tradelab.data.market import MarketData, MarketView
from tradelab.risk.limits import RiskLimits, RiskManager
from tradelab.risk.sizing import VolatilityTarget
from tradelab.strategies.base import Strategy
from tradelab.strategies.benchmarks import BuyAndHold
from tradelab.strategies.mean_reversion import RSIReversion, ZScoreReversion
from tradelab.strategies.momentum import CrossSectionalMomentum, TimeSeriesMomentum
from tradelab.strategies.trend import BreakoutTrend, MovingAverageCrossover

CONFIG = BacktestConfig(
    commission=BpsCommission(2.0),
    slippage=FixedBpsSlippage(5.0),
    liquidate_at_end=False,
    rebalance_tolerance=0.02,
)

CUT_POINTS = (200, 300, 400)

STRATEGIES = [
    MovingAverageCrossover(fast=20, slow=60),
    MovingAverageCrossover(fast=10, slow=30, allow_short=True, confirmation_bars=3),
    BreakoutTrend(entry_window=30, exit_window=10, atr_window=14),
    TimeSeriesMomentum(lookback=40),
    CrossSectionalMomentum(lookback=60, skip_bars=5, top_n=1),
    ZScoreReversion(lookback=15, entry_z=1.2, exit_z=0.2),
    RSIReversion(window=10),
]


def perturb_after(data: MarketData, cut: int, *, seed: int = 7) -> MarketData:
    """Replace every bar after ``cut`` with a different but still valid price path.

    Each bar's OHLC is scaled by one positive factor, so ``high >= low`` and the
    close stays inside its own bar - the panel remains something the engine will
    accept. The factors compound, so by the end of the sample the perturbed
    series is a long way from the original: a leak of any horizon has something
    to be detected by.
    """
    rng = np.random.default_rng(seed)
    frames = {}
    n = len(data.index)
    shocks = np.ones(n)
    shocks[cut + 1 :] = np.exp(np.cumsum(rng.normal(0.002, 0.02, size=n - cut - 1)))
    for name, frame in data.frames.items():
        scale = shocks if name != "volume" else 1.0 + (shocks - 1.0) * 0.5
        frames[name] = frame.mul(pd.Series(scale, index=frame.index), axis=0)
    return MarketData(frames=frames)


def decisions_upto(result: object, cut: int) -> list[tuple[pd.Timestamp, dict[str, float]]]:
    return [
        (decision.ts, decision.targets)
        for decision in result.decisions  # type: ignore[attr-defined]
        if decision.position <= cut
    ]


def assert_no_future_dependence(data: MarketData, strategy: Strategy, **kwargs: object) -> None:
    """Every decision at or before bar k must survive the future being replaced."""
    baseline = run_backtest(data, strategy, config=CONFIG, **kwargs)  # type: ignore[arg-type]
    for cut in CUT_POINTS:
        altered = run_backtest(perturb_after(data, cut), strategy, config=CONFIG, **kwargs)  # type: ignore[arg-type]
        assert decisions_upto(baseline, cut) == decisions_upto(altered, cut), (
            f"decisions up to bar {cut} changed when the bars after {cut} were replaced, "
            "which means something read the future"
        )


def assert_prefix_invariant(data: MarketData, strategy: Strategy, **kwargs: object) -> None:
    """The equity over the first k bars must not depend on the panel being longer."""
    full = run_backtest(data, strategy, config=CONFIG, **kwargs).equity_curve["equity"]  # type: ignore[arg-type]
    for cut in CUT_POINTS:
        truncated = MarketData(frames={n: f.iloc[: cut + 1] for n, f in data.frames.items()})
        prefix = run_backtest(truncated, strategy, config=CONFIG, **kwargs).equity_curve["equity"]  # type: ignore[arg-type]
        pd.testing.assert_series_equal(
            full.iloc[: len(prefix)], prefix, check_freq=False, obj=f"equity over bars 0..{cut}"
        )


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda s: s.describe()[:40])
def test_no_strategy_reads_the_future(panel: MarketData, strategy: Strategy) -> None:
    assert_no_future_dependence(panel, strategy)


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda s: s.describe()[:40])
def test_every_strategy_is_prefix_invariant(panel: MarketData, strategy: Strategy) -> None:
    assert_prefix_invariant(panel, strategy)


def test_the_risk_layer_does_not_read_the_future(panel: MarketData) -> None:
    """Sizing reads the market too, so it gets the same treatment as a strategy."""
    risk = RiskManager(
        limits=RiskLimits(max_gross_exposure=1.0),
        sizer=VolatilityTarget(annual_target=0.10, lookback=40),
    )
    assert_no_future_dependence(panel, MovingAverageCrossover(fast=20, slow=60), risk=risk)
    assert_prefix_invariant(panel, MovingAverageCrossover(fast=20, slow=60), risk=risk)


class PeeksOneBarAhead(Strategy):
    """A deliberately broken strategy that reaches past the end of its own view.

    Nothing in Python stops a determined caller reaching into a private
    attribute, so the guarantee here is not "a strategy cannot look ahead" - it
    is "a strategy that looks ahead is detected". This class is what the
    detector is aimed at.
    """

    name = "peeks_one_bar_ahead"

    @property
    def warmup(self) -> int:
        return 5

    def generate(self, view: MarketView) -> dict[str, float]:
        closes = view._data.field("close")  # noqa: SLF001 - the point of the test
        if view.position + 1 >= len(closes):
            return {}
        tomorrow, today = closes.iloc[view.position + 1], closes.iloc[view.position]
        return {
            symbol: (1.0 if tomorrow[symbol] > today[symbol] else 0.0) / len(closes.columns)
            for symbol in closes.columns
        }


def test_perturbation_catches_a_one_bar_peek(panel: MarketData) -> None:
    """The primary check must fail on a strategy that does peek."""
    with pytest.raises(AssertionError, match="read the future"):
        assert_no_future_dependence(panel, PeeksOneBarAhead())


def test_prefix_invariance_alone_misses_a_one_bar_peek(panel: MarketData) -> None:
    """Documents why prefix invariance is not sufficient on its own.

    This is not a bug being tolerated - it is the limitation that motivates the
    perturbation check, pinned down so nobody deletes the perturbation test on
    the grounds that the truncation test already covers it.
    """
    assert_prefix_invariant(panel, PeeksOneBarAhead())


def test_the_leaking_strategy_looks_brilliant(panel: MarketData) -> None:
    """Sanity: the cheat produces the impossible result that makes leaks tempting."""
    from tradelab.analytics.metrics import summarise

    honest = summarise(run_backtest(panel, MovingAverageCrossover(fast=20, slow=60), config=CONFIG))
    cheat = summarise(run_backtest(panel, PeeksOneBarAhead(), config=CONFIG))
    assert cheat.sharpe_ratio > 5.0
    assert cheat.sharpe_ratio > honest.sharpe_ratio + 4.0


def test_orders_fill_at_the_next_bar_open_not_this_close(ramp_panel: MarketData) -> None:
    """The one-bar delay between deciding and trading, on a hand-made series."""
    config = BacktestConfig(
        commission=NoCommission(),
        slippage=NoSlippage(),
        max_participation=None,
        liquidate_at_end=False,
        rebalance_tolerance=0.01,
    )
    risk = RiskManager(limits=RiskLimits(max_position_weight=1.0))
    result = run_backtest(ramp_panel, BuyAndHold(warmup_bars=1), risk=risk, config=config)
    first_fill = result.fills[0]

    assert first_fill.ts == ramp_panel.index[1]
    assert first_fill.price == pytest.approx(cell(ramp_panel.field("open"), 1, 0))
    assert first_fill.price != pytest.approx(cell(ramp_panel.field("close"), 0, 0))
