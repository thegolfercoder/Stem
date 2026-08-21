"""Turning the model's confidence into an error bar that was measured, not guessed.

The model already reports a probability at each event it picks, and that
probability has always been labelled a diagnostic rather than an error bar,
because a number between nought and one is not a number of frames. Saying
"confidence 0.62" tells a reader nothing about whether the frame is right.

What makes it a frame count is held-out data. Run the model over clips it never
trained on, record the confidence it reported and the error it actually made, and
the relationship between the two can be read off rather than assumed. That is all
this module is: a table of measured errors, indexed by event and by how confident
the model was, with the arithmetic to look one up.

Two properties are worth being precise about.

*The quantile is the conformal one.* For a coverage of eighty percent from n
calibration samples, the right order statistic is the ceiling of 0.8 times (n+1),
not the plain eightieth percentile. The correction is small and it is the
difference between a bound that holds in finite samples and one that holds only
asymptotically - which, with a couple of hundred samples per bin, is the case
that matters.

*The table is widened, never narrowed, to make it monotone.* An error bar that
grows as the model becomes more confident is an artefact of a thin bin, and
reporting it as-is looks like a mistake. Taking a running maximum downwards from
the most confident bin removes the artefact by making low-confidence bins wider,
which cannot break the coverage it started with. Narrowing them to match would.

The important caveat travels with the table rather than living in a comment. A
band measured on rendered swings is a band for rendered swings; the corpus it
came from is recorded in `measured_on` and every band carries it, so that no
reader mistakes it for a claim about golfers on real grass.
"""

from __future__ import annotations

import math
from itertools import pairwise
from pathlib import Path
from typing import Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from swingml.events import NUM_EVENTS, SwingEvent
from swingml.features import CANONICAL_RATE_HZ
from swingml.quantity import NoReading

MIN_BIN_COUNT = 40
"""Fewest calibration samples a bin may hold and still report a band.

At forty samples an eightieth-percentile estimate rests on the eight largest
errors in the bin. Below that the number moves several frames if one clip is
added or removed, and a band that unstable is worse than no band.
"""


