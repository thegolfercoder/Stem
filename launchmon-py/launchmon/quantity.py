"""How a number came to exist, carried by the number itself.

Principle 1 of the project brief: measured, derived, low-confidence and
modelled values must be distinguishable everywhere, in the data model, in
exports and on screen, by a type rather than a naming convention. This module
is that type. Nothing downstream should ever hold a bare float that came out
of the pipeline.

The Swift side mirrors this as an enum with the same case names and the same
wire strings, and the golden vector fixtures carry the provenance of every
value so a port that loses it fails the test suite.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Provenance(StrEnum):
    """Where a reported number came from. The wire values are part of the contract."""

    MEASURED = "measured"
    """Read from a sensor by a chain of operations that only ever reduces data."""

    DERIVED = "derived"
    """Computed from measured values by a closed-form relationship, e.g. a ratio."""

    LOW_CONFIDENCE = "low_confidence"
    """Measured, but by a method known in advance to be poor. Shown for cross-check
    only, never as the primary reading, and never silently substituted for one."""

    MODELLED = "modelled"
    """Produced by a model, not observed. Depends on assumptions that are not
    measurements, which must be listed in `assumptions`."""


class Quantity(BaseModel):
    """A single reported number, its unit, and the standing of that number.

    There is deliberately no uncertainty field. The brief forbids inventing
    accuracy figures, and an optional field for one is an invitation to fill it
    with a guess. When validation data exists, uncertainty arrives as its own
    type sourced from that data.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    value: float
    unit: str
    provenance: Provenance
    source: str = Field(description="Which sensor or model produced it, e.g. 'radar', 'imu'.")
    assumptions: tuple[str, ...] = Field(
        default=(),
        description=(
            "Inputs that were assumed rather than measured. Required for MODELLED "
            "values. Carried into exports and shown on screen."
        ),
    )

    @model_validator(mode="after")
    def _modelled_values_declare_their_assumptions(self) -> Self:
        if self.provenance is Provenance.MODELLED and not self.assumptions:
            raise ValueError(
                "a MODELLED quantity must list its assumptions: a modelled number whose "
                "assumptions are invisible is indistinguishable from a measurement"
            )
        return self

    def __str__(self) -> str:
        tag = self.provenance.value
        note = f" [assumed: {'; '.join(self.assumptions)}]" if self.assumptions else ""
        return f"{self.value:.4g} {self.unit} ({tag}, {self.source}){note}"


class NoReading(BaseModel):
    """The pipeline ran and declined to produce a number, with the reason why.

    A refusal is a result. It is recorded, counted and reported: the proportion
    of shots yielding no reading is one of the outputs the analysis stage needs.
    Returning a low-confidence guess in place of this is not permitted.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: str
    source: str

    def __str__(self) -> str:
        return f"no reading ({self.source}): {self.reason}"


Reading = Quantity | NoReading
