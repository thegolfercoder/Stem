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

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import NUM_EVENTS
from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.pose.base import PoseSequence
from swingml.skeleton import Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.rig import BodyProportions, SwingGeometry
from synth.swing import GeneratedSwing, SwingTiming, generate_swing

# Phones are held at one of two positions far more often than anywhere else, but
# "far more often" is not "always", and a model that has only seen the two
# canonical angles has no idea what to do with a phone placed carelessly.
PREFERRED_AZIMUTHS_DEG = (0.0, 90.0)
CAPTURE_RATES_HZ = (30.0, 60.0, 120.0, 240.0)


class SampleConfig(BaseModel):
    """Ranges every generated sample is drawn from."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    waggle_count: tuple[int, int] = (0, 3)
    waggle_amplitude_deg: tuple[float, float] = (3.0, 11.0)
    waggle_period_s: tuple[float, float] = (0.35, 0.80)
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
    capture_rates_hz: tuple[float, ...] = CAPTURE_RATES_HZ
    """Frame rates a clip may be shot at.

    A caller that renders video narrows this, because a 240 Hz clip is eight
    times as many frames to draw and to run a pose estimator over as a 30 Hz one
    and buys the least - the fast rates are the easy case. Everything that costs
    nothing to generate keeps the full set.
    """

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


class SwingDraw(BaseModel):
    """Every parameter of one clip, decided before anything is drawn.

    This exists because there were two of it. Cheap samples come from projecting
    the rig through a camera model; expensive ones come from rendering the rig to
    video and running a real pose estimator over the result. Both need the same
    randomised golfer, swing, and camera - and both had grown their own copy of
    the code that draws one, which had silently diverged.

    The rendered path, which is the one the shipped model is trained on, had ended
    up with *no* body-width variation at all while its config declared a range of
    0.55 to 1.15, no per-segment length jitter, and every golfer turning their
    pelvis and thorax by exactly the same angles. The cheap path had no waggle at
    address, while its config declared up to three. Neither was a decision; each
    was a field somebody added on one side.

    So the draw is one function now, and what the two paths differ in is what they
    genuinely differ in: the frame they are rendered into, and whether the noise
    is modelled or arrives by way of a pose estimator.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    seed: int
    timing: SwingTiming
    geometry: SwingGeometry
    body: BodyProportions
    left_handed: bool
    capture_rate_hz: float
    azimuth_deg: float
    elevation_deg: float
    distance_m: float
    roll_deg: float
    vertical_fov_deg: float
    look_at_height_m: float
    landscape: bool
    noise: NoiseConfig

    @property
    def handedness(self) -> Handedness:
        return Handedness.LEFT if self.left_handed else Handedness.RIGHT

    def frame_size(self, long_edge: int) -> tuple[int, int]:
        """Width and height for a 16:9 frame of this orientation.

        Sized by the long edge rather than the height so that a landscape clip
        costs the same to render and to detect as a portrait one. Sizing by height
        instead makes landscape three times the pixels, which in practice means
        landscape quietly gets dropped from any corpus with a compute budget.
        """
        short_edge = round(long_edge * 9 / 16)
        return (long_edge, short_edge) if self.landscape else (short_edge, long_edge)

    def camera(self, long_edge: int) -> CameraConfig:
        width, height = self.frame_size(long_edge)
        return CameraConfig(
            azimuth_deg=self.azimuth_deg,
            elevation_deg=self.elevation_deg,
            distance_m=self.distance_m,
            roll_deg=self.roll_deg,
            frame_width=width,
            frame_height=height,
            vertical_fov_deg=self.vertical_fov_deg,
            look_at_height_m=self.look_at_height_m,
        )

    def swing(self) -> GeneratedSwing:
        return generate_swing(
            timing=self.timing,
            geometry=self.geometry,
            body=self.body,
            frame_rate_hz=self.capture_rate_hz,
            left_handed=self.left_handed,
        )

    def metadata(self) -> dict[str, float]:
        """The fields a cached corpus stores beside the features, for slicing."""
        return {
            "seed": float(self.seed),
            "tempo_ratio": self.timing.tempo_ratio,
            "azimuth_deg": self.azimuth_deg,
            "capture_rate_hz": self.capture_rate_hz,
            "left_handed": float(self.left_handed),
            "landscape": float(self.landscape),
        }


