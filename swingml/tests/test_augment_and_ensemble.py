"""Augmentation must stay physical, and an ensemble must behave like one model.

Augmentation is the easiest place in a training pipeline to introduce a silent
fault. Nothing crashes when a swing is stretched in time without its velocities
being rescaled - the model simply learns from sequences that no body could have
produced, and the damage shows up much later as accuracy that will not improve.
"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from swingml.features import feature_dimension, feature_layout
from swingml.model.augment import (
    AugmentConfig,
    apply_scale,
    augment_sample,
    crop_ends,
    occlude_landmarks,
    time_warp,
)
from swingml.model.ensemble import EnsembleConfig, SwingEventEnsemble
from swingml.model.tcn import SwingEventNet


@pytest.fixture
def smooth_features() -> np.ndarray:
    """A smooth signal, so interpolation is faithful and only real effects show."""
    n, width = 180, feature_dimension()
    t = np.linspace(0.0, 3.0, n)
    out = np.zeros((n, width), dtype=np.float32)
    for channel in range(width):
        out[:, channel] = np.sin(2.0 * np.pi * 0.7 * t + channel * 0.1)
    return out


@pytest.fixture
def events() -> np.ndarray:
    return np.array([10, 40, 60, 90, 110, 130, 150, 170], dtype=np.int64)


def test_feature_layout_matches_what_extraction_produces() -> None:
    assert feature_layout().total == feature_dimension()


@pytest.mark.parametrize("factor", [0.5, 0.8, 1.25, 2.0])
def test_time_warp_rescales_per_second_channels_and_only_those(
    factor: float, smooth_features: np.ndarray, events: np.ndarray
) -> None:
    """A swing played at half speed has half the velocity and the same shape."""
    layout = feature_layout()
    warped, _ = time_warp(smooth_features, events, factor, layout)

    for start, end in layout.per_second_spans:
        before = np.abs(smooth_features[:, start:end]).mean()
        after = np.abs(warped[:, start:end]).mean()
        assert after / before == pytest.approx(1.0 / factor, rel=0.02)

    for start, end in layout.positional_spans:
        before = np.abs(smooth_features[:, start:end]).mean()
        after = np.abs(warped[:, start:end]).mean()
        assert after / before == pytest.approx(1.0, rel=0.02)


def test_time_warp_moves_the_events_with_the_swing(
    smooth_features: np.ndarray, events: np.ndarray
) -> None:
    warped, moved = time_warp(smooth_features, events, 1.5, feature_layout())
    assert np.all(np.diff(moved) > 0)
    assert moved[-1] < warped.shape[0]
    # Impact sat at the same fraction of the clip before and after.
    assert moved[5] / warped.shape[0] == pytest.approx(
        events[5] / smooth_features.shape[0], abs=0.02
    )


def test_scaling_leaves_confidence_alone(smooth_features: np.ndarray) -> None:
    """Confidence is not a length and must not be stretched with the body."""
    layout = feature_layout()
    scaled = apply_scale(smooth_features, 1.4, layout)
    start, end = layout.visibility
    assert np.allclose(scaled[:, start:end], smooth_features[:, start:end])


def test_occlusion_zeroes_confidence_and_freezes_the_joint(
    smooth_features: np.ndarray,
) -> None:
    """A lost landmark holds its last position; it does not leap to the origin.

    Blanking it to zero would teach the model that a limb disappearing means the
    limb is at the golfer's pelvis, which is where zero is after centring.
    """
    layout = feature_layout()
    config = AugmentConfig(enabled=True, dropout_landmarks=(4, 4), dropout_span=(0.4, 0.4))
    out = occlude_landmarks(smooth_features, np.random.default_rng(3), config, layout)

    start, end = layout.visibility
    assert (out[:, start:end] == 0.0).any(), "nothing was occluded"

    positions_start = layout.positions[0]
    changed = np.abs(
        out[:, positions_start : positions_start + 38]
        - smooth_features[:, positions_start : positions_start + 38]
    ).sum(axis=1)
    assert changed.sum() > 0


def test_cropping_never_cuts_into_the_swing(
    smooth_features: np.ndarray, events: np.ndarray
) -> None:
    config = AugmentConfig(enabled=True, crop_margin_frames=(0, 60))
    for seed in range(50):
        cropped, moved = crop_ends(smooth_features, events, np.random.default_rng(seed), config)
        assert moved[0] >= 0, "cropped past the address"
        assert moved[-1] < cropped.shape[0], "cropped past the finish"


def test_augmented_samples_are_always_valid(
    smooth_features: np.ndarray, events: np.ndarray
) -> None:
    config = AugmentConfig(enabled=True)
    lengths = set()
    for seed in range(150):
        out, moved = augment_sample(
            smooth_features.copy(), events.copy(), np.random.default_rng(seed), config
        )
        assert np.isfinite(out).all()
        assert np.all(np.diff(moved) > 0)
        assert moved[0] >= 0 and moved[-1] < out.shape[0]
        lengths.add(out.shape[0])
    assert len(lengths) > 10, "augmentation is not varying the clips"


def test_augmentation_off_changes_nothing(smooth_features: np.ndarray, events: np.ndarray) -> None:
    out, moved = augment_sample(
        smooth_features.copy(), events.copy(), np.random.default_rng(0), AugmentConfig()
    )
    assert np.array_equal(out, smooth_features)
    assert np.array_equal(moved, events)


# -- ensemble --------------------------------------------------------------


def _model(seed: int) -> SwingEventNet:
    torch.manual_seed(seed)
    return SwingEventNet(feature_dimension())


def test_one_member_ensemble_matches_the_model_alone(smooth_features: np.ndarray) -> None:
    model = _model(0)
    ensemble = SwingEventEnsemble([model])
    with torch.no_grad():
        direct = torch.softmax(model(torch.from_numpy(smooth_features)[None, ...])[0], dim=-1)
    assert np.allclose(ensemble.probabilities(smooth_features), direct.numpy(), atol=1e-5)


def test_ensemble_output_is_a_probability_distribution_per_frame(
    smooth_features: np.ndarray,
) -> None:
    ensemble = SwingEventEnsemble([_model(0), _model(1), _model(2)])
    probabilities = ensemble.probabilities(smooth_features)
    assert probabilities.shape == (smooth_features.shape[0], 9)
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-4)
    assert (probabilities >= 0).all()


def test_test_time_warping_keeps_the_original_frame_count(
    smooth_features: np.ndarray,
) -> None:
    """Warped views are mapped back before averaging, or the result would not line
    up with the clip it came from."""
    ensemble = SwingEventEnsemble([_model(0)], EnsembleConfig(time_warps=(0.9, 1.0, 1.12)))
    probabilities = ensemble.probabilities(smooth_features)
    assert probabilities.shape[0] == smooth_features.shape[0]
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-4)


def test_an_empty_ensemble_is_refused() -> None:
    with pytest.raises(ValueError, match="at least one"):
        SwingEventEnsemble([])
