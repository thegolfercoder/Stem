# trading-algorithm

An event-driven backtesting framework for systematic trading research, in
Python. Strategy engine, transaction costs, slippage, position and risk
management, and performance analytics — built around making look-ahead bias
structurally impossible rather than merely discouraged.

**This is research software.** It is not connected to a broker, it does not place
orders, and nothing here is financial advice. The results in this repository are
computed on synthetic data and are evidence that the code works, not that any
strategy makes money. See [What the results mean](#what-the-results-mean).

---

## Why this exists

Most backtests are wrong, and almost every way of being wrong makes the answer
look better. Three problems account for the majority:

1. **Look-ahead bias** — using information that did not exist yet.
2. **Multiple testing** — trying enough variants that one looks good by chance.
3. **Cost optimism** — assuming an execution nobody would get.

This framework addresses each structurally, because a rule you have to remember
to follow is a rule that eventually gets forgotten quietly.

### Look-ahead bias is prevented by the architecture, and then verified

A strategy sees exactly one object: a `MarketView` constructed for one bar, with
no accessor that returns anything dated later. Orders it produces are executed at
the **next** bar's open. So a strategy cannot trade at a price it has seen, let
alone one it has not.

That is the design. The verification is `tests/test_no_lookahead.py`, which runs
two independent checks over every strategy:

- **Future perturbation.** Replace every bar after *k* with a different price
  path, rerun, and require every decision at or before bar *k* to be identical.
  Catches a leak of any horizon, including one bar.
- **Prefix invariance.** Truncate the panel at bar *k* and require the shared
  portion of the equity curve to match. Catches leakage that is not per-bar — a
  statistic fitted over the whole sample, a normalisation using data the strategy
  should not have had.

Both are aimed at a deliberately cheating strategy, and the perturbation check is
asserted to *fail* on it. A detector that has never caught anything is not known
to work.

The suite also pins down what prefix invariance alone **misses** — the check most
backtesting repositories ship on its own. Truncating at bar *k* removes bar
*k+1*, so a strategy peeking exactly one bar ahead makes its last comparable
decision using a bar present in both runs, and goes undetected.
`test_prefix_invariance_alone_misses_a_one_bar_peek` exists so nobody deletes the
perturbation test believing it redundant.

---

## Quick start

```bash
git clone https://github.com/thegolfercoder/trading-algorithm
cd trading-algorithm
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

tradelab compare configs --split development     # every strategy, side by side
tradelab run configs/trend_sma.yaml --split all  # one strategy, full tear sheet
pytest -q                                        # the test suite
```

The sample data is checked in, so that works on a fresh clone with no data
source. To reproduce everything in [`docs/RESULTS.md`](docs/RESULTS.md):

```bash
python scripts/run_research.py
```

### Using your own data

One CSV or Parquet file per instrument, columns `ts, open, high, low, close,
volume`. Point a config at the directory:

```bash
tradelab check data/raw/my_universe       # validate before trusting anything
tradelab run configs/trend_sma.yaml --data data/raw/my_universe
```

[`data/README.md`](data/README.md) covers the format, the aliases the loader
accepts, why the `close` column must be a total-return series, and what the
validator does and does not check.

---

## Architecture

```
trading-algorithm/
├── src/tradelab/
│   ├── data/          # loaders, validation, the panel, train/test splits
│   │   └── market.py  #   MarketView — the look-ahead barrier
│   ├── strategies/    # base class, registry, trend / momentum / mean reversion
│   ├── backtesting/   # engine, broker, commission, slippage, portfolio
│   ├── risk/          # position sizing, exposure limits, stops, kill switch
│   ├── analytics/     # metrics, tear sheets, charts
│   ├── config.py      # YAML -> a reproducible run
│   ├── research.py    # running a config over a chosen split
│   └── cli.py
├── tests/             # 231 tests, including the look-ahead suite
├── notebooks/         # the same workflow, step by step, with the reasoning
├── configs/           # one YAML per experiment
├── data/sample/       # seeded synthetic data, regenerable byte for byte
├── scripts/           # reproduce every number in the docs
└── docs/              # methodology, assumptions, results
```

The layers requested in a flat layout — `strategies/`, `backtesting/`,
`analytics/`, `risk/` — are subpackages under `src/tradelab/` rather than
top-level directories. `src`-layout is what makes `pip install -e .` test the
installed package rather than the working directory, which is how you find out
about a missing `__init__.py` before your users do.

### The bar loop

Ordering inside one bar is the whole design:

| Step | What happens | Why in this order |
|---|---|---|
| 1 | Execute orders decided at the **previous** bar's close, at this bar's open | The one-bar delay between deciding and trading |
| 2 | Check stops against this bar's high and low | A stop is evaluated as the bar unfolds, not after it closes |
| 3 | Accrue borrow on shorts, interest on cash | |
| 4 | Mark to this bar's close, write one row of the equity curve | |
| 5 | Hand the strategy a view ending at this bar; record the orders it implies | Executed at step 1 of the *next* bar |

Step 5 happens after step 4, and its orders are untouched until the next
iteration. That single bar of separation is what the tests verify.

### Adding a strategy

Two methods, and nothing else in the framework changes:

```python
from tradelab.data.market import MarketView
from tradelab.strategies.base import Strategy
from tradelab.strategies.registry import register


@register
class AboveItsOwnAverage(Strategy):
    """Equal weight across whatever is trading above its own N-bar mean."""

    name = "above_average"

    def __init__(self, window: int = 100) -> None:
        self.window = window

    @property
    def warmup(self) -> int:
        """Bars needed before a signal means anything. The engine stays flat until then."""
        return self.window + 1

    def generate(self, view: MarketView) -> dict[str, float]:
        """Target weights as a signed fraction of equity."""
        picks = [
            symbol
            for symbol in view.tradable()
            if len(c := view.series(symbol, lookback=self.window)) == self.window
            and c.iloc[-1] > c.mean()
        ]
        return {symbol: 1.0 / len(picks) for symbol in picks} if picks else {}
```

Add it to the list in `tests/test_no_lookahead.py` and both leak detectors apply
to it. `tests/test_strategies.py` has a test asserting exactly this claim — that a
new strategy needs nothing but these two methods — because an extensibility claim
in prose is not a claim anyone can check.

---

## What is implemented

**Data.** CSV and Parquet loading with column-alias handling; a validator that
refuses structurally broken data and warns about unadjusted splits, stale
series, calendar gaps and zero-volume bars; symbols outer-joined with NaN
meaning "not tradable" rather than forward filled; date splits and rolling or
anchored walk-forward schedules.

**Strategies.** Moving-average crossover with confirmation, Donchian breakout
with ATR-scaled sizing, cross-sectional (12-1) and time-series momentum, z-score
mean reversion with an Ornstein-Uhlenbeck reversion gate, RSI reversion, and
buy-and-hold as the benchmark every result is reported against.

**Execution.** Market-on-next-open only. Commission models: per-share with floor
and cap, basis points of notional, fixed per order, composite. Slippage models:
fixed bps, volume-share with square-root market impact, volatility-scaled. A
participation cap that truncates oversized orders instead of inventing
liquidity.

**Risk.** Fixed-fractional, inverse-volatility and covariance-based
volatility-target sizing; per-position, gross and net exposure caps; percentage,
ATR and trailing stops that fill at the open when a bar gaps through; a drawdown
kill switch.

**Analytics.** CAGR, annualised volatility, Sharpe, Sortino, Calmar, maximum
drawdown with peak/trough/recovery dates, win rate, profit factor, payoff ratio,
trade count, exposure, average gross exposure, annualised turnover, skew,
kurtosis, lag-1 autocorrelation, equity curve — plus the three that exist to stop
you overclaiming:

- **Sharpe standard error** (Lo, 2002). On two years of daily data this is around
  0.7. Most published Sharpe ratios are not distinguishable from zero and are
  quoted to two decimal places anyway.
- **Probabilistic Sharpe ratio** (Bailey & López de Prado, 2012) — the probability
  the true Sharpe exceeds a benchmark, corrected for sample length, skew and
  kurtosis.
- **Deflated Sharpe ratio** — the same, benchmarked against the Sharpe you would
  expect from the *best of N attempts*.

---

## What the results mean

All numbers below come from `python scripts/run_research.py` on the checked-in
synthetic data. Full tables are in [`docs/RESULTS.md`](docs/RESULTS.md).

### The data is synthetic and that limits what any of this means

`data/sample/` holds four generated series with known statistical properties.
`SYN_TREND` has positive return autocorrelation because it was put there;
`SYN_MEANREV` has negative autocorrelation for the same reason; `SYN_RANDOM` is
the control. Realised properties of the checked-in files:

| symbol | target CAGR | realised CAGR | target vol | realised vol | target AR(1) | realised AR(1) | max drawdown |
|---|---|---|---|---|---|---|---|
| SYN_TREND | 8.0% | 9.8% | 18% | 17.6% | 0.06 | 0.059 | -50.2% |
| SYN_MEANREV | 5.0% | 4.8% | 22% | 22.7% | -0.10 | -0.102 | -52.4% |
| SYN_MIXED | 6.0% | 7.1% | 28% | 27.0% | 0.03 | 0.025 | -53.7% |
| SYN_RANDOM | 0.0% | -1.4% | 20% | 19.6% | 0.00 | -0.019 | -70.9% |

A strategy that makes money here has demonstrated that the code works. It has
demonstrated nothing about markets.

### Out-of-sample, 2020-2025, after costs

| strategy | CAGR | vol | Sharpe | max DD | trades | win rate | profit factor |
|---|---|---|---|---|---|---|---|
| **buy_and_hold** | **5.8%** | 11.4% | **0.53** | -20.7% | 4 | - | - |
| mean_reversion | 2.5% | 8.7% | 0.31 | -14.2% | 228 | 61.8% | 1.10 |
| breakout | 0.7% | 9.3% | 0.12 | -26.5% | 56 | 39.3% | 1.07 |
| momentum_xs | -0.6% | 22.4% | 0.09 | -43.4% | 77 | 59.7% | 0.87 |
| trend_sma | -0.5% | 9.2% | -0.01 | -26.1% | 78 | 37.2% | 1.00 |
| momentum_ts | -6.4% | 9.3% | -0.64 | -34.1% | 293 | 28.7% | 0.71 |

**Equal-weight buy-and-hold beat every strategy in the repository.** Trend
following looked reasonable in development (Sharpe 0.74, drawdown -12.8%) and
returned approximately nothing out of sample. That is the ordinary result, it is
the reason the split exists, and it is reported here rather than buried because
a repository that only shows the runs that worked is not showing you anything.

### And even the winner is not distinguishable from luck

Best out-of-sample Sharpe: 0.53, with a **standard error of 0.40**. Six configs
were run; their Sharpe ratios have a standard deviation of 0.40. Deflating the
best for having been selected as the best of six gives a
**51.5% probability that its true Sharpe is above zero** — a coin flip.

That is on six years of daily data. Any repository quoting a Sharpe ratio to two
decimal places over a shorter sample, without a standard error beside it, is
quoting noise.

### Nothing survives pessimistic costs

CAGR over the full sample, at zero cost, at the base assumption (2 bps
commission plus volume-share slippage), and at roughly four times that:

| strategy | zero cost | base | pessimistic |
|---|---|---|---|
| buy_and_hold | 7.4% | 7.4% | 7.3% |
| trend_sma | 4.5% | 4.1% | 2.1% |
| breakout | 2.1% | 1.7% | -0.3% |
| mean_reversion | 3.0% | 1.6% | -4.8% |
| momentum_xs | 4.0% | 2.0% | -5.5% |
| momentum_ts | -3.6% | -5.1% | -12.0% |

Mean reversion loses two-thirds of its gross return to costs at the base
assumption and goes negative under the pessimistic one, because it trades 25x
its equity a year. That relationship — turnover times cost equals the drag — is
the single most under-modelled thing in retail backtesting.

### Walk-forward says the same

`trend_sma` scored over thirteen rolling folds, three years of run-up to one year
of measurement: mean Sharpe **0.32**, standard deviation **0.81**, ten of
thirteen folds positive. A standard deviation two and a half times the mean is
what an effect that may not be there looks like.

### The summary

No strategy in this repository is demonstrated to be profitable, on this data or
on any other. The engine is demonstrated to be correct — 231 tests, including two
independent look-ahead detectors, one of which is verified against a strategy
that genuinely cheats.

---

## Assumptions and limitations

Every assumption is listed in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md), with
the optimistic ones marked as optimistic. The ones worth knowing before reading
any number:

