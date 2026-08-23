"""The claim the whole design rests on: no calibration is needed anywhere.

If that claim is true then the features the model sees must not change when the
camera moves closer, when the golfer stands somewhere else in the frame, or when
the phone is tilted. If it is false, the model has quietly learned something
about one filming setup and will fail on another.

These are the tests that would catch that, so they are written against the same
swing rendered under different cameras rather than against synthetic arrays.
"""

from __future__ import annotations

import numpy as np
import pytest

from swingml.features import (
    FeatureConfig,
    body_scale,
    extract_features,
    feature_dimension,
    normalise_pose,
    resample_pose,
)
from swingml.pose.base import PoseSequence
from swingml.skeleton import SWING_LANDMARK_INDICES, Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import generate_swing

N_LANDMARKS = len(SWING_LANDMARK_INDICES)
POSITION_CHANNELS = slice(0, N_LANDMARKS * 2)
VELOCITY_CHANNELS = slice(N_LANDMARKS * 2, N_LANDMARKS * 4)

QUIET = NoiseConfig(
    jitter_px=0.0,
    speed_jitter_px_per_body_length=0.0,
    fast_landmark_multiplier=1.0,
    dropout_probability=0.0,
    frame_loss_probability=0.0,
    timestamp_jitter_s=0.0,
)


def _features(camera: CameraConfig, frame_rate_hz: float = 60.0) -> np.ndarray:
    swing = generate_swing(frame_rate_hz=frame_rate_hz)
    pose = render_pose_sequence(swing, camera, QUIET, seed=0)
    resampled, _ = resample_pose(pose, FeatureConfig().canonical_rate_hz)
    return extract_features(resampled, Handedness.RIGHT)


def test_feature_dimension_matches_what_is_produced() -> None:
    assert _features(CameraConfig()).shape[1] == feature_dimension()


def test_positions_barely_move_when_the_camera_changes_distance() -> None:
    """Filming from three metres or six must describe the same posture.

    The invariance is close but not exact, and the reason is worth knowing: a
    camera at three metres foreshortens more than one at six, so doubling the
    distance genuinely changes the shape projected into the image. What is left
    after the body-scale normalisation is that perspective, not a defect. It is
    small against features that span roughly plus or minus one body length.
    """
    near = _features(CameraConfig(distance_m=3.0))
    far = _features(CameraConfig(distance_m=6.0))
    n = min(len(near), len(far))
    difference = np.abs(near[:n, POSITION_CHANNELS] - far[:n, POSITION_CHANNELS]).max()
    assert difference < 0.1, f"positions moved by {difference:.3f} on a doubled distance"


def test_features_are_unchanged_when_the_golfer_moves_within_the_frame() -> None:
    """Position in frame is an accident of where the phone was pointed."""
    swing = generate_swing(frame_rate_hz=60.0)
    pose = render_pose_sequence(swing, CameraConfig(), QUIET, seed=0)

    shifted_xy = pose.xy.copy()
    shifted_xy[..., 0] += 0.07
    shifted_xy[..., 1] -= 0.05
    shifted = pose.model_copy(update={"xy": shifted_xy})

    base = extract_features(resample_pose(pose, 60.0)[0], Handedness.RIGHT)
    moved = extract_features(resample_pose(shifted, 60.0)[0], Handedness.RIGHT)
    assert np.abs(base - moved).max() < 1e-4


def test_features_are_untouched_by_the_phone_being_tilted() -> None:
    """A phone propped against a bag is never level, and roll is removed exactly."""
    upright = _features(CameraConfig(roll_deg=0.0))
    tilted = _features(CameraConfig(roll_deg=12.0))
    n = min(len(upright), len(tilted))
    assert np.abs(upright[:n] - tilted[:n]).max() < 1e-4


