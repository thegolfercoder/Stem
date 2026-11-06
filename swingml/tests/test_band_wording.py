"""What the pages say about the error bands matches the table that made them (#30).

The calibration can split each event's errors by the model's confidence, and the
pages used to say so unconditionally: "a doubtful event gets a wider band than a
certain one". The shipped table has one bin per event, so every swing gets the
same band. The wording is now driven by the table, on the desktop page and in the
browser page (whose note is checked on the real page in `test_page.py`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import SwingAnalysis
from swingml.events import EventSequence
from swingml.model.calibration import (
    EventCalibration,
    ModelCalibration,
    build_calibration,
    load_calibration,
)
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.web.app import create_app
from swingml.web.service import AnalysisService

HERE = Path(__file__).parent
SHIPPED = HERE.parent / "swingml" / "data" / "event_calibration.json"
MODEL_JS = HERE.parent / "webapp" / "model.js"
CONFIDENCES = (0.9, 0.3, 0.8, 0.85, 0.82, 0.9, 0.7, 0.4)


def multi_bin() -> EventCalibration:
    rng = np.random.default_rng(0)
    confidence = rng.uniform(0.1, 1.0, size=(600, 8))
    error = np.abs(rng.normal(0.0, 1.0 + 6.0 * (1.0 - confidence)))
    return build_calibration(
        confidence, error, measured_on="a made-up corpus", n_clips=600, n_bins=3
    )


def test_the_shipped_table_has_one_band_per_event() -> None:
    assert load_calibration(SHIPPED).events.varies_with_confidence is False


def test_a_binned_table_varies_with_confidence() -> None:
    assert multi_bin().varies_with_confidence is True


def swing_page(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, table: EventCalibration) -> str:
    """The desktop swing page for one analysis banded by `table`, served with it."""
    calibration = ModelCalibration(events=table)
    monkeypatch.setattr(AnalysisService, "calibration", property(lambda self: calibration))
    events = EventSequence(frames=(10, 20, 30, 40, 45, 50, 55, 70), confidence=CONFIDENCES)
    analysis = SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=80,
        events=events,
        event_times_s=tuple(f / 60.0 for f in events.frames),
        event_source_frames=events.frames,
        metrics=NoReading(reason="not measured in this test", source="test"),
        handedness=Handedness.RIGHT,
        event_uncertainty=table.bands(CONFIDENCES),
    )
    store = SwingStore(tmp_path / "s.db")
    swing_id = store.add(analysis, source_name="clip.mov")
    app = create_app(store=store)
    app.config.update(TESTING=True)
    response = app.test_client().get(f"/swing/{swing_id}")
    assert response.status_code == 200
    return " ".join(response.get_data(as_text=True).split())


def test_the_desktop_page_does_not_claim_wider_bands_for_one_bin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    html = swing_page(tmp_path, monkeypatch, load_calibration(SHIPPED).events)
    assert "measured, not assumed" in html
    assert "wider band" not in html
    assert "every swing gets the same band" in html
    assert "measured on 85 clips" in html


def test_the_desktop_page_explains_a_binned_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    html = swing_page(tmp_path, monkeypatch, multi_bin())
    assert "a doubtful event gets a wider band than a certain one" in html
    assert "every swing gets the same band" not in html


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_the_browser_applies_the_same_rule() -> None:
    tables = {
        "shipped": json.loads(SHIPPED.read_text(encoding="utf-8")),
        "binned": {"events": multi_bin().model_dump(mode="json")},
        "none": None,
    }
    script = (
        f"import {{ bandsVaryWithConfidence }} from {json.dumps(MODEL_JS.as_uri())};"
        f"const t = {json.dumps(tables)};"
        "console.log(JSON.stringify(Object.fromEntries("
        "Object.entries(t).map(([k, v]) => [k, bandsVaryWithConfidence(v)]))));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    assert json.loads(done.stdout) == {"shipped": False, "binned": True, "none": False}
