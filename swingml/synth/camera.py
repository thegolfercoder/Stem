"""Projecting a generated swing into what a phone camera would have recorded.

A perfect three-dimensional skeleton is not what the model will meet. It will
meet the output of a pose estimator run on a handheld phone, which is a very
different object: two-dimensional, viewed from wherever somebody happened to prop
the phone, noisy in a way that is correlated from frame to frame rather than
independent, worse on the fast-moving parts, and occasionally absent entirely.

Training on clean projections and testing on that is how a model comes to look
excellent in a notebook and fail on the range. Everything modelled here is
something a pose estimator on real golf footage genuinely does.

**Camera placement.** Golfers film from two positions and rarely from either
exactly: face-on, and down the line. The azimuth is continuous so the model sees
everything in between, along with the elevation and roll a phone leaning against
a bag actually has.

**Correlated noise.** Landmark error from a pose estimator is not white. The
estimator is confidently wrong for a stretch of frames and then recovers, because
consecutive frames look alike. Independent per-frame noise is far easier to
average away than the real thing, so the noise here is low-pass filtered in time.

**Speed-dependent error.** The hands are the fastest points in the swing and they
smear. Error is scaled by each landmark's own image-plane speed, which is what
makes the frames near impact - the frames that matter most - the hardest.

**Occlusion.** A golfer viewed down the line hides one arm behind their body for
much of the swing. Depth relative to the torso decides confidence, so the
estimator's confidence channel carries something real rather than a constant.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.pose.base import PoseSequence
from swingml.skeleton import FAST_LANDMARKS, NUM_LANDMARKS, Landmark
from synth.swing import GeneratedSwing

UP_AXIS = np.array([0.0, 1.0, 0.0])


class CameraConfig(BaseModel):
    """Where the phone is and what it sees."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    azimuth_deg: float = Field(
        default=90.0,
        description=(
            "Position around the golfer. Zero looks at them face-on from the far "
            "side of the ball; ninety is down the line, behind them looking at the "
            "target. Everything between is a phone that was not placed carefully."
        ),
    )
    elevation_deg: float = Field(
        default=8.0, description="Height of the camera above the golfer's centre, as an angle."
    )
    distance_m: float = Field(default=4.0)
    roll_deg: float = Field(default=0.0, description="Camera tilt about its own axis.")
    frame_width: int = 1080
    frame_height: int = 1920
    vertical_fov_deg: float = Field(
        default=60.0, description="Sets the focal length together with the frame height."
    )
    look_at_height_m: float = Field(default=1.2, description="Height the camera is aimed at.")

    @property
    def focal_px(self) -> float:
        return float(0.5 * self.frame_height / np.tan(np.radians(self.vertical_fov_deg) / 2.0))


