"""Padding idle footage onto a clip's ends, which augmentation could not do.

`crop_ends` could only ever make a clip shorter, so no setting of any knob could
show the model a clip framed more loosely than the generator drew it - and the
generator draws at most 1.40 s before address and 1.10 s after the finish.
Measured on 360 real GolfDB clips, 45% carry more lead-in than that and 76% more
tail, and the clips run three times longer overall against a 253-frame receptive
field.

These tests pin the construction, not its benefit. Whether it helps is a
question for a training run.
"""

from __future__ import annotations

import numpy as np

from swingml.features import feature_layout
from swingml.model.augment import AugmentConfig, extend_ends

LAYOUT = feature_layout()
N_FRAMES = 160
EVENTS = np.array([30, 50, 65, 90, 105, 115, 125, 140], dtype=np.int64)


def ramp() -> np.ndarray:
    """Features that rise with the frame, so a reflection is visible as a fold."""
    features = np.zeros((N_FRAMES, LAYOUT.total), dtype=np.float32)
    features += np.arange(N_FRAMES, dtype=np.float32)[:, None]
    return features


def always(front: int, back: int) -> AugmentConfig:
    return (
        AugmentConfig(enabled=True, extend_probability=1.0, extend_frames=(front, front))
        if front == back
        else AugmentConfig(enabled=True, extend_probability=1.0, extend_frames=(front, back))
    )


def run(front_and_back: int) -> tuple[np.ndarray, np.ndarray]:
    config = AugmentConfig(
        enabled=True, extend_probability=1.0, extend_frames=(front_and_back, front_and_back)
    )
    return extend_ends(ramp(), EVENTS.copy(), np.random.default_rng(0), config, LAYOUT)


def test_the_clip_grows_by_the_drawn_amount_at_each_end() -> None:
    features, _ = run(20)
    assert features.shape[0] == N_FRAMES + 40


def test_the_events_move_with_the_footage_in_front_of_them() -> None:
    features, events = run(20)
    assert np.array_equal(events, EVENTS + 20)
    # And still point at the same frames they did before.
    original = ramp()
    for event in events:
        assert features[int(event), 0] == original[int(event) - 20, 0]


def test_off_by_default_so_no_recorded_number_moves() -> None:
    config = AugmentConfig(enabled=True)
    features, events = extend_ends(ramp(), EVENTS.copy(), np.random.default_rng(0), config, LAYOUT)
    assert features.shape[0] == N_FRAMES
    assert np.array_equal(events, EVENTS)


def test_the_join_is_continuous() -> None:
    """A jump at the seam would be a signal no body could produce, and a cue."""
    features, _ = run(20)
    positions = LAYOUT.positions
    front_step = np.abs(features[20, positions[0]] - features[19, positions[0]])
    inside_step = np.abs(features[25, positions[0]] - features[24, positions[0]])
    assert front_step <= inside_step + 1e-5


def test_velocity_reverses_where_time_does() -> None:
    """Positions running one way while the velocity channels say the other is not a body.

    Ten frames stays inside the first fold at both ends, where time runs
    backwards throughout. The alternation beyond that is its own test.
    """
    features, _ = run(10)
    start, end = LAYOUT.velocities
    assert (features[:10, start:end] < 0).all(), "the lead-in kept its forward velocity sign"
    assert (features[-10:, start:end] < 0).all(), "the tail kept its forward velocity sign"
    real = features[10 : 10 + N_FRAMES, start:end]
    assert (real >= 0).all(), "the recorded frames were negated"


def test_a_long_extension_folds_back_and_forth() -> None:
    """Past the first fold, time runs forwards again, and the sign has to follow.

    The tail here is twenty frames long and the padding is a hundred, so it
    folds several times. Holding one sign across the whole run would put a
    velocity channel against its own positions for most of it.
    """
    features, _ = run(100)
    start, _ = LAYOUT.velocities
    tail = features[-100:, start]
    assert (tail < 0).any() and (tail > 0).any(), "the padding never changed direction"


def test_no_second_swing_is_spliced_into_the_lead_in() -> None:
    """Reflecting the whole clip would teach the model that a clip holds two swings.

    The lead-in is built only from frames before address, so nothing in it can
    come from after it.
    """
    features, _ = run(120)
    assert features[:120, 0].max() <= float(EVENTS[0])


def test_a_padded_clip_never_exceeds_the_ceiling() -> None:
    config = AugmentConfig(
        enabled=True, extend_probability=1.0, extend_frames=(400, 400), max_extended_frames=200
    )
    features, events = extend_ends(ramp(), EVENTS.copy(), np.random.default_rng(0), config, LAYOUT)
    assert features.shape[0] == N_FRAMES, "the ceiling did not hold"
    assert np.array_equal(events, EVENTS)


def test_an_idle_segment_of_one_frame_is_held_rather_than_reflected() -> None:
    """Address on frame zero leaves nothing to reflect; it must not divide by zero."""
    events = EVENTS.copy()
    events[0] = 0
    config = AugmentConfig(enabled=True, extend_probability=1.0, extend_frames=(10, 10))
    features, _ = extend_ends(ramp(), events, np.random.default_rng(0), config, LAYOUT)
    assert features.shape[0] == N_FRAMES + 20
    assert (features[:10, 0] == 0.0).all()
