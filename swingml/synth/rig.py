"""An articulated golfer, driven by the geometry a golf swing actually has.

The hands do not wander. Through most of a swing they travel close to a circle
lying on an inclined plane that passes through the upper chest and through the
ball, and the club extends from the hands along that same plane, hinged at the
wrists. Almost everything else follows: the arms are whatever reaches the hands,
the shoulders and hips turn about the spine, and the legs are whatever connects a
turning pelvis to feet that stay where they were put.

Building the rig this way rather than animating joint angles independently buys
the thing that matters most here - the club is in a *known* place in every frame,
so the two events defined by the shaft being horizontal have exact ground truth
rather than a guess. It also means an implausible swing is hard to generate by
accident, because the constraints are geometric rather than cosmetic.

Segment lengths are adult averages in metres. They are varied per golfer by the
generator, and none of them is a measurement of anybody.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.skeleton import NUM_LANDMARKS, Landmark

UP = np.array([0.0, 1.0, 0.0])
"""World axes: X runs down the target line, Y is up, Z points from the ball back
toward the golfer. A right-handed golfer stands at positive Z and hits toward
positive X."""


class BodyProportions(BaseModel):
    """Segment lengths in metres."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    pelvis_height_m: float = 0.88
    """Hip joint above the ground. Bounded above by the legs' reach: the ankles are
    planted, the pelvis rises through the finish, and a pelvis set too high leaves
    the legs unable to reach the feet at the top of that rise."""
    hip_width_m: float = 0.32
    shoulder_width_m: float = 0.42
    torso_length_m: float = 0.50
    neck_length_m: float = 0.24
    head_radius_m: float = 0.10
    upper_arm_m: float = 0.33
    forearm_m: float = 0.40
    """Elbow to the grip, so it includes the hand. Measuring to the wrist and then
    asking the arm to reach a club leaves it permanently over-extended."""
    thigh_m: float = 0.46
    shin_m: float = 0.45
    foot_length_m: float = 0.25
    stance_width_m: float = 0.42
    ankle_height_m: float = 0.08
    """Ankle above the ground. Scales with the rest of the body: left as a constant
    it makes a small golfer proportionally longer in the shin than a large one."""
    club_length_m: float = 1.10


class SwingGeometry(BaseModel):
    """The shape of one golfer's swing, independent of how fast they do it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    plane_inclination_deg: float = Field(
        default=55.0,
        description=(
            "Tilt of the swing plane from the ground. Shallower for a driver, steeper for a wedge."
        ),
    )
    hand_radius_m: float = Field(
        default=0.52,
        description=(
            "Hub to hands on the swing plane. Bounded above by the arms' reach: the "
            "hub sits between the shoulders, so each shoulder is about a fifth of a "
            "metre off-axis and the true shoulder-to-grip distance runs well above "
            "this figure at the extremes of the swing."
        ),
    )
    spine_tilt_deg: float = Field(default=30.0, description="Forward bend at address.")
    address_phase_deg: float = Field(
        default=6.0, description="Hand angle at address; positive puts the hands ahead of the ball."
    )
    top_phase_deg: float = Field(default=-168.0, description="Hand angle at the top.")
    finish_phase_deg: float = Field(default=168.0, description="Hand angle at the finish.")
    max_wrist_hinge_deg: float = Field(default=88.0)
    lag_retention: float = Field(
        default=0.55,
        ge=0.0,
        le=1.0,
        description=(
            "How much of the wrist hinge survives into the downswing before release. "
            "Higher means the hinge is held later."
        ),
    )
    pelvis_turn_top_deg: float = Field(default=-42.0)
    pelvis_turn_impact_deg: float = Field(default=38.0)
    pelvis_turn_finish_deg: float = Field(default=78.0)
    thorax_turn_top_deg: float = Field(default=-92.0)
    thorax_turn_impact_deg: float = Field(default=28.0)
    thorax_turn_finish_deg: float = Field(default=112.0)
    sway_amplitude_m: float = Field(default=0.05, description="Lateral pelvis travel.")
    lift_amplitude_m: float = Field(default=0.03, description="Vertical pelvis travel.")
    head_drift_m: float = Field(default=0.04)
    sequence_lead_ms: float = Field(
        default=45.0,
        description=(
            "How far ahead of the thorax the pelvis reaches its peak rotation speed. "
            "An efficient swing unwinds from the ground up, the heavier and slower "
            "segments leading the lighter and faster ones. Without this the generated "
            "pelvis and thorax peak together, and a metric that reports their ordering "
            "would have nothing real to recover."
        ),
    )


def _rodrigues(
    vectors: NDArray[np.float64], axis: NDArray[np.float64], angle: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Rotate `vectors` about a unit `axis` by a per-frame `angle`."""
    axis = axis / np.linalg.norm(axis)
    cos = np.cos(angle)[:, None]
    sin = np.sin(angle)[:, None]
    dot = vectors @ axis
    return (
        vectors * cos
        + np.cross(np.broadcast_to(axis, vectors.shape), vectors) * sin
        + np.broadcast_to(axis, vectors.shape) * (dot * (1.0 - np.cos(angle)))[:, None]
    )


