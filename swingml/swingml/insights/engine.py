"""The one thing to work on next, chosen by rules from measured evidence only.

Deterministic on purpose: the same swings always give the same priority, and the
language model (when one is used) may explain the choice but may not make it.
The rules, in order:

1. **Capture first.** If the latest swing was refused, or two of the last three
   were, or the body was found in under 80% of frames, nothing else measured can
   be trusted yet; the priority is getting a clean recording.
2. **Enough comparable swings.** A priority about the swing needs at least three
   analysed swings from the same camera position and club; one swing's tempo is
   uncertain by ±27%.
3. **Tempo outside what tour swings read as.** The mean tempo reading of those
   swings below the 10th or above the 90th percentile of the model's readings on
   tour swings (2.89 and 4.59). Compared reading against reading, because the
   model compresses tempo toward about 3.3 for everyone.
4. **Otherwise, no measured priority.** Nothing stands out against a reference the
   app can defend. The golfer chooses what to work on and the app measures it,
   rather than inventing a fault. This is the common case and is said plainly.

Nothing here comments on club, face, path, plane, speed or ball flight, and
nothing claims that one swing proves anything.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict

from swingml.insights.compare import MIN_SWINGS, SwingPoint, comparability
from swingml.insights.drills import BY_FOCUS, Drill
from swingml.insights.reference import TEMPO_MISS_EXAMPLE, TOUR_TEMPO_READINGS

Kind = Literal["capture", "not_enough", "tempo_quick", "tempo_slow", "choose"]

TRACKABLE: tuple[tuple[str, str], ...] = (
    ("tempo_quick", "Lengthen a quick backswing (tempo)"),
    ("tempo_slow", "Keep a long backswing moving (tempo)"),
    ("head_stability", "Keep the head centred"),
    ("pelvis_sway", "Turn rather than slide the hips"),
    ("shoulder_turn", "A fuller shoulder turn"),
)


class Evidence(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    label: str
    value: str
    provenance: str
    swing_id: int | None = None


class RecentSwing(BaseModel):
    """What the engine is allowed to look at for one swing."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    swing_id: int
    refused: bool
    refusal: str | None = None
    detection_rate: float | None = None
    tempo: float | None = None
    point: SwingPoint | None = None
    """The swing for comparability checks, when it was analysed."""


