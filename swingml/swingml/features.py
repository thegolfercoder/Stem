"""Turning landmarks into something a model can learn from, with no calibration.

Three problems have to be solved before a temporal model sees anything, and all
three come from the fact that the input is a handheld phone rather than a rig.

**Frame rate.** The same swing shot at 30, 60 or 240 frames per second is the
same swing, but a temporal convolution's receptive field is counted in frames, so
to the model it is three different events lasting three different lengths. Every
sequence is therefore resampled onto a canonical rate on its *real timestamp*
axis before anything else happens, and predictions are mapped back afterwards.
This is what lets one model handle normal video and iPhone slow-motion without
being told which it is looking at.

**Scale and position.** The golfer might fill the frame or occupy a third of it,
and might stand anywhere in it. Landmarks are recentred on the pelvis and divided
by a body length measured from the golfer themselves, so the features describe a
shape rather than a placement. Nothing here needs to know the focal length, the
distance, or anything else about the camera - which is the point.

**Camera roll.** A phone propped against a bag sits at whatever angle it sits at,
and that angle rotates every landmark. The median body axis over the clip is
rotated to vertical, which removes the camera's roll while leaving the golfer's
own tilt, because their tilt varies through the swing and the camera's does not.

What is deliberately *not* removed is anything that would take real information
with it. No rotation about the vertical is applied, because the camera's viewing
direction relative to the golfer is exactly what decides whether a projected
angle means anything, and pretending otherwise would hide it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.pose.base import PoseSequence
from swingml.skeleton import (
    SWING_LANDMARK_INDICES,
    Handedness,
    Landmark,
)

CANONICAL_RATE_HZ = 60.0
"""The rate every sequence is resampled to before the model sees it.

