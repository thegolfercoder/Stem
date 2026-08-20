"""Provenance is carried by the type, and modelled numbers declare what they assumed."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from launchmon.quantity import NoReading, Provenance, Quantity


def test_provenance_wire_values_are_stable() -> None:
    # The Swift enum and the golden vector fixtures both depend on these strings.
    assert [p.value for p in Provenance] == ["measured", "derived", "low_confidence", "modelled"]


def test_modelled_quantity_must_declare_assumptions() -> None:
    with pytest.raises(ValidationError):
        Quantity(value=275.0, unit="yd", provenance=Provenance.MODELLED, source="trajectory")


def test_modelled_quantity_with_assumptions_is_accepted_and_shows_them() -> None:
    carry = Quantity(
        value=275.0,
        unit="yd",
        provenance=Provenance.MODELLED,
        source="trajectory",
        assumptions=("backspin 2686 rpm, a per-club prior and not a measurement",),
    )
    assert "assumed" in str(carry)


def test_measured_quantity_needs_no_assumptions() -> None:
    Quantity(value=74.66, unit="m/s", provenance=Provenance.MEASURED, source="radar")


def test_quantities_are_immutable() -> None:
    speed = Quantity(value=74.66, unit="m/s", provenance=Provenance.MEASURED, source="radar")
    with pytest.raises(ValidationError):
        speed.value = 80.0


def test_no_reading_carries_a_reason() -> None:
    refusal = NoReading(reason="ball never rose above the noise floor", source="radar")
    assert refusal.reason in str(refusal)
