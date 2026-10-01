"""The browser's practice loop gives the desktop's answers.

webapp/practice.js ports the rules in swingml/insights (one priority from the
swings, whether two sets of swings can be compared, and the Welch verdict on a
retest) and the plan bookkeeping in swingml/web/practice.py. These tests hand
both the same generated swings and require the same answer: the same priority,
word for word, the same evidence, the same interval and the same verdict.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from swingml.insights.compare import CameraSignature, SwingPoint, camera_signature, compare
from swingml.insights.engine import RecentSwing, choose
from swingml.insights.payload import practice_payload
from swingml.pose.base import PoseSequence
from swingml.web import practice as desktop

HERE = Path(__file__).parent
HARNESS = HERE / "js" / "practice_parity.mjs"
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

CAMERAS = (
    CameraSignature(orientation="portrait", body_height=0.62, centre_x=0.50,
                    shoulder_ratio=0.95, frame_rate=60.0),
    # The same spot, a little noise.
    CameraSignature(orientation="portrait", body_height=0.60, centre_x=0.53,
                    shoulder_ratio=0.90, frame_rate=59.9),
    # Moved closer: timing unaffected, pictures not comparable.
    CameraSignature(orientation="portrait", body_height=0.90, centre_x=0.50,
                    shoulder_ratio=0.93, frame_rate=60.0),
    # Down the line.
    CameraSignature(orientation="portrait", body_height=0.61, centre_x=0.48,
                    shoulder_ratio=0.40, frame_rate=30.0),
    CameraSignature(orientation="landscape", body_height=0.70, centre_x=0.45,
                    shoulder_ratio=0.92, frame_rate=120.0),
)  # fmt: skip
CLUBS = (None, "7 iron", "7 iron", "7 iron", "Driver")
REFUSALS = ("no swing found", "a body was found in only 41 percent of frames")


def random_point(rng: random.Random, swing_id: int, value: float) -> SwingPoint:
    return SwingPoint(
        swing_id=swing_id,
        value=value,
        handedness=rng.choice(("right", "right", "right", "right", "left")),
        club=rng.choice(CLUBS),
        camera=rng.choice((*CAMERAS[:2], *CAMERAS[:2], *CAMERAS, None)),
    )


def random_history(rng: random.Random) -> list[RecentSwing]:
    """Newest first, as `choose` takes them."""
    centre = rng.choice((2.4, 2.7, 3.3, 3.8, 4.8, 5.2))
    swings = []
    for swing_id in range(rng.randint(0, 12), 0, -1):
        if rng.random() < 0.12:
            swings.append(
                RecentSwing(swing_id=swing_id, refused=True, refusal=rng.choice(REFUSALS),
                            detection_rate=rng.random())
            )  # fmt: skip
            continue
        tempo = max(1.2, rng.gauss(centre, 0.35))
        swings.append(
            RecentSwing(
                swing_id=swing_id,
                refused=False,
                # 0.8 exactly and just under it: the capture rule's edge.
                detection_rate=rng.choice(
                    (1.0, 1.0, 0.97, 0.93, 0.85, 0.8, 0.795 if rng.random() < 0.3 else 1.0)
                ),
                tempo=tempo,
                point=random_point(rng, swing_id, tempo),
            )
        )
    return swings


def random_sets(rng: random.Random) -> dict[str, Any]:
    metric, direction = rng.choice(
        (("tempo_ratio", "increase"), ("tempo_ratio", "decrease"),
         ("head_movement", "decrease"), ("shoulder_turn_foreshortened", "increase"))
    )  # fmt: skip
    base = {"tempo_ratio": 3.0, "head_movement": 0.08, "shoulder_turn_foreshortened": 70.0}[metric]
    shift = rng.choice((0.0, 0.05, 0.2, -0.2)) * base
    spread = rng.choice((0.0, 0.03, 0.1)) * base
    same = rng.random() < 0.7

    def points(first: int, n: int, centre: float) -> list[SwingPoint]:
        out = []
        for i in range(n):
            value = centre if spread == 0 else rng.gauss(centre, spread)
            point = random_point(rng, first + i, value)
            if same:
                point = point.model_copy(update={"handedness": "right", "club": "7 iron",
                                                 "camera": CAMERAS[i % 2]})  # fmt: skip
            out.append(point)
        return out

    before = points(1, rng.randint(1, 6), base)
    after = points(100, rng.randint(1, 6), base + shift)
    return {"before": before, "after": after, "metric": metric, "direction": direction}


def dump(value: Any) -> Any:
    if isinstance(value, list):
        return [dump(v) for v in value]
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value


def agree(python: Any, browser: Any, where: str = "") -> None:
    if isinstance(python, float) or isinstance(browser, float):
        assert browser == pytest.approx(python, rel=1e-9, abs=1e-12), where
    elif isinstance(python, dict):
        assert isinstance(browser, dict), where
        assert set(python) == set(browser), f"{where}: {set(python) ^ set(browser)}"
        for key in python:
            agree(python[key], browser[key], f"{where}.{key}")
    elif isinstance(python, (list, tuple)):
        assert isinstance(browser, list) and len(python) == len(browser), where
        for i, (a, b) in enumerate(zip(python, browser, strict=True)):
            agree(a, b, f"{where}[{i}]")
    else:
        assert python == browser, where


def run(job: dict[str, Any], tmp_path: Path) -> dict[str, Any]:
    path = tmp_path / "job.json"
    path.write_text(json.dumps(job), encoding="utf-8")
    finished = subprocess.run(
        ["node", str(HARNESS), str(path)], capture_output=True, text=True, timeout=120, check=False
    )
    if finished.returncode != 0:
        pytest.fail(f"the browser practice rules would not run:\n{finished.stderr[-2000:]}")
    return dict(json.loads(finished.stdout))


@pytest.fixture(scope="module")
def generated(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    rng = random.Random(20260929)
    histories = [random_history(rng) for _ in range(400)]
    sets = [random_sets(rng) for _ in range(400)]
    g3 = [0.1234567, 12.3456, 1234.5, 0.000123456, 1e-5, 2.0, 0.5, 99.95, 0.0]
    job = {
        "rules": practice_payload(),
        "choose": [dump(h) for h in histories],
        "compare": [{**s, "before": dump(s["before"]), "after": dump(s["after"])} for s in sets],
        "g3": g3,
    }
    browser = run(job, tmp_path_factory.mktemp("practice"))
    return {"histories": histories, "sets": sets, "g3": g3, "browser": browser}


def test_the_priorities_agree_word_for_word(generated: dict[str, Any]) -> None:
    kinds: dict[str, int] = {}
    for i, (history, browser) in enumerate(
        zip(generated["histories"], generated["browser"]["choose"], strict=True)
    ):
        python = choose(history).model_dump(mode="json")
        agree(python, browser, f"history {i}")
        kinds[python["kind"]] = kinds.get(python["kind"], 0) + 1
    # Every rule was reached, or the agreement proves less than it seems to.
    assert set(kinds) == {"capture", "not_enough", "tempo_quick", "tempo_slow", "choose"}, kinds


def test_the_retest_verdicts_agree(generated: dict[str, Any]) -> None:
    verdicts: dict[str, int] = {}
    for i, (s, browser) in enumerate(
        zip(generated["sets"], generated["browser"]["compare"], strict=True)
    ):
        python = compare(s["before"], s["after"], s["metric"], s["direction"])
        agree(python.model_dump(mode="json"), browser, f"set {i}")
        verdicts[python.verdict] = verdicts.get(python.verdict, 0) + 1
    assert set(verdicts) == {
        "improved", "worsened", "no_detectable_change", "not_comparable", "not_enough_swings"
    }, verdicts  # fmt: skip


def test_three_significant_figures_print_as_python_prints_them(generated: dict[str, Any]) -> None:
    assert generated["browser"]["g3"] == [f"{x:.3g}" for x in generated["g3"]]


@pytest.mark.skipif(not LANDMARKS.is_file(), reason="needs the real-swing fixture")
def test_the_camera_signature_agrees_on_a_real_swing(tmp_path: Path) -> None:
    data = np.load(LANDMARKS)
    sequence = PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )
    frames = [0, 10, sequence.n_frames // 2, sequence.n_frames - 1, sequence.n_frames + 5]
    job = {
        "rules": practice_payload(), "choose": [], "compare": [], "g3": [],
        "camera": {
            "xy": sequence.xy.tolist(), "visibility": sequence.visibility.tolist(),
            "detected": [bool(v) for v in np.asarray(sequence.detected).ravel()],
            "times": sequence.timestamps_s.tolist(),
            "width": sequence.frame_width, "height": sequence.frame_height, "frames": frames,
        },
    }  # fmt: skip
    browser = run(job, tmp_path)["camera"]
    for frame, theirs in zip(frames, browser, strict=True):
        ours = camera_signature(sequence, frame)
        assert (ours is None) == (theirs is None), frame
        if ours is None:
            continue
        mine = ours.model_dump(mode="json")
        assert mine["orientation"] == theirs["orientation"]
        for key in ("body_height", "centre_x", "shoulder_ratio", "frame_rate"):
            # Python reads the landmarks in float32; the browser in float64.
            assert theirs[key] == pytest.approx(mine[key], rel=1e-5), (frame, key)


class FakeStore:
    """Just enough of SwingStore for the desktop's own plan functions."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def recent(self, limit: int = 50) -> list[SimpleNamespace]:
        return sorted(self.rows, key=lambda r: -r.id)[:limit]

    def get(self, swing_id: int) -> SimpleNamespace | None:
        return next((r for r in self.rows if r.id == swing_id), None)


