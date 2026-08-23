"""Making a small set of real-domain clips go further.

Landmarks that came out of the real pose estimator are expensive: each one costs a
render and a full pass of a neural network over every frame, so a few hundred is
what there is. The synthetic landmarks are free but the model does not meet those
at run time, and training on them alone is what the whole sim-to-real problem was.

Augmentation is the way out. Each of these turns one recorded swing into a
plausible different one, and each corresponds to something that genuinely varies
between clips rather than being noise for its own sake:

* **Time warping** is a golfer swinging faster or slower, and it is the one that
  has to be done carefully. Stretching a swing rescales anything measured per
  second and leaves anything measuring a shape alone, so the channel layout is
  consulted rather than the whole matrix being resampled and hoped for.
* **Scale jitter** is the body-length estimate being slightly off, which it always
  is, since it comes from the estimator's own landmarks.
* **Landmark dropout** is a limb passing behind the body, which happens in every
  swing filmed from behind and is exactly where this pipeline is weakest.
* **Positional noise** is the estimator jittering, which it does far more on real
  video than on a render.
* **Cropping** is somebody starting and stopping the recording at a different
  moment, which is the most variable thing about a clip and nothing to do with
  the swing.

None of these invent a swing that could not happen. That distinction matters: an
augmentation that produces impossible input teaches the model to expect it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.features import FeatureLayout, feature_layout


class AugmentConfig(BaseModel):
    """How far each augmentation may go. Off by default; training turns it on."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    enabled: bool = False
    time_warp: tuple[float, float] = Field(
        default=(0.85, 1.18),
        description=(
            "Range of speed factors. Wide enough to cover a slow practice swing "
            "against a hard one, narrow enough that the result is still a golf swing."
        ),
    )
    scale_jitter: tuple[float, float] = Field(default=(0.93, 1.07))
    position_noise: float = Field(default=0.012, description="Standard deviation in body lengths.")
    velocity_noise: float = Field(default=0.05, description="Relative, on per-second channels.")
    dropout_probability: float = Field(
        default=0.25, description="Chance a clip has a landmark occluded at all."
    )
    dropout_landmarks: tuple[int, int] = Field(default=(1, 4))
    dropout_span: tuple[float, float] = Field(
        default=(0.05, 0.30), description="Fraction of the clip an occlusion lasts."
    )
    crop_margin_frames: tuple[int, int] = Field(
        default=(0, 20), description="Frames that may be trimmed from each end."
    )
    min_frames: int = Field(default=48, description="Never crop below this many frames.")


def time_warp(
    features: NDArray[np.float32],
    events: NDArray[np.int64],
    factor: float,
    layout: FeatureLayout,
) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    """Play the swing at `factor` times the duration, keeping the physics consistent.

    A factor above one makes the swing longer, so it is slower, so everything
    measured per second gets smaller - hence the division. Getting that backwards
    produces a sequence whose velocities disagree with its own positions, which is
    worse than no augmentation because nothing in the world produces it.
    """
    n = features.shape[0]
    target = max(16, round(n * factor))
    source = np.linspace(0.0, n - 1, target)
    lower = np.floor(source).astype(int)
    upper = np.minimum(lower + 1, n - 1)
    blend = (source - lower).astype(np.float32)[:, None]

    warped = features[lower] * (1.0 - blend) + features[upper] * blend
    for start, end in layout.per_second_spans:
        warped[:, start:end] /= np.float32(factor)

    moved = np.rint(events.astype(np.float64) * (target - 1) / max(n - 1, 1)).astype(np.int64)
    moved = np.clip(moved, 0, target - 1)
    for index in range(1, len(moved)):
        moved[index] = max(moved[index], moved[index - 1] + 1)
    if moved[-1] > target - 1:
        return features, events
    return warped.astype(np.float32), moved


