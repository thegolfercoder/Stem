"""Every drill is shown as well as told (#57).

Each drill in `insights/drills.py` carries a looping stick-figure illustration and
its sets for the page's rep counter. The figure's poses are drawn by hand and go
out in the same payload as the drills, so the browser draws what Python defines;
`webapp/drills.js` turns them into SVG, which these tests run in node.
"""

from __future__ import annotations

import itertools
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from swingml.insights.drills import DRILLS, JOINTS, POSES
from swingml.insights.payload import practice_payload

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"


def node(expression: str, data: Any) -> Any:
    script = (
        f"import * as d from {json.dumps((WEBAPP / 'drills.js').as_uri())};"
        "const data = JSON.parse(process.argv[1]);"
        f"console.log(JSON.stringify(({expression})));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(data)],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return json.loads(done.stdout)


needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


@pytest.mark.parametrize("drill", DRILLS, ids=[d.id for d in DRILLS])
def test_every_drill_has_an_illustration_and_its_sets(drill: Any) -> None:
    keys = drill.demo.keys
    assert keys, f"{drill.id} has no illustration"
    assert keys[0].at == 0 and all(a.at < b.at for a, b in itertools.pairwise(keys))
    assert all(k.pose in POSES for k in keys)
    assert len({k.pose for k in keys}) >= 2, f"{drill.id}'s figure never moves"
    # The counter's sets are the ones the drill's own words ask for.
    sets = re.match(r"(\d+) sets of (\d+)", drill.reps)
    expected = (int(sets[1]), int(sets[2])) if sets else (1, int(drill.reps.split()[0]))
    assert (drill.sets, drill.reps_per_set) == expected


def test_every_pose_names_every_point_inside_the_figures_box() -> None:
    for name, pose in POSES.items():
        assert set(pose) == set(JOINTS), name
        assert all(0 <= x <= 100 and 0 <= y <= 140 for x, y in pose.values()), name


def test_the_payload_carries_the_drills_and_their_poses_unchanged() -> None:
    rules = practice_payload()
    assert rules["drills"] == [d.model_dump(mode="json") for d in DRILLS]
    assert rules["drill_poses"] == {
        name: {joint: list(point) for joint, point in pose.items()} for name, pose in POSES.items()
    }
    if PAYLOAD.is_file():
        shipped = json.loads(PAYLOAD.read_text(encoding="utf-8"))["practice"]
        assert shipped["drills"] == rules["drills"]
        assert shipped["drill_poses"] == rules["drill_poses"]


@needs_node
def test_each_figure_is_drawn_from_its_drills_poses() -> None:
    rules = practice_payload()
    svgs = node("data.drills.map((dr) => d.drillDemoSvg(dr, data.drill_poses))", rules)
    for drill, svg in zip(DRILLS, svgs, strict=True):
        loop = drill.demo.keys[-1].at
        # 13 lines and the head, each moved through every key of the loop.
        assert svg.count('<line class="dm-bone"') + svg.count('<line class="dm-lit"') == 13
        assert svg.count(f'dur="{loop}s"') >= 14 * 2, drill.id
        first = POSES[drill.demo.keys[0].pose]
        assert f'cx="{first["head"][0]:g}"' in svg
        assert "not a measurement of anyone&#39;s swing" in svg
        lit = {"shoulders": 1, "hips": 1, "head": 0, "frame": 0}[drill.demo.highlight]
        assert svg.count('class="dm-lit"') == lit, drill.id
        assert ("dm-lit-head" in svg) == (drill.demo.highlight == "head")
        assert ("dm-frame" in svg) == (drill.demo.highlight == "frame")
        assert ("dm-stick" in svg) == ("stick" in drill.demo.props)
        words = [k.say for k in drill.demo.keys if k.say]
        assert svg.count('class="dm-say"') == len(words)


@needs_node
def test_the_counter_walks_through_the_sets() -> None:
    drill = next(d for d in DRILLS if d.id == "tempo-count-three").model_dump(mode="json")
    labels = node("[0, 1, 4, 5, 6, 14, 15, 20].map((n) => d.repLabel(data, n))", drill)
    assert labels == [
        "Set 1 of 3 · rep 0 of 5", "Set 1 of 3 · rep 1 of 5", "Set 1 of 3 · rep 4 of 5",
        "Set 1 of 3 done: rest, then the next", "Set 2 of 3 · rep 1 of 5",
        "Set 3 of 3 · rep 4 of 5", "All 15 done: 3 sets of 5", "All 15 done: 3 sets of 5",
    ]  # fmt: skip
    one = next(d for d in DRILLS if d.sets == 1).model_dump(mode="json")
    assert node("[0, 2, 3].map((n) => d.repLabel(data, n))", one) == [
        "rep 0 of 3",
        "rep 2 of 3",
        "All 3 done: 1 set of 3",
    ]