class ErrorBand(BaseModel):
    """How far the truth has been observed to sit from a prediction like this one.

    Not a standard deviation and not a confidence interval in the parametric
    sense: the plain statement that, on the named corpus, this share of held-out
    events fell within this many frames of where the model put them.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    half_width_frames: float = Field(ge=0.0)
    half_width_ms: float = Field(ge=0.0)
    coverage: float = Field(gt=0.0, lt=1.0)
    n_calibration: int = Field(
        ge=1, description="Held-out events this band was measured from, in this bin."
    )
    measured_on: str = Field(
        description="The corpus the errors were measured on. Part of the reading, not a footnote."
    )

    def __str__(self) -> str:
        return (
            f"+/-{self.half_width_frames:.1f} frames ({self.half_width_ms:.0f} ms) "
            f"for {100 * self.coverage:.0f}% of {self.n_calibration} held-out events "
            f"on {self.measured_on}"
        )


class EventCalibration(BaseModel):
    """Measured error bands, per event, indexed by the model's own confidence.

    Bin edges are per-event quantiles of the calibration confidences rather than a
    fixed grid, because the events do not share a confidence scale: the model is
    routinely above 0.8 at the top of the backswing and rarely above 0.4 at
    address, and a fixed grid would put every address prediction in one bin.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    coverage: float = Field(gt=0.0, lt=1.0)
    canonical_rate_hz: float = Field(gt=0.0)
    measured_on: str
    n_clips: int = Field(ge=1)
    confidence_edges: tuple[tuple[float, ...], ...] = Field(
        description="Per event, the interior bin edges on confidence. Ascending."
    )
    half_width_frames: tuple[tuple[float, ...], ...] = Field(
        description="Per event, per bin, the measured half width."
    )
    counts: tuple[tuple[int, ...], ...] = Field(
        description="Per event, per bin, how many held-out events it rests on."
    )

    @model_validator(mode="after")
    def _shapes_agree(self) -> Self:
        for name, table in (
            ("confidence_edges", self.confidence_edges),
            ("half_width_frames", self.half_width_frames),
            ("counts", self.counts),
        ):
            if len(table) != NUM_EVENTS:
                raise ValueError(f"{name} must have {NUM_EVENTS} rows, got {len(table)}")
        for event in range(NUM_EVENTS):
            n_bins = len(self.half_width_frames[event])
            if len(self.confidence_edges[event]) != n_bins - 1:
                raise ValueError(
                    f"event {event}: {n_bins} bins need {n_bins - 1} interior edges, "
                    f"got {len(self.confidence_edges[event])}"
                )
            if len(self.counts[event]) != n_bins:
                raise ValueError(f"event {event}: counts and half widths disagree in length")
            edges = self.confidence_edges[event]
            if any(b < a for a, b in pairwise(edges)):
                raise ValueError(f"event {event}: confidence edges must ascend, got {edges}")
        return self

    def band(self, event: SwingEvent, confidence: float) -> ErrorBand | NoReading:
        """The band for one prediction, or a refusal saying why there is none."""
        index = int(event)
        edges = self.confidence_edges[index]
        bin_index = int(np.searchsorted(np.asarray(edges, dtype=np.float64), confidence, "right"))
        count = self.counts[index][bin_index]
        if count < MIN_BIN_COUNT:
            return NoReading(
                reason=(
                    f"only {count} held-out events landed in this confidence range, "
                    f"fewer than the {MIN_BIN_COUNT} an error band needs to mean anything"
                ),
                source="calibration",
            )
        half_width = self.half_width_frames[index][bin_index]
        return ErrorBand(
            half_width_frames=half_width,
            half_width_ms=1000.0 * half_width / self.canonical_rate_hz,
            coverage=self.coverage,
            n_calibration=count,
            measured_on=self.measured_on,
        )

    def bands(self, confidences: tuple[float, ...]) -> tuple[ErrorBand | NoReading, ...]:
        """One band per event, in event order."""
        if len(confidences) != NUM_EVENTS:
            raise ValueError(f"expected {NUM_EVENTS} confidences, got {len(confidences)}")
        return tuple(self.band(event, confidences[int(event)]) for event in SwingEvent.ordered())

    def report(self) -> str:
        """The whole table, laid out to be read."""
        lines = [
            f"{100 * self.coverage:.0f}% error bands measured on {self.measured_on} "
            f"({self.n_clips} clips)",
            "  event                 confidence range    +/- frames   n",
        ]
        for event in SwingEvent.ordered():
            index = int(event)
            edges = (0.0, *self.confidence_edges[index], 1.0)
            for bin_index, half_width in enumerate(self.half_width_frames[index]):
                count = self.counts[index][bin_index]
                shown = f"{half_width:6.2f}" if count >= MIN_BIN_COUNT else "     -"
                label = event.label if bin_index == 0 else ""
                lines.append(
                    f"  {label:<20}  {edges[bin_index]:.2f} - {edges[bin_index + 1]:.2f}"
                    f"       {shown}    {count:4d}"
                )
        return "\n".join(lines)


def conformal_quantile(errors: NDArray[np.float64], coverage: float) -> float:
    """The smallest bound that covers `coverage` of these errors, with the finite-n fix.

    Taking the plain empirical quantile of n samples under-covers slightly, by
    roughly one part in n. The order statistic that does not is the ceiling of
    coverage times (n+1), which is the split-conformal result. When that index
    exceeds n the sample cannot support the requested coverage at all and the
    largest observed error is returned, which is the widest honest answer.
    """
    if errors.size == 0:
        raise ValueError("cannot take a quantile of no errors")
    rank = math.ceil(coverage * (errors.size + 1))
    ordered = np.sort(errors)
    if rank > errors.size:
        return float(ordered[-1])
    return float(ordered[rank - 1])


