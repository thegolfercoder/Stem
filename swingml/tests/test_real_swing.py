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
    model_fingerprint,
    resolve_model,
)
from swingml.assets import find_event_calibration, find_event_model
from swingml.events import SwingEvent
from swingml.features import feature_dimension
from swingml.model.calibration import ErrorBand, load_calibration
from swingml.model.tcn import SwingEventNet
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
    """Analysed through whatever this installation would actually run.

    Deliberately not a checkpoint picked out here. The point of the fixture is to
    catch a regression in the thing a user gets, and a test that loads a different
    model from the application is testing something nobody runs. It also means the
    error bands are attached only when they were measured through these weights,
    which is the behaviour worth exercising rather than working around.
    """
    resolved = resolve_model()
    assert resolved is not None
    return analyse_pose_sequence(
        sequence,
        resolved.model,
        AnalysisConfig(handedness=Handedness.RIGHT)
        if resolved.calibration is None
        else AnalysisConfig(handedness=Handedness.RIGHT, calibration=resolved.calibration),
    )


def has_bands(analysis: SwingAnalysis) -> bool:
    return any(isinstance(b, ErrorBand) for b in analysis.event_uncertainty)


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


def test_the_error_bands_mostly_contain_the_truth_on_this_clip(
    analysis: SwingAnalysis, truth: Truth
) -> None:
    """Most of the four independently established events land inside their bands.

    Where "most" is set by arithmetic rather than by taste. The bands claim to
    hold four times in five. On four events that makes three-or-more an 82 percent
    outcome and two-or-more a 97 percent one - so a threshold of three fails
    roughly one run in six for a model whose bands are telling the exact truth,
    and this test was written with that threshold and duly failed on a model that
    turned out to be better than the one before it. Errors within a clip are
    correlated too, which makes the real false-failure rate worse than the
    binomial says.

    Two of four it is. What that still catches is the failure that matters: bands
    so tight that a real clip falls outside them repeatedly, which would mean they
    were measured on something easier than the footage people actually shoot.
    """
    if not has_bands(analysis):
        pytest.skip("no error bands were measured for the model this installation runs")

    inside = []
    outside = []
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
        # band is halved to compare against an error counted in source frames.
        report = f"{event.label} off by {error}, band {band.half_width_frames / 2:.1f}"
        (inside if error <= band.half_width_frames / 2.0 + 0.5 else outside).append(report)

    assert len(inside) >= 2, f"only {len(inside)} of 4 inside; outside: {outside}"


def test_impact_lands_inside_its_band(analysis: SwingAnalysis, truth: Truth) -> None:
    """Held on its own because impact's truth is not a judgement call.

    The ball is on the tee in one frame and gone in the next. Every other event
    on this clip rests on an inference about when motion started or settled;
    this one rests on the ball. A band that misses it is wrong, and no argument
    about the vagueness of the event can rescue it.
    """
    if not has_bands(analysis):
        pytest.skip("no error bands were measured for the model this installation runs")

    index = int(SwingEvent.IMPACT)
    band = analysis.event_uncertainty[index]
    assert isinstance(band, ErrorBand)
    error = abs(analysis.event_source_frames[index] - truth.events["impact"])
    assert error <= band.half_width_frames / 2.0 + 0.5


def test_the_vague_events_get_the_wider_bands(analysis: SwingAnalysis) -> None:
    """Address and the finish are the two events whose truth is a judgement call.

    Every other event is a shape the body passes through. These two are the
    boundaries of the swing, and the ground-truth notes for this clip say as much
    about both: address had to be found from where stillness ended, and the finish
    from where motion settled, neither of which happens on a particular frame.

    The model never saw those notes and is least sure at exactly those two points.
    That the bands come out wider there is the whole claim that they measure
    something, so it is asserted as a property rather than as two numbers - which
    of the pair is widest is a detail of one model on one clip, and changed when
    the ensemble replaced a single network.
    """
    if not has_bands(analysis):
        pytest.skip("no error bands were measured for the model this installation runs")

    widths = [b.half_width_frames for b in analysis.event_uncertainty if isinstance(b, ErrorBand)]
    assert len(widths) == len(analysis.event_uncertainty)
    boundary = {int(SwingEvent.ADDRESS), int(SwingEvent.FINISH)}
    interior = max(w for i, w in enumerate(widths) if i not in boundary)
    for index in boundary:
        assert widths[index] > interior, (
            f"{SwingEvent.ordered()[index].label} band is {widths[index]}, no wider than "
            f"the widest interior event at {interior}"
        )


def test_a_calibration_measured_for_another_model_is_not_quoted(
    sequence: PoseSequence,
) -> None:
    """The check that stops one model's error bars appearing beside another's.

    The table is found by searching a path, so nothing about finding it says it
    belongs to the model that got loaded - and during development that mismatch
    happened by accident, with the bundled single model picking up bands measured
    through the ensemble. A wrong error bar is worse than none, so a mismatch has
    to produce a refusal rather than a number.
    """
    calibration_path = find_event_calibration()
    if calibration_path is None:
        pytest.skip("needs a measured calibration to mismatch against")

    calibration = load_calibration(calibration_path)
    untrained = SwingEventNet(feature_dimension())
    assert not calibration.matches(model_fingerprint(untrained))

    analysis = analyse_pose_sequence(
        sequence,
        untrained,
        AnalysisConfig(handedness=Handedness.RIGHT, calibration=calibration),
    )
    if isinstance(analysis.events, NoReading):
        # An untrained model may well refuse the clip, which is its own correct
        # answer; the mismatch is then moot and there is nothing left to check.
        return
    assert all(isinstance(b, NoReading) for b in analysis.event_uncertainty)
    assert "different weights" in analysis.event_uncertainty[0].reason
    assert analysis.tempo_uncertainty is None