def browser_swing(point: SwingPoint, head: float) -> dict[str, Any]:
    return {
        "ok": True,
        "refusal": None,
        "detection_rate": 0.98,
        "handedness": point.handedness,
        "club": point.club,
        "camera": point.camera.model_dump(mode="json") if point.camera else None,
        "metrics": {
            "tempo_ratio": point.value,
            "head_movement": head,
            "pelvis_sway": None,
            "shoulder_turn_foreshortened": None,
            "detection_rate": 0.98,
        },
    }


def desktop_row(swing_id: int, swing: dict[str, Any]) -> SimpleNamespace:
    metrics = {k: {"value": v} for k, v in swing["metrics"].items() if v is not None}
    return SimpleNamespace(
        id=swing_id, ok=swing["ok"], refusal=swing["refusal"],
        detection_rate=swing["detection_rate"], tempo_ratio=swing["metrics"]["tempo_ratio"],
        club=swing["club"],
        analysis={"metrics": metrics, "handedness": swing["handedness"], "camera": swing["camera"]},
    )  # fmt: skip


@pytest.mark.parametrize("focus", ["tempo_quick", "head_stability"])
def test_a_plan_played_through_matches_the_desktop(focus: str, tmp_path: Path) -> None:
    rng = random.Random(7)
    before, after = [], []
    for i in range(6):
        point = SwingPoint(swing_id=i + 1, value=rng.gauss(2.5, 0.1), handedness="right",
                           club="7 iron", camera=CAMERAS[i % 2])  # fmt: skip
        before.append(browser_swing(point, rng.gauss(0.10, 0.01)))
    for i in range(5):
        point = SwingPoint(swing_id=i + 7, value=rng.gauss(3.1, 0.1), handedness="right",
                           club="7 iron", camera=CAMERAS[i % 2])  # fmt: skip
        after.append(browser_swing(point, rng.gauss(0.09, 0.01)))
    job = {
        "rules": practice_payload(), "choose": [], "compare": [], "g3": [],
        "plan": {"before": before, "after": after, "focus": focus},
    }  # fmt: skip
    browser = run(job, tmp_path)["plan"]

    rows = [desktop_row(i + 1, s) for i, s in enumerate(before)]
    store = FakeStore(rows)
    agree(desktop.insight_for(store, 6).model_dump(mode="json"), browser["insight"], "insight")
    drill = desktop.BY_FOCUS[focus]
    baseline, _ = desktop.baseline_for(store, drill, 6)  # type: ignore[arg-type]
    assert browser["baseline"] == baseline
    store.rows += [desktop_row(i + 7, s) for i, s in enumerate(after)]
    assert browser["retest"] == [7, 8, 9, 10, 11]
    plan = {"drill_id": drill.id, "baseline": baseline, "retest": browser["retest"]}
    change = desktop.plan_change(store, plan)  # type: ignore[arg-type]
    assert change is not None
    agree(change.model_dump(mode="json"), browser["change"], "change")
    assert browser["closed"] is True and browser["active"] is None
    assert browser["erased"] == 11 and browser["afterErase"] == 0


