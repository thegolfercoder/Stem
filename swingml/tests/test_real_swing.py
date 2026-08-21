"""The only real golf swing in this repository, and what it is allowed to do.

Everything else here is synthetic: a generated golfer, rendered, put through the
pose estimator. That is enough to develop against and it is not enough to trust,
because the thing it cannot contain is whatever nobody thought to model.

This fixture is one clip of one person hitting one ball on a driving range at
night, on a phone, at thirty frames a second, in the dark, at 360 by 640. It is
not a benchmark and it proves nothing about the general case. What it does is
stop a change that looks fine on generated data from quietly breaking the real
thing, which is a failure mode no amount of synthetic testing catches.

The ground truth is not a label somebody guessed at. Impact is the frame the ball
leaves the tee - visible, unarguable, and needing no interpretation. Address comes
from the golfer's own stillness. Both, and how they were established, are recorded
alongside the fixture.

Tolerances are set a little wider than what the model currently achieves, so that
ordinary drift does not fail the build and a real regression does.
"""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from pydantic import BaseModel, ConfigDict

from swingml.analysis import (
    AnalysisConfig,
    SwingAnalysis,
    analyse_pose_sequence,
    load_model,
)
from swingml.assets import find_event_calibration, find_event_model
from swingml.events import SwingEvent
from swingml.model.calibration import ErrorBand, load_calibration
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

FIXTURES = Path(__file__).parent / "fixtures"
LANDMARKS = FIXTURES / "real_swing_01.npz"
TRUTH = FIXTURES / "real_swing_01.json"


