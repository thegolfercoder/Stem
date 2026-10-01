"""The iPhone's practice-loop reference still says what the Python says.

PracticeTests (Swift) holds Practice.swift to answers stored in
practice_golden.json. Those answers were the Python's when the file was made; if
the rules or the drills change and nobody regenerates it, the Swift tests go on
passing against the old rules. This fails first.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

IOS_TESTS = Path(__file__).resolve().parents[2] / "ios" / "SwingCore" / "Tests"
GENERATOR = IOS_TESTS / "make_practice_golden.py"
GOLDEN = IOS_TESTS / "SwingCoreTests" / "Resources" / "practice_golden.json"


@pytest.mark.skipif(not GOLDEN.is_file(), reason="the iPhone app is not in this checkout")
def test_the_swift_reference_matches_the_python_rules() -> None:
    spec = importlib.util.spec_from_file_location("make_practice_golden", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fresh = json.loads(json.dumps(module.build(), sort_keys=True))
    stored = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert fresh == stored, (
        "practice_golden.json is stale: run python ios/SwingCore/Tests/make_practice_golden.py"
    )
