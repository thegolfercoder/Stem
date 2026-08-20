"""Measuring the model the way the task is actually judged.

The metric is the share of events landed within a tolerance of the truth, which
is what the golf-swing-event literature reports and what a user experiences: an
impact frame four frames late is not "94 percent correct", it is the wrong frame.

Two tolerances are reported rather than one. A tight tolerance says whether the
model has found the instant; a loose one says whether it has found the right part
of the swing at all. Quoting only the loose figure flatters the model, and quoting
only the tight one hides the difference between a near miss and a total failure.

Tolerances are given in *milliseconds* as well as frames, because frames are not
a unit: at the canonical sixty per second, two frames is thirty-three
milliseconds, and whether that matters depends on the event. It is a long time at
impact and nothing at all at the finish.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.events import NUM_EVENTS, SwingEvent
from swingml.features import CANONICAL_RATE_HZ
from swingml.model.decode import decode_events, greedy_events
from swingml.quantity import NoReading


class EventAccuracy(BaseModel):
    """How close the predictions landed, overall and event by event."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    n_clips: int
    n_refused: int
    tolerance_frames: tuple[int, ...]
    correct_rate: dict[int, float]
    correct_rate_per_event: dict[int, tuple[float, ...]]
    mean_absolute_error_frames: tuple[float, ...]
    median_absolute_error_frames: tuple[float, ...]
    ordering_violations: int

    def summary(self) -> str:
        lines = [f"clips {self.n_clips}, refused {self.n_refused}"]
        for tolerance in self.tolerance_frames:
            ms = 1000.0 * tolerance / CANONICAL_RATE_HZ
            lines.append(
                f"  within +/-{tolerance} frames ({ms:.0f} ms): "
                f"{100 * self.correct_rate[tolerance]:.1f}%"
            )
        lines.append("  per event, mean |error| in frames:")
        for event in SwingEvent.ordered():
            lines.append(
                f"    {event.label:20s} {self.mean_absolute_error_frames[int(event)]:6.2f} "
                f"(median {self.median_absolute_error_frames[int(event)]:5.2f})"
            )
        return "\n".join(lines)


def evaluate_predictions(
    predicted: list[NDArray[np.int64] | None],
    truth: list[NDArray[np.int64]],
    tolerances: tuple[int, ...] = (1, 2, 5),
) -> EventAccuracy:
    """Accuracy of decoded event frames against ground truth."""
    errors: list[NDArray[np.int64]] = []
    refused = 0
    violations = 0
    for prediction, actual in zip(predicted, truth, strict=True):
        if prediction is None:
            refused += 1
            continue
        if np.any(np.diff(prediction) <= 0):
            violations += 1
        errors.append(np.abs(np.asarray(prediction) - np.asarray(actual)))

    if not errors:
        zeros = tuple(0.0 for _ in range(NUM_EVENTS))
        return EventAccuracy(
            n_clips=len(truth),
            n_refused=refused,
            tolerance_frames=tolerances,
            correct_rate=dict.fromkeys(tolerances, 0.0),
            correct_rate_per_event={t: zeros for t in tolerances},
            mean_absolute_error_frames=zeros,
            median_absolute_error_frames=zeros,
            ordering_violations=violations,
        )

    stacked = np.stack(errors)
    return EventAccuracy(
        n_clips=len(truth),
        n_refused=refused,
        tolerance_frames=tolerances,
        correct_rate={t: float((stacked <= t).mean()) for t in tolerances},
        correct_rate_per_event={
            t: tuple(float(v) for v in (stacked <= t).mean(axis=0)) for t in tolerances
        },
        mean_absolute_error_frames=tuple(float(v) for v in stacked.mean(axis=0)),
        median_absolute_error_frames=tuple(float(v) for v in np.median(stacked, axis=0)),
        ordering_violations=violations,
    )


def decode_batch(
    logits: NDArray[np.float32], lengths: NDArray[np.int64], min_mean_confidence: float = 0.0
) -> list[NDArray[np.int64] | None]:
    """Decode each clip in a padded batch, honouring its real length."""
    out: list[NDArray[np.int64] | None] = []
    for i, length in enumerate(lengths):
        result = decode_events(logits[i, : int(length)], min_mean_confidence)
        out.append(None if isinstance(result, NoReading) else np.asarray(result.frames))
    return out


def greedy_batch(
    logits: NDArray[np.float32], lengths: NDArray[np.int64]
) -> list[NDArray[np.int64] | None]:
    """The unconstrained baseline, for measuring what ordering the events buys."""
    return [greedy_events(logits[i, : int(length)]) for i, length in enumerate(lengths)]