def _two_link_ik(
    root: NDArray[np.float64],
    target: NDArray[np.float64],
    length_a: float,
    length_b: float,
    pole: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Position of the middle joint of a two-segment chain reaching from root to target.

    The chain is over-determined by one degree of freedom - an elbow can rotate
    about the line from shoulder to hand - so a pole direction picks which of the
    possible bends is used. Out-of-reach targets are clamped rather than raising:
    a generated pose that stretches slightly beyond the arm's length should
    straighten the arm, not stop the run.
    """
    delta = target - root
    distance = np.linalg.norm(delta, axis=1, keepdims=True)
    reach = np.clip(distance, 1e-6, length_a + length_b - 1e-6)
    direction = delta / np.maximum(distance, 1e-9)

    # Distance from root to the foot of the perpendicular through the middle joint.
    along = (reach**2 + length_a**2 - length_b**2) / (2.0 * reach)
    height = np.sqrt(np.maximum(length_a**2 - along**2, 0.0))

    pole = pole / np.linalg.norm(pole)
    perpendicular = np.broadcast_to(pole, direction.shape) - direction * (direction @ pole)[:, None]
    norm = np.linalg.norm(perpendicular, axis=1, keepdims=True)
    fallback = np.broadcast_to(UP, direction.shape) - direction * (direction @ UP)[:, None]
    perpendicular = np.where(norm > 1e-6, perpendicular, fallback)
    perpendicular = perpendicular / np.maximum(
        np.linalg.norm(perpendicular, axis=1, keepdims=True), 1e-9
    )

    return np.asarray(root + direction * along + perpendicular * height)


class RigPose(BaseModel):
    """One swing's worth of three-dimensional landmarks, plus the club."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    landmarks_xyz: NDArray[np.float64] = Field(description="(T, 33, 3) world metres.")
    hands_xyz: NDArray[np.float64]
    clubhead_xyz: NDArray[np.float64]
    shaft_direction: NDArray[np.float64] = Field(description="(T, 3) unit vector hands to head.")
    hand_phase_rad: NDArray[np.float64]
    wrist_hinge_rad: NDArray[np.float64]
    ball_xyz: NDArray[np.float64]


def build_rig_pose(
    hand_phase_rad: NDArray[np.float64],
    wrist_hinge_rad: NDArray[np.float64],
    pelvis_turn_rad: NDArray[np.float64],
    thorax_turn_rad: NDArray[np.float64],
    sway_m: NDArray[np.float64],
    lift_m: NDArray[np.float64],
    head_drift_m: NDArray[np.float64],
    body: BodyProportions,
    geometry: SwingGeometry,
    left_handed: bool = False,
) -> RigPose:
    """Assemble the full landmark set for every frame from the driving signals."""
    n = len(hand_phase_rad)
    mirror = -1.0 if left_handed else 1.0

    tilt = np.radians(geometry.spine_tilt_deg)
    spine_axis = np.array([0.0, np.cos(tilt), np.sin(tilt)])
    spine_axis /= np.linalg.norm(spine_axis)

    pelvis = np.zeros((n, 3))
    pelvis[:, 0] = sway_m * mirror
    pelvis[:, 1] = body.pelvis_height_m + lift_m
    pelvis[:, 2] = 0.0

    shoulder_centre = pelvis + spine_axis * body.torso_length_m

    # Shoulder and hip lines start along the target line. The thorax turns about
    # the spine, which is tilted forward; the pelvis turns about the vertical,
    # because the hips stay level as they rotate. Turning the pelvis about the
    # tilted axis too swings the hips up, down and fore-and-aft far enough that
    # the legs can no longer reach the feet.
    base_line = np.tile(np.array([1.0, 0.0, 0.0]), (n, 1))
    shoulder_dir = _rodrigues(base_line, spine_axis, thorax_turn_rad * mirror)
    hip_dir = _rodrigues(base_line, UP, pelvis_turn_rad * mirror)

    left_shoulder = shoulder_centre + shoulder_dir * (body.shoulder_width_m / 2.0)
    right_shoulder = shoulder_centre - shoulder_dir * (body.shoulder_width_m / 2.0)
    left_hip = pelvis + hip_dir * (body.hip_width_m / 2.0)
    right_hip = pelvis - hip_dir * (body.hip_width_m / 2.0)

    # The swing plane: spanned by the target line and a direction tilted back
    # toward the golfer. The hub sits at the top of the chest.
    alpha = np.radians(geometry.plane_inclination_deg)
    plane_down = np.array([0.0, -np.sin(alpha), -np.cos(alpha)])
    plane_along = np.array([mirror, 0.0, 0.0])
    # The hub sits between the shoulders. Hanging the arc off the lead shoulder
    # instead puts the grip out of the trail arm's reach even at address, because
    # both hands are on the same grip roughly below the sternum.
    hub = shoulder_centre.copy()

    cos_phase = np.cos(hand_phase_rad)[:, None]
    sin_phase = np.sin(hand_phase_rad)[:, None]
    hands = hub + geometry.hand_radius_m * (cos_phase * plane_down + sin_phase * plane_along)

    # The hinge folds the club *back* from the arm's line, so it subtracts. With
    # the opposite sign the shaft never passes through horizontal at all, and the
    # two events defined by a horizontal shaft cease to exist.
    shaft_angle = hand_phase_rad - wrist_hinge_rad
    shaft = np.cos(shaft_angle)[:, None] * plane_down + np.sin(shaft_angle)[:, None] * plane_along
    shaft /= np.linalg.norm(shaft, axis=1, keepdims=True)
    clubhead = hands + shaft * body.club_length_m

    # The ball sits wherever the clubhead is at address, by construction, so the
    # geometry cannot drift into a swing that misses its own ball.
    ball = clubhead[0].copy()

    # Wrists sit a little either side of the hand centre, along the shoulder line.
    wrist_offset = shoulder_dir * 0.045
    left_wrist = hands + wrist_offset
    right_wrist = hands - wrist_offset

    elbow_pole = -spine_axis - np.array([0.0, 0.0, 0.6])
    left_elbow = _two_link_ik(
        left_shoulder, left_wrist, body.upper_arm_m, body.forearm_m, elbow_pole
    )
    right_elbow = _two_link_ik(
        right_shoulder, right_wrist, body.upper_arm_m, body.forearm_m, elbow_pole
    )

    # Feet stay put. Knees bend forward, toward the ball.
    half_stance = body.stance_width_m / 2.0
    left_ankle = np.tile(np.array([mirror * half_stance, body.ankle_height_m, 0.0]), (n, 1))
    right_ankle = np.tile(np.array([-mirror * half_stance, body.ankle_height_m, 0.0]), (n, 1))
    knee_pole = np.array([0.0, 0.0, -1.0])
    left_knee = _two_link_ik(left_hip, left_ankle, body.thigh_m, body.shin_m, knee_pole)
    right_knee = _two_link_ik(right_hip, right_ankle, body.thigh_m, body.shin_m, knee_pole)

    head_centre = shoulder_centre + spine_axis * body.neck_length_m
    head_centre = head_centre + np.stack([head_drift_m * mirror, np.zeros(n), np.zeros(n)], axis=1)
    face_dir = np.array([0.0, -np.sin(tilt), -np.cos(tilt)])
    nose = head_centre + face_dir * body.head_radius_m
    ear_offset = shoulder_dir * (body.head_radius_m * 0.85)

    out = np.zeros((n, NUM_LANDMARKS, 3))
    out[:, Landmark.LEFT_SHOULDER] = left_shoulder
    out[:, Landmark.RIGHT_SHOULDER] = right_shoulder
    out[:, Landmark.LEFT_ELBOW] = left_elbow
    out[:, Landmark.RIGHT_ELBOW] = right_elbow
    out[:, Landmark.LEFT_WRIST] = left_wrist
    out[:, Landmark.RIGHT_WRIST] = right_wrist
    out[:, Landmark.LEFT_HIP] = left_hip
    out[:, Landmark.RIGHT_HIP] = right_hip
    out[:, Landmark.LEFT_KNEE] = left_knee
    out[:, Landmark.RIGHT_KNEE] = right_knee
    out[:, Landmark.LEFT_ANKLE] = left_ankle
    out[:, Landmark.RIGHT_ANKLE] = right_ankle
    out[:, Landmark.NOSE] = nose
    out[:, Landmark.LEFT_EAR] = head_centre + ear_offset
    out[:, Landmark.RIGHT_EAR] = head_centre - ear_offset

    # Hands beyond the wrist, and the small face and foot landmarks, are placed by
    # fixed offsets. They carry little information but the schema has slots for
    # them and downstream code should never meet a hole.
    hand_dir = shaft * 0.09
    out[:, Landmark.LEFT_INDEX] = left_wrist + hand_dir
    out[:, Landmark.RIGHT_INDEX] = right_wrist + hand_dir
    out[:, Landmark.LEFT_PINKY] = left_wrist + hand_dir * 0.8 + wrist_offset * 0.5
    out[:, Landmark.RIGHT_PINKY] = right_wrist + hand_dir * 0.8 - wrist_offset * 0.5
    out[:, Landmark.LEFT_THUMB] = left_wrist + hand_dir * 0.6
    out[:, Landmark.RIGHT_THUMB] = right_wrist + hand_dir * 0.6

    eye_offset = shoulder_dir * (body.head_radius_m * 0.35)
    for landmark, scale in (
        (Landmark.LEFT_EYE, 1.0),
        (Landmark.LEFT_EYE_INNER, 0.6),
        (Landmark.LEFT_EYE_OUTER, 1.4),
    ):
        out[:, landmark] = nose * 0.35 + head_centre * 0.65 + eye_offset * scale
    for landmark, scale in (
        (Landmark.RIGHT_EYE, 1.0),
        (Landmark.RIGHT_EYE_INNER, 0.6),
        (Landmark.RIGHT_EYE_OUTER, 1.4),
    ):
        out[:, landmark] = nose * 0.35 + head_centre * 0.65 - eye_offset * scale
    out[:, Landmark.MOUTH_LEFT] = nose + eye_offset * 0.5 - UP * 0.03
    out[:, Landmark.MOUTH_RIGHT] = nose - eye_offset * 0.5 - UP * 0.03

    toe = np.array([0.0, 0.0, -body.foot_length_m])
    heel_drop = UP * (body.ankle_height_m * 0.85)
    out[:, Landmark.LEFT_HEEL] = left_ankle - heel_drop
    out[:, Landmark.RIGHT_HEEL] = right_ankle - heel_drop
    out[:, Landmark.LEFT_FOOT_INDEX] = left_ankle - heel_drop + toe
    out[:, Landmark.RIGHT_FOOT_INDEX] = right_ankle - heel_drop + toe

    return RigPose(
        landmarks_xyz=out,
        hands_xyz=hands,
        clubhead_xyz=clubhead,
        shaft_direction=shaft,
        hand_phase_rad=hand_phase_rad,
        wrist_hinge_rad=wrist_hinge_rad,
        ball_xyz=ball,
    )