def test_roll_normalisation_is_what_removes_the_tilt() -> None:
    """Confirms the invariance above is earned rather than accidental."""
    swing = generate_swing(frame_rate_hz=60.0)
    upright = render_pose_sequence(swing, CameraConfig(roll_deg=0.0), QUIET, seed=0)
    tilted = render_pose_sequence(swing, CameraConfig(roll_deg=12.0), QUIET, seed=0)

    without = FeatureConfig(normalise_roll=False)
    with_roll = FeatureConfig(normalise_roll=True)
    raw_gap = np.abs(normalise_pose(upright, without)[0] - normalise_pose(tilted, without)[0]).max()
    fixed_gap = np.abs(
        normalise_pose(upright, with_roll)[0] - normalise_pose(tilted, with_roll)[0]
    ).max()
    assert fixed_gap < raw_gap / 2.0


@pytest.mark.parametrize("frame_rate_hz", [30.0, 120.0, 240.0])
def test_the_same_swing_at_any_capture_rate_gives_the_same_posture(
    frame_rate_hz: float,
) -> None:
    """This is what makes one model handle normal video and slow motion alike."""
    reference = _features(CameraConfig(), frame_rate_hz=60.0)
    other = _features(CameraConfig(), frame_rate_hz=frame_rate_hz)

    assert abs(len(reference) - len(other)) <= 2
    n = min(len(reference), len(other))
    difference = np.abs(reference[:n, POSITION_CHANNELS] - other[:n, POSITION_CHANNELS]).max()
    assert difference < 0.05


@pytest.mark.parametrize("frame_rate_hz", [120.0, 240.0])
def test_velocities_also_agree_when_the_clip_was_captured_above_the_canonical_rate(
    frame_rate_hz: float,
) -> None:
    reference = _features(CameraConfig(), frame_rate_hz=60.0)
    other = _features(CameraConfig(), frame_rate_hz=frame_rate_hz)
    n = min(len(reference), len(other))
    difference = np.abs(reference[:n, VELOCITY_CHANNELS] - other[:n, VELOCITY_CHANNELS]).max()
    assert difference < 0.01


def test_thirty_frames_a_second_cannot_reproduce_sixty_hertz_velocities() -> None:
    """A limitation, pinned by a test so it is not mistaken for invariance.

    Positions resample cleanly from any capture rate, but velocity is a
    derivative, and a thirty-frames-a-second clip does not contain the detail to
    reconstruct one at sixty. The gap shows up at the fastest moments of the
    swing, which are the moments the events sit in. This is why the sampled
    capture rates in training include thirty: a model that has never seen a
    coarsely sampled swing would be surprised by one.
    """
    reference = _features(CameraConfig(), frame_rate_hz=60.0)
    coarse = _features(CameraConfig(), frame_rate_hz=30.0)
    n = min(len(reference), len(coarse))

    positions = np.abs(reference[:n, POSITION_CHANNELS] - coarse[:n, POSITION_CHANNELS]).max()
    velocities = np.abs(reference[:n, VELOCITY_CHANNELS] - coarse[:n, VELOCITY_CHANNELS]).max()
    assert positions < 0.05
    assert velocities > 0.3


def test_resampling_preserves_the_clip_duration() -> None:
    swing = generate_swing(frame_rate_hz=240.0)
    pose = render_pose_sequence(swing, CameraConfig(), QUIET, seed=0)
    resampled, grid = resample_pose(pose, 60.0)
    assert resampled.duration_s == pytest.approx(pose.duration_s, abs=1 / 60)
    assert resampled.median_frame_rate_hz == pytest.approx(60.0, rel=1e-6)
    assert len(grid) == resampled.n_frames


def test_body_scale_falls_back_when_the_feet_are_out_of_shot() -> None:
    """Filming in portrait and cutting the feet off is the normal case, not an edge one."""
    swing = generate_swing(frame_rate_hz=60.0)
    pose = render_pose_sequence(swing, CameraConfig(), QUIET, seed=0)
    square = pose.square_xy()

    full = body_scale(square, pose.visibility, 0.3)
    hidden = pose.visibility.copy()
    hidden[:, 27] = 0.0
    hidden[:, 28] = 0.0
    cropped = body_scale(square, hidden, 0.3)

    assert full > 0
    assert cropped == pytest.approx(full, rel=0.35)


