"""Whether a golfer's swings changed, and whether the swings can be compared at all.

Two sets of swings are compared by the difference of their means, with a Welch
95% interval from the swings' own spread. The spread between one golfer's swings
already contains the measurement's own noise, so it is the honest yardstick; the
model's systematic lean for this golfer and camera (the phone fixture reads its
tempo 52% high) largely cancels when both sets come from the same golfer, spot
and camera, and does not cancel otherwise. That is why comparability is checked
before anything is said, and why a verdict needs at least three swings a side.

What this cannot do, and says so: a change smaller than the interval is reported
as "no detectable change", never as "no change"; and tempo moves at roughly 0.44
of the real change on held-out swings, so a real change in tempo shows up smaller
than it is.

The comparability thresholds are judgements, not measurements: nothing yet says
how far a phone can move before a projected angle stops being comparable. They
are stated here so they can be tested and replaced when that is measured.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.insights.drills import Direction
from swingml.pose.base import PoseSequence
from swingml.skeleton import Landmark

MIN_SWINGS = 3
SHOULDER_RATIO_TOLERANCE = 0.30
BODY_HEIGHT_TOLERANCE = 0.30
CENTRE_TOLERANCE = 0.20
SCALE_FREE_METRICS = frozenset({"tempo_ratio", "backswing_duration", "downswing_duration"})
"""Metrics that do not depend on where the camera stood, only on the frames."""

# Two-sided 95% critical values of Student's t, by degrees of freedom. Tabulated
# rather than computed so the desktop build needs no SciPy.
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
        9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042,
        40: 2.021, 60: 2.000, 120: 1.980}  # fmt: skip


def t95(df: float) -> float:
    """The critical value for the largest tabulated df not above `df` (conservative)."""
    usable = [k for k in _T95 if k <= max(df, 1.0)]
    return _T95[max(usable)] if usable else _T95[1]


class CameraSignature(BaseModel):
    """Where the camera was, as far as the golfer's body at address can say."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    orientation: Literal["portrait", "landscape"]
    body_height: float
    """Head to feet at address, as a share of the frame height."""
    centre_x: float
    """Hips at address, across the frame from 0 to 1."""
    shoulder_ratio: float
    """Shoulder width over torso length at address: about 1 face on, near 0 down the line."""
    frame_rate: float


def camera_signature(sequence: PoseSequence, address_frame: int) -> CameraSignature | None:
    if sequence.n_frames == 0:
        return None
    frame = min(max(address_frame, 0), sequence.n_frames - 1)
    square = sequence.square_xy()[frame].astype(np.float64)
    xy = sequence.xy[frame].astype(np.float64)
    visible = sequence.visibility[frame] >= 0.3
    if visible.sum() < 8:
        return None

    def point(landmark: Landmark) -> NDArray[np.float64]:
        return np.asarray(square[int(landmark)], dtype=np.float64)

    shoulders = np.linalg.norm(point(Landmark.LEFT_SHOULDER) - point(Landmark.RIGHT_SHOULDER))
    mid_shoulder = 0.5 * (point(Landmark.LEFT_SHOULDER) + point(Landmark.RIGHT_SHOULDER))
    mid_hip = 0.5 * (point(Landmark.LEFT_HIP) + point(Landmark.RIGHT_HIP))
    torso = float(np.linalg.norm(mid_shoulder - mid_hip))
    steps = np.diff(sequence.timestamps_s)
    return CameraSignature(
        orientation="portrait" if sequence.frame_height >= sequence.frame_width else "landscape",
        body_height=float(xy[visible, 1].max() - xy[visible, 1].min()),
        centre_x=float(0.5 * (xy[int(Landmark.LEFT_HIP), 0] + xy[int(Landmark.RIGHT_HIP), 0])),
        shoulder_ratio=float(shoulders / torso) if torso > 1e-6 else float("nan"),
        frame_rate=float(1.0 / np.median(steps)) if steps.size else float("nan"),
    )


