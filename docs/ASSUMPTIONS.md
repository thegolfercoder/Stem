# Assumptions

Every backtest is a simulation, and a simulation is a list of assumptions with a
number on the end. This is the list. Where an assumption is optimistic, it says
so.

## Execution

| Assumption | Where | Optimistic or pessimistic |
|---|---|---|
| A signal computed on bar *t*'s close is traded at bar *t+1*'s open. | `backtesting/engine.py` | Realistic. It is the earliest price you could act on, and one bar of delay is what a daily-bar strategy actually faces. |
| Only market orders exist. | `types.Order` | Pessimistic on cost, optimistic on certainty. A limit order might have filled better; it also might not have filled at all, and a backtest that assumes limits fill is assuming away the hard part. |
| Orders fill in one bar, at one price. | `backtesting/broker.py` | Optimistic for anything large. A real order of size is worked over hours and gets an average, not a print. |
| An order above `max_participation` of the bar's volume is truncated, and the remainder is re-requested next bar. | `backtesting/broker.py` | Realistic in shape, optimistic in that the remainder is assumed to be executable at all. |
| Stop exits and the end-of-run liquidation ignore the participation cap and fill in full. | `backtesting/engine.py` | **Optimistic.** A stop in a name with no liquidity is the case where a stop does not save you, and this framework does not model that. |
| A stop that the bar gapped through fills at the open, not the stop level. | `risk/stops.py` | Realistic, and deliberately the pessimistic branch. |
| Whole units only, unless `allow_fractional` is set. | `backtesting/broker.py` | Realistic for equities and futures, wrong for crypto - set the flag. |
| An instrument with no close at a bar is liquidated at that bar's open, or failing that at its last observed close. | `backtesting/engine.py` | **Optimistic.** Something that halts and never reopens rarely does so at its last quote. |

## Costs

| Assumption | Default | Note |
|---|---|---|
| Commission | 2 bps of notional | In the right neighbourhood for liquid US equities at retail scale. Far too cheap for small caps, emerging markets, or anything with a wide tick. |
| Slippage | 3 bps spread plus `0.6 * sigma * sqrt(participation)` | The square-root impact law has good empirical support in its *shape*. The coefficient is a guess. Vary it first in any sensitivity check. |
| Borrow on shorts | 3% a year, flat | Real borrow is instrument-specific, changes daily, and can be recalled at the worst moment. Hard-to-borrow names cost multiples of this. |
| Interest on cash | 0% by default | Understates a strategy that sits in cash. Set `annual_cash_rate` to the relevant bill yield if that matters to the comparison. |
| No taxes, no financing on leverage, no exchange or regulatory fees | - | All absent. All real. |

## Data

| Assumption | Note |
|---|---|
| The `close` column is a total-return series, adjusted for splits and dividends. | Not checked and not checkable. Feeding raw closes understates every long-only result by roughly the dividend yield. |
| The universe in the data files is the universe that existed. | **Survivorship bias lives here.** A universe built from today's index members is a set of companies selected for having survived. The framework cannot detect this. |
| Weekday calendar, no exchange holidays, for the synthetic data. | The generator uses `pd.bdate_range`. Real data brings its own calendar and the loader uses whatever dates are in the file. |
| A NaN means "not tradable at this bar". | Symbols are outer-joined and never forward filled. Inventing a price for a day an instrument did not trade is exactly the fabrication this is built to avoid. |

## Statistics

| Assumption | Note |
|---|---|
| CAGR is compounded over the calendar span, not over bar count / 252. | Differs by around a percent on a typical series. |
| Volatility is annualised by the square root of time. | Assumes serially uncorrelated returns. Trend-following returns are positively autocorrelated, so this **understates** their volatility. Lag-1 autocorrelation is reported beside it. |
| Sortino's downside deviation divides by the *total* period count. | Sortino's own definition. Dividing by the count of losing periods, as several retail tools do, inflates the ratio. |
| Sharpe standard errors assume iid returns (Lo, 2002). | A lower bound on the true uncertainty. Autocorrelated returns have wider errors than this. |
| Metrics are computed after trimming the warm-up bars. | Leaving them in averages a stretch of exactly-zero returns into the volatility. Large effect on a short backtest with a long warm-up. |
| The trials count fed to `deflated_sharpe_ratio` is supplied by a person. | Nothing in code can count the variants you tried and abandoned. `docs/METHODOLOGY.md` is where they get recorded. |

## What this framework does not model at all

- Intraday execution, order books, queue position, partial fills within a bar
- Corporate actions beyond what is already in an adjusted price series
- Margin calls, position limits imposed by a broker, or forced liquidation
- Currency conversion for a multi-currency book
- Options, futures roll, or any instrument with an expiry
- Regime detection, portfolio optimisation, or any form of parameter fitting

The last one is deliberate. A framework that fits parameters makes it very easy
to fit them on data you are also measuring on, and the point of this repository
is the opposite.
