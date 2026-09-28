"""What skilled golfers read as, through this model, and how far that can be trusted.

Comparing a golfer against the tempo *labels* of tour players would compare two
different things: the model compresses tempo toward about 3.3 (slope 0.44 on
held-out real swings), so a golfer's reading has to be compared against the
*readings* the same model gives tour players. Both then carry the same
compression.

Measured through the application's own decision (thresholds, timing gate,
slow-motion retry) on the 170 GolfDB swings in `golfdb-validation-v1` and
`golfdb-calibration-v1`: used to choose and calibrate the shipped model, never
to train it, and kept apart from the frozen test set. Recomputed with the model;
the fingerprint below says which weights it describes.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TempoReference(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    p10: float
    p50: float
    p90: float
    n_swings: int
    source: str
    model_fingerprint: str


TOUR_TEMPO_READINGS = TempoReference(
    p10=2.89,
    p50=3.65,
    p90=4.59,
    n_swings=170,
    source=(
        "the shipped model's tempo readings on 170 GolfDB tour and range swings "
        "(golfdb-validation-v1 and golfdb-calibration-v1), none used in training"
    ),
    model_fingerprint="shipped e7_s0",
)

TEMPO_COMPRESSION_SLOPE = 0.44
"""Slope of log read tempo on log true tempo, golfdb-holdout-v1 (95% CI 0.15-0.70)."""

TEMPO_MISS_EXAMPLE = (
    "On the one phone swing whose positions were checked by hand, a true tempo of 2.1 "
    "read 3.2, inside the tour range, so a quick tempo can go unflagged."
)
