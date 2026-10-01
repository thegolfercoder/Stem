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


class BodyReference(BaseModel):
    """Where tour swings read for one picture-based measure, with 95% intervals."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    unit: str
    p10: float
    p50: float
    p90: float
    p10_ci95: tuple[float, float]
    p50_ci95: tuple[float, float]
    p90_ci95: tuple[float, float]
    n_swings: int
    n_groups: int
    source: str
    model_fingerprint: str


_BODY_SOURCE = (
    "the shipped pipeline's readings (MediaPipe, then the app's decision and metrics) on "
    "the 85 face-on GolfDB clips of golfdb-validation-v2 and golfdb-calibration-v2, none "
    "used in training; intervals resample golfer/video groups (scripts/body_reference.py, "
    "docs/audit/body-reference.json)"
)

TOUR_BODY_READINGS: dict[str, BodyReference] = {
    "head_movement": BodyReference(
        unit="body lengths", p10=0.03, p50=0.071, p90=0.14,
        p10_ci95=(0.017, 0.045), p50_ci95=(0.055, 0.093), p90_ci95=(0.109, 0.158),
        n_swings=84, n_groups=32, source=_BODY_SOURCE,
        model_fingerprint="8c70fac9540d053b6936aca3cb4688fc",
    ),
    "pelvis_sway": BodyReference(
        unit="body lengths", p10=0.03, p50=0.058, p90=0.093,
        p10_ci95=(0.015, 0.041), p50_ci95=(0.046, 0.074), p90_ci95=(0.081, 0.107),
        n_swings=84, n_groups=32, source=_BODY_SOURCE,
        model_fingerprint="8c70fac9540d053b6936aca3cb4688fc",
    ),
    "shoulder_turn_foreshortened": BodyReference(
        unit="deg", p10=49.044, p50=57.96, p90=74.574,
        p10_ci95=(47.334, 51.518), p50_ci95=(54.611, 61.974), p90_ci95=(70.307, 81.842),
        n_swings=84, n_groups=32, source=_BODY_SOURCE,
        model_fingerprint="8c70fac9540d053b6936aca3cb4688fc",
    ),
}  # fmt: skip
"""Tour readings for the three measures behind the head, sway and turn focuses (#12).

Face on only, broadcast footage, tour players. Not used by any priority rule:
the practice loop still waits for the golfer to choose these focuses
(docs/ml/checkpoint-reference.md says why, and what these do not claim).
"""
