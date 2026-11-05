"""Progress charts in the browser page (#38), run in node on a seeded practice log.

webapp/progress.js turns the log's swings into one series per measure. These hold
it to: a swing filmed differently from the newest is drawn hollow and left out of
the day's median; the tempo spread appears only where it was measured; tour bands
carry their source; a retest verdict sits at its last swing; and an empty log
draws nothing.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import subprocess
from pathlib import Path
from typing import Any

import pytest

from swingml.insights.compare import CameraSignature

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

pytestmark = [
    pytest.mark.skipif(shutil.which("node") is None, reason="needs node"),
    pytest.mark.skipif(not PAYLOAD.is_file(), reason="needs the exported web payload"),
]

FACE_ON = CameraSignature(orientation="portrait", body_height=0.6, centre_x=0.5,
                          shoulder_ratio=0.9, frame_rate=60.0).model_dump(mode="json")  # fmt: skip
DOWN_THE_LINE = {**FACE_ON, "shoulder_ratio": 0.2}


def swing(n: int, day: str, tempo: float, camera: dict = FACE_ON, **extra: Any) -> dict[str, Any]:
    return {
        "id": n, "at": f"{day}T10:{n:02d}:00Z", "ok": True, "handedness": "right",
        "club": "7 iron", "camera": camera, "positions_set_by_you": 0,
        "metrics": {"tempo_ratio": tempo, "head_movement": 0.05 + n / 1000,
                    "pelvis_sway": 0.04, "shoulder_turn_foreshortened": 60.0 + n,
                    "detection_rate": 1.0},
        **extra,
    }  # fmt: skip


def series(
    swings: list[dict], verdicts: list[dict] | None = None, tz: str = "UTC"
) -> dict[str, Any]:
    data = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    script = (
        f"import * as g from {json.dumps((WEBAPP / 'progress.js').as_uri())};"
        "const input = JSON.parse(process.argv[1]);"
        "const s = g.progressSeries(input);"
        "s.svg = s.measures.map((m) => g.progressSvg(m));"
        "console.log(JSON.stringify(s));"
    )
    job = {"swings": swings, "verdicts": verdicts or [], "rules": data["practice"],
           "band": data["calibration"]["tempo"]}  # fmt: skip
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(job)],
        capture_output=True, text=True, timeout=60, check=True,
        env={**os.environ, "TZ": tz},
    )  # fmt: skip
    return dict(json.loads(done.stdout))


def tempo_of(result: dict[str, Any]) -> dict[str, Any]:
    return next(m for m in result["measures"] if m["key"] == "tempo_ratio")


def test_an_empty_log_draws_nothing_and_asks_for_three_swings() -> None:
    result = series([])
    assert result["enough"] is False and result["swings"] == 0
    assert all(m["points"] == [] for m in result["measures"]) and set(result["svg"]) == {""}
    assert not series([swing(1, "2026-10-01", 3.0), swing(2, "2026-10-01", 3.1)])["enough"]


def test_a_swing_filmed_differently_is_hollow_and_out_of_the_median() -> None:
    log = [swing(1, "2026-10-01", 3.0), swing(2, "2026-10-01", 3.4), swing(3, "2026-10-01", 3.2),
           swing(4, "2026-10-02", 2.6), swing(5, "2026-10-02", 9.0, DOWN_THE_LINE),
           swing(6, "2026-10-02", 2.8)]  # fmt: skip
    result = series(log)
    tempo = tempo_of(result)
    assert result["enough"] and [p["comparable"] for p in tempo["points"]] == [True] * 4 + [
        False,
        True,
    ]
    days = {s["day"]: s for s in tempo["sessions"]}
    assert days["2026-10-01"]["median"] == pytest.approx(3.2)
    assert days["2026-10-02"]["median"] == pytest.approx(statistics.median([2.6, 2.8]))
    assert days["2026-10-02"]["n"] == 2
    svg = result["svg"][0]
    assert svg.count('class="pg-point pg-hollow"') == 1 and svg.count('class="pg-point"') == 5
    assert "not in the median" in svg


def test_the_tempo_spread_appears_only_where_it_was_measured() -> None:
    log = [swing(1, "2026-10-01", 3.0), swing(2, "2026-10-01", 3.0, handedness="left"),
           swing(3, "2026-10-01", 3.0, positions_set_by_you=1)]  # fmt: skip
    points = tempo_of(series(log))["points"]
    assert points[0]["low"] < 3.0 < points[0]["high"]
    assert points[1]["low"] is None and points[2]["low"] is None
    head = next(m for m in series(log)["measures"] if m["key"] == "head_movement")
    assert all(p["low"] is None for p in head["points"])


def test_reference_bands_are_labelled_with_their_source() -> None:
    log = [swing(n, "2026-10-01", 3.0) for n in (1, 2, 3)]
    result = series(log)
    sources = {m["key"]: m["reference"]["source"] for m in result["measures"]}
    assert sources["tempo_ratio"] == "tour players, broadcast video"
    assert sources["head_movement"] == "tour players filmed face on, broadcast video"
    assert all(m["reference"]["source"] in svg for m, svg in
               zip(result["measures"], result["svg"], strict=True))  # fmt: skip


def test_a_retest_verdict_is_marked_at_its_last_swing() -> None:
    log = [swing(n, "2026-10-01", 2.4) for n in (1, 2, 3)] + [
        swing(n, "2026-10-02", 3.0) for n in (4, 5, 6)]  # fmt: skip
    plan = {"baseline": [1, 2, 3], "retest": [4, 5, 6]}
    verdicts = [
        {"plan": plan, "change": {"metric": "tempo_ratio", "verdict": "improved"}},
        {"plan": plan, "change": {"metric": "head_movement", "verdict": "not_comparable"}},
    ]
    result = series(log, verdicts)
    assert tempo_of(result)["verdicts"] == [{"id": 6, "verdict": "improved",
                                             "label": "moved the drill's way"}]  # fmt: skip
    assert "▼ moved the drill&#39;s way" in result["svg"][0]
    head = next(m for m in result["measures"] if m["key"] == "head_movement")
    assert head["verdicts"] == []


def test_refused_swings_are_not_drawn() -> None:
    log = [swing(1, "2026-10-01", 3.0), {"id": 2, "ok": False, "metrics": None, "at": "2026-10-01"},
           swing(3, "2026-10-01", 3.1), swing(4, "2026-10-01", 3.2)]  # fmt: skip
    result = series(log)
    assert result["swings"] == 3 and [p["id"] for p in tempo_of(result)["points"]] == [1, 3, 4]


def test_an_evening_session_across_utc_midnight_is_one_local_day() -> None:
    """QA (#69): 16:40-17:40 in Los Angeles is 23:40-00:40 UTC."""
    log = [{**swing(n, "2026-10-04", 3.0 + n / 100),
            "at": at} for n, at in enumerate(
        ["2026-10-04T23:40:00Z", "2026-10-04T23:55:00Z", "2026-10-05T00:10:00Z",
         "2026-10-05T00:25:00Z", "2026-10-05T00:40:00Z"], start=1)]  # fmt: skip
    tempo = tempo_of(series(log, tz="America/Los_Angeles"))
    assert [s["day"] for s in tempo["sessions"]] == ["2026-10-04"]
    assert tempo["sessions"][0]["n"] == 5
    assert {p["day"] for p in tempo["points"]} == {"2026-10-04"}
    # The same swings in Tokyo are one local day too, the next one.
    assert [s["day"] for s in tempo_of(series(log, tz="Asia/Tokyo"))["sessions"]] == ["2026-10-05"]