class Truth(BaseModel):
    """What the clip itself says, kept apart from what the model says about it.

    Parsing the file rather than indexing it means a typo in a key or a hand-edit
    that drops a field fails loudly here, instead of quietly turning an assertion
    into a KeyError halfway through a test run.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    source: str
    description: str
    handedness: str
    frame_rate_hz: float
    n_frames: int
    events: dict[str, int]
    how_the_truth_was_established: dict[str, str]
    notes: tuple[str, ...] = ()


pytestmark = pytest.mark.skipif(
    not LANDMARKS.is_file() or find_event_model() is None,
    reason="needs the real-swing fixture and a trained model",
)


@pytest.fixture(scope="module")
def truth() -> Truth:
    return Truth.model_validate_json(TRUTH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def sequence() -> PoseSequence:
    """The landmarks, cached rather than re-detected.

    Storing the estimator's output rather than running it here keeps the test
    quick and keeps it testing what it means to test. A MediaPipe upgrade that
    moved the landmarks would otherwise fail this and look like a regression in
    code that had not changed.
    """
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


@pytest.fixture(scope="module")
def analysis(sequence: PoseSequence) -> SwingAnalysis:
    path = find_event_model()
    assert path is not None
    calibration_path = find_event_calibration()
    return analyse_pose_sequence(
        sequence,
        load_model(path),
        AnalysisConfig(
            handedness=Handedness.RIGHT,
            calibration=(
                load_calibration(calibration_path) if calibration_path is not None else None
            ),
        ),
    )


def test_a_real_swing_is_not_refused(analysis: SwingAnalysis) -> None:
    assert not isinstance(analysis.events, NoReading), analysis.events
    assert analysis.detection_rate > 0.9


@pytest.mark.parametrize(
    ("event", "key", "tolerance"),
    [
        # Impact is the ball leaving the tee, so it is held tightest.
        (SwingEvent.IMPACT, "impact", 2),
        (SwingEvent.ADDRESS, "address", 3),
        (SwingEvent.TOP, "top", 3),
        # The finish is the vaguest of the four - a golfer holds a pose rather than
        # arriving at an instant - so it gets the loosest bound.
        (SwingEvent.FINISH, "finish", 6),
    ],
)
def test_events_land_where_the_clip_says_they_do(
    analysis: SwingAnalysis, truth: Truth, event: SwingEvent, key: str, tolerance: int
) -> None:
    predicted = analysis.event_source_frames[int(event)]
    actual = truth.events[key]
    assert abs(predicted - actual) <= tolerance, (
        f"{event.label}: model says frame {predicted}, the clip says {actual}. "
        f"{truth.how_the_truth_was_established[key]}"
    )


def test_the_events_come_out_in_order(analysis: SwingAnalysis) -> None:
    frames = analysis.event_source_frames
    assert all(b > a for a, b in pairwise(frames))


def test_tempo_is_in_the_range_a_golf_swing_produces(analysis: SwingAnalysis) -> None:
    metrics = analysis.metrics
    assert not isinstance(metrics, NoReading)
    assert not isinstance(metrics.tempo_ratio, NoReading)
    assert 1.5 <= metrics.tempo_ratio.value <= 4.0


def test_the_model_is_confident_about_a_real_swing(analysis: SwingAnalysis) -> None:
    """Well clear of the threshold that refuses clips containing no swing.

    A real swing scoring near that line would mean the threshold is in the wrong
    place, whatever it does on generated clips.
    """
    events = analysis.events
    assert not isinstance(events, NoReading)
    mean = sum(events.confidence) / len(events.confidence)
    assert mean > 0.45


def test_the_depth_output_is_refused_on_this_clip(analysis: SwingAnalysis) -> None:
    """On this footage the estimator's own 3D output is not usable, and says so.

    Its shoulder line changes length by about seventy percent across the swing,
    which a bone does not do. This pins that the check fires on the real case it
    was written for, not only on the synthetic one it was found on.
    """
    metrics = analysis.metrics
    assert not isinstance(metrics, NoReading)
    assert isinstance(metrics.shoulder_turn_3d, NoReading)
    assert "length" in metrics.shoulder_turn_3d.reason


def test_foreshortening_still_gives_a_turn(analysis: SwingAnalysis) -> None:
    """The measurement that survives an uncalibrated camera should survive this one."""
    metrics = analysis.metrics
    assert not isinstance(metrics, NoReading)
    turn = metrics.shoulder_turn_foreshortened
    assert not isinstance(turn, NoReading)
    assert 15.0 <= turn.value <= 90.0


@pytest.mark.skipif(find_event_calibration() is None, reason="needs a measured calibration")
def test_the_error_bands_contain_the_truth_on_this_clip(
    analysis: SwingAnalysis, truth: Truth
) -> None:
    """The bands are a claim about held-out clips, and this is a held-out clip.

    Not proof they are correct - four events on one clip could fall inside four
    wrong bands by luck - but a band that misses the ball leaving the tee is
    wrong for certain, and this is where that would show.
    """
    for event, key in (
        (SwingEvent.ADDRESS, "address"),
        (SwingEvent.TOP, "top"),
        (SwingEvent.IMPACT, "impact"),
        (SwingEvent.FINISH, "finish"),
    ):
        index = int(event)
        band = analysis.event_uncertainty[index]
        assert isinstance(band, ErrorBand), f"{event.label}: {band}"
        error = abs(analysis.event_source_frames[index] - truth.events[key])
        # The clip is 30 fps and the bands are in canonical 60 Hz frames, so the
        # source-frame error is compared against half the band.
        assert error <= band.half_width_frames / 2.0 + 0.5, (
            f"{event.label}: off by {error} source frames, "
            f"outside a band of {band.half_width_frames:.0f} canonical frames"
        )


@pytest.mark.skipif(find_event_calibration() is None, reason="needs a measured calibration")
def test_the_vaguest_event_gets_the_widest_band(analysis: SwingAnalysis) -> None:
    """The finish is the event whose truth was hardest to pin down on this clip.

    The ground-truth notes say so in as many words - motion falls back toward the
    noise floor rather than arriving at an instant - and the model, which never
    saw those notes, is least confident there too. An uncertainty estimate that
    did not reproduce that ordering would not be measuring anything.
    """
    bands = [b for b in analysis.event_uncertainty if isinstance(b, ErrorBand)]
    assert len(bands) == len(analysis.event_uncertainty)
    widest = max(range(len(bands)), key=lambda i: bands[i].half_width_frames)
    assert widest == int(SwingEvent.FINISH)