def build_calibration(
    confidence: NDArray[np.float64],
    absolute_error: NDArray[np.float64],
    *,
    measured_on: str,
    n_clips: int,
    coverage: float = 0.8,
    n_bins: int = 4,
    canonical_rate_hz: float = CANONICAL_RATE_HZ,
) -> EventCalibration:
    """Measure the table from held-out predictions.

    Args:
        confidence: (n_clips, NUM_EVENTS) the model's probability at each chosen frame.
        absolute_error: (n_clips, NUM_EVENTS) frames between the chosen frame and the truth.
        measured_on: what the calibration clips were, in words a reader can judge.
        n_clips: how many clips the rows came from.
        coverage: the share of held-out events a band is meant to contain.
        n_bins: confidence bins per event. More bins track confidence more closely
            and put fewer samples behind each number; four is about the most that
            a few hundred clips supports.
    """
    if confidence.shape != absolute_error.shape:
        raise ValueError("confidence and error tables must be the same shape")
    if confidence.ndim != 2 or confidence.shape[1] != NUM_EVENTS:
        raise ValueError(f"expected (n, {NUM_EVENTS}) tables, got {confidence.shape}")
    if n_bins < 1:
        raise ValueError("need at least one bin")

    all_edges: list[tuple[float, ...]] = []
    all_widths: list[tuple[float, ...]] = []
    all_counts: list[tuple[int, ...]] = []

    for event in range(NUM_EVENTS):
        confidences = np.asarray(confidence[:, event], dtype=np.float64)
        errors = np.asarray(absolute_error[:, event], dtype=np.float64)
        quantiles = np.linspace(0.0, 1.0, n_bins + 1)[1:-1]
        edges = np.unique(np.quantile(confidences, quantiles)) if n_bins > 1 else np.empty(0)
        assignment = np.searchsorted(edges, confidences, side="right")

        widths: list[float] = []
        counts: list[int] = []
        for bin_index in range(len(edges) + 1):
            selected = errors[assignment == bin_index]
            counts.append(int(selected.size))
            widths.append(conformal_quantile(selected, coverage) if selected.size else float("inf"))

        # Widen upwards from the most confident bin, so that a thin bin can never
        # advertise a tighter band than a bin the model was surer about.
        running = 0.0
        for bin_index in range(len(widths) - 1, -1, -1):
            running = max(running, widths[bin_index]) if np.isfinite(widths[bin_index]) else running
            widths[bin_index] = running

        all_edges.append(tuple(float(v) for v in edges))
        all_widths.append(tuple(float(v) for v in widths))
        all_counts.append(tuple(counts))

    return EventCalibration(
        coverage=coverage,
        canonical_rate_hz=canonical_rate_hz,
        measured_on=measured_on,
        n_clips=n_clips,
        confidence_edges=tuple(all_edges),
        half_width_frames=tuple(all_widths),
        counts=tuple(all_counts),
    )


def measure_coverage(
    calibration: EventCalibration,
    confidence: NDArray[np.float64],
    absolute_error: NDArray[np.float64],
) -> dict[str, float]:
    """Check a table against predictions it was not built from.

    A calibration measured and then reported on the same data is a description of
    that data, not a prediction about the next clip. This is the check that makes
    it the second thing: the share of a fresh set that lands inside the bands the
    table promises, which should come out near the coverage it claims.
    """
    inside = 0
    total = 0
    per_event: dict[str, float] = {}
    for event in SwingEvent.ordered():
        index = int(event)
        hits = 0
        seen = 0
        for row in range(confidence.shape[0]):
            band = calibration.band(event, float(confidence[row, index]))
            if isinstance(band, NoReading):
                continue
            seen += 1
            if float(absolute_error[row, index]) <= band.half_width_frames:
                hits += 1
        per_event[event.label] = hits / seen if seen else float("nan")
        inside += hits
        total += seen
    per_event["all"] = inside / total if total else float("nan")
    per_event["n"] = float(total)
    return per_event


def load_calibration(path: Path | str) -> EventCalibration:
    """Read a table from disk, validating it rather than trusting it.

    A hand-edited or half-written table would otherwise surface as a wrong error
    bar, which is the one failure this whole module exists to prevent.
    """
    return EventCalibration.model_validate_json(Path(path).read_text(encoding="utf-8"))
