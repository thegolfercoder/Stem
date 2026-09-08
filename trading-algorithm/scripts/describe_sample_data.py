"""Print what the checked-in sample data actually came out at.

The generator is specified in terms of unconditional targets. Whether a
particular seed hit them is an empirical question, and the answer belongs in the
README next to the claim rather than in a docstring nobody re-checks.

    python scripts/describe_sample_data.py [--data data/sample]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from tradelab._pandas import as_float
from tradelab.analytics.metrics import (
    annualised_volatility,
    cagr,
    max_drawdown,
    to_returns,
)
from tradelab.analytics.tearsheet import to_markdown
from tradelab.data.loaders import load_directory
from tradelab.data.synthetic import DEFAULT_SPECS


def describe(directory: Path) -> pd.DataFrame:
    data, _ = load_directory(directory)
    specs = {spec.name: spec for spec in DEFAULT_SPECS}
    closes = data.field("close")

    rows = {}
    for symbol in closes.columns:
        equity = closes[symbol]
        returns = to_returns(equity)
        spec = specs.get(symbol)
        rows[symbol] = {
            "target CAGR": spec.annual_return if spec else float("nan"),
            "realised CAGR": cagr(equity),
            "target vol": spec.annual_vol if spec else float("nan"),
            "realised vol": annualised_volatility(returns),
            "target AR(1)": spec.ar1 if spec else float("nan"),
            "realised AR(1)": as_float(np.log(equity).diff().dropna().autocorr(lag=1)),
            "max drawdown": max_drawdown(equity).depth,
            "excess kurtosis": as_float(returns.kurt()),
        }
    frame = pd.DataFrame(rows).T
    frame.index.name = "symbol"
    return frame


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="data/sample", type=Path)
    args = parser.parse_args()

    frame = describe(args.data)
    print(to_markdown(frame))
    print()
    print(
        "Targets are the unconditional population values in "
        "`src/tradelab/data/synthetic.py`. The realised figures differ because a "
        "sixteen-year sample of a 20%-volatility series has a standard error on its "
        "annualised return of about five percentage points. That gap is sampling "
        "noise, not a bug, and it is the same gap that makes a single backtest on "
        "real data a weak piece of evidence."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
