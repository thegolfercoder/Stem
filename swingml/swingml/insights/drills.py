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
    ),
)

BY_FOCUS: dict[str, Drill] = {drill.focus: drill for drill in DRILLS}
BY_ID: dict[str, Drill] = {drill.id: drill for drill in DRILLS}
