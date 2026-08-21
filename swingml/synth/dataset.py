"""Randomised swings: different golfers, different swings, different phones.

Variation here is not decoration. A model trained on one body, one tempo and one
camera position learns that swing rather than swings, and the failure is invisible
until real footage arrives. Every axis that would differ between two clips is
varied, and the ranges are deliberately wider than what a careful golfer filming
carefully would produce, because the point is a model that survives a phone
propped against a bag.

The one thing deliberately *not* randomised is the relationship between the
events and the geometry. Impact is where the club returns to the ball in every
sample, at every tempo, from every angle.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import NUM_EVENTS
from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.pose.base import PoseSequence
from swingml.skeleton import Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.rig import BodyProportions, SwingGeometry
from synth.swing import SwingTiming, generate_swing

# Phones are held at one of two positions far more often than anywhere else, but
# "far more often" is not "always", and a model that has only seen the two
# canonical angles has no idea what to do with a phone placed carelessly.
PREFERRED_AZIMUTHS_DEG = (0.0, 90.0)
CAPTURE_RATES_HZ = (30.0, 60.0, 120.0, 240.0)


class SampleConfig(BaseModel):
    """Ranges every generated sample is drawn from."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    waggle_count: tuple[int, int] = (0, 3)
    backswing_s: tuple[float, float] = (0.60, 1.05)
    tempo_ratio: tuple[float, float] = (2.1, 4.0)
    follow_through_s: tuple[float, float] = (0.30, 0.60)
    address_hold_s: tuple[float, float] = (0.20, 1.20)
    finish_hold_s: tuple[float, float] = (0.25, 1.10)

    plane_inclination_deg: tuple[float, float] = (44.0, 66.0)
    spine_tilt_deg: tuple[float, float] = (20.0, 40.0)
    top_phase_deg: tuple[float, float] = (-186.0, -146.0)
    finish_phase_deg: tuple[float, float] = (150.0, 185.0)
    wrist_hinge_deg: tuple[float, float] = (70.0, 100.0)
    lag_retention: tuple[float, float] = (0.30, 0.80)
    hand_radius_m: tuple[float, float] = (0.46, 0.55)

    body_scale: tuple[float, float] = (0.88, 1.12)
    width_scale: tuple[float, float] = (0.55, 1.15)
    """Independent scaling of the shoulder, hip and stance widths.

    Deliberately wide, and the reason is worth recording. A pose estimator does
    not report the width of the body it was shown: it reports where *it* believes
    the joint centres are, using its own anatomical prior. Measured against this
    generator on rendered video, MediaPipe placed the hips at roughly forty
    percent of the modelled width and the shoulders at eighty, and the ratio moved
    a long way with camera angle.

    Matching that measurement would be fitting to one renderer on one swing. The
    honest response to a gap whose true size is unknown is to train across a range
    wide enough to contain it, so the model cannot come to depend on a body being
    any particular shape.
    """
    left_handed_probability: float = 0.15

    azimuth_spread_deg: float = Field(
        default=22.0, description="Scatter about the two positions people actually film from."
    )
    azimuth_uniform_probability: float = Field(
        default=0.25, description="Fraction of samples placed anywhere at all."
    )
    elevation_deg: tuple[float, float] = (-6.0, 28.0)
    distance_m: tuple[float, float] = (2.4, 6.5)
    roll_deg: tuple[float, float] = (-14.0, 14.0)
    vertical_fov_deg: tuple[float, float] = (48.0, 72.0)
    landscape_probability: float = 0.3

    jitter_px: tuple[float, float] = (1.5, 20.0)
    """Upper end raised after measurement. MediaPipe's lead-wrist path over a
    rendered swing ran between 1.8 and 2.7 times longer than this generator's,
    meaning the real estimator jitters considerably more than was being modelled.
    A model trained on cleaner landmarks than it will meet is a model that has
    learned to trust them."""
    fast_landmark_multiplier: tuple[float, float] = (1.5, 3.5)
    correlation_frames: tuple[float, float] = (1.0, 8.0)
    dropout_probability: tuple[float, float] = (0.0, 0.03)
    frame_loss_probability: tuple[float, float] = (0.0, 0.012)


