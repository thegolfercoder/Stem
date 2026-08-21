"""Aggregating a session: what the golfer's own numbers do across a bucket of balls.

The single-swing numbers are less interesting than their spread. One swing with a
tempo ratio of 3.1 says almost nothing; twenty swings averaging 3.1 with a
coefficient of variation of four percent says the golfer is repeatable, and the
same twenty at eighteen percent says they are not, and that is a thing a coach
can work with.

Presented as the golfer's own patterns, never as instruction. There is no scoring
here, no target ranges, and nothing that says a swing was good or bad. The numbers
and their spread are shown; a human being interprets them.
"""

from __future__ import annotations

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from swingml.analysis import SwingAnalysis
from swingml.metrics.swing import SwingMetrics
from swingml.quantity import NoReading, Quantity

TRACKED_METRICS: tuple[str, ...] = (
    "tempo_ratio",
    "backswing_duration",
    "downswing_duration",
    "swing_duration",
    "shoulder_turn_foreshortened",
    "hip_turn_foreshortened",
    "shoulder_turn_projected",
    "hip_turn_projected",
    "separation_projected",
    "head_movement",
    "pelvis_sway",
    "time_to_peak_hand_speed",
)


class MetricSpread(BaseModel):
    """One metric across a session."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    unit: str
    provenance: str
    n: int = Field(description="Swings that produced a reading for this metric.")
    n_missing: int = Field(
        description=(
            "Swings that produced no reading. Reported alongside every average, "
            "because a metric that quietly disappears on the hard swings looks far "
            "more consistent than it is."
        )
    )
    mean: float
    median: float
    standard_deviation: float
    coefficient_of_variation: float | None = Field(
        description="Spread relative to the mean. None where the mean is near zero."
    )
    minimum: float
    maximum: float

    def __str__(self) -> str:
        cv = (
            f"{100 * self.coefficient_of_variation:5.1f}%"
            if self.coefficient_of_variation is not None
            else "    - "
        )
        missing = f", {self.n_missing} missing" if self.n_missing else ""
        return (
            f"{self.name:24s} {self.mean:8.3f} +/- {self.standard_deviation:7.3f} "
            f"{self.unit:12s} spread {cv}  (n={self.n}{missing})"
        )


class SessionSummary(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    n_swings: int
    n_analysed: int
    n_refused: int
    spreads: tuple[MetricSpread, ...]
    kinematic_sequences: dict[str, int] = Field(
        description="How often each ordering of the segment peaks was observed."
    )

    def get(self, name: str) -> MetricSpread | None:
        for spread in self.spreads:
            if spread.name == name:
                return spread
        return None

    def describe(self) -> str:
        lines = [
            f"session: {self.n_analysed} of {self.n_swings} swings analysed"
            + (f", {self.n_refused} refused" if self.n_refused else "")
        ]
        lines.extend(f"  {spread}" for spread in self.spreads)
        if self.kinematic_sequences:
            lines.append("  kinematic sequence, times observed:")
            for order, count in sorted(self.kinematic_sequences.items(), key=lambda item: -item[1]):
                lines.append(f"    {count:3d}  {order}")
        return "\n".join(lines)


def _spread(name: str, readings: list[Quantity], n_missing: int) -> MetricSpread | None:
    if not readings:
        return None
    values = np.array([r.value for r in readings], dtype=np.float64)
    mean = float(values.mean())
    deviation = float(values.std(ddof=1)) if len(values) > 1 else 0.0
    return MetricSpread(
        name=name,
        unit=readings[0].unit,
        provenance=readings[0].provenance.value,
        n=len(values),
        n_missing=n_missing,
        mean=mean,
        median=float(np.median(values)),
        standard_deviation=deviation,
        coefficient_of_variation=(deviation / abs(mean)) if abs(mean) > 1e-9 else None,
        minimum=float(values.min()),
        maximum=float(values.max()),
    )


def summarise_session(analyses: list[SwingAnalysis]) -> SessionSummary:
    """Spread of every tracked metric across a session's swings."""
    usable = [a.metrics for a in analyses if isinstance(a.metrics, SwingMetrics)]
    refused = len(analyses) - len(usable)

    spreads: list[MetricSpread] = []
    for name in TRACKED_METRICS:
        readings: list[Quantity] = []
        missing = 0
        for metrics in usable:
            reading = getattr(metrics, name)
            if isinstance(reading, NoReading):
                missing += 1
            else:
                readings.append(reading)
        spread = _spread(name, readings, missing)
        if spread is not None:
            spreads.append(spread)

    sequences: dict[str, int] = {}
    for metrics in usable:
        key = " -> ".join(metrics.kinematic_sequence)
        sequences[key] = sequences.get(key, 0) + 1

    return SessionSummary(
        n_swings=len(analyses),
        n_analysed=len(usable),
        n_refused=refused,
        spreads=tuple(spreads),
        kinematic_sequences=sequences,
    )


def compare_sessions(current: SessionSummary, baseline: SessionSummary) -> str:
    """Change in each metric against an earlier session, as a plain table.

    Differences are reported, not judged. Whether a shorter backswing is an
    improvement is not something this can know.
    """
    lines = ["metric                     now        before      change"]
    for spread in current.spreads:
        previous = baseline.get(spread.name)
        if previous is None:
            continue
        delta = spread.mean - previous.mean
        percent = 100.0 * delta / abs(previous.mean) if abs(previous.mean) > 1e-9 else float("nan")
        lines.append(
            f"{spread.name:24s} {spread.mean:9.3f}  {previous.mean:9.3f}  "
            f"{delta:+8.3f} ({percent:+.1f}%)"
        )
    return "\n".join(lines)
