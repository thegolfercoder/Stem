"""How a number came to exist, carried by the number itself.

A single camera at an unknown angle, with no calibration, can measure some things
outright, can infer others only under an assumption, and cannot measure a third
group at all. Presenting all three as plain floats invites the reader to trust
them equally, which is how a swing analyser ends up quoting degrees of shoulder
rotation it never measured.

Nothing downstream should hold a bare float that came out of the pipeline.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Provenance(StrEnum):
    """Where a reported number came from."""

    MEASURED = "measured"
    """Read from the video by operations that only reduce data. Frame timings and
    anything counted rather than modelled."""

    PROJECTED = "projected"
    """A real geometric quantity, but measured in the image plane rather than in
    the world. A shoulder line that appears to turn 80 degrees on screen has not
    turned 80 degrees in space unless the camera happens to be looking straight
    down the axis of rotation. Honest for comparing one swing against another from
    the same camera position; not a body angle."""

    ESTIMATED_3D = "estimated_3d"
    """From the pose estimator's own three-dimensional output, which is inferred
    by a network from a single view rather than triangulated. Better than a
    projection for absolute angles, and still a model's opinion."""

    DERIVED = "derived"
    """Computed from other values by a closed-form relationship, such as a ratio."""

    MODELLED = "modelled"
    """Produced by a model rather than observed. Must list its assumptions."""


class Quantity(BaseModel):
    """A single reported number, its unit, and the standing of that number.

    There is deliberately no uncertainty field. An optional slot for an error bar
    is an invitation to fill it with a guess; when validation data exists,
    uncertainty arrives as its own type sourced from that data.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    value: float
    unit: str
    provenance: Provenance
    source: str = Field(description="What produced it, e.g. 'pose', 'events', 'timestamps'.")
    assumptions: tuple[str, ...] = ()

    @model_validator(mode="after")
    def _modelled_values_declare_their_assumptions(self) -> Self:
        if self.provenance is Provenance.MODELLED and not self.assumptions:
            raise ValueError("a MODELLED quantity must list its assumptions")
        return self

    def __str__(self) -> str:
        note = f" [assumed: {'; '.join(self.assumptions)}]" if self.assumptions else ""
        return f"{self.value:.4g} {self.unit} ({self.provenance.value}){note}"


class NoReading(BaseModel):
    """The pipeline ran and declined to produce a number, with the reason why.

    A refusal is a result. The share of swings that produce no reading for a given
    metric is itself reported, because a metric that quietly disappears on hard
    footage looks better than it is.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: str
    source: str

    def __str__(self) -> str:
        return f"no reading ({self.source}): {self.reason}"


Reading = Quantity | NoReading
