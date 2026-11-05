"""A clip slowed two or three times is no longer reported as measured (#32).

Before, the slow-motion retry ran only on a clip refused at recorded speed. The
real phone swing slowed 2x or 3x passes every gate at recorded speed (a doubled
backswing still fits 0.30-2.50 s), so its durations were shown two or three
times too long as plain measurements. Now an answered clip with a long backswing
is also read at the slow-motion factors. The rule's values were chosen on
golfdb-validation-v2 (`scripts/slow_motion_rule.py`, `docs/ml/slow-motion-rule.md`).
Re-reading the clip at the slowed speed failed the release gate (#41); what ships
(#49) keeps the recorded-speed read and withholds only the durations, so no event
and no tempo moves. Both are tested here.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, SwingAnalysis, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.features import extract_features, resample_pose
from swingml.model import release_gate
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

LANDMARKS = Path(__file__).parent / "fixtures" / "real_swing_01.npz"

pytestmark = pytest.mark.skipif(
    find_event_model() is None or not LANDMARKS.is_file(),
    reason="needs the bundled model and the real-swing fixture",
)


def slowed(by: float) -> PoseSequence:
    data = np.load(LANDMARKS)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"] * by,
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


@pytest.fixture(scope="module")
def model():  # type: ignore[no-untyped-def]
    path = find_event_model()
    assert path is not None
    return load_model(path)


# The re-reading rule chosen on validation. It failed the release gate (#41); these
# tests keep it working. What ships is SHIPPED, the same check with re-reading off.
CHECK_ON = AnalysisConfig(
    handedness=Handedness.RIGHT, slow_motion_check_backswing_s=1.1, slow_motion_margin=0.01,
    slow_motion_check_rereads=True,
)  # fmt: skip
SHIPPED = AnalysisConfig(handedness=Handedness.RIGHT)
CHECK_OFF = AnalysisConfig(handedness=Handedness.RIGHT, slow_motion_check_backswing_s=None)


def read(model, by: float, config: AnalysisConfig | None = None) -> SwingAnalysis:  # type: ignore[no-untyped-def]
    return analyse_pose_sequence(slowed(by), model, config or CHECK_ON)


def test_what_ships_checks_but_does_not_re_read() -> None:
    assert AnalysisConfig().slow_motion_check_backswing_s == 1.1
    assert AnalysisConfig().slow_motion_check_rereads is False


@pytest.mark.parametrize("by", [2.0, 3.0])
def test_a_clip_slowed_two_or_three_times_is_read_as_slow_motion(model, by: float) -> None:  # type: ignore[no-untyped-def]
    analysis = read(model, by)
    assert analysis.playback_slowed_by is not None, "durations reported as measured"
    assert not isinstance(analysis.metrics, NoReading)
    assert isinstance(analysis.metrics.backswing_duration, NoReading)
    assert isinstance(analysis.metrics.downswing_duration, NoReading)


def test_without_the_check_the_two_times_clip_passes_as_real_time(model) -> None:  # type: ignore[no-untyped-def]
    """The failure #32 reported, kept reproducible: it is the check that catches it."""
    analysis = read(model, 2.0, CHECK_OFF)
    assert analysis.playback_slowed_by is None
    assert not isinstance(analysis.metrics, NoReading)
    assert not isinstance(analysis.metrics.backswing_duration, NoReading)


def test_the_real_time_clip_is_still_read_at_real_time(model) -> None:  # type: ignore[no-untyped-def]
    analysis = read(model, 1.0)
    assert analysis.playback_slowed_by is None
    assert not isinstance(analysis.metrics, NoReading)
    assert not isinstance(analysis.metrics.backswing_duration, NoReading)


@pytest.mark.parametrize("by", [1.0, 2.0])
def test_the_release_gate_applies_the_same_check(model, by: float) -> None:  # type: ignore[no-untyped-def]
    config = CHECK_ON
    resampled, _ = resample_pose(slowed(by), config.features.canonical_rate_hz)
    decision = release_gate.decide(model, extract_features(resampled, Handedness.RIGHT), config)
    assert decision.positions is not None
    assert (decision.slowed_by is not None) == (by > 1.0)


@pytest.mark.parametrize("by", [1.0, 2.0, 3.0])
def test_what_ships_moves_no_event_and_no_tempo(model, by: float) -> None:  # type: ignore[no-untyped-def]
    """#49: a fired check withholds durations and bands; everything else is the unchecked read."""
    shipped = read(model, by, SHIPPED)
    unchecked = read(model, by, CHECK_OFF)
    assert not isinstance(shipped.events, NoReading) and not isinstance(unchecked.events, NoReading)
    assert shipped.events.frames == unchecked.events.frames
    assert shipped.event_times_s == unchecked.event_times_s
    assert not isinstance(shipped.metrics, NoReading) and not isinstance(
        unchecked.metrics, NoReading
    )
    assert shipped.metrics.tempo_ratio.value == unchecked.metrics.tempo_ratio.value  # type: ignore[union-attr]
    if by == 1.0:
        assert shipped.playback_slowed_by is None
        assert not isinstance(shipped.metrics.backswing_duration, NoReading)
    else:
        assert shipped.playback_slowed_by is not None, "durations reported as measured"
        for refused in (shipped.metrics.backswing_duration, shipped.metrics.downswing_duration,
                        shipped.metrics.time_to_peak_hand_speed):  # fmt: skip
            assert isinstance(refused, NoReading)
            assert "more confidently as slow motion" in refused.reason


@pytest.mark.parametrize("by", [1.0, 2.0, 3.0])
def test_the_gate_sees_the_unchecked_decision_for_what_ships(model, by: float) -> None:  # type: ignore[no-untyped-def]
    resampled, _ = resample_pose(slowed(by), SHIPPED.features.canonical_rate_hz)
    features = extract_features(resampled, Handedness.RIGHT)
    shipped = release_gate.decide(model, features, SHIPPED)
    unchecked = release_gate.decide(model, features, CHECK_OFF)
    assert shipped.slowed_by is None
    assert shipped.positions is not None and unchecked.positions is not None
    assert np.array_equal(shipped.positions, unchecked.positions)
    assert shipped.confidence == unchecked.confidence
