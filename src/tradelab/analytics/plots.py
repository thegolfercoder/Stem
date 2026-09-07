"""Charts.

Matplotlib only, with an ``Agg`` backend chosen at import time so this works on
a machine with no display - a CI runner, for instance. Nothing here calls
``plt.show``; every function returns a ``Figure`` for the caller to save or
display.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure

from tradelab.analytics.metrics import drawdown_series

_PALETTE = ("#2b5d8c", "#c0603f", "#4a7c59", "#6b5b95", "#8c7b2b", "#7a7a7a")


def equity_curves(
    curves: dict[str, pd.Series],
    *,
    title: str = "Equity curves",
    log_scale: bool = True,
    normalise: bool = True,
) -> Figure:
    """Equity curves and their drawdowns, on a shared time axis.

    Log scale by default. A linear equity chart makes the last two years of any
    compounding series look like the only years that mattered, which is a
    presentation artefact rather than a fact about the strategy.
    """
    figure, (top, bottom) = plt.subplots(
        2, 1, figsize=(11, 7), sharex=True, gridspec_kw={"height_ratios": [3, 1]}
    )
    for (name, curve), colour in zip(curves.items(), _PALETTE * 4, strict=False):
        series = curve / curve.iloc[0] if normalise else curve
        top.plot(series.index, series.to_numpy(), label=name, color=colour, linewidth=1.3)
        bottom.fill_between(
            curve.index, drawdown_series(curve).to_numpy() * 100, 0, color=colour, alpha=0.25
        )

    top.set_title(title)
    top.set_ylabel("growth of 1" if normalise else "equity")
    if log_scale:
        top.set_yscale("log")
    top.legend(loc="upper left", frameon=False)
    top.grid(alpha=0.25)

    bottom.set_ylabel("drawdown (%)")
    bottom.grid(alpha=0.25)
    figure.tight_layout()
    return figure


def return_distribution(returns: pd.Series, *, title: str = "Return distribution") -> Figure:
    """A histogram of per-bar returns against the normal that shares its moments.

    The gap between the two in the tails is the point: risk numbers that assume
    normality understate what actually happens, and this chart is where that
    stops being an abstract caveat.
    """
    figure, axis = plt.subplots(figsize=(9, 5))
    values = returns.dropna().to_numpy() * 100
    axis.hist(values, bins=80, color=_PALETTE[0], alpha=0.75, density=True, label="observed")

    grid = np.linspace(values.min(), values.max(), 400)
    mu, sigma = values.mean(), values.std(ddof=1)
    if sigma > 0:
        normal = np.exp(-0.5 * ((grid - mu) / sigma) ** 2) / (sigma * np.sqrt(2 * np.pi))
        axis.plot(grid, normal, color=_PALETTE[1], linewidth=1.5, label="normal, same mean and sd")

    axis.set_title(title)
    axis.set_xlabel("return per bar (%)")
    axis.set_ylabel("density")
    axis.legend(frameon=False)
    axis.grid(alpha=0.25)
    figure.tight_layout()
    return figure


def exposure_chart(equity_curve: pd.DataFrame, *, title: str = "Exposure") -> Figure:
    """Gross and net exposure through time."""
    figure, axis = plt.subplots(figsize=(11, 3.5))
    axis.fill_between(
        equity_curve.index,
        equity_curve["gross_exposure"].to_numpy() * 100,
        0,
        color=_PALETTE[0],
        alpha=0.3,
        label="gross",
    )
    axis.plot(
        equity_curve.index,
        equity_curve["net_exposure"].to_numpy() * 100,
        color=_PALETTE[1],
        linewidth=1.0,
        label="net",
    )
    axis.axhline(0, color="black", linewidth=0.6)
    axis.set_title(title)
    axis.set_ylabel("% of equity")
    axis.legend(frameon=False)
    axis.grid(alpha=0.25)
    figure.tight_layout()
    return figure


def save(figure: Figure, path: Path | str, *, dpi: int = 130) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close(figure)
    return path
