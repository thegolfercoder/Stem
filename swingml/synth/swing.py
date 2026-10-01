"""Generating whole swings: how they are timed, and where the events land.

The rig says what a golfer's body does for a given hand position. This decides
how the hand position changes with time, which is what makes one swing different
from another, and then reads the eight events straight off the resulting geometry
rather than labelling them.

That last part is the reason for the whole exercise. Impact is not "about here";
it is the frame at which the clubhead reaches the ball, and the generator knows
where the clubhead is. Two of the eight events are defined by the shaft being
horizontal, which no body-pose estimator can see, and here they are exact.

Timing is built from durations rather than from a phase variable, because tempo
is the thing being measured downstream. A swing whose backswing takes three times
as long as its downswing has a tempo ratio of three by construction, and a model
that recovers it has recovered something real.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from scipy.interpolate import PchipInterpolator

from swingml.events import NUM_EVENTS, SwingEvent
from synth.rig import BodyProportions, RigPose, SwingGeometry, build_rig_pose


class SwingTiming(BaseModel):
    """How long each part of the swing takes, in seconds."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    address_hold_s: float = Field(default=0.5, description="At address before the takeaway.")
    waggle_count: int = Field(
        default=0,
        description=(
            "Small rehearsal movements of the hands before the takeaway.\n\n"
            "Address is measurably the hardest of the eight events to place, and part "
            "of the reason is visible in this generator: without a waggle the golfer "
            "is perfectly still and then suddenly is not, which makes the takeaway "
            "trivial to find and teaches the model nothing about the real problem. A "
            "real golfer fidgets, rehearses and regrips, and the model has to learn "
            "which movement is the swing starting and which is not."
        ),
    )
    waggle_amplitude_deg: float = Field(default=7.0)
    waggle_period_s: float = Field(default=0.55)
    backswing_s: float = Field(default=0.75)
    downswing_s: float = Field(default=0.25)
    follow_through_s: float = Field(default=0.45, description="Impact to the finish position.")
    finish_hold_s: float = Field(default=0.6, description="Held at the finish.")

    @property
    def tempo_ratio(self) -> float:
        """Backswing over downswing: the number a coach means by tempo."""
        return self.backswing_s / self.downswing_s

    @property
    def total_s(self) -> float:
        return (
            self.address_hold_s
            + self.backswing_s
            + self.downswing_s
            + self.follow_through_s
            + self.finish_hold_s
        )