def apply_scale(
    features: NDArray[np.float32], factor: float, layout: FeatureLayout
) -> NDArray[np.float32]:
    """Stretch everything measured in body lengths, as a wrong scale estimate would."""
    out = features.copy()
    for start, end in (*layout.positional_spans, *layout.per_second_spans):
        out[:, start:end] *= np.float32(factor)
    for start, end in (layout.widths,):
        out[:, start:end] *= np.float32(factor)
    return out


def occlude_landmarks(
    features: NDArray[np.float32],
    rng: np.random.Generator,
    config: AugmentConfig,
    layout: FeatureLayout,
) -> NDArray[np.float32]:
    """Hide a few landmarks for part of the clip, as a body passing in front does.

    Confidence goes to zero and the position freezes at its last known value, which
    is exactly what the estimator does when it loses something. Blanking the
    position to zero instead would teach the model that a lost limb jumps to the
    golfer's pelvis.
    """
    out = features.copy()
    n_frames = out.shape[0]
    n_landmarks = layout.visibility[1] - layout.visibility[0]

    count = int(rng.integers(config.dropout_landmarks[0], config.dropout_landmarks[1] + 1))
    for _ in range(count):
        landmark = int(rng.integers(0, n_landmarks))
        span = float(rng.uniform(*config.dropout_span))
        length = max(2, int(span * n_frames))
        start = int(rng.integers(0, max(1, n_frames - length)))
        stop = min(n_frames, start + length)

        out[start:stop, layout.visibility[0] + landmark] = 0.0
        held = out[
            max(start - 1, 0),
            layout.positions[0] + 2 * landmark : layout.positions[0] + 2 * landmark + 2,
        ]
        out[
            start:stop, layout.positions[0] + 2 * landmark : layout.positions[0] + 2 * landmark + 2
        ] = held
        out[
            start:stop,
            layout.velocities[0] + 2 * landmark : layout.velocities[0] + 2 * landmark + 2,
        ] = 0.0
        out[start:stop, layout.speeds[0] + landmark] = 0.0
    return out


def crop_ends(
    features: NDArray[np.float32],
    events: NDArray[np.int64],
    rng: np.random.Generator,
    config: AugmentConfig,
) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    """Trim idle frames from either end, as a different finger on the record button.

    Never trims into the swing: the crop is bounded by the first and last event,
    because a clip missing its own address is a different training example
    altogether and one the model should be refusing rather than learning.
    """
    n = features.shape[0]
    low, high = config.crop_margin_frames
    front = int(rng.integers(low, high + 1))
    back = int(rng.integers(low, high + 1))

    front = min(front, max(0, int(events[0]) - 2))
    back = min(back, max(0, n - 1 - int(events[-1]) - 2))
    if n - front - back < config.min_frames:
        return features, events
    return features[front : n - back], events - front


def augment_sample(
    features: NDArray[np.float32],
    events: NDArray[np.int64],
    rng: np.random.Generator,
    config: AugmentConfig,
    layout: FeatureLayout | None = None,
) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    """One recorded swing, made into a plausible different one."""
    if not config.enabled:
        return features, events
    layout = layout or feature_layout()

    features, events = time_warp(features, events, float(rng.uniform(*config.time_warp)), layout)
    features = apply_scale(features, float(rng.uniform(*config.scale_jitter)), layout)

    if config.position_noise > 0:
        for start, end in layout.positional_spans:
            features[:, start:end] += rng.normal(
                0.0, config.position_noise, size=(features.shape[0], end - start)
            ).astype(np.float32)
    if config.velocity_noise > 0:
        for start, end in layout.per_second_spans:
            scale = np.abs(features[:, start:end]).mean() * config.velocity_noise
            features[:, start:end] += rng.normal(
                0.0, max(scale, 1e-4), size=(features.shape[0], end - start)
            ).astype(np.float32)

    if rng.random() < config.dropout_probability:
        features = occlude_landmarks(features, rng, config, layout)

    features, events = crop_ends(features, events, rng, config)
    return np.ascontiguousarray(features, dtype=np.float32), events
