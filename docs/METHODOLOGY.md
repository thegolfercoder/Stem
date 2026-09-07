# Methodology

## The problem this is built around

A backtest is a measurement with a very large number of ways to be wrong, and
almost all of them make the result look better rather than worse. Three matter
most:

1. **Look-ahead bias** - using information that did not exist yet.
2. **Multiple testing** - trying enough variants that one looks good by chance.
3. **Cost optimism** - assuming an execution nobody would get.

Each is addressed structurally rather than by discipline, because discipline
fails quietly and structure fails loudly.

## 1. Look-ahead bias

**Structure.** A strategy receives a `MarketView`, which is constructed for one
bar and has no accessor returning a value dated later than that bar. The orders
it produces are executed at the *next* bar's open. So a strategy cannot trade at
a price it has seen, let alone one it has not.

**Verification.** `tests/test_no_lookahead.py` runs two independent checks on
every strategy:

- *Future perturbation.* Replace every bar after *k* with a different price path
  and rerun. Every decision at or before bar *k* must be byte-identical, because
  nothing after *k* was legitimately visible to any of them. This catches a leak
  of any horizon.
- *Prefix invariance.* Truncate the panel at bar *k* and compare the equity curve
  over the shared bars. This catches leakage that is not per-bar: a statistic
  fitted over the whole sample, a normalisation using data the strategy should
  not have had.

Prefix invariance alone - the check most backtesting repositories ship - is
**not sufficient**, and the test suite proves it rather than asserting it.
Truncating at bar *k* removes bar *k+1*, so a strategy peeking exactly one bar
ahead makes its last comparable decision at bar *k-1* using bar *k*, which is
present in both runs. `test_prefix_invariance_alone_misses_a_one_bar_peek` pins
that hole open so nobody deletes the perturbation test believing it redundant.

Both checks are aimed at a deliberately cheating strategy that reaches past its
view, and the perturbation check is asserted to fail on it. A detector that has
never caught anything is not known to work.

## 2. Separating development from test

History is cut at a date named in each config (`data.development_end`).

- **Development** - iterate freely. Fit, plot, change your mind. Nothing measured
  here is evidence about anything.
- **Out-of-sample** - the tail. Every evaluation spends from the same
  multiple-testing budget.

The out-of-sample run starts *before* the boundary so indicators are warm on the
first measured bar, and the records are trimmed to the measurement window
afterwards (`research.trim_to_split`). Backtesting from a standing start on the
first out-of-sample day would measure a strategy that spent its first two
hundred bars flat, which is a different thing.

**Walk-forward** (`data/splits.walk_forward`) is the stronger version: rolling or
anchored train/test folds where each test window is scored by a rule that could
not have seen it. `Fold.__post_init__` refuses to construct a fold whose
training window overlaps its test window, so the mistake cannot be made silently.

## 3. Multiple testing

Picking the best of *N* strategies and reporting its Sharpe ratio reports the
maximum of *N* draws, not the quality of the strategy. `analytics.metrics`
provides:

- `sharpe_standard_error` - Lo (2002). On two years of daily data the standard
  error of an annualised Sharpe is around 0.7. Most reported Sharpe ratios are
  not distinguishable from zero and are quoted to two decimal places anyway.
- `probabilistic_sharpe_ratio` - Bailey and López de Prado (2012). The
  probability the true Sharpe exceeds a benchmark, corrected for sample length,
  skew and kurtosis.
- `deflated_sharpe_ratio` - the same, benchmarked against the Sharpe you would
  expect from the best of *N* attempts.

`scripts/run_research.py` computes the deflated Sharpe from the number of
configs it ran and the observed dispersion of their Sharpe ratios.

### Trials actually taken

Code cannot count the variants abandoned before they were written down, so they
are recorded here by hand. This section is the honest part of the multiple
testing correction, and it is a floor rather than a total.

| Decision | How it was made | Data used |
|---|---|---|
| Moving-average pair (50/200) | Textbook default, not searched | None |
| Breakout windows (55/20) | Original Turtle parameters, not searched | None |
| Momentum lookbacks (252-21, 126) | Standard values from the published literature | None |
| Z-score window and thresholds (20, 1.5/0.3) | Conventional; the entry/exit asymmetry was chosen for hysteresis, not fitted | None |
| Stop multiples (3-4x ATR) | Chosen to be loose enough not to dominate the entry rule; not optimised | None |
| Volatility target (10%) | Chosen as a round number | None |
| Regime parameters of the synthetic generator | Adjusted until the four series had plausible drift, volatility and drawdown | Not a strategy decision, but a decision about the data, and disclosed for that reason |

**No strategy parameter in this repository was chosen by searching the sample
data.** That is why the development-period figures are closer to honest
out-of-sample numbers than a tuned parameter set would be, and it is worth more
to the credibility of the result than any amount of optimisation would have been.

If you fork this and start tuning, add rows to that table. The moment it stops
being maintained, the deflated Sharpe stops meaning anything.

## 4. Cost realism

Commission is separated from slippage because one can be looked up and the other
cannot. `scripts/run_research.py` reports every strategy at zero cost, at the
base assumption, and under a pessimistic model. The interesting question is never
what the base case says; it is whether anything survives the pessimistic one.

## What none of this can fix

Survivorship bias in the input data. A universe of today's index members is a
set of companies selected for having survived, and no amount of care in the
engine detects it. Use point-in-time universes with delisted names, or state the
bias plainly.