class NoiseConfig(BaseModel):
    """How badly the pose estimator does, expressed the way it actually fails."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    jitter_px: float = Field(default=4.0, description="Landmark error at rest, in pixels.")
    speed_jitter_px_per_body_length: float = Field(
        default=1.6,
        description=(
            "Extra error per body length per second of image-plane speed. This is "
            "what makes impact the hardest part of the swing to localise."
        ),
    )
    fast_landmark_multiplier: float = Field(
        default=2.0, description="Extra error on hands and wrists, which blur worst."
    )
    correlation_frames: float = Field(
        default=4.0,
        description=(
            "Time constant of the noise, in frames. Zero gives white noise, which "
            "is far kinder than a real estimator and trivially smoothed away."
        ),
    )
    occlusion_visibility: float = Field(
        default=0.35, description="Confidence reported for a landmark hidden behind the body."
    )
    dropout_probability: float = Field(
        default=0.01, description="Chance per landmark per frame of a confidence collapse."
    )
    frame_loss_probability: float = Field(
        default=0.004, description="Chance per frame that no body is found at all."
    )
    timestamp_jitter_s: float = Field(
        default=0.0008, description="Variation in frame timing, as real containers have."
    )


def _look_at(
    camera_pos: NDArray[np.float64], target: NDArray[np.float64], roll_rad: float
) -> NDArray[np.float64]:
    """Rotation from world into camera axes, with x right, y down and z forward."""
    forward = target - camera_pos
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, UP_AXIS)
    if np.linalg.norm(right) < 1e-8:
        right = np.array([1.0, 0.0, 0.0])
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)

    if roll_rad != 0.0:
        cos, sin = np.cos(roll_rad), np.sin(roll_rad)
        right, down = cos * right + sin * down, -sin * right + cos * down

    return np.stack([right, down, forward], axis=0)


def _correlated_noise(
    shape: tuple[int, ...], correlation_frames: float, rng: np.random.Generator
) -> NDArray[np.float64]:
    """Unit-variance noise that drifts over `correlation_frames` rather than flickering."""
    white = rng.standard_normal(shape)
    if correlation_frames <= 1.0:
        return white
    alpha = np.exp(-1.0 / correlation_frames)
    out = np.empty_like(white)
    out[0] = white[0]
    for i in range(1, shape[0]):
        out[i] = alpha * out[i - 1] + np.sqrt(1.0 - alpha**2) * white[i]
    return out


def render_pose_sequence(
    swing: GeneratedSwing,
    camera: CameraConfig | None = None,
    noise: NoiseConfig | None = None,
    seed: int = 0,
) -> PoseSequence:
    """Project a generated swing into landmark form, as an estimator would report it."""
    camera = camera or CameraConfig()
    noise = noise or NoiseConfig()
    rng = np.random.default_rng(seed)

    points = swing.pose.landmarks_xyz
    n_frames = points.shape[0]

    centre = np.array([0.0, camera.look_at_height_m, 0.0])
    azimuth = np.radians(camera.azimuth_deg)
    elevation = np.radians(camera.elevation_deg)
    offset = np.array(
        [
            -np.sin(azimuth) * np.cos(elevation),
            np.sin(elevation),
            -np.cos(azimuth) * np.cos(elevation),
        ]
    )
    camera_pos = centre + camera.distance_m * offset
    rotation = _look_at(camera_pos, centre, np.radians(camera.roll_deg))

    local = (points - camera_pos) @ rotation.T
    depth = np.maximum(local[..., 2], 1e-3)

    focal = camera.focal_px
    u = focal * local[..., 0] / depth + camera.frame_width / 2.0
    v = focal * local[..., 1] / depth + camera.frame_height / 2.0
    pixels = np.stack([u, v], axis=-1)

    # Image-plane speed in body lengths per second, used to scale the error the way
    # motion blur scales it.
    dt = np.gradient(swing.times_s)
    torso = np.linalg.norm(
        pixels[:, Landmark.LEFT_SHOULDER] - pixels[:, Landmark.LEFT_HIP], axis=-1
    )
    body_px = max(float(np.median(torso)), 1.0)
    speed = np.linalg.norm(np.gradient(pixels, axis=0) / dt[:, None, None], axis=-1) / body_px

    scale = np.full((n_frames, NUM_LANDMARKS), noise.jitter_px, dtype=np.float64)
    scale += noise.speed_jitter_px_per_body_length * speed
    fast = np.array(
        [int(landmark) in {int(f) for f in FAST_LANDMARKS} for landmark in range(NUM_LANDMARKS)]
    )
    scale[:, fast] *= noise.fast_landmark_multiplier

    jitter = _correlated_noise((n_frames, NUM_LANDMARKS, 2), noise.correlation_frames, rng)
    pixels = pixels + jitter * scale[..., None]

    # Occlusion: a landmark noticeably further from the camera than the torso, and
    # close to the torso's line of sight, is behind the body.
    torso_depth = 0.5 * (depth[:, Landmark.LEFT_HIP] + depth[:, Landmark.RIGHT_SHOULDER])
    behind = depth > torso_depth[:, None] + 0.10
    torso_centre = 0.5 * (pixels[:, Landmark.LEFT_HIP] + pixels[:, Landmark.RIGHT_SHOULDER])
    lateral = np.linalg.norm(pixels - torso_centre[:, None, :], axis=-1) / body_px
    hidden = behind & (lateral < 1.4)

    visibility = np.full((n_frames, NUM_LANDMARKS), 0.98, dtype=np.float64)
    visibility -= 0.25 * np.clip(speed / 12.0, 0.0, 1.0)
    visibility[hidden] = noise.occlusion_visibility
    visibility[rng.random((n_frames, NUM_LANDMARKS)) < noise.dropout_probability] = 0.05

    in_frame = (
        (pixels[..., 0] >= 0)
        & (pixels[..., 0] < camera.frame_width)
        & (pixels[..., 1] >= 0)
        & (pixels[..., 1] < camera.frame_height)
    )
    visibility[~in_frame] = 0.02

    detected: NDArray[np.bool_] = np.asarray(rng.random(n_frames) >= noise.frame_loss_probability)
    # A frame with no detection holds the previous frame's landmarks at near-zero
    # confidence, which is what a tracker does rather than emitting nothing.
    for i in np.flatnonzero(~detected):
        if i > 0:
            pixels[i] = pixels[i - 1]
        visibility[i] = 0.02

    times = swing.times_s + rng.normal(0.0, noise.timestamp_jitter_s, n_frames)
    times = np.maximum.accumulate(times)
    times += np.arange(n_frames) * 1e-9  # keep them strictly increasing

    normalised = np.empty_like(pixels)
    normalised[..., 0] = pixels[..., 0] / camera.frame_width
    normalised[..., 1] = pixels[..., 1] / camera.frame_height

    hips = 0.5 * (points[:, Landmark.LEFT_HIP] + points[:, Landmark.RIGHT_HIP])
    world = (points - hips[:, None, :]) @ rotation.T

    return PoseSequence(
        xy=normalised.astype(np.float32),
        visibility=visibility.astype(np.float32),
        timestamps_s=times,
        frame_width=camera.frame_width,
        frame_height=camera.frame_height,
        world_xyz=world.astype(np.float32),
        detected=detected,
    )
