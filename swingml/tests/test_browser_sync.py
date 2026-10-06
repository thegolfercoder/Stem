"""Two swings in step (#35): webapp/sync.js, in node.

The compare view warps one swing's time onto the other's piecewise-linearly
between their eight detected positions; the ghost carries one skeleton onto the
other frame, hips on hips at address, scaled to the same torso length.
"""

from __future__ import annotations

import itertools
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def node(expression: str, data: Any) -> Any:
    script = (
        f"import * as s from {json.dumps((WEBAPP / 'sync.js').as_uri())};"
        "const data = JSON.parse(process.argv[1]);"
        f"console.log(JSON.stringify(({expression})));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(data)],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return json.loads(done.stdout)


A = [1.0, 1.42, 1.61, 2.18, 2.35, 2.42, 2.61, 3.1]


@pytest.mark.parametrize("factor", [1.0, 2.0, 4.0])
def test_every_position_lands_on_the_other_swings_position(factor: float) -> None:
    b = [0.3 + t * factor for t in A]
    mapped = node("data.a.map((t) => s.syncTime(data.a, data.b, t))", {"a": A, "b": b})
    assert mapped == pytest.approx(b, abs=1e-9)


def test_the_parts_of_a_swing_are_stretched_each_by_its_own_amount() -> None:
    # B's backswing is twice as long as A's, its downswing the same length.
    b = [1.0, 1.84, 2.22, 3.36, 3.53, 3.6, 3.79, 4.28]
    out = node(
        "[0.5, 1.21, 2.0, 2.385, 3.1, 3.5].map((t) => s.syncTime(data.a, data.b, t))",
        {"a": A, "b": b},
    )
    assert out[1] == pytest.approx(1.42, abs=1e-9)  # halfway to toe-up, stretched twice
    assert out[3] == pytest.approx(3.565, abs=1e-9)  # halfway down, not stretched
    pace = (b[-1] - b[0]) / (A[-1] - A[0])
    assert out[0] == pytest.approx(b[0] - 0.5 * pace) and out[5] == pytest.approx(
        b[-1] + 0.4 * pace
    )
    assert all(x < y for x, y in itertools.pairwise(out))


def test_the_nearest_frame_is_found() -> None:
    times = [0.0, 0.0333, 0.0667, 0.1]
    assert node("[0.016, 0.017, 0.045, 2].map((t) => s.nearestIndex(data, t))", times) == [
        0,
        1,
        1,
        3,
    ]


def test_the_ghost_puts_hips_on_hips_and_matches_the_torso() -> None:
    data = np.load(LANDMARKS)
    xy_a = data["xy"][81].tolist()
    # The same golfer, filmed smaller, off to one side, on a landscape frame.
    xy_b = [[0.2 + 0.5 * x * 1280 / 1920, 0.1 + 0.5 * y] for x, y in xy_a]
    out = node(
        "(() => { const t = s.ghostTransform(data.a, [720, 1280], data.b, [1920, 1080]);"
        " return s.ghostPoints(data.b, [1920, 1080], [720, 1280], t); })()",
        {"a": xy_a, "b": xy_b},
    )
    hip = lambda p: np.mean([p[23], p[24]], axis=0) * [720, 1280]  # noqa: E731
    shoulder = lambda p: np.mean([p[11], p[12]], axis=0) * [720, 1280]  # noqa: E731
    assert np.allclose(hip(np.array(out)), hip(np.array(xy_a)), atol=1e-6)
    torso = lambda p: np.linalg.norm(shoulder(np.array(p)) - hip(np.array(p)))  # noqa: E731
    assert torso(out) == pytest.approx(torso(xy_a), rel=1e-9)
