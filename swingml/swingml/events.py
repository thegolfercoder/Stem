"""The eight events a golf swing is divided into, and the sequence they form.

These are the events defined by GolfDB (McNally et al., CVPR Workshops 2019),
used here so that anything built on synthetic data can later be trained or
evaluated against that dataset without redefining the problem.

The ordering is the whole point. A golf swing is not eight independent detection
problems: the events occur exactly once each, always in this order, and no
sequence that violates that is a swing. Encoding the ordering in the type - and
enforcing it when decoding - removes an entire class of nonsense output that a
per-frame classifier will otherwise produce happily.
"""

from __future__ import annotations

import itertools
from enum import IntEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SwingEvent(IntEnum):
    """The eight events, in the order they must occur. Values are the class indices."""

    ADDRESS = 0
    """Setup complete, club behind the ball, motion about to begin."""

    TOE_UP = 1
    """Club shaft horizontal on the way back, toe of the club pointing up."""

    MID_BACKSWING = 2
    """Lead arm horizontal on the way back."""

    TOP = 3
    """Transition. The last frame before the club changes direction."""

    MID_DOWNSWING = 4
    """Lead arm horizontal again, coming down."""

    IMPACT = 5
    """Club meets ball."""

    MID_FOLLOW_THROUGH = 6
    """Club shaft horizontal after impact."""

    FINISH = 7
    """Full finish position, motion complete."""

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()

    @classmethod
    def ordered(cls) -> tuple[SwingEvent, ...]:
        return tuple(sorted(cls, key=int))


NUM_EVENTS = len(SwingEvent)

# The per-frame classifier emits one class per event plus a background class for
# every frame that is not an event, which is nearly all of them.
BACKGROUND_CLASS = NUM_EVENTS
NUM_CLASSES = NUM_EVENTS + 1


# Which events a body-pose-only system can locate on its own evidence, and which
# it is inferring. Two of the eight are defined by the club shaft's angle, and a
# pose estimator does not see the club. They are still predicted - the temporal
# model learns where they fall relative to the body - but they rest on the
# regularity of the swing rather than on anything observed, and the distinction
# is carried through to the output rather than being quietly dropped.
CLUB_DEFINED_EVENTS: frozenset[SwingEvent] = frozenset(
    {SwingEvent.TOE_UP, SwingEvent.MID_FOLLOW_THROUGH}
)


class EventSequence(BaseModel):
    """Eight frame indices, strictly increasing, one per event.

    Construction fails if the ordering is violated. That is deliberate: an
    out-of-order sequence is not a low-quality result to be flagged downstream,
    it is not a swing, and letting one exist would mean every consumer has to
    re-check it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    frames: tuple[int, int, int, int, int, int, int, int]
    confidence: tuple[float, float, float, float, float, float, float, float] = Field(
        description="Model probability at each chosen frame. A diagnostic, not an error bar."
    )
    subframe: tuple[float, float, float, float, float, float, float, float] | None = Field(
        default=None,
        description=(
            "Event positions refined to a fraction of a frame, from the shape of the "
            "model's probability around each chosen frame. An event does not happen "
            "on a frame boundary; which frame is nearest is partly an accident of "
            "when the shutter opened. Tempo is a ratio of two durations, one of them "
            "short, so a quarter of a frame at each end is worth recovering."
        ),
    )

    @model_validator(mode="after")
    def _strictly_increasing(self) -> Self:
        if any(b <= a for a, b in itertools.pairwise(self.frames)):
            raise ValueError(f"swing events must be strictly increasing in time, got {self.frames}")
        return self

    def frame_of(self, event: SwingEvent) -> int:
        return self.frames[int(event)]

    def position_of(self, event: SwingEvent) -> float:
        """Sub-frame position where one is available, otherwise the frame index."""
        if self.subframe is None:
            return float(self.frames[int(event)])
        return self.subframe[int(event)]

    def confidence_of(self, event: SwingEvent) -> float:
        return self.confidence[int(event)]

    def duration_frames(self, start: SwingEvent, end: SwingEvent) -> int:
        return self.frame_of(end) - self.frame_of(start)

    def __str__(self) -> str:
        parts = [f"{e.label} @ {self.frame_of(e)}" for e in SwingEvent.ordered()]
        return ", ".join(parts)