def _swing(
    tempo: float, key: str | None, handedness: str = "right", ok: bool = True
) -> dict[str, Any]:
    point = SwingPoint(
        swing_id=0, value=tempo, handedness=handedness, club="7 iron", camera=CAMERAS[0]
    )
    record = browser_swing(point, 0.1)
    record.update({"clip_key": key, "ok": ok, "refusal": None if ok else "no swing found"})
    return record


def _ops(ops: list[dict[str, Any]], tmp_path: Path) -> dict[str, Any]:
    job = {"rules": practice_payload(), "choose": [], "compare": [], "g3": [], "ops": ops}
    return run(job, tmp_path)["ops"]


def test_one_clip_analysed_three_times_is_one_retest_swing(tmp_path: Path) -> None:
    """QA's reproduction (#22): it used to read "improved" [+0.002, +0.498]."""
    ops: list[dict[str, Any]] = [
        {"op": "add", "record": _swing(t, f"b{i}")} for i, t in enumerate((2.7, 2.9, 2.8))
    ]
    ops.append({"op": "start", "focus": "tempo_quick", "from": 3})
    ops += [{"op": "add", "record": _swing(3.05, "same clip"), "forPlan": True}] * 3
    result = _ops(ops, tmp_path)
    assert len(result["swings"]) == 4
    assert result["plan"]["retest"] == [4]
    assert result["change"]["verdict"] == "not_enough_swings"


