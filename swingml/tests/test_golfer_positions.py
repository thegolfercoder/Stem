"""Positions the golfer sets by hand: re-measured, stored, reversible, and labels.

Phone swings with their positions marked are the one input that can move the
model on phone footage, and the golfer is the person looking at the frames. So
a moved position has to re-measure the swing from the golfer's frames, never
quote the model's error bands against them, be undoable, and become a training
label only when the golfer says all eight are right.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import SwingAnalysis, analyse_with_positions
from swingml.events import EventSequence, SwingEvent
from swingml.labels import (
    GolferPositions,
    load_pose,
    read_positions,
    save_pose,
    training_labels,
    write_positions,
)
from swingml.metrics.swing import compute_metrics
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.web.app import create_app
from swingml.web.service import frames_dir
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
def truth() -> tuple[int, ...]:
    return tuple(int(f) for f in generate_swing(frame_rate_hz=60.0).truth.event_frames)


@pytest.fixture
def model_answer(sequence: PoseSequence, truth: tuple[int, ...]) -> SwingAnalysis:
    """What the model said: the truth with address three frames late."""
    frames = (truth[0] + 3, *truth[1:])
    events = EventSequence(frames=frames, confidence=(0.9,) * 8)  # type: ignore[arg-type]
    return SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=sequence.n_frames,
        events=events,
        event_times_s=tuple(float(sequence.timestamps_s[f]) for f in frames),
        event_source_frames=frames,
        metrics=compute_metrics(sequence, events, Handedness.RIGHT),
        handedness=Handedness.RIGHT,
    )


# -- the measurement ---------------------------------------------------------


def test_positions_are_measured_from_the_golfers_frames(
    sequence: PoseSequence, truth: tuple[int, ...]
) -> None:
    moved = analyse_with_positions(sequence, truth, Handedness.RIGHT)
    assert moved.positions_set_by == "golfer"
    assert moved.event_source_frames == truth
    assert not isinstance(moved.metrics, NoReading)
    expected = (truth[3] - truth[0]) / (truth[5] - truth[3])
    assert moved.metrics.tempo_ratio.value == pytest.approx(expected, rel=0.02)  # type: ignore[union-attr]


def test_the_models_error_bands_are_not_quoted_against_the_golfers_frames(
    sequence: PoseSequence, truth: tuple[int, ...]
) -> None:
    moved = analyse_with_positions(sequence, truth, Handedness.RIGHT)
    assert moved.event_uncertainty == ()
    assert moved.tempo_uncertainty is None


@pytest.mark.parametrize(
    "change",
    [
        lambda f: (f[1], f[0], *f[2:]),  # two swapped
        lambda f: (f[0], f[0], *f[2:]),  # two on one frame
        lambda f: f[:7],  # seven
        lambda f: (*f[:7], 10_000),  # past the end
    ],
)
def test_positions_out_of_swing_order_are_refused(
    sequence: PoseSequence, truth: tuple[int, ...], change: object
) -> None:
    with pytest.raises(ValueError):
        analyse_with_positions(sequence, change(truth), Handedness.RIGHT)  # type: ignore[operator]


# -- storage -----------------------------------------------------------------


def test_landmarks_survive_a_round_trip(sequence: PoseSequence, tmp_path: Path) -> None:
    save_pose(sequence, tmp_path)
    loaded = load_pose(tmp_path)
    assert loaded is not None
    np.testing.assert_allclose(loaded.xy, sequence.xy, atol=1e-6)
    np.testing.assert_allclose(loaded.timestamps_s, sequence.timestamps_s)
    assert loaded.frame_width == sequence.frame_width


def test_only_confirmed_swings_are_training_labels(sequence: PoseSequence, tmp_path: Path) -> None:
    """Moving one position is a correction, not a claim about the other seven."""
    frames = tuple(range(10, 18))
    for swing_id, confirmed in ((1, False), (2, True)):
        directory = tmp_path / str(swing_id)
        save_pose(sequence, directory)
        write_positions(
            directory,
            GolferPositions(
                frames=frames,
                model_frames=frames,
                handedness=Handedness.RIGHT,
                training_label=confirmed,
            ),
        )
    assert [swing_id for swing_id, _, _ in training_labels(tmp_path)] == [2]


# -- the app -----------------------------------------------------------------


@pytest.fixture
def client(  # type: ignore[no-untyped-def]
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    sequence: PoseSequence,
    model_answer: SwingAnalysis,
):
    monkeypatch.setenv("SWINGML_HOME", str(tmp_path / "home"))
    store = SwingStore(tmp_path / "s.db")
    swing_id = store.add(model_answer, source_name="clip.mov")
    save_pose(sequence, frames_dir() / str(swing_id))
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client(), store, swing_id


def test_setting_positions_re_measures_and_stores_the_swing(  # type: ignore[no-untyped-def]
    client, truth: tuple[int, ...], model_answer: SwingAnalysis
) -> None:
    http, store, swing_id = client
    response = http.post(
        f"/api/swings/{swing_id}/positions", json={"frames": list(truth), "training_label": True}
    )
    assert response.status_code == 200, response.get_json()

    stored = SwingAnalysis.model_validate(store.get(swing_id).analysis)
    assert stored.positions_set_by == "golfer"
    assert stored.event_source_frames == truth

    positions = read_positions(frames_dir() / str(swing_id))
    assert positions is not None
    assert positions.training_label
    assert positions.model_frames == model_answer.event_source_frames
    assert positions.moved[int(SwingEvent.ADDRESS)]
    assert sum(positions.moved) == 1

    page = http.get(f"/swing/{swing_id}").get_data(as_text=True)
    assert "Positions set by you" in page


def test_a_second_correction_keeps_the_models_original_answer(  # type: ignore[no-untyped-def]
    client, truth: tuple[int, ...], model_answer: SwingAnalysis
) -> None:
    http, _, swing_id = client
    http.post(f"/api/swings/{swing_id}/positions", json={"frames": list(truth)})
    later = (truth[0] - 1, *truth[1:])
    http.post(f"/api/swings/{swing_id}/positions", json={"frames": list(later)})
    positions = read_positions(frames_dir() / str(swing_id))
    assert positions is not None
    assert positions.model_frames == model_answer.event_source_frames


def test_reset_puts_the_models_answer_back(  # type: ignore[no-untyped-def]
    client, truth: tuple[int, ...], model_answer: SwingAnalysis
) -> None:
    http, store, swing_id = client
    http.post(f"/api/swings/{swing_id}/positions", json={"frames": list(truth)})
    assert http.delete(f"/api/swings/{swing_id}/positions").status_code == 200

    stored = SwingAnalysis.model_validate(store.get(swing_id).analysis)
    assert stored.positions_set_by == "model"
    assert stored.event_source_frames == model_answer.event_source_frames
    assert read_positions(frames_dir() / str(swing_id)) is None


def test_positions_out_of_order_are_refused_by_the_server(  # type: ignore[no-untyped-def]
    client, truth: tuple[int, ...]
) -> None:
    http, store, swing_id = client
    swapped = [truth[1], truth[0], *truth[2:]]
    response = http.post(f"/api/swings/{swing_id}/positions", json={"frames": swapped})
    assert response.status_code == 400
    assert "order" in response.get_json()["error"]
    stored = SwingAnalysis.model_validate(store.get(swing_id).analysis)
    assert stored.positions_set_by == "model"


def test_a_swing_without_kept_landmarks_says_so(  # type: ignore[no-untyped-def]
    client, truth: tuple[int, ...]
) -> None:
    http, _, swing_id = client
    (frames_dir() / str(swing_id) / "pose.npz").unlink()
    response = http.post(f"/api/swings/{swing_id}/positions", json={"frames": list(truth)})
    assert response.status_code == 409
    assert "analyse the clip again" in response.get_json()["error"]


# -- the training archive ----------------------------------------------------


def test_labelled_swings_become_an_archive_the_trainer_reads(
    sequence: PoseSequence, truth: tuple[int, ...], tmp_path: Path
) -> None:
    import subprocess
    import sys

    from swingml.model.benchmark import load_samples

    frames_root = tmp_path / "frames"
    for swing_id in (1, 2):
        directory = frames_root / str(swing_id)
        save_pose(sequence, directory)
        write_positions(
            directory,
            GolferPositions(
                frames=truth,
                model_frames=(truth[0] + 3, *truth[1:]),
                handedness=Handedness.RIGHT,
                training_label=swing_id == 2,
            ),
        )
    out = tmp_path / "labelled.npz"
    script = Path(__file__).resolve().parent.parent / "scripts" / "make_labelled_dataset.py"
    done = subprocess.run(
        [sys.executable, str(script), "--frames", str(frames_root), "--out", str(out)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "1 labelled swings" in done.stdout
    assert "Address" in done.stdout and "moved by the golfer in 1 of 1" in done.stdout

    samples = load_samples([out])
    assert len(samples) == 1
    # The synthetic sequence is already on the 60 Hz grid, so the labels are the frames.
    assert tuple(int(f) for f in samples[0].event_frames) == truth
