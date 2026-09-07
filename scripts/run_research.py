"""Reproduce every number quoted in the README.

    python scripts/run_research.py

Writes ``docs/RESULTS.md`` and the charts under ``docs/images/``. Nothing in the
README is typed by hand: if a number there disagrees with what this script
prints, the README is wrong.

The protocol, in order:

1. Every config on the **development** period. This is the period you are
   allowed to look at, so nothing here is evidence of anything.
2. Every config on the **out-of-sample** period, once. That "once" is the whole
   point, and it is also the thing a repository cannot enforce: the count of
   variants tried before this one is recorded in ``docs/METHODOLOGY.md`` because
   only a person can know it.
3. **Cost sensitivity** - the same runs at zero cost and at roughly four times
   the base assumption. A result that only exists at zero cost does not exist.
4. **Walk-forward** on the trend config, so the out-of-sample figure is not one
   draw from one boundary date.
5. **Deflated Sharpe** against the number of configs actually run, using the
   observed dispersion of their Sharpe ratios.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from tradelab.analytics import plots
from tradelab.analytics.metrics import deflated_sharpe_ratio, summarise
from tradelab.analytics.tearsheet import comparison_table, to_markdown
from tradelab.backtesting.costs import BpsCommission, NoCommission
from tradelab.backtesting.engine import run_backtest, with_costs
from tradelab.backtesting.slippage import FixedBpsSlippage, NoSlippage
from tradelab.config import RunConfig, load_run
from tradelab.data.splits import walk_forward
from tradelab.research import SplitRun, load_data, run_split, select_split, with_data_directory

HEADLINE = (
    "cagr",
    "annualised_volatility",
    "sharpe_ratio",
    "sortino_ratio",
    "max_drawdown",
    "calmar_ratio",
    "win_rate",
    "profit_factor",
    "trades",
    "exposure",
    "annualised_turnover",
    "probabilistic_sharpe_ratio",
)


def load_configs(directory: Path, data_override: str | None) -> list[RunConfig]:
    configs = [
        with_data_directory(load_run(path), data_override)
        for path in sorted(directory.glob("*.yaml"))
    ]
    if not configs:
        raise SystemExit(f"no configs found in {directory}")
    return configs


def split_table(configs: list[RunConfig], split: str) -> tuple[pd.DataFrame, dict[str, SplitRun]]:
    runs = {config.name: run_split(config, split, quiet=True) for config in configs}  # type: ignore[arg-type]
    table = comparison_table({name: run.summary for name, run in runs.items()}, columns=HEADLINE)
    table.index.name = "strategy"
    return table, runs


def cost_sensitivity(configs: list[RunConfig], split: str) -> pd.DataFrame:
    """The same strategies under three cost assumptions."""
    scenarios = {
        "zero cost": (NoCommission(), NoSlippage()),
        "base": (None, None),
        "pessimistic": (BpsCommission(8.0), FixedBpsSlippage(25.0)),
    }
    rows: dict[str, dict[str, float]] = {}
    for config in configs:
        row: dict[str, float] = {}
        data = select_split(load_data(config, quiet=True), config, split)  # type: ignore[arg-type]
        for label, (commission, slippage) in scenarios.items():
            backtest = config.backtest
            if commission is not None and slippage is not None:
                backtest = with_costs(backtest, commission, slippage)
            result = run_backtest(data, config.strategy, risk=config.risk, config=backtest)
            row[label] = summarise(result).cagr
        rows[config.name] = row
    frame = pd.DataFrame(rows).T
    frame.index.name = "strategy"
    return frame


def walk_forward_table(config: RunConfig, *, train_bars: int, test_bars: int) -> pd.DataFrame:
    """Score a fixed rule fold by fold, so one boundary date is not the whole story.

    The parameters are not refit between folds - these configs have no fitted
    parameters, by design - so this measures stability of the *rule* across
    regimes rather than the value of refitting. A version that refits would need
    the search to happen inside the training window and nowhere else.
    """
    data = load_data(config, quiet=True)
    folds = walk_forward(data.index, train_bars=train_bars, test_bars=test_bars)
    rows = []
    for fold in folds:
        window = data.slice(None, fold.test.end)
        result = run_backtest(window, config.strategy, risk=config.risk, config=config.backtest)
        result.equity_curve = result.equity_curve.loc[result.equity_curve.index >= fold.test.start]
        if len(result.equity_curve) < 10:
            continue
        result.trades = result.trades.loc[result.trades["exit_ts"] >= fold.test.start]
        result.warmup_bars = 0
        summary = summarise(result)
        rows.append(
            {
                "fold": fold.index,
                "test start": fold.test.start.date(),
                "test end": fold.test.end.date(),
                "CAGR": summary.cagr,
                "Sharpe": summary.sharpe_ratio,
                "max drawdown": summary.max_drawdown,
            }
        )
    frame = pd.DataFrame(rows).set_index("fold")
    frame.index.name = "fold"
    return frame


def deflation(runs: dict[str, SplitRun]) -> tuple[float, float, str]:
    """Discount the best Sharpe by how many strategies were run to find it."""
    sharpes = np.array(
        [run.summary.sharpe_ratio for run in runs.values() if np.isfinite(run.summary.sharpe_ratio)]
    )
    best_name = max(runs, key=lambda name: runs[name].summary.sharpe_ratio)
    best = runs[best_name]
    dispersion = float(sharpes.std(ddof=1)) if len(sharpes) > 1 else 0.0
    deflated = deflated_sharpe_ratio(
        best.result.equity_curve["equity"].pct_change().dropna(),
        trials=len(runs),
        trial_sharpe_std=dispersion,
    )
    return deflated, dispersion, best_name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--configs", type=Path, default=Path("configs"))
    parser.add_argument("--data", default=None, help="override the data directory in every config")
    parser.add_argument("--output", type=Path, default=Path("docs/RESULTS.md"))
    parser.add_argument("--images", type=Path, default=Path("docs/images"))
    args = parser.parse_args()

    configs = load_configs(args.configs, args.data)
    print(f"running {len(configs)} configs on development and out-of-sample...")

    development, dev_runs = split_table(configs, "development")
    out_of_sample, oos_runs = split_table(configs, "out_of_sample")
    costs = cost_sensitivity(configs, "all")

    trend = next((c for c in configs if c.name == "trend_sma"), configs[0])
    folds = walk_forward_table(trend, train_bars=756, test_bars=252)

    deflated, dispersion, best_name = deflation(oos_runs)
    sample = next(iter(dev_runs.values())).result

    args.images.mkdir(parents=True, exist_ok=True)
    plots.save(
        plots.equity_curves(
            {name: run.result.equity_curve["equity"] for name, run in dev_runs.items()},
            title="Development period (synthetic data)",
        ),
        args.images / "equity_development.png",
    )
    plots.save(
        plots.equity_curves(
            {name: run.result.equity_curve["equity"] for name, run in oos_runs.items()},
            title="Out-of-sample period (synthetic data)",
        ),
        args.images / "equity_out_of_sample.png",
    )

    generated = datetime.now(UTC).strftime("%Y-%m-%d")
    lines = [
        "# Results",
        "",
        "<!-- Generated by scripts/run_research.py. Do not edit by hand. -->",
        "",
        f"Generated {generated} from `{configs[0].data.directory}`, "
        f"{sample.start.date()} to {sample.end.date()}.",
        "",
        "> **These runs are on synthetic data.** The series were generated with a known",
        "> drift, volatility and return autocorrelation, so a strategy doing well here has",
        "> demonstrated that the code works and nothing else. See `data/README.md`.",
        "",
        "## Development period",
        "",
        "The period you are allowed to iterate on. Nothing here is evidence.",
        "",
        to_markdown(development),
        "",
        "## Out-of-sample period",
        "",
        "One evaluation, after the development work was finished.",
        "",
        to_markdown(out_of_sample),
        "",
        "### Deflated for multiple testing",
        "",
        f"The best out-of-sample Sharpe belongs to `{best_name}` at "
        f"{oos_runs[best_name].summary.sharpe_ratio:.2f}, with a standard error of "
        f"{oos_runs[best_name].summary.sharpe_standard_error:.2f}.",
        "",
        f"Across the {len(oos_runs)} configs the Sharpe ratios have a standard deviation of "
        f"{dispersion:.2f}. Deflating the best one for having been chosen as the best of "
        f"{len(oos_runs)} gives a probability of "
        f"**{deflated:.1%}** that its true Sharpe ratio is above zero.",
        "",
        "That count of trials is a floor, not a total. It counts the configs in this",
        "repository and not the variants tried and discarded while writing them, which is",
        "why `docs/METHODOLOGY.md` records those separately.",
        "",
        "## Sensitivity to cost assumptions",
        "",
        "CAGR over the full sample under three cost models. Slippage is an assumption,",
        "not a measurement, so the question is not what the base case says but whether",
        "anything survives the pessimistic one.",
        "",
        to_markdown(costs),
        "",
        "## Walk-forward",
        "",
        f"`{trend.name}` scored fold by fold, three years of run-up to one year of",
        "measurement, rolling forward. The rule has no fitted parameters, so this measures",
        "how stable it is across regimes rather than the value of refitting.",
        "",
        to_markdown(folds.astype({"test start": str, "test end": str})),
        "",
        f"Fold Sharpe ratios: mean {folds['Sharpe'].mean():.2f}, "
        f"standard deviation {folds['Sharpe'].std(ddof=1):.2f}, "
        f"{int((folds['Sharpe'] > 0).sum())} of {len(folds)} positive.",
        "",
        "## Charts",
        "",
        "![Development equity curves](images/equity_development.png)",
        "",
        "![Out-of-sample equity curves](images/equity_out_of_sample.png)",
        "",
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines))
    print(f"wrote {args.output} and charts to {args.images}/")
    print()
    print(to_markdown(out_of_sample))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
