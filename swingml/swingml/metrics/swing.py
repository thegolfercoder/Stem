"""What the swing actually was, given where the events fell.

Everything here is computed from the golfer's own body, in units taken from their
own body, so nothing needs a calibrated camera - which is the constraint the whole
design is built around. A ratio of two durations does not care where the phone
was. A displacement measured in shoulder-widths does not care how far away it
stood.

The exception is rotation, and it is worth being blunt about it. A shoulder line
that sweeps eighty degrees across the image has not turned eighty degrees in
space unless the camera happened to be looking straight down the axis it turned
about. Two numbers are therefore reported for every rotation: what was seen in the
image, marked as a projection, and what the pose estimator's own three-dimensional
output says, marked as an estimate from a network rather than a measurement. They
are not the same quantity and they are not presented as though they were.

The projected figure is still useful, and more useful than it looks: for a golfer
comparing today against last week from the same spot in the same bay, a change in
the projected angle is a real change in their swing. It stops being comparable the
moment the phone moves, and it was never a body angle.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import CLUB_DEFINED_EVENTS, EventSequence, SwingEvent
from swingml.features import FeatureConfig, normalise_pose
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading, Provenance, Quantity, Reading
from swingml.skeleton import Handedness, Landmark


class MetricConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    min_detection_rate: float = Field(
        default=0.75,
        description="Share of frames needing a body found before any metric is reported.",
    )
    max_world_length_variation: float = Field(
        default=0.25,
        description=(
            "How much the estimator's three-dimensional shoulder or hip line may "
            "change length across a swing before its depth output is judged unusable. "
            "A quarter is already generous for something that is anatomically fixed."
        ),
    )
    min_key_visibility: float = Field(
        default=0.4,
        description="Mean confidence required on the shoulders and hips over the swing.",
    )
    min_swing_frames: int = Field(
        default=12, description="Frames from address to finish below which nothing is reported."
    )
    velocity_smoothing_frames: int = Field(
        default=3,
        description=(
            "Width of the smoothing applied before peak angular velocities are "
            "located. Differentiating a noisy angle track amplifies the noise, and "
            "the peaks are what the kinematic sequence is read from."
        ),
    )


class SwingMetrics(BaseModel):
    """One swing's numbers, each carrying how it was obtained."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    tempo_ratio: Reading
    backswing_duration: Reading
    downswing_duration: Reading
    swing_duration: Reading
    time_to_peak_hand_speed: Reading

    shoulder_turn_projected: Reading
    hip_turn_projected: Reading
    separation_projected: Reading
    shoulder_turn_3d: Reading
    hip_turn_3d: Reading
    separation_3d: Reading
    shoulder_turn_foreshortened: Reading
    hip_turn_foreshortened: Reading

    head_movement: Reading
    pelvis_sway: Reading
    pelvis_lift: Reading

    kinematic_sequence: tuple[str, ...] = Field(
        description=(
            "Order in which the pelvis, thorax and lead arm reached their peak "
            "angular speed. In an efficient swing the larger, slower segments peak "
            "first. Reported as an observed order, not scored."
        )
    )
    kinematic_peak_times_ms: dict[str, float] = Field(
        description="Time of each segment's peak, relative to impact."
    )
    kinematic_sequence_source: str = Field(
        description=(
            "Whether the ordering came from the estimator's inferred depth or from "
            "projected image-plane angles. The projected version is close to "
            "meaningless when the camera is down the line, because the shoulder line "
            "is then edge-on and its apparent angle is mostly noise."
        )
    )

    low_confidence_events: tuple[str, ...] = Field(
        description=(
            "Events whose position rests on the regularity of the swing rather than "
            "on anything the pose estimator saw. Two of the eight are defined by the "
            "club shaft, and there is no club in a body-pose estimate."
        )
    )
    detection_rate: float
    frames_analysed: int


