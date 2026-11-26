"""The decisions behind recording in the browser page (#34), without a camera.

webapp/capture.js decides what to ask the camera for, which container to record,
whether the golfer is framed, whether the phone is level and whether the frame
rate is enough. These run it in node on made-up poses whose answers are known.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

CAPTURE = Path(__file__).resolve().parent.parent / "webapp" / "capture.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def call(expression: str) -> Any:
    script = (
        f"import * as c from {json.dumps(CAPTURE.as_uri())};"
        f"console.log(JSON.stringify(({expression})));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return json.loads(done.stdout)


def body(top: float, bottom: float, centre: float = 0.5, feet: bool = True) -> list[dict]:
    """33 landmarks of a standing golfer between `top` and `bottom` of the frame."""
    points = []
    for i in range(33):
        if i <= 10:
            y = top + 0.02 * (i % 3)
        elif i >= 27:
            y = bottom - 0.01 * (i % 2)
        else:
            y = top + (bottom - top) * (0.2 + 0.5 * ((i - 11) / 16))
        x = centre + (0.05 if i % 2 else -0.05)
        visible = 0.0 if (i >= 27 and not feet) else 0.95
        points.append({"x": x, "y": y, "visibility": visible})
    return points


def verdict(points: list[dict] | None) -> dict:
    return call(f"c.framingVerdict({json.dumps(points)})")


def test_a_golfer_filling_the_band_is_framed() -> None:
    result = verdict(body(0.15, 0.85))
    assert result["ok"] and result["message"] == "Whole body in frame"


@pytest.mark.parametrize(
    ("points", "says"),
    [
        (None, "Step into the frame"),
        (body(0.15, 0.85, feet=False), "feet"),
        (body(0.05, 0.99), "feet"),
        (body(0.01, 0.80), "head"),
        (body(0.06, 0.95), "Step back a little"),
        (body(0.40, 0.70), "Move closer"),
        (body(0.15, 0.85, centre=0.15), "middle"),
    ],
)
def test_each_framing_fault_gets_its_own_instruction(points: list[dict] | None, says: str) -> None:
    result = verdict(points)
    assert not result["ok"]
    assert says in result["message"]


def test_the_phone_is_level_within_three_degrees() -> None:
    assert call("c.levelVerdict(80, 2, false)")["level"] is True
    tilted = call("c.levelVerdict(80, -7.4, false)")
    assert tilted["level"] is False and "7" in tilted["text"]
    assert call("c.levelVerdict(5, 80, true)")["level"] is False
    assert call("c.levelVerdict(null, null, false)") is None


def test_below_fifty_fps_the_camera_rate_is_a_warning() -> None:
    assert call("c.frameRateNote(30)")["low"] is True
    assert "30 fps" in call("c.frameRateNote(30)")["text"]
    assert call("c.frameRateNote(60)")["low"] is False
    assert call("c.frameRateNote(undefined)")["low"] is False


def test_mp4_is_preferred_where_the_browser_records_it() -> None:
    assert call("c.recordingType((t) => t.startsWith('video/mp4'))") == "video/mp4;codecs=avc1"
    assert call("c.recordingType((t) => t === 'video/webm;codecs=vp8')") == "video/webm;codecs=vp8"
    assert call("c.recordingType(() => false)") == ""
    assert call("c.extensionFor('video/webm;codecs=vp8')") == "webm"


def test_the_camera_asked_for_is_the_rear_one_at_sixty_and_no_sound() -> None:
    constraints = call("c.cameraConstraints()")
    assert constraints["audio"] is False
    assert constraints["video"]["facingMode"] == {"ideal": "environment"}
    assert constraints["video"]["frameRate"] == {"ideal": 60}
