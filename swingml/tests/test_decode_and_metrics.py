"""The decoder's constraint, and the metrics computed on top of it."""

from __future__ import annotations

import numpy as np
import pytest

from swingml.events import NUM_CLASSES, NUM_EVENTS, EventSequence, SwingEvent
from swingml.metrics.swing import MetricConfig, compute_metrics
from swingml.model.data import collate, soft_targets
from swingml.model.decode import decode_events, greedy_events
from swingml.model.evaluate import evaluate_predictions
from swingml.quantity import NoReading, Provenance
from swingml.session import summarise_session
from swingml.skeleton import Handedness
from synth.dataset import generate_sample

TRUE_FRAMES = [10, 40, 60, 90, 110, 130, 150, 180]


def _confident_logits(frames: list[int], n_frames: int = 200, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    logits = rng.normal(0.0, 1.0, (n_frames, NUM_CLASSES)).astype(np.float32)
    logits[:, NUM_EVENTS] += 3.0
    for event, frame in enumerate(frames):
        logits[frame, event] += 12.0
    return logits


def test_the_decoder_finds_the_planted_events() -> None:
    decoded = decode_events(_confident_logits(TRUE_FRAMES))
    assert not isinstance(decoded, NoReading)
    assert list(decoded.frames) == TRUE_FRAMES


def test_the_decoder_stays_ordered_where_a_greedy_pick_does_not() -> None:
    """The whole argument for the dynamic programme, in one test.

    A single strong spurious peak - the sort noise produces on hard footage - is
    enough to make an independent per-event pick return a swing in which the club
    reaches the ball before it reaches the top of the backswing.
    """
    logits = _confident_logits(TRUE_FRAMES)
    logits[130, int(SwingEvent.TOP)] += 20.0

    greedy = greedy_events(logits)
    assert np.any(np.diff(greedy) <= 0), "the baseline was expected to break here"

    decoded = decode_events(logits)
    assert not isinstance(decoded, NoReading)
    assert list(decoded.frames) == sorted(decoded.frames)
    assert len(set(decoded.frames)) == NUM_EVENTS


def test_a_clip_shorter_than_the_swing_is_refused() -> None:
    result = decode_events(np.zeros((5, NUM_CLASSES), dtype=np.float32))
    assert isinstance(result, NoReading)
    assert "frames" in result.reason


def test_a_confidence_floor_refuses_rather_than_reporting_a_best_guess() -> None:
    flat = np.zeros((200, NUM_CLASSES), dtype=np.float32)
    result = decode_events(flat, min_mean_confidence=0.5)
    assert isinstance(result, NoReading)
    assert "confidence" in result.reason


def test_subframe_refinement_stays_next_to_the_frame_it_refines() -> None:
    """It sharpens a good answer; it must not be able to relocate a bad one."""
    decoded = decode_events(_confident_logits(TRUE_FRAMES))
    assert not isinstance(decoded, NoReading)
    assert decoded.subframe is not None
    for frame, refined in zip(decoded.frames, decoded.subframe, strict=True):
        assert abs(refined - frame) <= 1.0


def test_soft_targets_put_their_mass_at_the_event() -> None:
    target = soft_targets(np.array(TRUE_FRAMES), 200, sigma_frames=2.0)
    assert target.shape == (200, NUM_CLASSES)
    assert np.allclose(target.sum(axis=1), 1.0)
    assert int(np.argmax(target[:, 0])) == TRUE_FRAMES[0]
    assert target[0, NUM_EVENTS] == pytest.approx(1.0, abs=1e-3)


def test_evaluation_counts_an_ordering_violation() -> None:
    accuracy = evaluate_predictions(
        [np.array([10, 40, 60, 130, 110, 90, 150, 180])], [np.array(TRUE_FRAMES)]
    )
    assert accuracy.ordering_violations == 1


def test_evaluation_reports_refusals_separately_from_errors() -> None:
    accuracy = evaluate_predictions([None, np.array(TRUE_FRAMES)], [np.array(TRUE_FRAMES)] * 2)
    assert accuracy.n_refused == 1
    assert accuracy.correct_rate[1] == 1.0


def _sample_with_events(seed: int):
    sample = generate_sample(seed, keep_pose=True)
    assert sample is not None and sample.pose is not None
    events = EventSequence(
        frames=tuple(int(f) for f in sample.event_frames), confidence=(1.0,) * NUM_EVENTS
    )
    return sample, events


def test_tempo_ratio_recovers_the_generated_tempo() -> None:
    """The headline number, against a swing whose tempo was set by construction."""
    errors = []
    for seed in range(5000, 5040):
        sample, events = _sample_with_events(seed)
        metrics = compute_metrics(sample.pose, events, sample.handedness)
        if isinstance(metrics, NoReading):
            continue
        errors.append(abs(metrics.tempo_ratio.value - sample.tempo_ratio) / sample.tempo_ratio)

    assert len(errors) > 25
    assert float(np.median(errors)) < 0.05


def test_durations_are_measured_and_the_ratio_is_derived() -> None:
    sample, events = _sample_with_events(5001)
    metrics = compute_metrics(sample.pose, events, sample.handedness)
    assert not isinstance(metrics, NoReading)
    assert metrics.backswing_duration.provenance is Provenance.MEASURED
    assert metrics.tempo_ratio.provenance is Provenance.DERIVED
    assert metrics.shoulder_turn_projected.provenance is Provenance.PROJECTED
    assert metrics.shoulder_turn_3d.provenance is Provenance.ESTIMATED_3D


def test_body_movement_is_refused_when_the_feet_are_out_of_shot() -> None:
    """There is no fixed reference then, and the hips are not one: they move."""
    sample, events = _sample_with_events(5002)
    visibility = sample.pose.visibility.copy()
    visibility[:, 27] = 0.0
    visibility[:, 28] = 0.0
    cropped = sample.pose.model_copy(update={"visibility": visibility})

    metrics = compute_metrics(cropped, events, sample.handedness)
    assert not isinstance(metrics, NoReading)
    assert isinstance(metrics.pelvis_sway, NoReading)
    assert "feet" in metrics.pelvis_sway.reason
    # Tempo does not depend on the feet, so it survives.
    assert not isinstance(metrics.tempo_ratio, NoReading)


def test_metrics_are_refused_when_the_body_was_mostly_not_found() -> None:
    sample, events = _sample_with_events(5003)
    detected = np.zeros(sample.pose.n_frames, dtype=bool)
    detected[::4] = True
    poor = sample.pose.model_copy(update={"detected": detected})

    result = compute_metrics(poor, events, sample.handedness, MetricConfig())
    assert isinstance(result, NoReading)
    assert "body was found" in result.reason


def test_a_session_reports_spread_and_counts_what_was_missing() -> None:
    from swingml.analysis import SwingAnalysis

    analyses = []
    for seed in range(5100, 5120):
        sample, events = _sample_with_events(seed)
        metrics = compute_metrics(sample.pose, events, sample.handedness)
        analyses.append(
            SwingAnalysis(
                video=None,
                detection_rate=1.0,
                canonical_frames=sample.n_frames,
                events=events,
                event_times_s=tuple(float(f) / 60.0 for f in sample.event_frames),
                event_source_frames=tuple(int(f) for f in sample.event_frames),
                metrics=metrics,
                handedness=Handedness.RIGHT,
            )
        )

    summary = summarise_session(analyses)
    assert summary.n_swings == 20
    tempo = summary.get("tempo_ratio")
    assert tempo is not None
    assert tempo.n > 15
    assert tempo.coefficient_of_variation is not None
    assert "tempo_ratio" in summary.describe()


def test_collate_marks_padding_so_it_cannot_reach_the_loss() -> None:
    from swingml.model.data import SwingDataset
    from synth.dataset import generate_dataset

    dataset = SwingDataset(generate_dataset(4, seed_offset=6000))
    batch = collate([dataset[i] for i in range(4)])
    for row, length in enumerate(batch["lengths"]):
        assert batch["mask"][row, : int(length)].all()
        assert not batch["mask"][row, int(length) :].any()
        assert float(batch["weight"][row, int(length) :].sum()) == 0.0