def _angle_series(vectors: NDArray[np.float64]) -> NDArray[np.float64]:
    """Unwrapped angle of a sequence of 2D vectors, in degrees."""
    return np.asarray(np.degrees(np.unwrap(np.arctan2(vectors[:, 1], vectors[:, 0]))))


def _line_tilt_change(angles: NDArray[np.float64], start: int, end: int) -> float:
    """Change in the tilt of a *line* between two frames, wrapped to plus or minus 90.

    A shoulder line is a line, not an arrow. Which end the estimator calls left and
    which right is its business, and when the body turns edge-on the two swap over
    in the image, flipping the vector by a full half turn. Unwrapping a series that
    does that produces changes of a hundred and eighty degrees or more out of a
    body that merely rotated a little, and a session average of a hundred and
    fifty-three degrees give or take a hundred and seventy-four, which is what this
    was quietly reporting before.

    Treating it as a line and wrapping into a quadrant either way removes the
    flip. It also caps what the metric can express at ninety degrees, which is
    honest: beyond that a line in an image is indistinguishable from its own
    reflection.
    """
    change = float(angles[end] - angles[start])
    return float((change + 90.0) % 180.0 - 90.0)


def _smooth(values: NDArray[np.float64], width: int) -> NDArray[np.float64]:
    if width <= 1:
        return values
    kernel = np.ones(width) / width
    return np.convolve(values, kernel, mode="same")


def _rotation_about_vertical(
    world: NDArray[np.float32], a: Landmark, b: Landmark
) -> NDArray[np.float64]:
    """Angle of a body line about the vertical axis, from the estimator's 3D output.

    MediaPipe's world landmarks are hip-centred with the vertical running down the
    image, so a turn of the shoulders is a rotation in the plane spanned by the
    remaining two axes.
    """
    line = world[:, int(a), :] - world[:, int(b), :]
    return np.asarray(np.degrees(np.unwrap(np.arctan2(line[:, 2], line[:, 0]))))


def world_landmarks_are_rigid(
    world: NDArray[np.float32],
    window: slice,
    tolerance: float,
) -> tuple[bool, float]:
    """Whether the estimator's depth output holds the body together.

    A shoulder line is a bone. Its length does not change while somebody swings a
    golf club, so if the estimator's three-dimensional output says it did, that
    output is not describing the body - and every angle computed from it is
    describing the same thing the length was.

    This is worth checking rather than assuming. Measured on a real clip, the
    shoulder line's world length ran from 0.295 m down to 0.048 m through one
    swing, a factor of six, while the shoulders in the image merely foreshortened
    as they should. The turn computed from that output came out at one and a half
    degrees for a full backswing, which is not a small error, it is a number about
    nothing.

    Returns whether it held together, and the worst relative variation seen.
    """
    worst = 0.0
    for a, b in (
        (Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER),
        (Landmark.LEFT_HIP, Landmark.RIGHT_HIP),
    ):
        lengths = np.linalg.norm(world[window, int(a), :] - world[window, int(b), :], axis=1)
        usable = lengths[lengths > 1e-6]
        if usable.size < 3:
            return False, 1.0
        reference = float(np.median(usable))
        if reference <= 1e-6:
            return False, 1.0
        variation = float(np.max(np.abs(usable - reference)) / reference)
        worst = max(worst, variation)
    return worst <= tolerance, worst


