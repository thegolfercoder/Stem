"""The practice loop: one grounded priority, one drill, a retest, an honest verdict.

What these pin down is mostly what the loop must *not* do: name a priority from
fewer than three swings, compare swings filmed from a different angle or with a
different club, call a change that the spread between swings can explain, or
invent a fault when nothing measured stands out.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from swingml.analysis import SwingAnalysis, analyse_with_positions
from swingml.insights.compare import CameraSignature, SwingPoint, compare, t95
from swingml.insights.engine import RecentSwing, choose
from swingml.insights.reference import TOUR_TEMPO_READINGS
from swingml.labels import save_pose
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading, Provenance, Quantity
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.web.app import create_app
from swingml.web.service import frames_dir
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import generate_swing

FACE_ON = CameraSignature(
    orientation="portrait", body_height=0.6, centre_x=0.5, shoulder_ratio=1.0, frame_rate=60.0
)
DOWN_THE_LINE = FACE_ON.model_copy(update={"shoulder_ratio": 0.3})


def point(i: int, value: float, camera: CameraSignature = FACE_ON, club: str = "7i") -> SwingPoint:
    return SwingPoint(swing_id=i, value=value, handedness="right", club=club, camera=camera)


def recent(i: int, tempo: float, camera: CameraSignature = FACE_ON) -> RecentSwing:
    return RecentSwing(
        swing_id=i, refused=False, detection_rate=1.0, tempo=tempo, point=point(i, tempo, camera)
    )


# -- the engine -----------------------------------------------------------------


def test_a_refused_latest_swing_makes_capture_the_priority() -> None:
    swings = [
        RecentSwing(swing_id=3, refused=True, refusal="no body"),
        recent(2, 2.4),
        recent(1, 2.4),
    ]
    insight = choose(swings)
    assert insight.kind == "capture"
    assert insight.drill is not None and insight.drill.focus == "capture"


def test_no_priority_about_the_swing_from_fewer_than_three_swings() -> None:
    insight = choose([recent(2, 2.2), recent(1, 2.2)])
    assert insight.kind == "not_enough"
    assert insight.drill is None


def test_a_tempo_below_what_tour_swings_read_as_is_the_priority() -> None:
    low = TOUR_TEMPO_READINGS.p10 - 0.4
    insight = choose([recent(3, low), recent(2, low - 0.1), recent(1, low + 0.1)])
    assert insight.kind == "tempo_quick"
    assert insight.drill is not None and insight.drill.metric == "tempo_ratio"
    assert insight.confidence == "moderate"
    assert any("3.3" in limit for limit in insight.limitations)


def test_nothing_is_invented_when_the_tempo_is_in_the_tour_range() -> None:
    insight = choose([recent(3, 3.5), recent(2, 3.6), recent(1, 3.4)])
    assert insight.kind == "choose"
    assert insight.drill is None
    assert insight.choices


def test_swings_from_another_camera_angle_do_not_count_towards_a_priority() -> None:
    low = TOUR_TEMPO_READINGS.p10 - 0.5
    swings = [recent(3, low), recent(2, low, DOWN_THE_LINE), recent(1, low, DOWN_THE_LINE)]
    assert choose(swings).kind == "not_enough"


def test_the_same_swings_always_give_the_same_priority() -> None:
    swings = [recent(3, 2.3), recent(2, 2.4), recent(1, 2.2)]
    assert choose(swings) == choose(swings)


# -- the comparison -------------------------------------------------------------


def test_a_clear_change_the_drill_aims_for_is_called_improved() -> None:
    before = [point(i, v) for i, v in enumerate([2.3, 2.4, 2.35, 2.45])]
    after = [point(10 + i, v) for i, v in enumerate([2.9, 3.0, 2.95, 3.05])]
    change = compare(before, after, "tempo_ratio", "increase")
    assert change.verdict == "improved"
    assert change.interval is not None and change.interval[0] > 0
    assert "0.44" in change.explanation


def test_a_change_the_spread_can_explain_is_not_called_a_change() -> None:
    before = [point(i, v) for i, v in enumerate([2.3, 3.1, 2.6])]
    after = [point(10 + i, v) for i, v in enumerate([2.5, 3.2, 2.7])]
    change = compare(before, after, "tempo_ratio", "increase")
    assert change.verdict == "no_detectable_change"
    assert "not the same as no change" in change.explanation


def test_the_wrong_way_is_reported_as_the_wrong_way() -> None:
    before = [point(i, v) for i, v in enumerate([0.05, 0.06, 0.055])]
    after = [point(10 + i, v) for i, v in enumerate([0.09, 0.10, 0.095])]
    assert compare(before, after, "head_movement", "decrease").verdict == "worsened"


def test_two_swings_a_side_are_not_enough() -> None:
    change = compare(
        [point(1, 2.0), point(2, 2.1)], [point(3, 3.0), point(4, 3.1)], "tempo_ratio", "increase"
    )
    assert change.verdict == "not_enough_swings"


@pytest.mark.parametrize(
    "after_point",
    [
        point(9, 3.0, club="driver"),
        point(9, 3.0, DOWN_THE_LINE),
        point(9, 3.0, FACE_ON.model_copy(update={"orientation": "landscape"})),
    ],
)
def test_swings_filmed_or_played_differently_are_not_compared(after_point: SwingPoint) -> None:
    before = [point(i, 2.4) for i in range(3)]
    after = [point(10, 3.0), point(11, 3.1), after_point]
    assert compare(before, after, "tempo_ratio", "increase").verdict == "not_comparable"


def test_a_moved_phone_blocks_picture_measurements_but_not_timing() -> None:
    moved = FACE_ON.model_copy(update={"body_height": 0.3})
    before = [point(i, v) for i, v in enumerate([2.3, 2.4, 2.35])]
    after = [point(10 + i, v, moved) for i, v in enumerate([2.9, 3.0, 2.95])]
    timing = compare(before, after, "tempo_ratio", "increase")
    assert timing.verdict == "improved" and timing.comparability.warnings
    picture = compare(before, after, "head_movement", "decrease")
    assert picture.verdict == "not_comparable"


def test_the_t_table_is_conservative_between_entries() -> None:
    assert t95(13.7) == pytest.approx(2.179)
    assert t95(0.4) == pytest.approx(12.706)


# -- the app --------------------------------------------------------------------

QUIET = NoiseConfig(
    jitter_px=0.0, speed_jitter_px_per_body_length=0.0, fast_landmark_multiplier=1.0,
    dropout_probability=0.0, frame_loss_probability=0.0, timestamp_jitter_s=0.0,
)  # fmt: skip


@pytest.fixture
def sequence() -> PoseSequence:
    swing = generate_swing(frame_rate_hz=60.0)
    camera = CameraConfig(
        azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
    )
    return render_pose_sequence(swing, camera, QUIET, seed=0)


@pytest.fixture
def analysis(sequence: PoseSequence) -> SwingAnalysis:
    frames = tuple(int(f) for f in generate_swing(frame_rate_hz=60.0).truth.event_frames)
    return analyse_with_positions(sequence, frames, Handedness.RIGHT).model_copy(
        update={"positions_set_by": "model"}
    )


def with_tempo(analysis: SwingAnalysis, tempo: float) -> SwingAnalysis:
    assert not isinstance(analysis.metrics, NoReading)
    reading = Quantity(value=tempo, unit="", provenance=Provenance.DERIVED, source="events")
    return analysis.model_copy(
        update={"metrics": analysis.metrics.model_copy(update={"tempo_ratio": reading})}
    )


def test_every_analysis_records_where_the_camera_was(analysis: SwingAnalysis) -> None:
    assert analysis.camera is not None
    assert analysis.camera.orientation == "portrait"
    assert 0.5 < analysis.camera.shoulder_ratio < 2.0


@pytest.fixture
def app_with_swings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, analysis: SwingAnalysis, sequence: PoseSequence
):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("SWINGML_HOME", str(tmp_path / "home"))
    store = SwingStore(tmp_path / "s.db")
    ids = [store.add(with_tempo(analysis, t), source_name=f"{i}.mov", club="7i")
           for i, t in enumerate([2.3, 2.4, 2.35])]  # fmt: skip
    for swing_id in ids:
        save_pose(sequence, frames_dir() / str(swing_id))
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client(), store, ids


def test_the_swing_page_leads_with_one_priority_and_its_drill(app_with_swings) -> None:  # type: ignore[no-untyped-def]
    http, store, ids = app_with_swings
    page = http.get(f"/swing/{ids[-1]}").get_data(as_text=True)
    assert "Your backswing is quick for your downswing" in page
    assert "Start practising this" in page
    assert "What this analysis cannot tell you" in page
    assert "Club face" in page
    assert store.event_counts().get("insight_viewed") == 1


def test_a_plan_runs_from_start_to_verdict(app_with_swings, analysis: SwingAnalysis) -> None:  # type: ignore[no-untyped-def]
    http, store, ids = app_with_swings
    started = http.post("/api/plans", json={"focus": "tempo_quick", "from_swing": ids[-1]})
    assert started.status_code == 201
    plan_id = started.get_json()["plan_id"]
    assert sorted(started.get_json()["baseline"]) == sorted(ids)

    page = http.get("/practice").get_data(as_text=True)
    assert "Not enough swings to tell yet" in page

    for i, tempo in enumerate([2.9, 3.0, 2.95]):
        swing_id = store.add(with_tempo(analysis, tempo), source_name=f"r{i}.mov", club="7i")
        store.add_plan_swing(plan_id, swing_id, "retest")
    page = http.get("/practice").get_data(as_text=True)
    assert "Yes: it moved the way the drill aims" in page

    assert (
        http.post(
            f"/api/plans/{plan_id}/feedback", json={"useful": 4, "feel": "slower"}
        ).status_code
        == 201
    )
    assert http.post(f"/api/plans/{plan_id}/close", json={"status": "completed"}).status_code == 200
    assert store.active_plan() is None
    counts = store.event_counts()
    assert counts["plan_started"] == 1 and counts["feedback_given"] == 1


def test_a_retest_upload_must_name_a_real_plan(app_with_swings) -> None:  # type: ignore[no-untyped-def]
    import io

    http, _, _ = app_with_swings
    response = http.post(
        "/api/analyse",
        data={"video": (io.BytesIO(b"x"), "clip.mov"), "plan": "999"},
        content_type="multipart/form-data",
    )
    assert response.status_code in (400, 503)


def test_everything_can_be_exported_and_erased(app_with_swings) -> None:  # type: ignore[no-untyped-def]
    http, store, ids = app_with_swings
    exported = http.get("/api/export")
    assert exported.status_code == 200
    body = exported.get_json()
    assert len(body["swings"]) == len(ids)
    assert "analysis" in body["swings"][0]

    assert http.post("/api/erase", json={}).status_code == 400
    assert store.counts()[0] == len(ids)
    erased = http.post("/api/erase", json={"confirm": "ERASE"})
    assert erased.get_json()["swings_deleted"] == len(ids)
    assert store.counts() == (0, 0)
    assert not any(frames_dir().iterdir())


def test_deleting_a_swing_removes_it_from_plans(app_with_swings) -> None:  # type: ignore[no-untyped-def]
    http, store, ids = app_with_swings
    plan_id = http.post("/api/plans", json={"focus": "tempo_quick"}).get_json()["plan_id"]
    store.delete(ids[0])
    plan = store.plan(plan_id)
    assert plan is not None and ids[0] not in plan["baseline"]