def test_features_never_contain_nan_even_with_landmarks_missing() -> None:
    swing = generate_swing(frame_rate_hz=60.0)
    pose = render_pose_sequence(swing, CameraConfig(), QUIET, seed=0)
    broken_xy = pose.xy.copy()
    broken_xy[5:10] = 0.0
    broken = pose.model_copy(update={"xy": broken_xy})
    features = extract_features(resample_pose(broken, 60.0)[0], Handedness.RIGHT)
    assert np.isfinite(features).all()


def test_a_sequence_of_one_frame_is_returned_untouched() -> None:
    pose = PoseSequence(
        xy=np.zeros((1, 33, 2), dtype=np.float32),
        visibility=np.ones((1, 33), dtype=np.float32),
        timestamps_s=np.zeros(1),
        frame_width=1080,
        frame_height=1920,
    )
    resampled, grid = resample_pose(pose, 60.0)
    assert resampled.n_frames == 1
    assert len(grid) == 1


def test_world_landmarks_that_stretch_are_judged_unusable() -> None:
    """A bone that changes length is the estimator's depth failing, not the body moving.

    Measured on real footage, MediaPipe reported the shoulder line shrinking from
    0.295 m to 0.048 m across one swing. Any angle computed from that output is
    describing the same error, so the check has to catch it rather than let a
    confident-looking number through.
    """
    import numpy as np

    from swingml.metrics.swing import world_landmarks_are_rigid
    from swingml.skeleton import NUM_LANDMARKS, Landmark

    n = 60
    world = np.zeros((n, NUM_LANDMARKS, 3), dtype=np.float32)
    world[:, int(Landmark.LEFT_SHOULDER)] = [0.2, 0.0, 0.0]
    world[:, int(Landmark.RIGHT_SHOULDER)] = [-0.2, 0.0, 0.0]
    world[:, int(Landmark.LEFT_HIP)] = [0.15, -0.5, 0.0]
    world[:, int(Landmark.RIGHT_HIP)] = [-0.15, -0.5, 0.0]

    rigid, variation = world_landmarks_are_rigid(world, slice(0, n), 0.25)
    assert rigid and variation < 1e-5

    # Now collapse the shoulders the way a real estimator did.
    world[30:, int(Landmark.LEFT_SHOULDER)] = [0.03, 0.0, 0.0]
    world[30:, int(Landmark.RIGHT_SHOULDER)] = [-0.03, 0.0, 0.0]
    rigid, variation = world_landmarks_are_rigid(world, slice(0, n), 0.25)
    assert not rigid
    assert variation > 0.5


def test_turn_from_foreshortening_recovers_a_known_angle() -> None:
    """A line of fixed length seen from an angle shortens by the cosine of it."""
    import numpy as np

    from swingml.metrics.swing import turn_from_foreshortening
    from swingml.skeleton import NUM_LANDMARKS, Landmark

    n = 40
    xy = np.zeros((n, NUM_LANDMARKS, 2), dtype=np.float64)
    visibility = np.ones((n, NUM_LANDMARKS), dtype=np.float32)

    half = 0.10
    for frame in range(n):
        # Square to the camera at the start, turned 60 degrees by the end.
        turned = np.radians(60.0 * frame / (n - 1))
        xy[frame, int(Landmark.LEFT_SHOULDER)] = [0.5 + half * np.cos(turned), 0.4]
        xy[frame, int(Landmark.RIGHT_SHOULDER)] = [0.5 - half * np.cos(turned), 0.4]

    angle = turn_from_foreshortening(
        xy, visibility, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER, slice(0, n), n - 1, 0.3
    )
    assert angle is not None
    assert abs(angle - 60.0) < 1.5


def test_turn_from_foreshortening_refuses_when_the_line_was_never_seen() -> None:
    import numpy as np

    from swingml.metrics.swing import turn_from_foreshortening
    from swingml.skeleton import NUM_LANDMARKS, Landmark

    n = 40
    xy = np.zeros((n, NUM_LANDMARKS, 2), dtype=np.float64)
    visibility = np.zeros((n, NUM_LANDMARKS), dtype=np.float32)
    assert (
        turn_from_foreshortening(
            xy, visibility, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER, slice(0, n), 10, 0.3
        )
        is None
    )