def draw_swing(
    seed: int,
    config: SampleConfig | None = None,
    azimuth_range: tuple[float, float] | None = None,
) -> SwingDraw:
    """Draw one golfer, one swing and one camera from `config`.

    Deterministic in `seed` and cheap: nothing is projected, rendered or detected
    here, which is what lets a caller replay a corpus's seeds to find out what is
    in it without paying to build it again.

    `azimuth_range` overrides the camera placement, for building extra footage at
    an angle a model is measurably worse at.
    """
    config = config or SampleConfig()
    rng = np.random.default_rng(seed)

    backswing = _uniform(rng, config.backswing_s)
    timing = SwingTiming(
        address_hold_s=_uniform(rng, config.address_hold_s),
        waggle_count=int(rng.integers(config.waggle_count[0], config.waggle_count[1] + 1)),
        waggle_amplitude_deg=_uniform(rng, config.waggle_amplitude_deg),
        waggle_period_s=_uniform(rng, config.waggle_period_s),
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
    capture_rate = float(rng.choice(config.capture_rates_hz))

    if azimuth_range is not None:
        azimuth = _uniform(rng, azimuth_range)
    elif rng.random() < config.azimuth_uniform_probability:
        azimuth = _uniform(rng, (-20.0, 115.0))
    else:
        azimuth = float(rng.choice(PREFERRED_AZIMUTHS_DEG)) + float(
            rng.normal(0.0, config.azimuth_spread_deg)
        )
    if left_handed:
        # A left-hander filmed from the same side of the bay presents mirrored.
        azimuth = -azimuth

    return SwingDraw(
        seed=seed,
        timing=timing,
        geometry=geometry,
        body=body,
        left_handed=left_handed,
        capture_rate_hz=capture_rate,
        azimuth_deg=azimuth,
        elevation_deg=_uniform(rng, config.elevation_deg),
        distance_m=_uniform(rng, config.distance_m),
        roll_deg=_uniform(rng, config.roll_deg),
        vertical_fov_deg=_uniform(rng, config.vertical_fov_deg),
        look_at_height_m=_uniform(rng, (0.9, 1.5)),
        landscape=bool(rng.random() < config.landscape_probability),
        noise=NoiseConfig(
            jitter_px=_uniform(rng, config.jitter_px),
            fast_landmark_multiplier=_uniform(rng, config.fast_landmark_multiplier),
            speed_jitter_px_per_body_length=_uniform(rng, (1.0, 4.5)),
            correlation_frames=_uniform(rng, config.correlation_frames),
            dropout_probability=_uniform(rng, config.dropout_probability),
            frame_loss_probability=_uniform(rng, config.frame_loss_probability),
        ),
    )


def label_frames(
    event_times_s: NDArray[np.float64] | Sequence[float],
    grid: NDArray[np.float64],
    rate_hz: float,
    n_frames: int,
) -> NDArray[np.int64] | None:
    """Where the events land on the resampled grid, or None if they collide.

    Takes the event times rather than the swing they came from, because there is
    now a third source of them. The generator knows when it put each event; the
    rendered path reads the same times back; and GolfDB gives frame numbers in a
    real video, which become times by dividing by that video's own frame rate.
    All three want this arithmetic and none of them should have its own copy.

    Nearest grid point, not searchsorted. Searchsorted always rounds up, which
    puts every label systematically half a frame late and biases the tempo ratio
    the model is trained to reproduce.

    None means two events fell on the same frame, or the last one fell on the
    final frame with nothing after it. A 30 fps clip of a fast swing genuinely can
    do the first, and the honest response is to discard the clip rather than to
    invent a gap. The second matters because a model given no frames after the
    finish cannot be asked to find it.
    """
    frames = np.rint((np.asarray(event_times_s) - grid[0]) * rate_hz).astype(np.int64)
    clipped: NDArray[np.int64] = np.clip(frames, 0, n_frames - 1).astype(np.int64)
    if np.any(np.diff(clipped) <= 0) or clipped[-1] >= n_frames - 1:
        return None
    return clipped


def generate_sample(
    seed: int, config: SampleConfig | None = None, keep_pose: bool = False
) -> Sample | None:
    """One randomised swing projected through a camera model, or None if unusable.

    The cheap path: landmarks come from projecting the rig and adding modelled
    noise, which costs milliseconds. Good enough to develop against and, as the
    experiments in the README record, not good enough to train the shipped model
    on - a real pose estimator does not report where a joint is, it reports where
    its own anatomical prior puts one.
    """
    draw = draw_swing(seed, config)
    feature_config = FeatureConfig()
    swing = draw.swing()
    camera = draw.camera(1920)
    noise = draw.noise
    pose = render_pose_sequence(swing, camera, noise, seed=seed)
    resampled, grid = resample_pose(pose, feature_config.canonical_rate_hz)
    if resampled.n_frames < 32:
        return None

    event_frames = label_frames(
        swing.truth.event_times_s, grid, feature_config.canonical_rate_hz, resampled.n_frames
    )
    if event_frames is None:
        return None

    return Sample(
        features=extract_features(resampled, draw.handedness, feature_config),
        event_frames=event_frames,
        handedness=draw.handedness,
        tempo_ratio=swing.truth.tempo_ratio,
        capture_rate_hz=draw.capture_rate_hz,
        azimuth_deg=draw.azimuth_deg,
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
        if sample is not None:
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
