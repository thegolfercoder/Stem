"""This session in one card (#59): webapp/session.js, in node.

Medians and middle halves of today's comparable kept swings, tempo's spread set
against its measured per-swing band, and the most and least typical swings,
chosen only on readings whose spread is not already measurement noise.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

pytestmark = [
    pytest.mark.skipif(shutil.which("node") is None, reason="needs node"),
    pytest.mark.skipif(not PAYLOAD.is_file(), reason="needs the exported web payload"),
]

FACE_ON = {"orientation": "portrait", "body_height": 0.6, "centre_x": 0.5,
           "shoulder_ratio": 0.9, "frame_rate": 60.0}  # fmt: skip


def swing(n: int, tempo: float, head: float, *, day: str = "2026-10-06", **extra: Any) -> dict:
    return {
        "id": n, "at": f"{day}T10:{n:02d}:00Z", "ok": True, "handedness": "right",
        "club": "7 iron", "camera": FACE_ON, "positions_set_by_you": 0,
        "metrics": {"tempo_ratio": tempo, "head_movement": head, "pelvis_sway": 0.04,
                    "shoulder_turn_foreshortened": 60.0},
        **extra,
    }  # fmt: skip


def summary(swings: list[dict]) -> dict:
    data = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    script = (
        f"import * as s from {json.dumps((WEBAPP / 'session.js').as_uri())};"
        "const input = JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(s.sessionSummary(input)));"
    )
    job = {"swings": swings, "rules": data["practice"], "band": data["calibration"]["tempo"]}
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(job)],
        capture_output=True, text=True, timeout=60, check=True, env={**os.environ, "TZ": "UTC"},
    )  # fmt: skip
    return dict(json.loads(done.stdout))


def band_fraction() -> float:
    return float(
        json.loads(PAYLOAD.read_text(encoding="utf-8"))["calibration"]["tempo"][
            "half_width_fraction"
        ]
    )


def test_below_three_comparable_swings_there_is_no_summary() -> None:
    out = summary([swing(1, 3.0, 0.05), swing(2, 3.1, 0.06)])
    assert out["enough"] is False and out["n"] == 2 and out["day"] == "2026-10-06"
    assert summary([])["enough"] is False


def test_medians_and_middle_halves_are_numpy_s() -> None:
    tempos = [2.6, 3.4, 2.9, 3.1, 3.0]
    heads = [0.05, 0.09, 0.04, 0.06, 0.12]
    out = summary([swing(i + 1, t, h) for i, (t, h) in enumerate(zip(tempos, heads, strict=True))])
    assert out["enough"] and out["n"] == 5 and out["ids"] == [1, 2, 3, 4, 5]
    by_key = {m["key"]: m for m in out["measures"]}
    for key, values in (("tempo_ratio", tempos), ("head_movement", heads)):
        m = by_key[key]
        assert m["median"] == pytest.approx(statistics.median(values))
        assert m["q1"] == pytest.approx(float(np.quantile(values, 0.25)))
        assert m["q3"] == pytest.approx(float(np.quantile(values, 0.75)))


def test_a_tempo_spread_inside_its_band_is_noise_and_singles_nobody_out() -> None:
    # Head movement, sway and turn identical: tempo alone could rank, and it is noise.
    out = summary(
        [swing(1, 3.0, 0.05), swing(2, 3.2, 0.05), swing(3, 2.9, 0.05), swing(4, 3.1, 0.05)]
    )
    tempo = next(m for m in out["measures"] if m["key"] == "tempo_ratio")
    assert tempo["band"] == pytest.approx(abs(tempo["median"]) * band_fraction())
    assert tempo["iqr"] <= 2 * tempo["band"] and tempo["withinNoise"] is True
    assert out["typical"] is None and out["least"] is None and out["rankedOn"] == []


def test_a_tempo_spread_wider_than_its_band_is_a_difference() -> None:
    out = summary(
        [swing(1, 2.0, 0.05), swing(2, 4.5, 0.05), swing(3, 2.1, 0.05), swing(4, 4.4, 0.05)]
    )
    tempo = next(m for m in out["measures"] if m["key"] == "tempo_ratio")
    assert tempo["withinNoise"] is False and "Tempo" in out["rankedOn"]


def test_the_most_typical_swing_is_nearest_the_middle_and_the_least_are_furthest() -> None:
    out = summary([swing(1, 3.0, 0.05), swing(2, 3.0, 0.06), swing(3, 3.0, 0.20),
                   swing(4, 3.0, 0.055), swing(5, 3.0, 0.10)])  # fmt: skip
    assert out["rankedOn"] == ["Head movement"]  # tempo has no spread; the others none either
    assert out["typical"] == {"id": 2}  # 0.06 is the median
    assert [s["id"] for s in out["least"]] == [3, 5]
    assert all(s["furthestOn"] == "Head movement" for s in out["least"])


def test_only_todays_comparable_swings_count() -> None:
    swings = [
        swing(1, 3.0, 0.05, day="2026-10-05"),  # yesterday
        swing(2, 3.0, 0.05, club="driver"),  # another club
        swing(3, 3.0, 0.05, camera={**FACE_ON, "body_height": 0.3}),  # the phone moved
        swing(4, 3.0, 0.06),
        swing(5, 3.1, 0.07),
        swing(6, 2.9, 0.05),
    ]
    out = summary(swings)
    assert out["ids"] == [4, 5, 6]


@pytest.mark.parametrize("extra", [{"handedness": "left"}, {"positions_set_by_you": 1}])
def test_no_band_is_quoted_where_it_was_not_measured(extra: dict) -> None:
    swings = [swing(1, 3.0, 0.05), swing(2, 3.2, 0.06), swing(3, 2.9, 0.07, **extra)]
    if "handedness" in extra:
        swings = [{**s, **extra} for s in swings]
    tempo = next(m for m in summary(swings)["measures"] if m["key"] == "tempo_ratio")
    assert tempo["band"] is None and tempo["withinNoise"] is None


def test_three_swings_name_one_typical_and_one_least_typical_not_all_three() -> None:
    out = summary([swing(1, 3.0, 0.05), swing(2, 3.0, 0.06), swing(3, 3.0, 0.20)])
    assert out["typical"] == {"id": 2} and [s["id"] for s in out["least"]] == [3]
