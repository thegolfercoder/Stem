"""Left-handed swings: what the app knows, and what it says it does not (#33).

The model reads the same swing differently when it is mirrored, and the tempo
band was measured on 85 swings of which 8 were left-handed. Until left-handers
are canonicalised (#45), every app says the band was not measured
for them, with the same words.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, SwingAnalysis, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.events import EventSequence
from swingml.model.calibration import LEFT_HANDED_TEMPO_NOTE, load_calibration
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.web.app import create_app
from tests.mirror import mirrored

HERE = Path(__file__).parent
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"
SHIPPED = HERE.parent / "swingml" / "data" / "event_calibration.json"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"


def fixture() -> PoseSequence:
    data = np.load(LANDMARKS)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


def test_the_note_quotes_the_published_numbers() -> None:
    """The counts in the wording are the ones in the audit, not typed from memory."""
    audit = json.loads((HERE.parents[1] / "docs" / "audit" / "error-breakdown.json").read_text())
    left = audit["by_condition"]["handedness"]["left"]
    right = audit["by_condition"]["handedness"]["right"]
    assert f"within {round(100 * left['tempo_p80_rel_error'])}% ({left['n']} swings)" in (
        LEFT_HANDED_TEMPO_NOTE
    )
    assert f"{round(100 * right['tempo_p80_rel_error'])}% for right-handed ones ({right['n']})" in (
        LEFT_HANDED_TEMPO_NOTE
    )
    assert f"of the {load_calibration(SHIPPED).tempo.n_calibration} swings" in (  # type: ignore[union-attr]
        LEFT_HANDED_TEMPO_NOTE
    )


@pytest.mark.skipif(find_event_model() is None, reason="needs the bundled model")
@pytest.mark.xfail(
    strict=True,
    reason="#33, #45: features are not mirrored for left-handers, so a mirrored swing reads "
    "differently; expected to pass once left-handers are canonicalised",
)
def test_a_mirrored_swing_reads_the_same_as_the_original() -> None:
    path = find_event_model()
    assert path is not None
    model = load_model(path)
    right = analyse_pose_sequence(fixture(), model, AnalysisConfig(handedness=Handedness.RIGHT))
    left = analyse_pose_sequence(
        mirrored(fixture()), model, AnalysisConfig(handedness=Handedness.LEFT)
    )
    assert not isinstance(right.events, NoReading) and not isinstance(left.events, NoReading)
    assert np.max(np.abs(np.subtract(right.events.frames, left.events.frames))) <= 1
    assert not isinstance(right.metrics, NoReading) and not isinstance(left.metrics, NoReading)
    assert left.metrics.tempo_ratio.value == pytest.approx(  # type: ignore[union-attr]
        right.metrics.tempo_ratio.value,
        rel=0.02,  # type: ignore[union-attr]
    )


def desktop_tempo_card(tmp_path: Path, hand: Handedness) -> str:
    calibration = load_calibration(SHIPPED)
    events = EventSequence(frames=(10, 20, 30, 40, 45, 50, 55, 70), confidence=(0.9,) * 8)
    sequence = fixture()
    from swingml.metrics.swing import compute_metrics

    analysis = SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=sequence.n_frames,
        events=events,
        event_times_s=tuple(f / 60.0 for f in events.frames),
        event_source_frames=events.frames,
        metrics=compute_metrics(sequence, events, hand),
        handedness=hand,
        tempo_uncertainty=calibration.tempo,
    )
    store = SwingStore(tmp_path / f"{hand.value}.db")
    swing_id = store.add(analysis, source_name="clip.mov")
    app = create_app(store=store)
    app.config.update(TESTING=True)
    response = app.test_client().get(f"/swing/{swing_id}")
    assert response.status_code == 200
    return " ".join(response.get_data(as_text=True).split())


def test_the_desktop_page_tells_a_left_hander_the_band_is_not_theirs(tmp_path: Path) -> None:
    left = desktop_tempo_card(tmp_path, Handedness.LEFT)
    right = desktop_tempo_card(tmp_path, Handedness.RIGHT)
    assert "measured spread" in left and "measured spread" in right
    assert LEFT_HANDED_TEMPO_NOTE in left
    assert "Not measured for left-handed swings" not in right


@pytest.mark.skipif(not PAYLOAD.is_file(), reason="needs the exported web payload")
def test_the_browser_and_iphone_get_the_same_words() -> None:
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    assert payload["notes"]["left_handed_tempo_band"] == LEFT_HANDED_TEMPO_NOTE
    ios = HERE.parents[1] / "ios" / "SwingCore" / "Sources" / "SwingCore" / "Resources"
    assert json.loads((ios / "model.json").read_text())["notes"] == payload["notes"]


def _history(hand: str, tempos: tuple[float, ...]) -> list:  # type: ignore[type-arg]
    from swingml.insights.compare import CameraSignature, SwingPoint
    from swingml.insights.engine import RecentSwing

    camera = CameraSignature(
        orientation="portrait", body_height=0.6, centre_x=0.5, shoulder_ratio=0.95,
        frame_rate=60.0,
    )  # fmt: skip
    return [
        RecentSwing(
            swing_id=i + 1,
            refused=False,
            detection_rate=1.0,
            tempo=t,
            point=SwingPoint(
                swing_id=i + 1, value=t, handedness=hand, club="7 iron", camera=camera
            ),
        )
        for i, t in enumerate(tempos)
    ][::-1]


def test_the_practice_priority_tells_a_left_hander_the_band_is_not_theirs() -> None:
    """QA's repro on #33: three left-handed swings at 2.5, 2.6 and 2.4."""
    from swingml.insights.engine import TEMPO_LIMITS, choose

    left = choose(_history("left", (2.5, 2.6, 2.4)))
    right = choose(_history("right", (2.5, 2.6, 2.4)))
    assert left.kind == right.kind == "tempo_quick"
    assert left.limitations[0] == LEFT_HANDED_TEMPO_NOTE
    assert not any("±27%" in line and "left" not in line for line in left.limitations)
    assert right.limitations == TEMPO_LIMITS


def test_too_few_left_handed_swings_says_the_band_was_not_measured() -> None:
    from swingml.insights.engine import choose

    left = choose(_history("left", (2.5,)))
    right = choose(_history("right", (2.5,)))
    assert left.kind == right.kind == "not_enough"
    assert "not measured for left-handed" in left.summary
    assert "left-handed" not in right.summary
    assert left.limitations[0] == LEFT_HANDED_TEMPO_NOTE