- **Survivorship bias is not detectable here.** If your universe is "today's index
  members", the backtest measures companies selected for having survived. No
  amount of care in the engine fixes that; only point-in-time data does.
- **Slippage is an assumption, not a measurement.** Nothing in a daily OHLCV file
  says what you would have paid. Every cost model here is a guess with a stated
  shape, and the honest use is to re-run under the pessimistic one.
- **Stop exits and end-of-run liquidation ignore the participation cap.** A stop in
  an illiquid name is precisely where stops fail, and this does not model that.
- **The `close` column must be a total-return series.** Feeding raw closes
  understates every long-only result by roughly the dividend yield.
- **Square-root scaling of volatility assumes uncorrelated returns.** Trend
  following violates this in one direction and mean reversion in the other. The
  lag-1 autocorrelation is reported beside the volatility so you can discount it.
- **No intraday microstructure, no options or futures roll, no margin calls, no
  taxes, no currency conversion.**
- **No parameter fitting, deliberately.** A framework that fits parameters makes it
  very easy to fit them on the data you are also measuring on.

### Performance

A sixteen-year, four-symbol daily backtest takes roughly twenty seconds. The
engine steps bar by bar through pandas rather than vectorising, which is what
makes the ordering auditable and the look-ahead guarantee checkable. That was the
trade made on purpose; if you need to run ten thousand parameter combinations,
this is the wrong tool.

