"""Practice drills, each tied to one thing the app can measure before and after.

A drill is only offered where the app can tell whether practising it changed
anything: every one names the metric it will be judged on, the direction that
counts as progress, and the evidence that would show it. Drills describe what
to practise; none of them claims to fix a cause, because one camera on a body
tracker cannot see causes, and none is offered as treatment for pain.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Direction = Literal["increase", "decrease"]

Point = tuple[float, float]

JOINTS = (
    "head", "neck", "r_sh", "l_sh", "r_el", "l_el", "hands", "grip", "club",
    "r_hip", "l_hip", "r_knee", "l_knee", "r_foot", "l_foot",
)  # fmt: skip
"""A stick figure's points, seen face on: x to the viewer's right, y down, in a
100 by 140 box. `grip` to `club` is the shaft (or the club held across the chest)."""


def _pose(base: dict[str, Point] | None = None, **points: Point) -> dict[str, Point]:
    pose = {**(base or {}), **points}
    pose.setdefault("grip", pose["hands"])
    return pose


_HEAD: dict[str, Point] = {"head": (50, 20), "neck": (50, 32)}
_LEGS: dict[str, Point] = {"r_knee": (41, 98), "l_knee": (59, 98), "r_foot": (38, 128),
                           "l_foot": (62, 128)}  # fmt: skip

# A right-handed swing, face on, drawn by hand: an illustration of the move, not a
# measurement of anyone's swing. The head holds still to impact (the head drill
# shows it against a box), and the hips turn without sliding.
# fmt: off
POSES: dict[str, dict[str, Point]] = {
    "address": _pose({**_HEAD, **_LEGS}, r_sh=(39, 37), l_sh=(61, 37), r_el=(43, 58),
                     l_el=(57, 58), hands=(50, 80), club=(53, 128), r_hip=(43, 70),
                     l_hip=(57, 70)),
    "takeaway": _pose({**_HEAD, **_LEGS}, r_sh=(40, 36), l_sh=(59, 39), r_el=(38, 58),
                      l_el=(48, 58), hands=(38, 76), club=(12, 74), r_hip=(44, 70),
                      l_hip=(57, 70), l_knee=(57, 98)),
    "top": _pose({**_HEAD, **_LEGS}, r_sh=(42, 35), l_sh=(55, 41), r_el=(30, 34),
                 l_el=(42, 36), hands=(32, 20), club=(74, 12), r_hip=(45, 70),
                 l_hip=(56, 71), l_knee=(55, 99)),
    "short_top": _pose({**_HEAD, **_LEGS}, r_sh=(41, 35), l_sh=(57, 40), r_el=(32, 48),
                       l_el=(42, 46), hands=(30, 36), club=(36, 8), r_hip=(44, 70),
                       l_hip=(57, 70), l_knee=(56, 98)),
    "downswing": _pose({**_HEAD, **_LEGS}, r_sh=(40, 37), l_sh=(58, 38), r_el=(38, 52),
                       l_el=(46, 52), hands=(38, 62), club=(22, 34), r_hip=(44, 70),
                       l_hip=(57, 70)),
    "impact": _pose({**_HEAD, **_LEGS}, r_sh=(39, 39), l_sh=(60, 36), r_el=(45, 60),
                    l_el=(56, 58), hands=(53, 80), club=(52, 128), r_hip=(44, 70),
                    l_hip=(57, 69), r_knee=(44, 99)),
    "through": _pose({**_HEAD, **_LEGS}, r_sh=(44, 38), l_sh=(60, 36), r_el=(56, 62),
                     l_el=(64, 60), hands=(64, 72), club=(90, 70), r_hip=(45, 70),
                     l_hip=(57, 69), r_knee=(46, 99), r_foot=(40, 127)),
    "finish": _pose(_LEGS, head=(52, 21), neck=(52, 33), r_sh=(46, 38), l_sh=(58, 36),
                    r_el=(56, 26), l_el=(64, 30), hands=(64, 18), club=(38, 12),
                    r_hip=(46, 70), l_hip=(56, 69), r_knee=(48, 100), r_foot=(44, 126)),
    # Arms crossed over a club held across the chest, then turned back.
    "chest_address": _pose({**_HEAD, **_LEGS}, r_sh=(39, 37), l_sh=(61, 37), r_el=(45, 52),
                           l_el=(55, 52), hands=(50, 44), grip=(30, 43), club=(70, 43),
                           r_hip=(43, 70), l_hip=(57, 70)),
    "chest_turned": _pose({**_HEAD, **_LEGS}, r_sh=(44, 36), l_sh=(56, 41), r_el=(47, 51),
                          l_el=(54, 53), hands=(50, 44), grip=(42, 37), club=(60, 50),
                          r_hip=(45, 70), l_hip=(56, 70), l_knee=(56, 98)),
}
# fmt: on
_FEET_TOGETHER: dict[str, Point] = {
    "r_knee": (46, 98),
    "l_knee": (54, 98),
    "r_foot": (47, 128),
    "l_foot": (53, 128),
}  # fmt: skip
for _name in ("address", "takeaway", "short_top", "downswing", "impact", "through", "finish"):
    POSES[f"together_{_name}"] = {**POSES[_name], **_FEET_TOGETHER}


class DemoKey(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    at: float
    """Seconds into the loop."""
    pose: str
    """A name in POSES."""
    say: str | None = None
    """A word of the drill's count, shown from this key to the next."""