class SwingTruth(BaseModel):
    """Everything the generator knows and the model is not told."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    event_frames: tuple[int, ...]
    event_times_s: tuple[float, ...]
    timing: SwingTiming
    tempo_ratio: float
    frame_rate_hz: float
    left_handed: bool

    def frame_of(self, event: SwingEvent) -> int:
        return self.event_frames[int(event)]


class GeneratedSwing(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    pose: RigPose
    truth: SwingTruth
    times_s: NDArray[np.float64]


def _smooth_track(
    times: NDArray[np.float64],
    keyframe_times: list[float],
    keyframe_values: list[float],
) -> NDArray[np.float64]:
    """A monotone-preserving curve through keyframes, flat outside them.

    PCHIP rather than a cubic spline because a spline overshoots at the reversal
    at the top of the backswing, which would make the generated club travel
    further back than the keyframe says and put the top event in the wrong place.
    """
    interpolator = PchipInterpolator(np.asarray(keyframe_times), np.asarray(keyframe_values))
    clamped = np.clip(times, keyframe_times[0], keyframe_times[-1])
    return np.asarray(interpolator(clamped), dtype=np.float64)


def _first_crossing(values: NDArray[np.float64], lo: int, hi: int, rising: bool) -> int | None:
    """First index in [lo, hi) where `values` crosses zero in the given direction."""
    segment = values[lo:hi]
    if segment.size < 2:
        return None
    signs = np.sign(segment)
    changes = np.flatnonzero(signs[:-1] * signs[1:] <= 0)
    for change in changes:
        going_up = segment[change + 1] > segment[change]
        if going_up == rising:
            # Take whichever of the two frames is closer to the crossing.
            a, b = abs(segment[change]), abs(segment[change + 1])
            return lo + int(change) + (0 if a <= b else 1)
    return None


def _locate_events(
    pose: RigPose,
    times: NDArray[np.float64],
    timing: SwingTiming,
    start_time: float,
    left_handed_flag: bool = False,
) -> tuple[list[int], list[float]]:
    """Read the eight events off the generated geometry.

    Address and finish are the instants motion begins and ends, which the timing
    defines. The other six are geometric: the top is where the hands reverse, the
    two shaft-horizontal events are where the shaft's vertical component passes
    through zero, the two arm-horizontal events are the same test on the lead arm,
    and impact is where the clubhead returns to the ball.
    """
    n = len(times)
    phase = pose.hand_phase_rad
    top_frame = int(np.argmin(phase))

    # Nearest sample, not searchsorted: searchsorted always rounds up, which puts
    # address systematically late, shortens the measured backswing and biases the
    # tempo ratio - the one number this whole exercise is meant to get right.
    def nearest(t: float) -> int:
        return int(np.argmin(np.abs(times - t)))

    address_frame = nearest(start_time)
    finish_frame = min(
        nearest(start_time + timing.backswing_s + timing.downswing_s + timing.follow_through_s),
        n - 1,
    )

    # Impact first, because the follow-through event has to be searched for after
    # it: the shaft also passes through horizontal on the way *down*, and that
    # instant is not one of the eight.
    #
    # Impact is where the club returns to the orientation it had at address, which
    # is exact in this rig and does not depend on where the body has shifted to.
    # Taking it instead as the closest approach to the ball's address position
    # would fold the modelled weight shift into the answer, since the rig's arms
    # are rigid and a real golfer's adjust.
    shaft_angle = pose.hand_phase_rad - pose.wrist_hinge_rad
    returned = shaft_angle - shaft_angle[address_frame]
    search_hi = min(finish_frame, n - 1)
    impact_crossing = _first_crossing(returned, top_frame + 1, search_hi, rising=True)
    impact = impact_crossing if impact_crossing is not None else min(top_frame + 2, n - 2)

    shaft_vertical = pose.shaft_direction[:, 1]
    toe_up = _first_crossing(shaft_vertical, address_frame, top_frame, rising=True)
    follow_through = _first_crossing(shaft_vertical, impact, finish_frame, rising=True)

    # Right shoulder for a left-hander, left for a right-hander.
    lead_shoulder_index = 12 if left_handed_flag else 11
    lead_arm = pose.hands_xyz[:, 1] - pose.landmarks_xyz[:, lead_shoulder_index, 1]
    mid_backswing = _first_crossing(lead_arm, address_frame, top_frame, rising=True)
    mid_downswing = _first_crossing(lead_arm, top_frame, impact, rising=False)

    frames = [
        address_frame,
        toe_up if toe_up is not None else (address_frame + top_frame) // 2,
        mid_backswing if mid_backswing is not None else (address_frame + top_frame) // 2,
        top_frame,
        mid_downswing if mid_downswing is not None else (top_frame + impact) // 2,
        impact,
        follow_through if follow_through is not None else (impact + finish_frame) // 2,
        finish_frame,
    ]

    # Nudge apart any events that collided on the sampling grid. A generated swing
    # at a low frame rate can genuinely put two events in one frame; the ordering
    # is still real, so the frames are separated rather than the swing discarded.
    for i in range(1, NUM_EVENTS):
        frames[i] = max(frames[i], frames[i - 1] + 1)
    if frames[-1] > n - 1:
        shift = frames[-1] - (n - 1)
        for i in range(NUM_EVENTS):
            frames[i] = max(i, frames[i] - shift)

    return frames, [float(times[f]) for f in frames]


def generate_swing(
    timing: SwingTiming | None = None,
    geometry: SwingGeometry | None = None,
    body: BodyProportions | None = None,
    frame_rate_hz: float = 60.0,
    left_handed: bool = False,
) -> GeneratedSwing:
    """One complete swing, sampled at `frame_rate_hz`, with its events located exactly."""
    timing = timing or SwingTiming()
    geometry = geometry or SwingGeometry()
    body = body or BodyProportions()

    n = max(8, round(timing.total_s * frame_rate_hz))
    times = np.arange(n, dtype=np.float64) / frame_rate_hz

    t_address = timing.address_hold_s
    t_top = t_address + timing.backswing_s
    t_impact = t_top + timing.downswing_s
    t_finish = t_impact + timing.follow_through_s

    phase_deg = _smooth_track(
        times,
        [0.0, t_address, t_top, t_impact, t_finish, timing.total_s],
        [
            geometry.address_phase_deg,
            geometry.address_phase_deg,
            geometry.top_phase_deg,
            geometry.address_phase_deg,
            geometry.finish_phase_deg,
            geometry.finish_phase_deg,
        ],
    )

    if timing.waggle_count > 0 and t_address > 0:
        # A rehearsal movement, fading out as the golfer settles. It lives entirely
        # before the takeaway, so the address event stays where the timing puts it
        # and the model has to learn to tell this motion from the real thing.
        waggle_span = min(t_address, timing.waggle_count * timing.waggle_period_s)
        start = t_address - waggle_span
        inside = (times >= start) & (times < t_address)
        local = times[inside] - start
        settle = 1.0 - local / max(waggle_span, 1e-6)
        phase_deg[inside] += (
            timing.waggle_amplitude_deg
            * settle
            * np.sin(2.0 * np.pi * local / timing.waggle_period_s)
        )

    phase = np.radians(phase_deg)

    # The wrists hinge going back, hold much of that hinge into the downswing, and
    # release through impact. `lag_retention` decides how late the release is,
    # which is the difference between a swing that looks powerful and one that
    # does not, and it moves the shaft-horizontal events measurably.
    hinge_release_time = t_top + timing.downswing_s * (1.0 - geometry.lag_retention * 0.55)
    hinge = np.radians(
        _smooth_track(
            times,
            [0.0, t_address, t_top, hinge_release_time, t_impact, t_finish, timing.total_s],
            [
                0.0,
                0.0,
                geometry.max_wrist_hinge_deg,
                geometry.max_wrist_hinge_deg * geometry.lag_retention,
                0.0,
                -geometry.max_wrist_hinge_deg * 0.85,
                -geometry.max_wrist_hinge_deg * 0.85,
            ],
        )
    )

    def turn(
        top: float, impact_value: float, finish: float, lead_s: float = 0.0
    ) -> NDArray[np.float64]:
        """A turn track, optionally reaching its milestones `lead_s` early.

        Shifting the pelvis's keyframes earlier is what gives the generated swing
        a proximal-to-distal sequence: the hips unwind before the shoulders do,
        as they do in a swing that is not all arms.
        """
        return np.radians(
            _smooth_track(
                times,
                [
                    0.0,
                    t_address,
                    t_top - lead_s,
                    t_impact - lead_s,
                    t_finish - lead_s,
                    timing.total_s,
                ],
                [0.0, 0.0, top, impact_value, finish, finish],
            )
        )

    lead_s = min(geometry.sequence_lead_ms / 1000.0, 0.4 * timing.downswing_s)
    pelvis_turn = turn(
        geometry.pelvis_turn_top_deg,
        geometry.pelvis_turn_impact_deg,
        geometry.pelvis_turn_finish_deg,
        lead_s=lead_s,
    )
    thorax_turn = turn(
        geometry.thorax_turn_top_deg,
        geometry.thorax_turn_impact_deg,
        geometry.thorax_turn_finish_deg,
    )

    sway = _smooth_track(
        times,
        [0.0, t_address, t_top, t_impact, t_finish, timing.total_s],
        [
            0.0,
            0.0,
            -geometry.sway_amplitude_m,
            geometry.sway_amplitude_m * 0.6,
            geometry.sway_amplitude_m,
            geometry.sway_amplitude_m,
        ],
    )
    lift = _smooth_track(
        times,
        [0.0, t_address, t_top, t_impact, t_finish, timing.total_s],
        # The golfer stands taller through the finish, but not by as much as the
        # rest of the swing's vertical motion might suggest: overdo it and the
        # planted feet end up out of the legs' reach.
        [
            0.0,
            0.0,
            geometry.lift_amplitude_m,
            -geometry.lift_amplitude_m * 0.4,
            geometry.lift_amplitude_m * 1.2,
            geometry.lift_amplitude_m * 1.2,
        ],
    )
    head_drift = _smooth_track(
        times,
        [0.0, t_address, t_top, t_impact, t_finish, timing.total_s],
        [
            0.0,
            0.0,
            -geometry.head_drift_m,
            -geometry.head_drift_m * 0.5,
            geometry.head_drift_m,
            geometry.head_drift_m,
        ],
    )

    pose = build_rig_pose(
        phase, hinge, pelvis_turn, thorax_turn, sway, lift, head_drift, body, geometry, left_handed
    )
    frames, event_times = _locate_events(pose, times, timing, t_address, left_handed)

    return GeneratedSwing(
        pose=pose,
        times_s=times,
        truth=SwingTruth(
            event_frames=tuple(frames),
            event_times_s=tuple(event_times),
            timing=timing,
            tempo_ratio=timing.tempo_ratio,
            frame_rate_hz=frame_rate_hz,
            left_handed=left_handed,
        ),
    )