def turn_from_foreshortening(
    square_xy: NDArray[np.float64],
    visibility: NDArray[np.float32],
    a: Landmark,
    b: Landmark,
    window: slice,
    frame: int,
    min_visibility: float,
) -> float | None:
    """How far a body line has turned away from the camera, from how short it looks.

    A line of fixed length seen from an angle appears shortened by the cosine of
    that angle. So the shoulders' apparent width, measured against the widest they
    appear anywhere in the swing, gives the angle they have turned through -
    without knowing the focal length, the distance, or anything else about the
    camera.

    Two honest limitations. The sign is not recoverable: turning away from the
    camera and turning towards it shorten the line identically, and only the
    magnitude is reported. And the reference is the widest the line appeared in
    *this* clip, so it assumes the body was square to the camera at some point
    during it - true for a swing filmed face-on or down the line, and not true if
    the camera sat at forty-five degrees throughout.

    Returns None when the line was never seen clearly enough to trust.
    """
    pair = [int(a), int(b)]
    seen = np.min(visibility[window][:, pair], axis=1) >= min_visibility
    if np.count_nonzero(seen) < 5:
        return None

    widths = np.linalg.norm(square_xy[window, int(a)] - square_xy[window, int(b)], axis=1)
    widths = widths[seen]
    # The widest the line appeared, taken as a high percentile rather than the
    # maximum so that one bad frame cannot set the reference.
    reference = float(np.percentile(widths, 95))
    if reference <= 1e-6:
        return None

    if visibility[frame, pair].min() < min_visibility:
        return None
    here = float(np.linalg.norm(square_xy[frame, int(a)] - square_xy[frame, int(b)]))
    return float(np.degrees(np.arccos(np.clip(here / reference, 0.0, 1.0))))


def _reading(
    value: float, unit: str, provenance: Provenance, source: str, assumptions: tuple[str, ...] = ()
) -> Quantity:
    return Quantity(
        value=float(value), unit=unit, provenance=provenance, source=source, assumptions=assumptions
    )


