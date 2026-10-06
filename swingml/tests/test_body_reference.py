"""The stored tour body references are the numbers the script wrote (#12)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from swingml.analysis import load_model, model_fingerprint
from swingml.assets import find_event_model
from swingml.insights.reference import TOUR_BODY_READINGS

AUDIT = Path(__file__).resolve().parents[2] / "docs" / "audit" / "body-reference.json"


def test_the_stored_references_match_the_script_output() -> None:
    recorded = json.loads(AUDIT.read_text(encoding="utf-8"))
    assert set(TOUR_BODY_READINGS) == set(recorded["measures"])
    for measure, stored in TOUR_BODY_READINGS.items():
        row = recorded["measures"][measure]
        for key in ("p10", "p50", "p90"):
            assert getattr(stored, key) == pytest.approx(row[key], abs=5e-4), (measure, key)
            assert list(getattr(stored, f"{key}_ci95")) == row[f"{key}_ci95"], (measure, key)
        assert (stored.n_swings, stored.n_groups, stored.unit) == (
            row["n_swings"], row["n_groups"], row["unit"])  # fmt: skip
        assert stored.model_fingerprint == recorded["model_fingerprint"]


@pytest.mark.skipif(find_event_model() is None, reason="needs the bundled model")
def test_the_references_describe_the_shipped_weights() -> None:
    path = find_event_model()
    assert path is not None
    fingerprint = model_fingerprint(load_model(path))
    assert all(r.model_fingerprint == fingerprint for r in TOUR_BODY_READINGS.values())
