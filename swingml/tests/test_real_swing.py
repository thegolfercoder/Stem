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
    model_fingerprint,
    resolve_model,
)
from swingml.assets import find_event_calibration, find_event_calibrations, find_event_model
from swingml.events import SwingEvent
from swingml.features import feature_dimension
from swingml.model.calibration import ErrorBand, ModelCalibration, load_calibration
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
    tolerance_frames: dict[str, int]
    why_those_tolerances: str
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


def analysed(sequence: PoseSequence, model: object, calibration: object) -> SwingAnalysis:
    config = (
        AnalysisConfig(handedness=Handedness.RIGHT)
        if calibration is None
        else AnalysisConfig(handedness=Handedness.RIGHT, calibration=calibration)  # type: ignore[arg-type]
    )
    return analyse_pose_sequence(sequence, model, config)  # type: ignore[arg-type]


@pytest.fixture(scope="module", params=["bundled", "installed"])
def analysis(request: pytest.FixtureRequest, sequence: PoseSequence) -> SwingAnalysis:
    """Run twice: against the artefact in the package, and against what resolves.

    It used to be only the second, on the argument that a test loading a different
    model from the application is testing something nobody runs. That argument is
    right and it left a hole, because the two are not the same model on a machine
    where anything has been trained. `resolve_model` prefers an ensemble under
    `out/` when one exists, so every developer here was exercising the ensemble
    while the thing that actually ships - the single checkpoint inside the package
    - was exercised only by a fresh checkout, which is to say only by CI.

    It went wrong exactly there. The bundled model put the finish thirty-eight
    frames late on this clip, CI said so on four consecutive pushes, and every
    local run was green because a better model was sitting in `out/`.
    """
    if request.param == "bundled":
        path = find_event_model()
        if path is None:
            pytest.skip("no model is bundled with the package")
        model: object = load_model(path)
        calibration = _matching_calibration(model)
    else:
        resolved = resolve_model()
        assert resolved is not None
        model, calibration = resolved.model, resolved.calibration
    return analysed(sequence, model, calibration)


def _matching_calibration(model: object) -> ModelCalibration | None:
    """The table measured through these weights, or none. Never another model's."""
    digest = model_fingerprint(model)  # type: ignore[arg-type]
    for path in find_event_calibrations():
        table = load_calibration(path)
        if table.matches(digest):
            return table
    return None


def has_bands(analysis: SwingAnalysis) -> bool:
    return any(isinstance(b, ErrorBand) for b in analysis.event_uncertainty)


def test_a_real_swing_is_not_refused(analysis: SwingAnalysis) -> None:
    assert not isinstance(analysis.events, NoReading), analysis.events
    assert analysis.detection_rate > 0.9


@pytest.mark.parametrize(
    ("event", "key"),
    [
        (SwingEvent.IMPACT, "impact"),
        (SwingEvent.ADDRESS, "address"),
        (SwingEvent.TOP, "top"),
        (SwingEvent.FINISH, "finish"),
    ],
)
def test_events_land_where_the_clip_says_they_do(
    analysis: SwingAnalysis, truth: Truth, event: SwingEvent, key: str
) -> None:
    """The tolerances come from the fixture, because two things need them.

    This test is one. The other is the script that decides which trained model
    gets bundled into the package, which uses this clip as a gate rather than as
    a tiebreak: a model that fails here does not ship however well it scores on
    generated swings. Written out twice they would drift, and the drift would
    show up as a model passing selection and failing the build.
    """
    predicted = analysis.event_source_frames[int(event)]
    actual = truth.events[key]
    tolerance = truth.tolerance_frames[key]
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


def test_the_bands_are_not_one_number_wearing_eight_hats(analysis: SwingAnalysis) -> None:
    """The bands respond to what the model actually reported on this clip.

    This is the third version of this test and the first that asserts something
    true. It began by requiring address and the finish - the two events whose truth
    is a judgement call - to have *strictly* wider bands than every interior event.
    That failed on a tie, because the bands are conformal quantiles of an integer
    frame error and take one of three values at this corpus size, so a strict
    ordering over eight events was a claim about the arithmetic having no ties. It
    was weakened to "widest". That then failed outright on a model whose address
    band came out at one frame against an interior event at two.

    So the ordering is not a property of the system. It held for three models and
    not for a fourth, and a claim that survives only until the next retrain is not
    a claim. What is genuinely being asserted by the calibration is narrower: the
    bands are looked up by the confidence the model reported for each event, so
    they must differ across the eight. A table that returned one number everywhere
    would be reporting an average dressed as a measurement, and that is the failure
    worth catching.
    """
    if not has_bands(analysis):
        pytest.skip("no error bands were measured for the model this installation runs")

    widths = [b.half_width_frames for b in analysis.event_uncertainty if isinstance(b, ErrorBand)]
    assert len(widths) == len(analysis.event_uncertainty)
    assert min(widths) < max(widths), (
        f"every event got the same band ({widths[0]}), so the table is not reading "
        "confidence at all"
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


def test_a_model_still_in_training_mode_does_not_answer_at_random(
    sequence: PoseSequence,
) -> None:
    """Dropout left switched on is a wrong answer that looks like a right one.

    `load_model` puts a checkpoint into evaluation mode, so nothing a user runs
    was ever affected. A model handed straight over from a training script was:
    its dropout is still on, the analysis does not fail, it simply returns
    something different every time it is asked. Found by a parity test that
    disagreed with itself between two runs of the same clip.
    """
    untrained = SwingEventNet(feature_dimension())
    untrained.train()
    config = AnalysisConfig(handedness=Handedness.RIGHT)
    first = analyse_pose_sequence(sequence, untrained, config)
    second = analyse_pose_sequence(sequence, untrained, config)
    assert str(first.events) == str(second.events)