class SwingPoint(BaseModel):
    """One swing's value of the metric being tracked, with what decides comparability."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    swing_id: int
    value: float
    handedness: str
    club: str | None = None
    camera: CameraSignature | None = None


class Comparability(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    comparable: bool
    blocking: tuple[str, ...]
    warnings: tuple[str, ...]


def comparability(
    before: Sequence[SwingPoint], after: Sequence[SwingPoint], metric: str
) -> Comparability:
    blocking: list[str] = []
    warnings: list[str] = []
    points = [*before, *after]
    if len({p.handedness for p in points}) > 1:
        blocking.append("the swings are not all the same way round (right- and left-handed)")
    clubs = {p.club for p in points if p.club}
    if len(clubs) > 1:
        blocking.append(f"different clubs: {', '.join(sorted(clubs))}")
    elif any(not p.club for p in points):
        warnings.append("not every swing says which club; mixing clubs changes tempo and turn")
    cameras = [p.camera for p in points]
    if any(c is None for c in cameras):
        warnings.append(
            "some swings were analysed before the camera position was recorded, so "
            "whether the phone moved cannot be checked"
        )
    known = [c for c in cameras if c is not None]
    if known:
        if len({c.orientation for c in known}) > 1:
            blocking.append("some swings were filmed in portrait and some in landscape")
        ratios = [c.shoulder_ratio for c in known if math.isfinite(c.shoulder_ratio)]
        if ratios and max(ratios) - min(ratios) > SHOULDER_RATIO_TOLERANCE:
            blocking.append(
                "the camera angle changed (face on in some swings, more down the line in others)"
            )
        heights = [c.body_height for c in known]
        centres = [c.centre_x for c in known]
        moved = (max(heights) - min(heights)) / max(max(heights), 1e-6) > BODY_HEIGHT_TOLERANCE
        moved = moved or (max(centres) - min(centres)) > CENTRE_TOLERANCE
        if moved:
            message = "the phone was closer, further or to one side in some swings"
            if metric in SCALE_FREE_METRICS:
                warnings.append(message + "; timing is unaffected")
            else:
                blocking.append(
                    message + "; angles and movements read from the picture change with it"
                )
        rates = [c.frame_rate for c in known if math.isfinite(c.frame_rate)]
        if rates and max(rates) > 1.6 * min(rates):
            warnings.append(
                "the frame rate differed between swings; lower frame rates place positions "
                "less precisely"
            )
    return Comparability(
        comparable=not blocking, blocking=tuple(blocking), warnings=tuple(warnings)
    )


def comparable_set(points: Sequence[SwingPoint], metric: str, limit: int = 5) -> list[int]:
    """Which of `points` (newest first) form one comparable set: their indices.

    Grown from the newest swing, each swing kept only if the whole set still passes
    `comparability`, because the camera checks are ranges over the set: swings each
    within tolerance of the newest can span twice the tolerance together, and
    `compare` would then refuse the baseline it was given (#53).
    """
    chosen: list[int] = []
    for i, point in enumerate(points):
        if comparability([*(points[j] for j in chosen), point], [], metric).comparable:
            chosen.append(i)
            if len(chosen) == limit:
                break
    return chosen


Verdict = Literal[
    "improved", "worsened", "no_detectable_change", "not_comparable", "not_enough_swings"
]


class Change(BaseModel):
    """Before against after, and what can be said about it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    metric: str
    direction: Direction
    verdict: Verdict
    n_before: int
    n_after: int
    mean_before: float | None = None
    mean_after: float | None = None
    difference: float | None = None
    interval: tuple[float, float] | None = None
    smallest_detectable: float | None = None
    comparability: Comparability
    explanation: str


def _welch(before: Sequence[float], after: Sequence[float]) -> tuple[float, float, float]:
    a, b = np.asarray(before, dtype=np.float64), np.asarray(after, dtype=np.float64)
    va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b)
    se = math.sqrt(va + vb)
    if se == 0.0:
        return float(b.mean() - a.mean()), 0.0, float("inf")
    df = (va + vb) ** 2 / (va**2 / (len(a) - 1) + vb**2 / (len(b) - 1))
    return float(b.mean() - a.mean()), se, df


def _common(
    metric: str,
    direction: Direction,
    before: Sequence[SwingPoint],
    after: Sequence[SwingPoint],
    check: Comparability,
) -> dict[str, Any]:
    return {
        "metric": metric,
        "direction": direction,
        "n_before": len(before),
        "n_after": len(after),
        "comparability": check,
    }


def compare(
    before: Sequence[SwingPoint], after: Sequence[SwingPoint], metric: str, direction: Direction
) -> Change:
    check = comparability(before, after, metric)
    if len(before) < MIN_SWINGS or len(after) < MIN_SWINGS:
        need = max(MIN_SWINGS - len(before), 0), max(MIN_SWINGS - len(after), 0)
        return Change(
            **_common(metric, direction, before, after, check),
            verdict="not_enough_swings",
            explanation=(
                f"A comparison needs at least {MIN_SWINGS} swings before and {MIN_SWINGS} after; "
                f"{need[0]} more before and {need[1]} more after are needed. One or two swings "
                "cannot separate a change from the spread between swings."
            ),
        )
    if not check.comparable:
        return Change(
            **_common(metric, direction, before, after, check),
            verdict="not_comparable",
            explanation="These swings cannot be compared: " + "; ".join(check.blocking) + ".",
        )
    mean_before = float(np.mean([p.value for p in before]))
    mean_after = float(np.mean([p.value for p in after]))
    difference, se, df = _welch([p.value for p in before], [p.value for p in after])
    half = t95(df) * se
    interval = (difference - half, difference + half)
    wanted = 1.0 if direction == "increase" else -1.0
    if interval[0] > 0 or interval[1] < 0:
        verdict: Verdict = "improved" if difference * wanted > 0 else "worsened"
    else:
        verdict = "no_detectable_change"
    explanation = {
        "improved": "The change is larger than the spread between your swings can explain, "
        "and in the direction the drill aims for.",
        "worsened": "The change is larger than the spread between your swings can explain, "
        "but in the opposite direction to the one the drill aims for.",
        "no_detectable_change": f"Any change is smaller than about {half:.3g}, which is what "
        "the spread between these swings can resolve. That is not the same as no change: "
        "more swings on each side narrow it.",
    }[verdict]
    if metric == "tempo_ratio" and verdict != "not_comparable":
        explanation += (
            " Tempo readings move by less than the real change (about 0.44 of it on held-out "
            "swings), so a real change in tempo is shown smaller than it is."
        )
    return Change(
        **_common(metric, direction, before, after, check),
        verdict=verdict,
        mean_before=mean_before,
        mean_after=mean_after,
        difference=difference,
        interval=interval,
        smallest_detectable=half,
        explanation=explanation,
    )
