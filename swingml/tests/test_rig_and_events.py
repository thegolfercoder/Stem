"""The generated swing has to be a swing, or every downstream number is measuring nothing."""

from __future__ import annotations

import numpy as np
import pytest

from swingml.events import SwingEvent
from swingml.skeleton import Landmark
from synth.rig import BodyProportions
from synth.swing import SwingTiming, generate_swing


@pytest.mark.parametrize("frame_rate_hz", [30.0, 60.0, 120.0, 240.0])
def test_events_are_ordered_at_every_capture_rate(frame_rate_hz: float) -> None:
    truth = generate_swing(frame_rate_hz=frame_rate_hz).truth
    assert list(truth.event_frames) == sorted(truth.event_frames)
    assert len(set(truth.event_frames)) == 8


@pytest.mark.parametrize("frame_rate_hz", [60.0, 240.0])
def test_limb_lengths_are_rigid(frame_rate_hz: float) -> None:
    """A stretching forearm means the arm IK is being asked for something impossible."""
    body = BodyProportions()
    swing = generate_swing(body=body, frame_rate_hz=frame_rate_hz)
    points = swing.pose.landmarks_xyz

    for start, end, expected in (
        (Landmark.LEFT_SHOULDER, Landmark.LEFT_ELBOW, body.upper_arm_m),
        (Landmark.LEFT_ELBOW, Landmark.LEFT_WRIST, body.forearm_m),
        (Landmark.RIGHT_SHOULDER, Landmark.RIGHT_ELBOW, body.upper_arm_m),
        (Landmark.RIGHT_ELBOW, Landmark.RIGHT_WRIST, body.forearm_m),
        (Landmark.LEFT_HIP, Landmark.LEFT_KNEE, body.thigh_m),
        (Landmark.RIGHT_KNEE, Landmark.RIGHT_ANKLE, body.shin_m),
    ):
        lengths = np.linalg.norm(points[:, int(start)] - points[:, int(end)], axis=1)
        assert lengths.max() == pytest.approx(expected, rel=0.01)
        assert lengths.min() == pytest.approx(expected, rel=0.01)


def test_the_shaft_is_horizontal_at_the_two_shaft_defined_events() -> None:
    """These two events exist only because the generator knows where the club is."""
    swing = generate_swing(frame_rate_hz=240.0)
    for event in (SwingEvent.TOE_UP, SwingEvent.MID_FOLLOW_THROUGH):
        vertical = swing.pose.shaft_direction[swing.truth.frame_of(event), 1]
        assert abs(vertical) < 0.05


def test_the_lead_arm_is_horizontal_at_the_two_arm_defined_events() -> None:
    swing = generate_swing(frame_rate_hz=240.0)
    for event in (SwingEvent.MID_BACKSWING, SwingEvent.MID_DOWNSWING):
        frame = swing.truth.frame_of(event)
        height = (
            swing.pose.hands_xyz[frame, 1]
            - swing.pose.landmarks_xyz[frame, int(Landmark.LEFT_SHOULDER), 1]
        )
        assert abs(height) < 0.05


def test_impact_lands_where_the_timing_says_it_should() -> None:
    timing = SwingTiming(address_hold_s=0.4, backswing_s=0.8, downswing_s=0.26)
    swing = generate_swing(timing=timing, frame_rate_hz=240.0)
    expected = timing.address_hold_s + timing.backswing_s + timing.downswing_s
    assert swing.truth.event_times_s[int(SwingEvent.IMPACT)] == pytest.approx(expected, abs=0.01)


def test_the_top_of_the_backswing_is_the_hands_reversing() -> None:
    swing = generate_swing(frame_rate_hz=120.0)
    top = swing.truth.frame_of(SwingEvent.TOP)
    assert top == int(np.argmin(swing.pose.hand_phase_rad))


def test_tempo_ratio_is_what_the_timing_asked_for() -> None:
    timing = SwingTiming(backswing_s=0.9, downswing_s=0.3)
    assert generate_swing(timing=timing).truth.tempo_ratio == pytest.approx(3.0)


def test_the_pelvis_leads_the_thorax() -> None:
    """Without a proximal-to-distal sequence the kinematic ordering metric measures nothing."""
    swing = generate_swing(frame_rate_hz=240.0)
    points = swing.pose.landmarks_xyz
    top = swing.truth.frame_of(SwingEvent.TOP)
    impact = swing.truth.frame_of(SwingEvent.IMPACT)

    def peak_frame(a: Landmark, b: Landmark) -> int:
        line = points[:, int(a)] - points[:, int(b)]
        angle = np.unwrap(np.arctan2(line[:, 2], line[:, 0]))
        speed = np.abs(np.gradient(angle))
        return top + int(np.argmax(speed[top : impact + 1]))

    pelvis = peak_frame(Landmark.LEFT_HIP, Landmark.RIGHT_HIP)
    thorax = peak_frame(Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER)
    assert pelvis < thorax


def test_waggle_moves_the_hands_without_moving_the_takeaway() -> None:
    """Rehearsal movement before the swing must not shift where the swing starts.

    Address is the hardest of the eight events to place, and a generator where the
    golfer is perfectly still and then abruptly is not makes it artificially easy.
    Adding a waggle only helps if the label stays put: if the event moved with the
    fidgeting, the model would be learning to find the fidgeting.
    """
    import numpy as np

    from swingml.events import SwingEvent
    from synth.swing import SwingTiming, generate_swing

    still = generate_swing(timing=SwingTiming(address_hold_s=1.2), frame_rate_hz=60.0)
    waggled = generate_swing(
        timing=SwingTiming(address_hold_s=1.2, waggle_count=2), frame_rate_hz=60.0
    )

    assert still.truth.event_frames == waggled.truth.event_frames

    address = still.truth.frame_of(SwingEvent.ADDRESS)
    still_motion = float(np.abs(np.diff(still.pose.hands_xyz[:address], axis=0)).sum())
    waggled_motion = float(np.abs(np.diff(waggled.pose.hands_xyz[:address], axis=0)).sum())
    assert still_motion < 1e-6
    assert waggled_motion > 0.1


def test_waggle_stays_out_of_the_swing_itself() -> None:
    """The oscillation lives before the takeaway and nowhere else."""
    import numpy as np

    from swingml.events import SwingEvent
    from synth.swing import SwingTiming, generate_swing

    timing = SwingTiming(address_hold_s=1.2, waggle_count=3, waggle_amplitude_deg=11.0)
    still = generate_swing(timing=SwingTiming(address_hold_s=1.2), frame_rate_hz=60.0)
    waggled = generate_swing(timing=timing, frame_rate_hz=60.0)

    address = waggled.truth.frame_of(SwingEvent.ADDRESS)
    after = np.abs(
        waggled.pose.hand_phase_rad[address:] - still.pose.hand_phase_rad[address:]
    ).max()
    assert after < 1e-9