def test_a_reread_replaces_the_earlier_reading_and_keeps_its_place(tmp_path: Path) -> None:
    ops: list[dict[str, Any]] = [
        {"op": "add", "record": _swing(t, f"b{i}")} for i, t in enumerate((2.7, 2.9, 2.8))
    ]
    ops.append({"op": "start", "focus": "tempo_quick", "from": 3})
    # A baseline clip re-run with the box ticked stays in the baseline only.
    ops.append({"op": "add", "record": _swing(2.75, "b1"), "forPlan": True})
    # A retest clip first read left-handed, then re-run right-handed: the plan
    # holds the corrected reading, not a left swing that blocks every comparison.
    for tempo in (3.0, 3.1):
        ops.append({"op": "add", "record": _swing(tempo, f"r{tempo}"), "forPlan": True})
    ops.append({"op": "add", "record": _swing(3.2, "wrong hand", "left"), "forPlan": True})
    ops.append({"op": "add", "record": _swing(3.2, "wrong hand", "right"), "forPlan": True})
    result = _ops(ops, tmp_path)
    assert result["plan"]["baseline"] == [3, 2, 1]
    assert result["plan"]["retest"] == [4, 5, 6]
    by_id = {s["id"]: s for s in result["swings"]}
    assert by_id[2]["metrics"]["tempo_ratio"] == 2.75 and "reread_at" in by_id[2]
    assert by_id[6]["handedness"] == "right"
    assert result["change"]["verdict"] != "not_comparable"


def _refused(key: str) -> dict[str, Any]:
    """What the page records for a clip it refused (app.js, recordSwing)."""
    return {"ok": False, "refusal": "The handedness chosen does not match this swing.",
            "detection_rate": 0.97, "handedness": None, "camera": None, "metrics": None,
            "clip_key": key}  # fmt: skip


def test_a_refused_reread_keeps_the_analysed_reading(tmp_path: Path) -> None:
    """QA's reproduction (#26): it used to drop "improved" to "not_enough_swings"."""
    ops: list[dict[str, Any]] = [
        {"op": "add", "record": _swing(t, f"b{i}")} for i, t in enumerate((2.7, 2.9, 2.8))
    ]
    ops.append({"op": "start", "focus": "tempo_quick", "from": 3})
    ops += [
        {"op": "add", "record": _swing(t, f"r{i}"), "forPlan": True}
        for i, t in enumerate((3.3, 3.4, 3.35))
    ]
    before = _ops(ops, tmp_path)
    assert before["change"]["verdict"] == "improved" and before["change"]["n_after"] == 3
    # Retest clip r0 run again with the wrong hand set, and refused.
    after = _ops([*ops, {"op": "add", "record": _refused("r0"), "forPlan": True}], tmp_path)

    def readings(result: dict[str, Any]) -> list[dict[str, Any]]:
        return [{k: v for k, v in s.items() if k != "at"} for s in result["swings"]]

    assert readings(after) == readings(before)  # swing 4 still holds its 3.3
    assert after["plan"]["retest"] == before["plan"]["retest"] == [4, 5, 6]
    assert after["plan"]["baseline"] == before["plan"]["baseline"]
    assert after["change"]["verdict"] == "improved" and after["change"]["n_after"] == 3
    # A refused clip analysed later replaces its refusal, and a refused re-read of
    # a refusal replaces it too: only an analysed reading is protected.
    ops = [
        {"op": "add", "record": _refused("x")},
        {"op": "add", "record": {**_refused("x"), "refusal": "No swing was found."}},
    ]
    assert _ops(ops, tmp_path)["swings"][0]["refusal"] == "No swing was found."
    ops.append({"op": "add", "record": _swing(3.0, "x")})
    swings = _ops(ops, tmp_path)["swings"]
    assert len(swings) == 1 and swings[0]["ok"] and swings[0]["metrics"]["tempo_ratio"] == 3.0


def test_removing_a_swing_matches_the_iphone(tmp_path: Path) -> None:
    """The scenario of PracticeTests.testACapturePlanCountsCleanRecordingsInARow."""
    ops: list[dict[str, Any]] = [
        {"op": "add", "record": _swing(0.0, None, ok=False)},
        {"op": "start", "focus": "capture", "from": 1},
        {"op": "add", "record": _swing(3.1, None), "forPlan": True},
        {"op": "add", "record": _swing(0.0, None, ok=False), "forPlan": True},
        {"op": "add", "record": _swing(3.1, None), "forPlan": True},
        {"op": "add", "record": _swing(3.1, None), "forPlan": True},
        {"op": "remove", "id": 2},
        {"op": "remove", "id": 99},
    ]
    result = _ops(ops, tmp_path)
    assert result["removed"] == [True, False]
    assert result["plan"]["retest"] == [3, 4, 5]  # the Swift test's expectation
    assert [s["id"] for s in result["swings"]] == [1, 3, 4, 5]
    assert result["reloaded"] == 4
