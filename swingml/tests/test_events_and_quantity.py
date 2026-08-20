"""The two type-level guarantees the rest of the system leans on."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from swingml.events import (
    BACKGROUND_CLASS,
    CLUB_DEFINED_EVENTS,
    NUM_CLASSES,
    NUM_EVENTS,
    EventSequence,
    SwingEvent,
)
from swingml.quantity import NoReading, Provenance, Quantity


def test_events_are_ordered_and_indexed_from_zero() -> None:
    assert [int(e) for e in SwingEvent.ordered()] == list(range(NUM_EVENTS))
    assert BACKGROUND_CLASS == NUM_EVENTS
    assert NUM_CLASSES == NUM_EVENTS + 1


def test_an_out_of_order_sequence_cannot_be_constructed() -> None:
    """Impact before the top of the backswing is not a low-quality swing. It is not a swing."""
    with pytest.raises(ValidationError):
        EventSequence(frames=(0, 10, 20, 90, 40, 50, 60, 70), confidence=(0.9,) * 8)


def test_repeated_frames_are_rejected() -> None:
    with pytest.raises(ValidationError):
        EventSequence(frames=(0, 10, 10, 30, 40, 50, 60, 70), confidence=(0.9,) * 8)


def test_subframe_position_falls_back_to_the_frame_index() -> None:
    events = EventSequence(frames=(0, 10, 20, 30, 40, 50, 60, 70), confidence=(0.9,) * 8)
    assert events.position_of(SwingEvent.TOP) == 30.0

    refined = events.model_copy(
        update={"subframe": (0.0, 10.0, 20.0, 30.4, 40.0, 50.0, 60.0, 70.0)}
    )
    assert refined.position_of(SwingEvent.TOP) == pytest.approx(30.4)


def test_the_club_defined_events_are_flagged_as_such() -> None:
    """A body-pose estimator does not see the club, and two events are defined by it."""
    assert {SwingEvent.TOE_UP, SwingEvent.MID_FOLLOW_THROUGH} == CLUB_DEFINED_EVENTS


def test_provenance_wire_values_are_stable() -> None:
    assert [p.value for p in Provenance] == [
        "measured",
        "projected",
        "estimated_3d",
        "derived",
        "modelled",
    ]


def test_a_modelled_quantity_must_declare_its_assumptions() -> None:
    with pytest.raises(ValidationError):
        Quantity(value=1.0, unit="deg", provenance=Provenance.MODELLED, source="x")


def test_a_projected_angle_says_so_when_printed() -> None:
    angle = Quantity(
        value=84.0,
        unit="deg",
        provenance=Provenance.PROJECTED,
        source="pose",
        assumptions=("image plane only",),
    )
    assert "projected" in str(angle)
    assert "image plane" in str(angle)


def test_no_reading_carries_a_reason() -> None:
    assert "feet" in str(NoReading(reason="the feet are not in shot", source="pose"))