Chosen so that a swing of ordinary length lands in the low hundreds of frames:
fast enough that impact, which is over in a couple of milliseconds, is not
smeared across the sampling grid, and slow enough that the temporal model's
receptive field spans a whole swing without needing to be enormous.
"""


class FeatureConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    canonical_rate_hz: float = CANONICAL_RATE_HZ
    normalise_roll: bool = Field(
        default=True, description="Rotate the median body axis to vertical."
    )
    min_visibility: float = Field(
        default=0.3,
        description=(
            "Confidence below which a landmark is treated as unobserved when "
            "estimating the body scale and axis. It is not below which the landmark "
            "is discarded: the model is given the confidence channel and can learn "
            "what to do with a doubtful joint itself."
        ),
    )


def resample_pose(
    sequence: PoseSequence, rate_hz: float
) -> tuple[PoseSequence, NDArray[np.float64]]:
    """Resample onto a uniform grid at `rate_hz`, using the real frame times.

    Returns the resampled sequence and the uniform time grid, which is what maps
    a predicted frame index back to a time and thence to an original frame.

    Linear interpolation is used rather than anything smoother on purpose. A
    higher-order interpolant overshoots at the sharp reversal at the top of the
    backswing and at impact, which are precisely the instants the model is being
    asked to find.
    """
    if sequence.n_frames < 2:
        return sequence, sequence.timestamps_s.copy()

    t_source = sequence.timestamps_s
    duration = float(t_source[-1] - t_source[0])
    n_out = max(2, round(duration * rate_hz) + 1)
    t_target = t_source[0] + np.arange(n_out, dtype=np.float64) / rate_hz
    t_target = np.clip(t_target, t_source[0], t_source[-1])

    def interp(values: NDArray[np.floating]) -> NDArray[np.float32]:
        flat = values.reshape(values.shape[0], -1)
        out = np.empty((n_out, flat.shape[1]), dtype=np.float32)
        for channel in range(flat.shape[1]):
            out[:, channel] = np.interp(t_target, t_source, flat[:, channel])
        return out.reshape((n_out, *values.shape[1:]))

    detected: NDArray[np.bool_] | None = None
    if sequence.detected is not None:
        # A frame is only counted as detected if the frames it was interpolated
        # from were. Nearest-neighbour, so a gap cannot be filled by averaging.
        nearest = np.searchsorted(t_source, t_target).clip(0, sequence.n_frames - 1)
        detected = sequence.detected[nearest]

    return (
        PoseSequence(
            xy=interp(sequence.xy),
            visibility=interp(sequence.visibility),
            timestamps_s=t_target,
            frame_width=sequence.frame_width,
            frame_height=sequence.frame_height,
            world_xyz=None if sequence.world_xyz is None else interp(sequence.world_xyz),
            detected=detected,
        ),
        t_target,
    )


def _midpoint(xy: NDArray[np.float32], a: Landmark, b: Landmark) -> NDArray[np.float32]:
    return 0.5 * (xy[:, int(a)] + xy[:, int(b)])


def body_scale(
    square_xy: NDArray[np.float32], visibility: NDArray[np.float32], min_visibility: float
) -> float:
    """A length taken from the golfer, used to make everything else dimensionless.

    Shoulder-centre to ankle-centre is used because it is the measurement that
    changes least through a swing. Shoulder width foreshortens dramatically as the
    body turns, and torso length shortens as the spine tilts; standing height does
    neither until the finish. The median over the clip is taken rather than the
    mean so that the finish position, and any frame where the legs were missed,
    cannot drag it.

    Falls back to torso length, scaled by a fixed anthropometric ratio, when the
    feet are not in shot - which is common, because people film swings in portrait
    and cut the feet off.
    """
    shoulders = _midpoint(square_xy, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER)
    hips = _midpoint(square_xy, Landmark.LEFT_HIP, Landmark.RIGHT_HIP)
    ankles = _midpoint(square_xy, Landmark.LEFT_ANKLE, Landmark.RIGHT_ANKLE)

    ankle_visible = (
        np.minimum(
            visibility[:, int(Landmark.LEFT_ANKLE)], visibility[:, int(Landmark.RIGHT_ANKLE)]
        )
        >= min_visibility
    )
    if np.count_nonzero(ankle_visible) >= max(3, 0.25 * len(ankle_visible)):
        heights = np.linalg.norm(shoulders - ankles, axis=1)[ankle_visible]
        scale = float(np.median(heights))
        if scale > 1e-6:
            return scale

    torso = np.linalg.norm(shoulders - hips, axis=1)
    torso_median = float(np.median(torso))
    # Shoulder-to-ankle is roughly three times shoulder-to-hip on an adult. This
    # keeps the two paths on a comparable scale so a model trained on clips with
    # feet in shot still works on clips without; it is a rough anthropometric
    # ratio, not a measurement of this golfer.
    return max(torso_median * 3.0, 1e-6)


def body_axis_angle(
    square_xy: NDArray[np.float32], visibility: NDArray[np.float32], min_visibility: float
) -> float:
    """Median angle of the golfer's long axis, which is taken to be the camera's roll.

    Over a whole swing the golfer's own lean swings one way and then the other,
    so its median is close to upright; whatever offset remains is the camera's.
    Separating the two perfectly would need to know one of them independently, and
    nothing here does, so this is an assumption rather than a measurement - a good
    one for a clip containing one swing and a poor one for a clip of somebody
    leaning on their club between shots.
    """
    shoulders = _midpoint(square_xy, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER)
    hips = _midpoint(square_xy, Landmark.LEFT_HIP, Landmark.RIGHT_HIP)
    axis = shoulders - hips
    usable = (
        np.minimum(
            visibility[:, int(Landmark.LEFT_SHOULDER)], visibility[:, int(Landmark.RIGHT_SHOULDER)]
        )
        >= min_visibility
    )
    if not np.any(usable):
        usable = np.ones(len(axis), dtype=bool)
    # Image y runs downward, so an upright body has a negative y component.
    angles = np.arctan2(axis[usable, 0], -axis[usable, 1])
    return float(np.median(angles))


def normalise_pose(
    sequence: PoseSequence, config: FeatureConfig
) -> tuple[NDArray[np.float32], float, float]:
    """Recentre, rescale and de-roll the landmarks. Returns coords, scale, roll.

    The output is in units of body length with the pelvis at the origin, so it
    describes a posture and carries nothing about where the camera was or how far
    away it stood.
    """
    square = sequence.square_xy()
    scale = body_scale(square, sequence.visibility, config.min_visibility)
    roll = (
        body_axis_angle(square, sequence.visibility, config.min_visibility)
        if config.normalise_roll
        else 0.0
    )

    pelvis = _midpoint(square, Landmark.LEFT_HIP, Landmark.RIGHT_HIP)
    centred = (square - pelvis[:, None, :]) / scale

    if roll != 0.0:
        cos, sin = np.cos(-roll), np.sin(-roll)
        rotation = np.array([[cos, -sin], [sin, cos]], dtype=np.float32)
        centred = centred @ rotation.T

    return centred.astype(np.float32), scale, roll


def _angle_channels(vectors: NDArray[np.float32]) -> NDArray[np.float32]:
    """Sine and cosine of a direction, so the model never sees a wrap discontinuity.

    Feeding an angle in radians to a network puts a seam at plus and minus pi that
    the network has to learn to ignore, and the seam sits in the middle of the
    backswing for a rotating shoulder line.
    """
    norm = np.linalg.norm(vectors, axis=-1, keepdims=True)
    unit = vectors / np.maximum(norm, 1e-6)
    return np.asarray(unit, dtype=np.float32)


def extract_features(
    sequence: PoseSequence, handedness: Handedness, config: FeatureConfig | None = None
) -> NDArray[np.float32]:
    """The per-frame feature matrix, shape (T, F).

    Positions and velocities of the landmarks that matter to a swing, their
    confidences, and a handful of angles that a network would otherwise have to
    spend capacity rediscovering: the shoulder line, the hip line, the separation
    between them, the arms and the spine.

    Velocities are in body lengths per second, computed from the real time grid,
    so they mean the same thing whatever the clip's frame rate.
    """
    config = config or FeatureConfig()
    coords, _, _ = normalise_pose(sequence, config)
    times = sequence.timestamps_s

    selected = coords[:, SWING_LANDMARK_INDICES, :]
    visibility = sequence.visibility[:, SWING_LANDMARK_INDICES]

    dt = np.gradient(times)
    velocity = np.gradient(selected, axis=0) / dt[:, None, None]
    speed = np.linalg.norm(velocity, axis=-1)

    shoulder_line = coords[:, int(Landmark.LEFT_SHOULDER)] - coords[:, int(Landmark.RIGHT_SHOULDER)]
    hip_line = coords[:, int(Landmark.LEFT_HIP)] - coords[:, int(Landmark.RIGHT_HIP)]
    spine = _midpoint(coords, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER) - _midpoint(
        coords, Landmark.LEFT_HIP, Landmark.RIGHT_HIP
    )
    lead_arm = coords[:, int(handedness.lead_wrist)] - coords[:, int(handedness.lead_shoulder)]
    trail_arm = coords[:, int(handedness.trail_wrist)] - coords[:, int(handedness.trail_shoulder)]

    hands = _midpoint(coords, Landmark.LEFT_WRIST, Landmark.RIGHT_WRIST)
    shoulder_centre = _midpoint(coords, Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER)
    hands_relative = hands - shoulder_centre
    hand_velocity = np.gradient(hands, axis=0) / dt[:, None]
    hand_speed = np.linalg.norm(hand_velocity, axis=-1)

    # Apparent width of the shoulder and hip lines. As the golfer turns away from
    # the camera these foreshorten, which is the single most informative signal
    # about rotation available without knowing where the camera is.
    shoulder_width = np.linalg.norm(shoulder_line, axis=-1)
    hip_width = np.linalg.norm(hip_line, axis=-1)

    blocks = [
        selected.reshape(len(times), -1),
        velocity.reshape(len(times), -1),
        speed,
        visibility,
        _angle_channels(shoulder_line),
        _angle_channels(hip_line),
        _angle_channels(spine),
        _angle_channels(lead_arm),
        _angle_channels(trail_arm),
        hands_relative,
        hand_velocity,
        hand_speed[:, None],
        shoulder_width[:, None],
        hip_width[:, None],
        np.linalg.norm(lead_arm, axis=-1)[:, None],
    ]
    features = np.concatenate([np.asarray(b, dtype=np.float32) for b in blocks], axis=1)
    cleaned = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
    return np.asarray(cleaned, dtype=np.float32)


def feature_dimension() -> int:
    """Width of the feature matrix, so the model can be built before any data exists."""
    n = len(SWING_LANDMARK_INDICES)
    return n * 2 + n * 2 + n + n + 2 * 5 + 2 + 2 + 1 + 1 + 1 + 1
