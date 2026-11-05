"""The iPhone's engine reference still says what the browser engine says.

SwingCoreTests hold the Swift engine to golden_real_swing_01.json, every stage of
the real-swing fixture as the browser engine (webapp/*.js) computed it when the
file was made. If the browser engine changes and nobody regenerates the file, the
Swift tests go on passing against the old answers (#72). This fails first.
"""

from __future__ import annotations

import importlib.util
import json
import math
import shutil
from pathlib import Path
from typing import Any

import pytest

IOS_TESTS = Path(__file__).resolve().parents[2] / "ios" / "SwingCore" / "Tests"
GENERATOR = IOS_TESTS / "make_golden.py"
GOLDEN = IOS_TESTS / "SwingCoreTests" / "Resources" / "golden_real_swing_01.json"

# Far below any change that means something, and above the last-digit differences
# a different node version's maths library may give.
RELATIVE = 1e-9


def differences(fresh: Any, stored: Any, path: str = "") -> list[str]:
    if isinstance(fresh, dict) and isinstance(stored, dict):
        if fresh.keys() != stored.keys():
            return [f"{path or '/'}: keys {sorted(fresh)} != {sorted(stored)}"]
        return [d for k in fresh for d in differences(fresh[k], stored[k], f"{path}/{k}")]
    if isinstance(fresh, list) and isinstance(stored, list):
        if len(fresh) != len(stored):
            return [f"{path}: {len(fresh)} items != {len(stored)}"]
        found: list[str] = []
        for i, (a, b) in enumerate(zip(fresh, stored, strict=True)):
            found += differences(a, b, f"{path}[{i}]")
            if len(found) > 5:
                break
        return found
    if isinstance(fresh, float | int) and isinstance(stored, float | int) \
            and not isinstance(fresh, bool) and not isinstance(stored, bool):  # fmt: skip
        same = math.isclose(fresh, stored, rel_tol=RELATIVE, abs_tol=1e-12)
        return [] if same else [f"{path}: {fresh} != {stored}"]
    return [] if fresh == stored else [f"{path}: {fresh!r} != {stored!r}"]


@pytest.mark.skipif(not GOLDEN.is_file(), reason="the iPhone app is not in this checkout")
@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_the_swift_reference_matches_the_browser_engine() -> None:
    spec = importlib.util.spec_from_file_location("make_golden", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fresh = json.loads(module.build())
    stored = json.loads(GOLDEN.read_text(encoding="utf-8"))
    found = differences(fresh, stored)
    assert not found, (
        "golden_real_swing_01.json is stale: run python ios/SwingCore/Tests/make_golden.py\n"
        + "\n".join(found[:6])
    )
