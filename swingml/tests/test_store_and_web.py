"""The application layer: persistence, the HTTP surface, and the frame strip.

These matter as much as the model does. A swing that is analysed correctly and
then lost, or reachable only by somebody who knows the right path, is not a
usable piece of software.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import SwingAnalysis
from swingml.events import EventSequence
from swingml.metrics.swing import compute_metrics
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.web.app import create_app
from swingml.web.frames import body_crop, draw_pose
from swingml.web.inputs import whole_number
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import generate_swing

QUIET = NoiseConfig(
    jitter_px=0.0,
    speed_jitter_px_per_body_length=0.0,
    fast_landmark_multiplier=1.0,
    dropout_probability=0.0,
    frame_loss_probability=0.0,
    timestamp_jitter_s=0.0,
)


@pytest.fixture
def sequence() -> PoseSequence:
    swing = generate_swing(frame_rate_hz=60.0)
    camera = CameraConfig(
        azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
    )
    return render_pose_sequence(swing, camera, QUIET, seed=0)


@pytest.fixture
def analysis(sequence: PoseSequence) -> SwingAnalysis:
    swing = generate_swing(frame_rate_hz=60.0)
    frames = tuple(int(f) for f in swing.truth.event_frames)
    events = EventSequence(frames=frames, confidence=(0.9,) * 8)
    metrics = compute_metrics(sequence, events, Handedness.RIGHT)
    return SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=sequence.n_frames,
        events=events,
        event_times_s=tuple(float(sequence.timestamps_s[f]) for f in frames),
        event_source_frames=frames,
        metrics=metrics,
        handedness=Handedness.RIGHT,
    )


# -- store -----------------------------------------------------------------


def test_store_round_trips_an_analysis(tmp_path: Path, analysis: SwingAnalysis) -> None:
    store = SwingStore(tmp_path / "s.db")
    swing_id = store.add(analysis, source_name="clip.mov", club="7 iron", label="range")

    stored = store.get(swing_id)
    assert stored is not None
    assert stored.club == "7 iron"
    assert stored.ok
    assert SwingAnalysis.model_validate(stored.analysis).handedness is Handedness.RIGHT


def test_store_keeps_refusals_so_the_failure_rate_is_knowable(
    tmp_path: Path, analysis: SwingAnalysis
) -> None:
    """A table of only the successes makes any tool look perfect."""
    store = SwingStore(tmp_path / "s.db")
    refusal = NoReading(reason="no swing in this clip", source="events")
    refused = analysis.model_copy(update={"events": refusal, "metrics": refusal})

    store.add(analysis, source_name="good.mov")
    store.add(refused, source_name="bad.mov")

    total, ok = store.counts()
    assert (total, ok) == (2, 1)
    assert any(not s.ok and s.refusal for s in store.recent())


def test_store_updates_and_deletes(tmp_path: Path, analysis: SwingAnalysis) -> None:
    store = SwingStore(tmp_path / "s.db")
    swing_id = store.add(analysis, source_name="clip.mov")

    assert store.update(swing_id, club="driver")
    assert store.get(swing_id).club == "driver"  # type: ignore[union-attr]
    assert store.clubs() == ["driver"]
    assert store.delete(swing_id)
    assert store.get(swing_id) is None


def test_store_filters_by_club(tmp_path: Path, analysis: SwingAnalysis) -> None:
    store = SwingStore(tmp_path / "s.db")
    store.add(analysis, source_name="a.mov", club="driver")
    store.add(analysis, source_name="b.mov", club="7 iron")
    assert [s.club for s in store.recent(club="driver")] == ["driver"]


# -- frame drawing ---------------------------------------------------------


def test_pose_is_drawn_onto_a_copy_not_the_original(sequence: PoseSequence) -> None:
    image = np.zeros((256, 144, 3), dtype=np.uint8)
    drawn = draw_pose(image, sequence, 10)
    assert np.array_equal(image, np.zeros_like(image))
    assert drawn.any(), "nothing was drawn"


def test_crop_box_covers_the_body_and_stays_inside_the_frame(sequence: PoseSequence) -> None:
    left, top, width, height = body_crop(sequence, [5, 30, 60], 720, 1280)
    assert left >= 0 and top >= 0
    assert left + width <= 720
    assert top + height <= 1280
    assert width > 32 and height > 32


def test_crop_box_falls_back_to_the_whole_frame_when_nothing_is_visible(
    sequence: PoseSequence,
) -> None:
    blind = sequence.model_copy(update={"visibility": np.zeros_like(sequence.visibility)})
    assert body_crop(blind, [0, 1], 720, 1280) == (0, 0, 720, 1280)


# -- web -------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path, analysis: SwingAnalysis):  # type: ignore[no-untyped-def]
    store = SwingStore(tmp_path / "s.db")
    store.add(analysis, source_name="clip.mov", club="7 iron", label="range session")
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client()


def test_pages_render(client) -> None:  # type: ignore[no-untyped-def]
    for route in ("/", "/session", "/swing/1"):
        response = client.get(route)
        assert response.status_code == 200, route


def test_health_reports_what_is_installed(client) -> None:  # type: ignore[no-untyped-def]
    payload = client.get("/health").get_json()
    assert set(payload) >= {"ready", "detail", "home", "swings"}


def test_missing_swing_is_a_404(client) -> None:  # type: ignore[no-untyped-def]
    assert client.get("/swing/999").status_code == 404


def test_upload_rejects_a_file_that_is_not_a_video(client) -> None:  # type: ignore[no-untyped-def]
    response = client.post(
        "/api/analyse",
        data={"video": (io.BytesIO(b"not a video"), "notes.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert "not a video" in response.get_json()["error"]


def test_upload_with_no_file_is_refused(client) -> None:  # type: ignore[no-untyped-def]
    response = client.post("/api/analyse", data={}, content_type="multipart/form-data")
    assert response.status_code == 400


def test_analysis_json_is_served_whole(client) -> None:  # type: ignore[no-untyped-def]
    payload = json.loads(client.get("/api/swings/1/analysis").get_data(as_text=True))
    assert payload["handedness"] == "right"


def test_media_route_refuses_to_escape_its_directory(client) -> None:  # type: ignore[no-untyped-def]
    """A path from the URL must not be able to reach outside the frame store."""
    response = client.get("/media/1/../../../etc/passwd")
    assert response.status_code in (404, 308, 400)


def test_swing_can_be_relabelled_then_removed(client) -> None:  # type: ignore[no-untyped-def]
    assert client.post("/api/swings/1", json={"club": "driver"}).status_code == 200
    assert client.get("/api/swings").get_json()[0]["club"] == "driver"
    assert client.delete("/api/swings/1").status_code == 200
    assert client.get("/api/swings").get_json() == []


def test_unknown_job_is_a_404(client) -> None:  # type: ignore[no-untyped-def]
    assert client.get("/api/jobs/nonexistent").status_code == 404


# -- only this machine -------------------------------------------------------------


def test_requests_for_another_host_name_are_refused(client) -> None:  # type: ignore[no-untyped-def]
    """DNS rebinding: a site pointed at 127.0.0.1 arrives with its own name."""
    response = client.get("/api/swings", headers={"Host": "evil.example:5000"})
    assert response.status_code == 403
    assert client.get("/api/swings", headers={"Host": "127.0.0.1:5000"}).status_code == 200


def test_state_changes_from_another_site_are_refused(client) -> None:  # type: ignore[no-untyped-def]
    refused = client.delete("/api/swings/1", headers={"Origin": "https://evil.example"})
    assert refused.status_code == 403
    assert client.get("/swing/1").status_code == 200


def test_deleting_a_swing_removes_its_files(tmp_path: Path, monkeypatch, analysis) -> None:  # type: ignore[no-untyped-def]
    from swingml.web.service import frames_dir, videos_dir

    monkeypatch.setenv("SWINGML_HOME", str(tmp_path / "home"))
    video = videos_dir() / "clip.mov"
    video.write_bytes(b"x")
    store = SwingStore(tmp_path / "s.db")
    swing_id = store.add(analysis, source_name="clip.mov", video_path=video)
    (frames_dir() / str(swing_id)).mkdir(parents=True)
    (frames_dir() / str(swing_id) / "0_address.jpg").write_bytes(b"x")
    app = create_app(store=store)
    app.config.update(TESTING=True)
    assert app.test_client().delete(f"/api/swings/{swing_id}").status_code == 200
    assert not video.exists()
    assert not (frames_dir() / str(swing_id)).exists()


def test_serving_on_the_network_is_an_explicit_choice(tmp_path: Path, analysis) -> None:  # type: ignore[no-untyped-def]
    store = SwingStore(tmp_path / "s.db")
    app = create_app(store=store, allow_any_host=True)
    app.config.update(TESTING=True)
    http = app.test_client()
    assert http.get("/api/swings", headers={"Host": "192.168.1.20:8000"}).status_code == 200
    refused = http.post(
        "/api/plans", json={"focus": "capture"},
        headers={"Host": "192.168.1.20:8000", "Origin": "https://evil.example"},
    )  # fmt: skip
    assert refused.status_code == 403


def test_a_store_from_before_clip_fingerprints_opens_and_keeps_its_swings(
    tmp_path: Path, analysis: SwingAnalysis
) -> None:
    """Version 3 adds two columns in place; a version 2 file loses nothing."""
    import sqlite3

    from swingml.store import SCHEMA

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as connection:
        connection.executescript(SCHEMA)  # the tables as version 2 created them
        connection.execute(
            "INSERT INTO swings (created_at, source_name, handedness, ok, analysis_json) "
            "VALUES ('2026-09-01T10:00:00+00:00', 'old.mov', 'right', 1, ?)",
            (json.dumps(analysis.model_dump(mode="json")),),
        )
    store = SwingStore(path)
    old = store.get(1)
    assert old is not None and old.source_name == "old.mov" and old.clip_sha256 is None
    swing_id, outcome = store.record(analysis, "new.mov", clip_sha256="abc")
    assert (swing_id, outcome) == (2, "new") and store.by_clip("abc") is not None


# -- the API's own input checks (#68) --------------------------------------------


@pytest.mark.parametrize("limit", ["abc", "-1", "0", "1.5", "", "%C2%B2", "%E2%91%A0", "%D9%A3"])
def test_a_malformed_limit_is_refused_never_a_500_or_uncapped(client, limit: str) -> None:  # type: ignore[no-untyped-def]
    response = client.get(f"/api/swings?limit={limit}")
    assert response.status_code == 400, response.get_data(as_text=True)
    assert "limit" in response.get_json()["error"]


def test_a_limit_is_capped_at_five_hundred(client) -> None:  # type: ignore[no-untyped-def]
    assert client.get("/api/swings?limit=100000").status_code == 200
    assert len(client.get("/api/swings?limit=1").get_json()) == 1


@pytest.mark.parametrize("field", ["label", "club"])
@pytest.mark.parametrize("value", [{"a": 1}, ["x"], 3, True])
def test_a_label_or_club_that_is_not_text_is_refused(client, field: str, value: object) -> None:  # type: ignore[no-untyped-def]
    response = client.post("/api/swings/1", json={field: value})
    assert response.status_code == 400, response.get_data(as_text=True)
    assert client.get("/api/swings").get_json()[0]["club"] == "7 iron"


def test_updating_a_swing_that_does_not_exist_is_a_404(client) -> None:  # type: ignore[no-untyped-def]
    response = client.post("/api/swings/999", json={"club": "driver"})
    assert response.status_code == 404 and response.get_json()["error"] == "no such swing"


def test_feedback_for_a_plan_that_does_not_exist_is_a_404_and_stores_nothing(client) -> None:  # type: ignore[no-untyped-def]
    response = client.post("/api/plans/999/feedback", json={"useful": 1})
    assert response.status_code == 404
    exported = client.get("/api/export").get_json()
    assert exported.get("feedback", []) == []


def test_feedback_is_kept_for_a_real_plan_and_refused_for_a_missing_swing(
    tmp_path: Path, analysis: SwingAnalysis
) -> None:
    store = SwingStore(tmp_path / "s.db")
    swing = store.add(analysis, source_name="clip.mov", club="7 iron")
    plan = store.create_plan("tempo_quick", "tempo-count-three", "tempo_ratio", "increase",
                             "7 iron", [swing])  # fmt: skip
    app = create_app(store=store)
    app.config.update(TESTING=True)
    http = app.test_client()
    missing = http.post(f"/api/plans/{plan}/feedback", json={"useful": 3, "swing_id": 999})
    assert missing.status_code == 404 and missing.get_json()["error"] == "no such swing"
    assert store.feedback(plan) == []
    kept = http.post(f"/api/plans/{plan}/feedback", json={"useful": 3, "swing_id": swing})
    assert kept.status_code == 201 and len(store.feedback(plan)) == 1


@pytest.mark.parametrize(
    ("text", "number"),
    [("12", 12), ("0", 0), (7, 7), ("²", None), ("①", None), ("٣", None), ("-1", None),
     (-1, None), ("1.5", None), ("", None), (True, None), (None, None)],
)  # fmt: skip
def test_only_ascii_digits_are_read_as_a_number(text: object, number: int | None) -> None:
    """#68, QA: str.isdigit() is true of "²", which int() then refuses."""
    assert whole_number(text) == number


def test_feedback_with_a_unicode_digit_rating_is_not_a_crash(
    tmp_path: Path, analysis: SwingAnalysis
) -> None:
    store = SwingStore(tmp_path / "s.db")
    swing = store.add(analysis, source_name="clip.mov", club="7 iron")
    plan = store.create_plan("tempo_quick", "tempo-count-three", "tempo_ratio", "increase",
                             "7 iron", [swing])  # fmt: skip
    app = create_app(store=store)
    app.config.update(TESTING=True)
    response = app.test_client().post(f"/api/plans/{plan}/feedback", json={"useful": "²"})
    assert response.status_code == 201
    assert [row["useful"] for row in store.feedback(plan)] == [None]
