"""A clip slowed two or three times is no longer reported as measured (#32).

Before, the slow-motion retry ran only on a clip refused at recorded speed. The
real phone swing slowed 2x or 3x passes every gate at recorded speed (a doubled
backswing still fits 0.30-2.50 s), so its durations were shown two or three
times too long as plain measurements. Now an answered clip with a long backswing
is also read at the slow-motion factors and kept as slow motion when a slowed
read is clearly more confident. The rule's values were chosen on
golfdb-validation-v2 (`scripts/slow_motion_rule.py`, `docs/ml/slow-motion-rule.md`)
but failed the release gate (#41), so it ships off; these tests run it explicitly.
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


# The rule chosen on validation. It failed the release gate (#41), so the app
# ships with the check off; these tests keep the rule working for when one passes.
CHECK_ON = AnalysisConfig(
    handedness=Handedness.RIGHT, slow_motion_check_backswing_s=1.1, slow_motion_margin=0.01
)


def read(model, by: float, config: AnalysisConfig | None = None) -> SwingAnalysis:  # type: ignore[no-untyped-def]
    return analyse_pose_sequence(slowed(by), model, config or CHECK_ON)


def test_the_check_is_off_until_a_rule_passes_the_gate() -> None:
    assert AnalysisConfig().slow_motion_check_backswing_s is None


@pytest.mark.parametrize("by", [2.0, 3.0])
def test_a_clip_slowed_two_or_three_times_is_read_as_slow_motion(model, by: float) -> None:  # type: ignore[no-untyped-def]
    analysis = read(model, by)
    assert analysis.playback_slowed_by is not None, "durations reported as measured"
    assert not isinstance(analysis.metrics, NoReading)
    assert isinstance(analysis.metrics.backswing_duration, NoReading)
    assert isinstance(analysis.metrics.downswing_duration, NoReading)


def test_without_the_check_the_two_times_clip_passes_as_real_time(model) -> None:  # type: ignore[no-untyped-def]
    """The failure #32 reported, kept reproducible: it is the check that catches it."""
    analysis = read(model, 2.0, AnalysisConfig(handedness=Handedness.RIGHT))
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
