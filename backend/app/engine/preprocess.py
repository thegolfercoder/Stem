"""Turn raw user input into a clean sample suitable for regression.

Freehand strokes, screenshot traces and spreadsheet columns all arrive with
different pathologies — duplicated x values, backtracking, non-finite entries,
tens of thousands of near-identical points. This module normalises all of them
into a single sorted, deduplicated, bounded-size sample.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Above this many points the extra samples buy no accuracy but cost real time
#: in the multi-start optimiser, so the sample is decimated uniformly in x.
MAX_SAMPLES = 600


@dataclass(frozen=True)
class Sample:
    """A cleaned (x, y) sample plus notes about what cleaning was required."""

    x: np.ndarray
    y: np.ndarray
    #: False when x is not single-valued — a vertical line or a loop, which no
    #: y = f(x) model can represent.
    is_function: bool
    #: Fraction of input points that had to be merged because they shared an x.
    collapsed_fraction: float
    dropped: int
    notes: tuple[str, ...]

    @property
    def n(self) -> int:
        return int(self.x.size)


def _monotonic_run_fraction(x: np.ndarray) -> float:
    """Fraction of consecutive steps that move in the dominant x direction."""
    if x.size < 2:
        return 1.0
    steps = np.diff(x)
    forward = float(np.sum(steps > 0))
    backward = float(np.sum(steps < 0))
    total = forward + backward
    if total == 0:
        return 0.0
    return max(forward, backward) / total


def prepare(
    xs: list[float] | np.ndarray,
    ys: list[float] | np.ndarray,
    *,
    max_samples: int = MAX_SAMPLES,
) -> Sample:
    """Clean a raw point cloud into a `Sample` ready for fitting."""
    x = np.asarray(xs, dtype=float).ravel()
    y = np.asarray(ys, dtype=float).ravel()
    if x.size != y.size:
        raise ValueError("x and y must have the same length")

    notes: list[str] = []

    finite = np.isfinite(x) & np.isfinite(y)
    dropped = int(x.size - finite.sum())
    if dropped:
        notes.append(f"Dropped {dropped} non-finite point(s)")
    x, y = x[finite], y[finite]

    if x.size == 0:
        raise ValueError("no finite points supplied")

    # A stroke that doubles back is not a function of x. Detect it before
    # sorting, because sorting destroys the evidence.
    monotonic = _monotonic_run_fraction(x)
    is_function = monotonic >= 0.9

    order = np.argsort(x, kind="stable")
    x, y = x[order], y[order]

    # Merge points sharing an x (exactly, or within float noise of the span).
    tolerance = max(1e-12, (float(x[-1] - x[0]) if x.size > 1 else 1.0) * 1e-9)
    groups = np.concatenate(([0], np.cumsum(np.diff(x) > tolerance)))
    n_groups = int(groups[-1]) + 1
    collapsed = 0.0
    if n_groups < x.size:
        collapsed = 1.0 - n_groups / x.size
        counts = np.bincount(groups, minlength=n_groups)
        x = np.bincount(groups, weights=x, minlength=n_groups) / counts
        y = np.bincount(groups, weights=y, minlength=n_groups) / counts
        if collapsed > 0.02:
            notes.append(f"Averaged {collapsed:.0%} of points sharing an x value")

    if x.size > max_samples:
        # Decimate on a uniform x grid rather than by index, so dense regions of
        # a slowly drawn stroke do not dominate the fit.
        targets = np.linspace(x[0], x[-1], max_samples)
        keep = np.unique(np.searchsorted(x, targets).clip(0, x.size - 1))
        x, y = x[keep], y[keep]
        notes.append(f"Resampled to {x.size} points")

    if not is_function:
        notes.append(
            "Input is not single-valued in x; fitted against the sorted samples"
        )

    return Sample(
        x=x,
        y=y,
        is_function=is_function,
        collapsed_fraction=collapsed,
        dropped=dropped,
        notes=tuple(notes),
    )
