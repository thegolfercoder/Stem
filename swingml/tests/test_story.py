"""The swing told in order: built only from what was measured.

The story is the most readable thing on the swing page and so the easiest place
for a claim to slip in that nothing measured. These pin the two rules it rests
on: a refused measurement is left out rather than described, and every number in
the prose is one of the stored ones.
"""

from __future__ import annotations

import re

from swingml.web.story import swing_story, tempo_note


def quantity(value: float, unit: str = "ms", provenance: str = "measured") -> dict[str, object]:
    return {"value": value, "unit": unit, "provenance": provenance}


METRICS: dict[str, object] = {
    "backswing_duration": quantity(784.0),
    "downswing_duration": quantity(212.0),
    "swing_duration": quantity(1502.0),
    "tempo_ratio": quantity(3.70, "", "derived"),
    "time_to_peak_hand_speed": quantity(-100.0),
    "shoulder_turn_foreshortened": quantity(33.5, "deg", "projected"),
    "hip_turn_foreshortened": quantity(29.4, "deg", "projected"),
    "head_movement": quantity(0.180, "body lengths", "projected"),
    "pelvis_sway": quantity(0.057, "body lengths", "projected"),
    "kinematic_sequence": ["lead arm", "thorax", "pelvis"],
    "kinematic_peak_times_ms": {"pelvis": 0.0, "thorax": -16.7, "lead arm": -100.0},
    "kinematic_sequence_source": "projected",
}


def test_the_parts_come_in_the_order_they_happen() -> None:
    titles = [beat.title for beat in swing_story(METRICS)]
    assert titles[0] == "Address to the top"
    assert titles[1] == "The top to impact"
    assert titles[-1] == "Impact to the finish"


def test_every_number_in_the_prose_is_a_stored_one() -> None:
    text = " ".join(str(beat.text) for beat in swing_story(METRICS))
    allowed = {
        "0.78",
        "0.21",
        "3.70",
        "3",
        "1",
        "100",
        "-100",
        "-17",
        "+0",
        "34",
        "29",
        "0.180",
        "0.057",
        "0.51",
        "1.50",
    }
    found = set(re.findall(r"[-+]?\d+(?:\.\d+)?", re.sub(r"<[^>]+>", "", text)))
    assert found <= allowed, f"numbers nobody measured: {sorted(found - allowed)}"


def test_a_refused_measurement_is_left_out_not_described() -> None:
    refused = dict(METRICS)
    refused["shoulder_turn_foreshortened"] = {"reason": "the shoulders were never seen"}
    titles = [beat.title for beat in swing_story(refused)]
    assert "The turn at the top" not in titles
    assert all("never seen" not in str(beat.text) for beat in swing_story(refused))


def test_each_part_carries_its_provenance() -> None:
    by_title = {beat.title: beat.provenance for beat in swing_story(METRICS)}
    assert by_title["Address to the top"] == "measured"
    assert by_title["The top to impact"] == "derived"
    assert by_title["The turn at the top"] == "projected"


def test_nothing_at_all_gives_no_story_rather_than_an_invented_one() -> None:
    assert swing_story({}) == []


def test_tempo_is_placed_against_the_quoted_figure_without_judging_it() -> None:
    assert "near 3 to 1" in tempo_note(3.0)
    assert "longer backswing" in tempo_note(3.7)
    assert "quicker backswing" in tempo_note(2.2)
    for ratio in (2.2, 3.0, 3.7):
        assert "should" not in tempo_note(ratio)


def test_markup_from_a_stored_name_is_escaped() -> None:
    """Segment names reach the page as HTML, so a hostile one must not become markup."""
    hostile = dict(METRICS)
    hostile["kinematic_sequence"] = ["<script>x</script>"]
    hostile["kinematic_peak_times_ms"] = {"<script>x</script>": 0.0}
    text = " ".join(str(beat.text) for beat in swing_story(hostile))
    assert "<script>" not in text