class Insight(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Kind
    title: str
    summary: str
    evidence: tuple[Evidence, ...]
    confidence: Literal["none", "low", "moderate", "high"]
    limitations: tuple[str, ...]
    drill: Drill | None
    retest: str
    success: str
    choices: tuple[tuple[str, str], ...] = ()


TEMPO_LIMITS = (
    "Each swing's tempo reading is uncertain by about ±27% (80% of held-out swings).",
    "Readings are compressed toward about 3.3, so the further a real tempo is from 3, "
    "the more it is under-read. " + TEMPO_MISS_EXAMPLE,
    "Measured on broadcast and range video of tour players; one phone swing was checked.",
)


def choose(recent: Sequence[RecentSwing]) -> Insight:
    """`recent` is newest first."""
    if not recent:
        return Insight(
            kind="not_enough",
            title="Record your first swing",
            summary="Nothing has been measured yet.",
            evidence=(),
            confidence="none",
            limitations=(),
            drill=BY_FOCUS["capture"],
            retest="Record 3 swings from the same spot.",
            success="Three swings analysed without a refusal.",
        )
    last_three = list(recent[:3])
    refused = [s for s in last_three if s.refused]
    poorly_seen = [
        s
        for s in last_three
        if not s.refused and s.detection_rate is not None and s.detection_rate < 0.8
    ]
    if recent[0].refused or len(refused) >= 2 or poorly_seen:
        evidence = tuple(
            Evidence(
                label=f"Swing {s.swing_id}",
                value=(
                    f"refused: {s.refusal}"
                    if s.refused
                    else f"body found in {100 * (s.detection_rate or 0):.0f}% of frames"
                ),
                provenance="measured",
                swing_id=s.swing_id,
            )
            for s in (*refused, *poorly_seen)
        )
        return Insight(
            kind="capture",
            title="Get a recording the app can measure",
            summary=(
                "Until swings are recorded so the whole body is seen from address to finish, "
                "every other number is unreliable. This comes before anything about the swing."
            ),
            evidence=evidence,
            confidence="high",
            limitations=("Based on the analysis's own refusals and detection rates.",),
            drill=BY_FOCUS["capture"],
            retest="Record 3 swings with the setup above.",
            success="Three swings in a row analysed without a refusal.",
        )

    analysed = [s for s in recent if not s.refused and s.tempo is not None and s.point is not None]
    newest = analysed[0] if analysed else None
    comparable: list[RecentSwing] = []
    if newest is not None and newest.point is not None:
        for swing in analysed[:10]:
            assert swing.point is not None
            if comparability([newest.point], [swing.point], "tempo_ratio").comparable:
                comparable.append(swing)
            if len(comparable) == 5:
                break
    if len(comparable) < MIN_SWINGS:
        return Insight(
            kind="not_enough",
            title=f"Record {MIN_SWINGS - len(comparable)} more swing(s) from the same spot",
            summary=(
                f"A priority needs at least {MIN_SWINGS} analysed swings filmed from the same "
                f"place with the same club; there are {len(comparable)}. One swing's tempo is "
                "uncertain by about ±27%, so a single reading cannot say what to work on."
            ),
            evidence=tuple(
                Evidence(
                    label=f"Swing {s.swing_id}",
                    value=f"tempo {s.tempo:.2f}",
                    provenance="derived",
                    swing_id=s.swing_id,
                )
                for s in comparable
            ),
            confidence="none",
            limitations=TEMPO_LIMITS,
            drill=None,
            retest=f"Record {MIN_SWINGS - len(comparable)} more swing(s) without moving the phone.",
            success=f"{MIN_SWINGS} comparable swings analysed.",
        )

    tempos = np.array([s.tempo for s in comparable], dtype=np.float64)
    mean = float(tempos.mean())
    evidence = (
        *(
            Evidence(
                label=f"Swing {s.swing_id}",
                value=f"tempo {s.tempo:.2f}",
                provenance="derived",
                swing_id=s.swing_id,
            )
            for s in comparable
        ),
        Evidence(
            label="Tour swings read by the same model",
            value=f"{TOUR_TEMPO_READINGS.p10:.2f} to {TOUR_TEMPO_READINGS.p90:.2f} "
            f"(10th to 90th percentile, {TOUR_TEMPO_READINGS.n_swings} swings)",
            provenance="measured",
        ),
    )
    reference = TOUR_TEMPO_READINGS
    if mean < reference.p10 or mean > reference.p90:
        quick = mean < reference.p10
        all_outside = bool(
            np.all(tempos < reference.p10) if quick else np.all(tempos > reference.p90)
        )
        drill = BY_FOCUS["tempo_quick" if quick else "tempo_slow"]
        return Insight(
            kind="tempo_quick" if quick else "tempo_slow",
            title=(
                "Your backswing is quick for your downswing"
                if quick
                else "Your backswing is long for your downswing"
            ),
            summary=(
                f"Your average tempo reading over {len(comparable)} comparable swings is "
                f"{mean:.2f}, {'below' if quick else 'above'} the range the same analysis reads "
                f"for 80% of tour swings ({reference.p10:.2f} to {reference.p90:.2f}). "
                "Tempo is a ratio of two durations and does not depend on where the camera stood."
            ),
            evidence=evidence,
            confidence="moderate" if all_outside else "low",
            limitations=TEMPO_LIMITS,
            drill=drill,
            retest=(
                "Practise the drill, then record 5 swings from the same spot with the same club."
            ),
            success=drill.what_counts,
        )
    return Insight(
        kind="choose",
        title="Nothing measured stands out: choose what to work on",
        summary=(
            f"Your average tempo reading over {len(comparable)} comparable swings is {mean:.2f}, "
            f"inside the range the analysis reads for tour swings. The other measurements have no "
            "reference the app can defend, so rather than guess at a fault it will measure "
            "whatever you choose to practise, against your own swings."
        ),
        evidence=evidence,
        confidence="low",
        limitations=TEMPO_LIMITS,
        drill=None,
        retest="Choose a focus, practise its drill, then record 5 swings from the same spot.",
        success="The chosen measurement moves in the drill's direction by more than the "
        "spread between your swings can explain.",
        choices=TRACKABLE,
    )
