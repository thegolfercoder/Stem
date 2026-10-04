"""Stem's read in the browser page (#52), run in node on fixture analyses.

webapp/read.js turns the page's numbers and the practice engine's priority into a
few sentences. These hold it to three things: every number in it is the page's
number with the page's rounding, the priority is practice.js's and no other, and
nothing in it names a quantity one camera cannot measure.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from swingml.insights.compare import CameraSignature, SwingPoint
from swingml.insights.engine import RecentSwing
from swingml.insights.payload import practice_payload
from swingml.insights.reference import TOUR_BODY_READINGS

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

pytestmark = [
    pytest.mark.skipif(shutil.which("node") is None, reason="needs node"),
    pytest.mark.skipif(not PAYLOAD.is_file(), reason="needs the exported web payload"),
]

DASH = "\u2013"  # the read joins ranges with an en dash, as the page does

CAMERA = CameraSignature(orientation="portrait", body_height=0.6, centre_x=0.5,
                         shoulder_ratio=0.95, frame_rate=60.0)  # fmt: skip


def payload() -> dict[str, Any]:
    return json.loads(PAYLOAD.read_text(encoding="utf-8"))


def node(expression: str) -> Any:
    script = (
        f"import * as r from {json.dumps((WEBAPP / 'read.js').as_uri())};"
        f"import * as p from {json.dumps((WEBAPP / 'practice.js').as_uri())};"
        f"console.log(JSON.stringify(({expression})));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return json.loads(done.stdout)


def history(hand: str, tempos: tuple[float, ...]) -> list[dict[str, Any]]:
    """Newest first, as the engine takes them."""
    swings = [
        RecentSwing(
            swing_id=i + 1, refused=False, detection_rate=1.0, tempo=t,
            point=SwingPoint(swing_id=i + 1, value=t, handedness=hand, club="7 iron",
                             camera=CAMERA),
        )
        for i, t in enumerate(tempos)
    ][::-1]  # fmt: skip
    return [s.model_dump(mode="json") for s in swings]


METRICS = {
    "tempoRatio": 3.2, "slowedBy": None, "headMovement": 0.052, "pelvisSway": 0.041,
    "shoulderTurnDeg": 61.3, "feetInShot": True,
}  # fmt: skip


def read(metrics: dict[str, Any] | None = None, *, hand: str = "right",
         recent: list[dict[str, Any]] | None = None, user_set: tuple[int, ...] = (),
         no_priority: str | None = None) -> dict[str, Any]:  # fmt: skip
    """The read and, where a history is given, the priority practice.js chose from it."""
    data = payload()
    rules = data["practice"]
    insight = "null" if recent is None else f"p.choosePriority(rules, {json.dumps(recent)})"
    return node(
        f"(() => {{ const rules = {json.dumps(rules)}; const insight = {insight};"
        f" return {{ insight, read: r.stemRead({{ metrics: {json.dumps(metrics or METRICS)},"
        f" handedness: {json.dumps(hand)}, band: {json.dumps(data['calibration']['tempo'])},"
        f" rules, userSet: {json.dumps(list(user_set))}, insight,"
        f" noPriority: {json.dumps(no_priority)} }}) }}; }})()"
    )


def by_key(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {s["key"]: s for s in result["read"]}


def all_text(result: dict[str, Any]) -> str:
    return " ".join(s["text"] + " " + " ".join(s["caveats"]) for s in result["read"])


def test_the_tempo_sentence_quotes_the_page_and_the_tour_reference() -> None:
    data = payload()
    band = data["calibration"]["tempo"]["half_width_fraction"]
    tour = data["practice"]["tour_tempo"]
    tempo = by_key(read())["tempo"]
    spread = 3.2 * band
    assert "3.20" in tempo["text"]
    assert f"{3.2 - spread:.2f}{DASH}{3.2 + spread:.2f}" in tempo["text"]
    assert f"inside the {tour['p10']:.2f}{DASH}{tour['p90']:.2f}" in tempo["text"]
    assert tempo["provenance"] == "derived"
    assert data["practice"]["tempo_limits"][0] in tempo["caveats"]
    assert any("compressed toward" in c for c in tempo["caveats"])


@pytest.mark.parametrize(("value", "where"), [(2.4, "below"), (5.0, "above")])
def test_a_tempo_outside_the_tour_range_says_which_side(value: float, where: str) -> None:
    tempo = by_key(read({**METRICS, "tempoRatio": value}))["tempo"]
    assert f"{value:.2f}" in tempo["text"] and f", {where} the" in tempo["text"]


def test_a_left_hander_is_told_the_band_was_not_measured_for_them() -> None:
    data = payload()
    left = by_key(read(hand="left"))["tempo"]
    assert data["notes"]["left_handed_tempo_band"] in left["caveats"]
    assert data["practice"]["tempo_limits"][0] not in left["caveats"]


def test_slow_motion_withholds_durations_and_says_why() -> None:
    result = read({**METRICS, "slowedBy": 3.0})
    tempo = by_key(result)["tempo"]
    assert any("slow motion played about 3 times slower" in c for c in tempo["caveats"])
    assert not re.search(r"\d\s*ms\b", all_text(result))


def test_a_refused_tempo_is_said_to_be_missing_not_coached_from() -> None:
    tempo = by_key(read({**METRICS, "tempoRatio": None}))["tempo"]
    assert tempo["provenance"] == "refused"
    assert not re.search(r"\d", tempo["text"])


def test_positions_placed_by_hand_drop_the_models_band() -> None:
    tempo = by_key(read(user_set=(5,)))["tempo"]
    assert "measured spread" not in tempo["text"]
    assert any("placed the impact by hand" in c for c in tempo["caveats"])


def test_head_sway_and_turn_are_a_difference_from_tour_swings_never_a_fault() -> None:
    head = TOUR_BODY_READINGS["head_movement"]
    inside = by_key(read())["body"]
    assert "within the range of tour swings filmed face on" in inside["text"]
    outside = by_key(read({**METRICS, "headMovement": 0.152}))["body"]
    assert "0.152 body lengths" in outside["text"]
    assert f"{head.p10:.3f}{DASH}{head.p90:.3f}" in outside["text"]
    assert outside["provenance"] == "projected"
    assert any("does not make it a fault" in c for c in outside["caveats"])
    unseen = by_key(read({**METRICS, "feetInShot": False, "shoulderTurnDeg": None}))["body"]
    assert unseen["provenance"] == "refused" and "feet were not in shot" in unseen["text"]


def test_the_priority_is_the_practice_engines_and_no_other() -> None:
    result = read(recent=history("right", (2.4, 2.5, 2.45)))
    insight = result["insight"]
    assert insight["kind"] == "tempo_quick"
    priority = by_key(result)["priority"]["text"]
    assert insight["title"].lower() in priority.lower()
    assert insight["drill"]["title"] in priority
    assert insight["retest"][0].lower() + insight["retest"][1:] in priority


def test_too_few_swings_says_so_instead_of_a_priority() -> None:
    result = read(recent=history("right", (3.2,)))
    assert result["insight"]["kind"] == "not_enough"
    priority = by_key(result)["priority"]["text"]
    assert priority.startswith("No priority yet: ")
    assert result["insight"]["title"].lower() in priority.lower()


def test_an_empty_practice_log_says_what_one_swing_cannot_tell() -> None:
    note = payload()["practice"]["one_swing"]["right"]
    result = read(recent=None, no_priority=note)
    assert by_key(result)["priority"]["text"] == note


FORBIDDEN_CASES = [
    {},
    {"tempoRatio": 2.2},
    {"tempoRatio": 5.4, "slowedBy": 4.0},
    {"headMovement": 0.2, "pelvisSway": 0.15, "shoulderTurnDeg": 40.0},
    {"feetInShot": False, "shoulderTurnDeg": None},
    {"tempoRatio": None},
]


@pytest.mark.parametrize("change", FORBIDDEN_CASES)
@pytest.mark.parametrize("hand", ["right", "left"])
def test_no_read_names_a_quantity_one_camera_cannot_measure(change: dict, hand: str) -> None:
    forbidden = node("r.FORBIDDEN")
    for recent in (None, history(hand, (2.4, 2.5, 2.45)), history(hand, (3.6, 3.5, 3.7)),
                   history(hand, (5.0, 5.1, 4.9)), history(hand, (3.0,)), []):  # fmt: skip
        text = all_text(read({**METRICS, **change}, hand=hand, recent=recent)).lower()
        found = [w for w in forbidden if re.search(rf"\b{re.escape(w)}\b", text)]
        assert not found, (found, text)


def test_the_payload_carries_the_tour_body_readings_unchanged() -> None:
    shipped = payload()["practice"]["tour_body"]
    assert shipped == practice_payload()["tour_body"]
    assert set(shipped) == set(TOUR_BODY_READINGS)
