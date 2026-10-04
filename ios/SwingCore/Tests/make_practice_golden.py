"""Regenerate SwingCoreTests/Resources/practice_golden.json.

Generated swing histories and before/after sets, each with the answer the Python
rules give (`choose`, `compare`, `camera_signature`, and a plan played through
swingml/web/practice.py), for PracticeTests to hold Practice.swift to. The same
generators feed swingml/tests/test_browser_practice.py, which holds the browser
to the same rules, and swingml/tests/test_ios_practice_golden.py fails when this
file no longer matches what the Python says. Run from anywhere after changing
the rules or the drills.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
TARGET = HERE / "SwingCoreTests" / "Resources" / "practice_golden.json"
sys.path.insert(0, str(REPO / "swingml"))
sys.path.insert(0, str(REPO / "swingml" / "tests"))

import numpy as np  # noqa: E402

from swingml.insights.compare import camera_signature, compare  # noqa: E402
from swingml.insights.engine import choose  # noqa: E402
from swingml.pose.base import PoseSequence  # noqa: E402
from swingml.web import practice as desktop  # noqa: E402
from test_browser_practice import (  # noqa: E402
    FakeStore,
    desktop_row,
    dump,
    plan_swings,
    random_history,
    random_sets,
)


def camera_case() -> dict[str, Any]:
    golden = json.loads((HERE / "SwingCoreTests" / "Resources" / "golden_real_swing_01.json").read_text())
    source = golden["input"]
    n = len(source["times"])
    sequence = PoseSequence(
        xy=np.asarray(source["xy"], dtype=np.float32),
        visibility=np.asarray(source["visibility"], dtype=np.float32),
        timestamps_s=np.asarray(source["times"], dtype=np.float64),
        frame_width=int(source["width"]),
        frame_height=int(source["height"]),
        detected=np.asarray(source["detected"], dtype=bool),
    )
    frames = [0, 10, n // 2, n - 1, n + 5]
    return {
        "frames": frames,
        "expected": [
            None if (c := camera_signature(sequence, f)) is None else c.model_dump(mode="json")
            for f in frames
        ],
    }


def plan_case(focus: str, spread: bool = False) -> dict[str, Any]:
    before, after = plan_swings(spread)
    store = FakeStore([desktop_row(i + 1, s) for i, s in enumerate(before)])
    insight = desktop.insight_for(store, 6).model_dump(mode="json")  # type: ignore[arg-type]
    drill = desktop.BY_FOCUS[focus]
    baseline, club = desktop.baseline_for(store, drill, 6)  # type: ignore[arg-type]
    store.rows += [desktop_row(i + 7, s) for i, s in enumerate(after)]
    retest = list(range(7, 12))
    plan = {"drill_id": drill.id, "baseline": baseline, "retest": retest}
    change = desktop.plan_change(store, plan)  # type: ignore[arg-type]
    return {
        "focus": focus,
        "before": before,
        "after": after,
        "expected": {
            "insight": insight,
            "baseline": baseline,
            "club": club,
            "retest": retest,
            "change": None if change is None else change.model_dump(mode="json"),
        },
    }


def build() -> dict[str, Any]:
    rng = random.Random(20261001)
    histories = [random_history(rng) for _ in range(150)]
    sets = [random_sets(rng) for _ in range(150)]
    return {
        "histories": [
            {"recent": dump(h), "expected": choose(h).model_dump(mode="json")} for h in histories
        ],
        "sets": [
            {
                "before": dump(s["before"]),
                "after": dump(s["after"]),
                "metric": s["metric"],
                "direction": s["direction"],
                "expected": compare(s["before"], s["after"], s["metric"], s["direction"]).model_dump(
                    mode="json"
                ),
            }
            for s in sets
        ],
        "g3": [[x, f"{x:.3g}"] for x in (0.1234567, 12.3456, 1234.5, 0.000123456, 1e-5, 2.0, 0.5)],
        "camera": camera_case(),
        "plans": [
            plan_case("tempo_quick"),
            plan_case("head_stability"),
            plan_case("tempo_quick", spread=True),
        ],
    }


if __name__ == "__main__":
    TARGET.write_text(json.dumps(build(), sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {TARGET} ({TARGET.stat().st_size / 1e3:.0f} kB)")