class Sample(BaseModel):
    """One training example: what the model sees, and where the events really are."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    features: NDArray[np.float32] = Field(description="(T, F) at the canonical rate.")
    event_frames: NDArray[np.int64] = Field(description="(8,) indices into the canonical grid.")
    handedness: Handedness
    tempo_ratio: float
    capture_rate_hz: float
    azimuth_deg: float
    pose: PoseSequence | None = None

    @property
    def n_frames(self) -> int:
        return int(self.features.shape[0])


def _uniform(rng: np.random.Generator, bounds: tuple[float, float]) -> float:
    return float(rng.uniform(*bounds))


def generate_sample(
    seed: int, config: SampleConfig | None = None, keep_pose: bool = False
) -> Sample | None:
    """One randomised swing, or None if it came out too short to be usable.

    Returning None rather than raising or silently padding matters: a 30 fps clip
    of a fast swing genuinely can put two events in the same resampled frame, and
    the honest response is to discard the sample rather than to invent a gap.
    """
    config = config or SampleConfig()
    rng = np.random.default_rng(seed)
    feature_config = FeatureConfig()

    backswing = _uniform(rng, config.backswing_s)
    timing = SwingTiming(
        address_hold_s=_uniform(rng, config.address_hold_s),
        backswing_s=backswing,
        downswing_s=backswing / _uniform(rng, config.tempo_ratio),
        follow_through_s=_uniform(rng, config.follow_through_s),
        finish_hold_s=_uniform(rng, config.finish_hold_s),
    )

    geometry = SwingGeometry(
        plane_inclination_deg=_uniform(rng, config.plane_inclination_deg),
        spine_tilt_deg=_uniform(rng, config.spine_tilt_deg),
        top_phase_deg=_uniform(rng, config.top_phase_deg),
        finish_phase_deg=_uniform(rng, config.finish_phase_deg),
        max_wrist_hinge_deg=_uniform(rng, config.wrist_hinge_deg),
        lag_retention=_uniform(rng, config.lag_retention),
        hand_radius_m=_uniform(rng, config.hand_radius_m),
        pelvis_turn_top_deg=-42.0 * _uniform(rng, (0.75, 1.3)),
        pelvis_turn_impact_deg=38.0 * _uniform(rng, (0.7, 1.3)),
        pelvis_turn_finish_deg=78.0 * _uniform(rng, (0.8, 1.25)),
        thorax_turn_top_deg=-92.0 * _uniform(rng, (0.8, 1.2)),
        thorax_turn_impact_deg=28.0 * _uniform(rng, (0.6, 1.4)),
        thorax_turn_finish_deg=112.0 * _uniform(rng, (0.85, 1.2)),
        sway_amplitude_m=_uniform(rng, (0.01, 0.08)),
        lift_amplitude_m=_uniform(rng, (0.0, 0.06)),
        head_drift_m=_uniform(rng, (0.0, 0.09)),
    )

    scale = _uniform(rng, config.body_scale)
    base = BodyProportions()
    fields = {
        field: getattr(base, field) * scale * _uniform(rng, (0.94, 1.06))
        for field in BodyProportions.model_fields
    }
    # The widths vary far more than the lengths, because the estimator's own
    # anatomical prior decides them rather than the body in front of it.
    width_scale = _uniform(rng, config.width_scale)
    for field in ("shoulder_width_m", "hip_width_m", "stance_width_m"):
        fields[field] *= width_scale * _uniform(rng, (0.85, 1.15))
    body = BodyProportions(**fields)

    left_handed = bool(rng.random() < config.left_handed_probability)
    capture_rate = float(rng.choice(CAPTURE_RATES_HZ))

    swing = generate_swing(
        timing=timing,
        geometry=geometry,
        body=body,
        frame_rate_hz=capture_rate,
        left_handed=left_handed,
    )

    if rng.random() < config.azimuth_uniform_probability:
        azimuth = _uniform(rng, (-20.0, 115.0))
    else:
        azimuth = float(rng.choice(PREFERRED_AZIMUTHS_DEG)) + float(
            rng.normal(0.0, config.azimuth_spread_deg)
        )
    if left_handed:
        # A left-hander filmed from the same side of the bay presents mirrored.
        azimuth = -azimuth

    landscape = bool(rng.random() < config.landscape_probability)
    width, height = (1920, 1080) if landscape else (1080, 1920)
    camera = CameraConfig(
        azimuth_deg=azimuth,
        elevation_deg=_uniform(rng, config.elevation_deg),
        distance_m=_uniform(rng, config.distance_m),
        roll_deg=_uniform(rng, config.roll_deg),
        frame_width=width,
        frame_height=height,
        vertical_fov_deg=_uniform(rng, config.vertical_fov_deg),
        look_at_height_m=_uniform(rng, (0.9, 1.5)),
    )
    noise = NoiseConfig(
        jitter_px=_uniform(rng, config.jitter_px),
        fast_landmark_multiplier=_uniform(rng, config.fast_landmark_multiplier),
        speed_jitter_px_per_body_length=_uniform(rng, (1.0, 4.5)),
        correlation_frames=_uniform(rng, config.correlation_frames),
        dropout_probability=_uniform(rng, config.dropout_probability),
        frame_loss_probability=_uniform(rng, config.frame_loss_probability),
    )

    pose = render_pose_sequence(swing, camera, noise, seed=seed)
    resampled, grid = resample_pose(pose, feature_config.canonical_rate_hz)
    if resampled.n_frames < 32:
        return None

    handedness = Handedness.LEFT if left_handed else Handedness.RIGHT
    features = extract_features(resampled, handedness, feature_config)

    # Nearest grid point, not searchsorted. Searchsorted always rounds up, which
    # puts every label systematically half a frame late and biases the tempo ratio
    # the model is trained to reproduce.
    event_times = np.asarray(swing.truth.event_times_s)
    event_frames = np.rint((event_times - grid[0]) * feature_config.canonical_rate_hz).astype(
        np.int64
    )
    event_frames = np.clip(event_frames, 0, resampled.n_frames - 1)
    if np.any(np.diff(event_frames) <= 0):
        return None

    return Sample(
        features=features,
        event_frames=event_frames,
        handedness=handedness,
        tempo_ratio=swing.truth.tempo_ratio,
        capture_rate_hz=capture_rate,
        azimuth_deg=azimuth,
        pose=resampled if keep_pose else None,
    )


def generate_dataset(
    n: int, seed_offset: int = 0, config: SampleConfig | None = None
) -> list[Sample]:
    """`n` usable samples, skipping any that came out degenerate."""
    samples: list[Sample] = []
    seed = seed_offset
    attempts = 0
    while len(samples) < n and attempts < n * 5:
        sample = generate_sample(seed, config)
        attempts += 1
        seed += 1
        if sample is not None and sample.event_frames[-1] < sample.n_frames - 1:
            samples.append(sample)
    if len(samples) < n:
        raise RuntimeError(f"generated only {len(samples)} usable samples from {attempts} attempts")
    return samples


def label_distribution(samples: list[Sample]) -> NDArray[np.float64]:
    """Share of frames that are each event, which is what the class weighting fixes."""
    total = sum(s.n_frames for s in samples)
    counts = np.full(NUM_EVENTS + 1, 0.0)
    counts[NUM_EVENTS] = total - NUM_EVENTS * len(samples)
    counts[:NUM_EVENTS] = len(samples)
    return counts / total