def compute_metrics(
    sequence: PoseSequence,
    events: EventSequence,
    handedness: Handedness,
    config: MetricConfig | None = None,
) -> SwingMetrics | NoReading:
    """Metrics for one swing, or a refusal explaining why there are none.

    `sequence` must be the same resampled sequence the event frames index into.
    """
    config = config or MetricConfig()

    address = events.frame_of(SwingEvent.ADDRESS)
    top = events.frame_of(SwingEvent.TOP)
    impact = events.frame_of(SwingEvent.IMPACT)
    finish = events.frame_of(SwingEvent.FINISH)

    if finish - address < config.min_swing_frames:
        return NoReading(
            reason=(
                f"address to finish spans {finish - address} frames, fewer than the "
                f"{config.min_swing_frames} needed to measure anything"
            ),
            source="metrics",
        )

    window = slice(address, finish + 1)
    detected = (
        sequence.detected[window]
        if sequence.detected is not None
        else np.ones(finish + 1 - address, dtype=bool)
    )
    detection_rate = float(np.mean(detected))
    if detection_rate < config.min_detection_rate:
        return NoReading(
            reason=(
                f"a body was found in only {100 * detection_rate:.0f} percent of the "
                "frames spanning the swing"
            ),
            source="metrics",
        )

    key_landmarks = [
        Landmark.LEFT_SHOULDER,
        Landmark.RIGHT_SHOULDER,
        Landmark.LEFT_HIP,
        Landmark.RIGHT_HIP,
    ]
    key_visibility = float(np.mean(sequence.visibility[window][:, [int(k) for k in key_landmarks]]))
    if key_visibility < config.min_key_visibility:
        return NoReading(
            reason=(
                f"shoulders and hips averaged {key_visibility:.2f} confidence across the "
                "swing, too low to measure rotation or movement from"
            ),
            source="metrics",
        )

    times = sequence.timestamps_s

    def time_at(event: SwingEvent) -> float:
        """Time of an event, interpolated between frames where the decoder refined it."""
        position = events.position_of(event)
        lower = int(np.floor(position))
        upper = min(lower + 1, len(times) - 1)
        fraction = position - lower
        return float(times[lower] + fraction * (times[upper] - times[lower]))

    backswing_s = time_at(SwingEvent.TOP) - time_at(SwingEvent.ADDRESS)
    downswing_s = time_at(SwingEvent.IMPACT) - time_at(SwingEvent.TOP)
    swing_s = time_at(SwingEvent.FINISH) - time_at(SwingEvent.ADDRESS)

    if downswing_s <= 0.0:
        return NoReading(reason="downswing has no duration", source="metrics")

    coords, scale, roll = normalise_pose(sequence, FeatureConfig())

    # Body movement needs a reference that does not move, and the pelvis is not
    # one - the normalised coordinates are centred on it, so its own displacement
    # is zero by construction. The feet are the only fixed thing in a golf swing,
    # so sway, lift and head movement are measured against the ankles. When the
    # feet are out of shot there is no such reference, and the honest answer is
    # that these cannot be measured rather than a number relative to a moving hip.
    ankle_visibility = float(
        np.mean(
            sequence.visibility[window][:, [int(Landmark.LEFT_ANKLE), int(Landmark.RIGHT_ANKLE)]]
        )
    )
    feet_in_shot = ankle_visibility >= config.min_key_visibility
    if feet_in_shot:
        square = sequence.square_xy().astype(np.float64)
        ankles = 0.5 * (square[:, int(Landmark.LEFT_ANKLE)] + square[:, int(Landmark.RIGHT_ANKLE)])
        grounded = (square - ankles[:, None, :]) / scale
        if roll != 0.0:
            cos, sin = np.cos(-roll), np.sin(-roll)
            grounded = grounded @ np.array([[cos, -sin], [sin, cos]]).T
    else:
        grounded = None

    shoulder_line = coords[:, int(Landmark.LEFT_SHOULDER)] - coords[:, int(Landmark.RIGHT_SHOULDER)]
    hip_line = coords[:, int(Landmark.LEFT_HIP)] - coords[:, int(Landmark.RIGHT_HIP)]
    shoulder_angle = _angle_series(shoulder_line.astype(np.float64))
    hip_angle = _angle_series(hip_line.astype(np.float64))

    shoulder_turn = _line_tilt_change(shoulder_angle, address, top)
    hip_turn = _line_tilt_change(hip_angle, address, top)

    projected_note = (
        "measured in the image plane, so it is a projection of the real turn and "
        "depends on where the camera stood",
    )
    projection_provenance = Provenance.PROJECTED

    swing_window = slice(address, min(finish + 1, sequence.n_frames))

    world_depth_usable = False
    shoulder_turn_3d: Reading = NoReading(
        reason="the pose estimator returned no three-dimensional landmarks", source="pose"
    )
    hip_turn_3d: Reading = shoulder_turn_3d
    separation_3d: Reading = shoulder_turn_3d
    if sequence.world_xyz is not None and np.any(sequence.world_xyz):
        world = sequence.world_xyz
        rigid, variation = world_landmarks_are_rigid(
            world, swing_window, config.max_world_length_variation
        )
        if not rigid:
            refusal = NoReading(
                reason=(
                    "the estimator's three-dimensional output does not hold the body "
                    f"together - the shoulder or hip line changed length by "
                    f"{100 * variation:.0f} percent during the swing, and a bone does "
                    "not do that. Any angle taken from it would be describing the same "
                    "error"
                ),
                source="pose",
            )
            shoulder_turn_3d = hip_turn_3d = separation_3d = refusal
        else:
            world_depth_usable = True
            shoulder_3d = _rotation_about_vertical(
                world, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER
            )
            hip_3d = _rotation_about_vertical(world, Landmark.LEFT_HIP, Landmark.RIGHT_HIP)
            estimate_note = (
                "from the pose estimator's inferred depth, which is a network's opinion "
                "about a single view rather than a triangulated measurement",
            )
            shoulder_turn_3d = _reading(
                abs(shoulder_3d[top] - shoulder_3d[address]),
                "deg",
                Provenance.ESTIMATED_3D,
                "pose",
                estimate_note,
            )
            hip_turn_3d = _reading(
                abs(hip_3d[top] - hip_3d[address]),
                "deg",
                Provenance.ESTIMATED_3D,
                "pose",
                estimate_note,
            )
            separation_3d = _reading(
                abs((shoulder_3d[top] - shoulder_3d[address]) - (hip_3d[top] - hip_3d[address])),
                "deg",
                Provenance.ESTIMATED_3D,
                "pose",
                estimate_note,
            )

    # Turn measured from foreshortening. This is the one rotation measure that a
    # single uncalibrated camera can genuinely support, so it is computed whether
    # or not the estimator's depth output survived the check above.
    square = sequence.square_xy().astype(np.float64)
    fore_note = (
        "from how much the shoulder line foreshortens, so it is the angle away from "
        "square to the camera and carries no sign - a turn towards the camera and a "
        "turn away look identical",
    )
    shoulder_turn_foreshortened: Reading = NoReading(
        reason="the shoulders were never seen clearly enough to measure foreshortening",
        source="pose",
    )
    hip_turn_foreshortened: Reading = NoReading(
        reason="the hips were never seen clearly enough to measure foreshortening",
        source="pose",
    )
    shoulder_fore = turn_from_foreshortening(
        square,
        sequence.visibility,
        Landmark.LEFT_SHOULDER,
        Landmark.RIGHT_SHOULDER,
        swing_window,
        top,
        config.min_key_visibility,
    )
    hip_fore = turn_from_foreshortening(
        square,
        sequence.visibility,
        Landmark.LEFT_HIP,
        Landmark.RIGHT_HIP,
        swing_window,
        top,
        config.min_key_visibility,
    )
    if shoulder_fore is not None:
        shoulder_turn_foreshortened = _reading(
            shoulder_fore, "deg", Provenance.PROJECTED, "pose", fore_note
        )
    if hip_fore is not None:
        hip_turn_foreshortened = _reading(hip_fore, "deg", Provenance.PROJECTED, "pose", fore_note)

    body_note = (
        "in units of the golfer's own body length, so it needs no calibration and "
        "cannot be converted to centimetres without one",
    )
    no_reference = NoReading(
        reason=(
            "the feet are not in shot, so there is no fixed reference to measure body "
            "movement against; the hips cannot serve as one because they move"
        ),
        source="pose",
    )
    head_reading: Reading = no_reference
    sway_reading: Reading = no_reference
    lift_reading: Reading = no_reference
    if grounded is not None:
        head_g = 0.5 * (grounded[:, int(Landmark.LEFT_EAR)] + grounded[:, int(Landmark.RIGHT_EAR)])
        pelvis_g = 0.5 * (
            grounded[:, int(Landmark.LEFT_HIP)] + grounded[:, int(Landmark.RIGHT_HIP)]
        )
        head_reading = _reading(
            float(np.linalg.norm(head_g[impact] - head_g[address])),
            "body lengths",
            Provenance.PROJECTED,
            "pose",
            body_note,
        )
        sway_reading = _reading(
            float(abs(pelvis_g[impact, 0] - pelvis_g[address, 0])),
            "body lengths",
            Provenance.PROJECTED,
            "pose",
            body_note,
        )
        lift_reading = _reading(
            float(abs(pelvis_g[impact, 1] - pelvis_g[address, 1])),
            "body lengths",
            Provenance.PROJECTED,
            "pose",
            body_note,
        )

    hands = 0.5 * (coords[:, int(Landmark.LEFT_WRIST)] + coords[:, int(Landmark.RIGHT_WRIST)])
    dt = np.gradient(times)
    hand_speed = np.linalg.norm(np.gradient(hands.astype(np.float64), axis=0) / dt[:, None], axis=1)
    downswing_window = slice(top, impact + 1)
    peak_hand_frame = top + int(
        np.argmax(_smooth(hand_speed, config.velocity_smoothing_frames)[downswing_window])
    )

    lead_arm = coords[:, int(handedness.lead_wrist)] - coords[:, int(handedness.lead_shoulder)]
    arm_angle = _angle_series(lead_arm.astype(np.float64))

    # Angular velocities are read from the estimator's three-dimensional output
    # where it exists. The projected angles are unusable for this: viewed down the
    # line the shoulder line is nearly edge-on, so its apparent angle is dominated
    # by whichever way the noise pushed it, and the ordering of the peaks becomes
    # close to random. Which source was used is reported, because they are not
    # equally trustworthy.
    # The kinematic sequence must come from the same judgement as the rotation
    # metrics. Refusing to report a turn because the estimator's depth output does
    # not hold the body together, and then in the next breath ordering the body's
    # segments using that same output, would be incoherent - and the ordering is
    # the more delicate of the two, because it turns on differences of tens of
    # milliseconds between three tracks.
    if sequence.world_xyz is not None and np.any(sequence.world_xyz) and world_depth_usable:
        world = sequence.world_xyz
        lead_arm_3d = (
            world[:, int(handedness.lead_wrist), :] - world[:, int(handedness.lead_shoulder), :]
        )
        segments = {
            "pelvis": _rotation_about_vertical(world, Landmark.LEFT_HIP, Landmark.RIGHT_HIP),
            "thorax": _rotation_about_vertical(
                world, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER
            ),
            "lead arm": np.degrees(
                np.unwrap(np.arctan2(lead_arm_3d[:, 1], lead_arm_3d[:, 0]).astype(np.float64))
            ),
        }
        sequence_source = "estimated_3d"
    else:
        segments = {
            "pelvis": hip_angle,
            "thorax": shoulder_angle,
            "lead arm": arm_angle,
        }
        sequence_source = "projected"
    peak_times: dict[str, float] = {}
    for name, track in segments.items():
        angular_speed = np.abs(_smooth(np.gradient(track) / dt, config.velocity_smoothing_frames))
        peak_frame = top + int(np.argmax(angular_speed[downswing_window]))
        peak_times[name] = float(1000.0 * (times[peak_frame] - times[impact]))

    order = tuple(sorted(peak_times, key=lambda name: peak_times[name]))

    return SwingMetrics(
        tempo_ratio=_reading(backswing_s / downswing_s, "", Provenance.DERIVED, "events"),
        backswing_duration=_reading(1000.0 * backswing_s, "ms", Provenance.MEASURED, "events"),
        downswing_duration=_reading(1000.0 * downswing_s, "ms", Provenance.MEASURED, "events"),
        swing_duration=_reading(1000.0 * swing_s, "ms", Provenance.MEASURED, "events"),
        time_to_peak_hand_speed=_reading(
            1000.0 * float(times[peak_hand_frame] - times[impact]),
            "ms",
            Provenance.MEASURED,
            "pose",
        ),
        shoulder_turn_projected=_reading(
            abs(shoulder_turn), "deg", projection_provenance, "pose", projected_note
        ),
        hip_turn_projected=_reading(
            abs(hip_turn), "deg", projection_provenance, "pose", projected_note
        ),
        separation_projected=_reading(
            abs(shoulder_turn - hip_turn), "deg", projection_provenance, "pose", projected_note
        ),
        shoulder_turn_foreshortened=shoulder_turn_foreshortened,
        hip_turn_foreshortened=hip_turn_foreshortened,
        shoulder_turn_3d=shoulder_turn_3d,
        hip_turn_3d=hip_turn_3d,
        separation_3d=separation_3d,
        head_movement=head_reading,
        pelvis_sway=sway_reading,
        pelvis_lift=lift_reading,
        kinematic_sequence=order,
        kinematic_peak_times_ms=peak_times,
        kinematic_sequence_source=sequence_source,
        low_confidence_events=tuple(sorted(e.label for e in CLUB_DEFINED_EVENTS)),
        detection_rate=detection_rate,
        frames_analysed=int(finish - address + 1),
    )