class Demo(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    keys: tuple[DemoKey, ...]
    """In time order; the last key's time is the loop's length."""
    highlight: Literal["head", "hips", "shoulders", "frame"]
    """The body line the drill is about, drawn in the accent colour."""
    props: tuple[Literal["stick"], ...] = ()


def _keys(*keys: tuple[float, str] | tuple[float, str, str]) -> tuple[DemoKey, ...]:
    return tuple(DemoKey(at=k[0], pose=k[1], say=k[2] if len(k) > 2 else None) for k in keys)


_FULL_SWING = _keys((0, "address"), (0.7, "takeaway"), (1.4, "top"), (1.75, "downswing"),
                    (1.9, "impact"), (2.05, "through"), (2.4, "finish"), (3.4, "finish"),
                    (4.2, "address"))  # fmt: skip


class Drill(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    focus: str
    title: str
    steps: tuple[str, ...]
    reps: str
    metric: str
    """The SwingMetrics field a retest compares."""
    direction: Direction
    """Which way the metric should move if the drill is working."""
    what_counts: str
    sets: int
    """The sets in `reps`, for the page's rep counter."""
    reps_per_set: int
    demo: Demo
    """A looping stick-figure illustration of the move: drawn by hand, not measured."""


DRILLS: tuple[Drill, ...] = (
    Drill(
        id="capture-setup",
        focus="capture",
        title="Set up the camera so every swing can be measured",
        steps=(
            "Phone at hip height on a stand or propped up, not held.",
            "Face on: level with the golfer, square to the target line, about 4 m away.",
            "Whole body in frame from head to feet, with space above the hands at the top.",
            "Start recording before you address the ball; stop after holding the finish.",
            "Film at 60 frames a second or more if the phone offers it, in good light.",
        ),
        reps="3 swings",
        metric="detection_rate",
        direction="increase",
        what_counts="Three swings in a row analysed without a refusal.",
        sets=1,
        reps_per_set=3,
        demo=Demo(keys=_FULL_SWING, highlight="frame"),
    ),
    Drill(
        id="tempo-count-three",
        focus="tempo_quick",
        title="Slow the backswing to a three count",
        steps=(
            "Say 'one-two-three' at an even pace as you take the club back to the top.",
            "Say 'one' as you swing down through the ball.",
            "Keep the downswing at its normal speed: only the backswing gets longer.",
        ),
        reps="3 sets of 5 swings, then 5 recorded swings",
        metric="tempo_ratio",
        direction="increase",
        what_counts=(
            "Your average tempo reading over at least 3 recorded swings rises, by more "
            "than the spread between your swings can explain."
        ),
        sets=3,
        reps_per_set=5,
        # Three beats back, one down: slowed down so the count can be read.
        demo=Demo(
            keys=_keys(
                (0, "address", "one"),
                (0.75, "address", "two"),
                (1.0, "takeaway", "two"),
                (1.5, "takeaway", "three"),
                (2.25, "top", "one"),
                (2.6, "downswing", "one"),
                (3.0, "impact"),
                (3.15, "through"),
                (3.5, "finish"),
                (4.5, "finish"),
                (5.3, "address"),
            ),
            highlight="shoulders",
        ),
    ),
    Drill(
        id="tempo-shorter-backswing",
        focus="tempo_slow",
        title="Keep the backswing moving: a two count back",
        steps=(
            "Say 'one-two' as you take the club back, without a pause at the top.",
            "Say 'one' as you swing down.",
            "Let the backswing be a little shorter if that keeps it moving.",
        ),
        reps="3 sets of 5 swings, then 5 recorded swings",
        metric="tempo_ratio",
        direction="decrease",
        what_counts=(
            "Your average tempo reading over at least 3 recorded swings falls, by more "
            "than the spread between your swings can explain."
        ),
        sets=3,
        reps_per_set=5,
        # Two beats back to a shorter top, no pause, one down.
        demo=Demo(
            keys=_keys(
                (0, "address", "one"),
                (0.75, "takeaway", "two"),
                (1.5, "short_top", "one"),
                (1.85, "downswing", "one"),
                (2.0, "impact"),
                (2.15, "through"),
                (2.5, "finish"),
                (3.5, "finish"),
                (4.3, "address"),
            ),
            highlight="shoulders",
        ),
    ),
    Drill(
        id="head-still-alignment-stick",
        focus="head_stability",
        title="Keep the head centred through impact",
        steps=(
            "Push an alignment stick or umbrella into the ground just beside your head at "
            "address, on the side away from the target.",
            "Make half swings, then full swings, without your head touching it.",
        ),
        reps="3 sets of 8 swings, then 5 recorded swings from the same camera spot",
        metric="head_movement",
        direction="decrease",
        what_counts=(
            "Head movement from address to impact falls, filmed from the same spot, by more "
            "than the spread between your swings can explain."
        ),
        sets=3,
        reps_per_set=8,
        demo=Demo(keys=_FULL_SWING, highlight="head", props=("stick",)),
    ),
    Drill(
        id="feet-together-sway",
        focus="pelvis_sway",
        title="Feet-together swings to turn rather than slide",
        steps=(
            "Stand with your feet touching and hit easy three-quarter shots.",
            "If you lose balance, you are sliding; slow down until you can hold the finish.",
            "Return to your normal stance and keep the same feeling of turning in place.",
        ),
        reps="3 sets of 6 swings, then 5 recorded swings from the same camera spot",
        metric="pelvis_sway",
        direction="decrease",
        what_counts=(
            "Pelvis sway from address to impact falls, filmed from the same spot, by more "
            "than the spread between your swings can explain."
        ),
        sets=3,
        reps_per_set=6,
        demo=Demo(
            keys=_keys(
                (0, "together_address"),
                (0.7, "together_takeaway"),
                (1.3, "together_short_top"),
                (1.65, "together_downswing"),
                (1.8, "together_impact"),
                (1.95, "together_through"),
                (2.3, "together_finish"),
                (3.3, "together_finish"),
                (4.1, "together_address"),
            ),
            highlight="hips",
        ),
    ),
    Drill(
        id="shoulder-turn-club-across-chest",
        focus="shoulder_turn",
        title="Turn the shoulders fully with a club across the chest",
        steps=(
            "Hold a club across your chest with both arms crossed over it.",
            "Turn back until the club points at the ball, keeping your spine angle.",
            "Make the same turn in your swing without letting the arms race ahead.",
        ),
        reps="2 sets of 10 turns, then 5 recorded swings from the same camera spot",
        metric="shoulder_turn_foreshortened",
        direction="increase",
        what_counts=(
            "Shoulder turn at the top, read from the same camera spot, rises by more than "
            "the spread between your swings can explain. The angle reads low against "
            "reality; only its change means anything."
        ),
        sets=2,
        reps_per_set=10,
        demo=Demo(
            keys=_keys(
                (0, "chest_address"),
                (1.2, "chest_turned"),
                (2.2, "chest_turned"),
                (3.2, "chest_address"),
                (3.8, "chest_address"),
            ),
            highlight="shoulders",
        ),
    ),
)

BY_FOCUS: dict[str, Drill] = {drill.focus: drill for drill in DRILLS}
BY_ID: dict[str, Drill] = {drill.id: drill for drill in DRILLS}
