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
