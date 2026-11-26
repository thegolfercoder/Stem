"""Product failures found by measuring the shipped model on real held-out swings.

Each test here pins a behaviour that was wrong in the product, not merely
inaccurate in a benchmark, with the measurement that exposed it. The audit that
produced them is `docs/audit/failure-inventory.md`.
"""

from __future__ import annotations

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading, Quantity
from swingml.skeleton import Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import SwingTiming, generate_swing

QUIET = NoiseConfig(
    jitter_px=0.0,
    speed_jitter_px_per_body_length=0.0,
    fast_landmark_multiplier=1.0,
    dropout_probability=0.0,
    frame_loss_probability=0.0,
    timestamp_jitter_s=0.0,
)
TIMING = SwingTiming(
    address_hold_s=1.0,
    backswing_s=0.8,
    downswing_s=0.8 / 3.0,
    follow_through_s=0.45,
    finish_hold_s=0.8,
)

needs_model = pytest.mark.skipif(find_event_model() is None, reason="needs the bundled model")


@pytest.fixture(scope="module")
def model():  # type: ignore[no-untyped-def]
    path = find_event_model()
    assert path is not None
    return load_model(path)


def _sequence(slowed_by: float = 1.0) -> PoseSequence:
    swing = generate_swing(timing=TIMING, frame_rate_hz=60.0)
    camera = CameraConfig(
        azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
    )
    sequence = render_pose_sequence(swing, camera, QUIET, seed=0)
    if slowed_by == 1.0:
        return sequence
    # A slow-motion export: the same frames, shown slowed_by times further apart.
    return sequence.model_copy(update={"timestamps_s": sequence.timestamps_s * slowed_by})


@needs_model
def test_the_whole_swing_duration_is_not_reported_from_an_unreliable_finish(model) -> None:  # type: ignore[no-untyped-def]
    """The finish lands a median 29 frames (about half a second) from the label.

    Measured on 201 held-out real GolfDB swings (docs/audit/error-breakdown.json);
    within one frame 0.5% of the time. A duration that ends at the finish was shown
    as a measured number in milliseconds. It is now refused with the reason.
    """
    analysis = analyse_pose_sequence(
        _sequence(), model, AnalysisConfig(handedness=Handedness.RIGHT)
    )
    assert not isinstance(analysis.metrics, NoReading)
    whole = analysis.metrics.swing_duration
    assert isinstance(whole, NoReading)
    assert "finish" in whole.reason
    # The durations whose ends the model does place are still reported.
    assert isinstance(analysis.metrics.backswing_duration, Quantity)
    assert isinstance(analysis.metrics.downswing_duration, Quantity)


@needs_model
@pytest.mark.parametrize("slowed_by", [4.0, 8.0])
def test_a_slow_motion_export_reads_tempo_and_refuses_durations(model, slowed_by: float) -> None:  # type: ignore[no-untyped-def]
    """A swing exported in slow motion was refused as "not a swing being made".

    Its backswing lasts three seconds or more, past the 2.5 s any real backswing
    takes; 82 of the 201 held-out real swings are slow-motion broadcast replays,
    with a median backswing of 3.07 s. Tempo is a ratio and survives an even
    slow-down (the model's tempo error on those 82 was 15.1%, against 15.0% on
    the real-time ones), so tempo is reported, with the assumption stated, and
    every duration is refused rather than shown four or eight times too long.
    """
    normal = analyse_pose_sequence(_sequence(), model, AnalysisConfig(handedness=Handedness.RIGHT))
    slowed = analyse_pose_sequence(
        _sequence(slowed_by), model, AnalysisConfig(handedness=Handedness.RIGHT)
    )
    assert not isinstance(slowed.events, NoReading), slowed.events
    assert not isinstance(slowed.metrics, NoReading)
    assert not isinstance(normal.metrics, NoReading)
    tempo = slowed.metrics.tempo_ratio
    assert isinstance(tempo, Quantity)
    assert isinstance(normal.metrics.tempo_ratio, Quantity)
    assert tempo.value == pytest.approx(normal.metrics.tempo_ratio.value, rel=0.25)
    assert any("slow" in a for a in tempo.assumptions)
    for name in ("backswing_duration", "downswing_duration", "time_to_peak_hand_speed"):
        reading = getattr(slowed.metrics, name)
        assert isinstance(reading, NoReading), name
        assert "slow" in reading.reason
    assert slowed.metrics.kinematic_peak_times_ms == {}


@needs_model
def test_a_real_time_clip_is_not_mistaken_for_slow_motion(model) -> None:  # type: ignore[no-untyped-def]
    analysis = analyse_pose_sequence(
        _sequence(), model, AnalysisConfig(handedness=Handedness.RIGHT)
    )
    assert not isinstance(analysis.metrics, NoReading)
    assert isinstance(analysis.metrics.backswing_duration, Quantity)
    assert isinstance(analysis.metrics.tempo_ratio, Quantity)
    assert not any("slow" in a for a in analysis.metrics.tempo_ratio.assumptions)


@needs_model
def test_a_clip_too_slow_even_for_slow_motion_is_still_refused(model) -> None:  # type: ignore[no-untyped-def]
    """Stretched past anything a phone records, it is not treated as a swing."""
    analysis = analyse_pose_sequence(
        _sequence(40.0), model, AnalysisConfig(handedness=Handedness.RIGHT)
    )
    assert isinstance(analysis.events, NoReading)
    assert np.isfinite(analysis.detection_rate)