---

## Reproducing everything

```bash
pip install -e ".[dev]"

tradelab generate --output data/sample        # regenerates the checked-in CSVs byte for byte
python scripts/describe_sample_data.py        # the data properties table above
python scripts/run_research.py                # docs/RESULTS.md and the charts

pytest -q                                     # 231 tests
ruff check . && ruff format --check .
mypy                                          # strict, and clean
```

CI runs all of it on Python 3.11 and 3.12, and additionally regenerates the
sample data and diffs it against what is checked in — if those ever disagree,
every number in the docs is unreproducible, which is worth failing a build over.

---

## Reading order

| If you want to | Read |
|---|---|
| Understand the method | [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) |
| Know what is being assumed | [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) |
| See the numbers | [`docs/RESULTS.md`](docs/RESULTS.md) |
| Follow the workflow step by step | [`notebooks/01_research_walkthrough.ipynb`](notebooks/01_research_walkthrough.ipynb) |
| Supply your own data | [`data/README.md`](data/README.md) |
| See how look-ahead is actually prevented | `src/tradelab/data/market.py`, `tests/test_no_lookahead.py` |

---

## Licence

MIT — see [LICENSE](LICENSE).

Research and educational software. Not investment advice, not a recommendation to
buy or sell anything, and not suitable for managing money without work well
beyond what is here.
