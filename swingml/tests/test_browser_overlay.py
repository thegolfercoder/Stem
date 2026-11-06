"""The lines a golfer can draw on a swing frame (#58): webapp/overlay.js, in node.

Each angle is a picture angle: between a line on the frame and the frame's own
level or upright, in pixels, so a portrait frame's aspect has to be taken into
account. The head box stays where the head was at address. Every label says it
was read in the picture, and never names what one camera cannot measure.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / "webapp"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

WIDTH, HEIGHT = 720, 1280  # a portrait phone frame: fractions are not pixels


def node(expression: str, data: Any) -> Any:
    script = (
        f"import * as o from {json.dumps((WEBAPP / 'overlay.js').as_uri())};"
        f"import * as r from {json.dumps((WEBAPP / 'read.js').as_uri())};"
        "const data = JSON.parse(process.argv[1]);"
        f"console.log(JSON.stringify(({expression})));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(data)],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return json.loads(done.stdout)


def pose(shoulder_deg: float, hip_deg: float, spine_deg: float, head: tuple[float, float]) -> dict:
    """A body whose lines make the given picture angles on a WIDTH x HEIGHT frame.

    Shoulders and hips tilt with the picture's right end lower for a positive
    angle; the spine leans right of upright by `spine_deg`."""
    xy = [[0.5, 0.5] for _ in range(33)]

    def line(centre_px: tuple[float, float], half_px: float, degrees: float) -> list[list[float]]:
        dx = half_px * math.cos(math.radians(degrees))
        dy = half_px * math.sin(math.radians(degrees))
        (cx, cy) = centre_px
        left, right = (cx - dx, cy - dy), (cx + dx, cy + dy)
        return [[right[0] / WIDTH, right[1] / HEIGHT], [left[0] / WIDTH, left[1] / HEIGHT]]

    hip_mid = (360.0, 800.0)
    length = 400.0
    shoulder_mid = (hip_mid[0] + length * math.sin(math.radians(spine_deg)),
                    hip_mid[1] - length * math.cos(math.radians(spine_deg)))  # fmt: skip
    xy[11], xy[12] = line(shoulder_mid, 90, shoulder_deg)  # left, right shoulder
    xy[23], xy[24] = line(hip_mid, 70, hip_deg)
    for i in range(11):
        xy[i] = [head[0] + 0.01 * (i % 3), head[1] + 0.006 * (i % 4)]
    return {"xy": xy, "visibility": [1.0] * 33}


@pytest.mark.parametrize(("shoulder", "hip", "spine"), [(0, 0, 0), (12, -5, 8), (-20, 15, -25)])
def test_line_angles_are_the_picture_angles_in_pixels(
    shoulder: float, hip: float, spine: float
) -> None:
    body = pose(shoulder, hip, spine, (0.48, 0.2))
    lines = node(f"o.frameLines(data.xy, data.visibility, {WIDTH}, {HEIGHT})", body)
    assert lines["shoulders"]["degrees"] == pytest.approx(abs(shoulder), abs=1e-6)
    assert lines["hips"]["degrees"] == pytest.approx(abs(hip), abs=1e-6)
    assert lines["spine"]["degrees"] == pytest.approx(abs(spine), abs=1e-6)
    lower = {True: "right", False: "left"}
    assert lines["shoulders"]["lower"] == (None if shoulder == 0 else lower[shoulder > 0])
    assert lines["spine"]["leans"] == (None if spine == 0 else lower[spine > 0])
    # The same fractions read on a square frame would give a different angle:
    # the aspect is in the answer.
    if shoulder:
        square = node("o.frameLines(data.xy, data.visibility, 1000, 1000)", body)
        assert abs(square["shoulders"]["degrees"] - abs(shoulder)) > 1


def test_a_line_whose_ends_were_not_seen_is_not_drawn() -> None:
    body = pose(10, 0, 0, (0.48, 0.2))
    body["visibility"][12] = 0.1
    lines = node(f"o.frameLines(data.xy, data.visibility, {WIDTH}, {HEIGHT})", body)
    assert lines["shoulders"] is None and lines["spine"] is None and lines["hips"] is not None


def test_the_head_box_stays_at_address_and_tells_a_moved_head() -> None:
    address = pose(0, 0, 0, (0.48, 0.2))
    still = pose(10, 5, 5, (0.481, 0.201))
    moved = pose(10, 5, 5, (0.56, 0.2))
    out = node(
        "(() => { const box = o.headBox(data.a.xy, data.a.visibility);"
        " return { box, again: o.headBox(data.a.xy, data.a.visibility),"
        " still: o.headInside(box, data.s.xy, data.s.visibility),"
        " moved: o.headInside(box, data.m.xy, data.m.visibility) }; })()",
        {"a": address, "s": still, "m": moved},
    )
    assert out["box"] == out["again"]
    head_x = [p[0] for p in address["xy"][:11]]
    assert out["box"]["x"] < min(head_x) and out["box"]["x"] + out["box"]["width"] > max(head_x)
    assert out["still"] is True and out["moved"] is False


@pytest.mark.parametrize("face_on", [True, False, None])
def test_every_label_says_it_is_read_in_the_picture(face_on: bool | None) -> None:
    body = pose(12, -5, 8, (0.48, 0.2))
    labels = node(
        f"o.lineLabels(o.frameLines(data.xy, data.visibility, {WIDTH}, {HEIGHT}), "
        f"{json.dumps(face_on)})",
        body,
    )
    forbidden = node("r.FORBIDDEN", {})
    for text in labels.values():
        assert text.endswith(", in the picture"), text
        found = [w for w in forbidden if re.search(rf"\b{re.escape(w)}\b", text.lower())]
        assert not found, (found, text)
    assert labels["shoulders"].startswith(
        {True: "Shoulder tilt 12°", False: "Shoulder line 12°", None: "Shoulder line 12°"}[face_on]
    )
    assert "(right end lower)" in labels["shoulders"] and "(leaning right)" in labels["spine"]
    spine_words = {True: "side lean", False: "forward lean", None: "Spine line"}[face_on]
    assert spine_words in labels["spine"]
