"""The release gate and the frozen manifests it scores against.

The gate is the thing that says no to a model, so the ways it can be fooled are
tested directly: an archive changed after freezing, a test set sharing golfers
with the calibration set, evidence that is simply absent, and a slow-motion clip
the application would read and a naive evaluation would call a refusal.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, load_model
from swingml.assets import find_event_model
from swingml.dataset.manifest import (
    ManifestError,
    freeze,
    group_resamples,
    groups_for,
    leaks,
    verify,
)
from swingml.features import extract_features, feature_layout, resample_pose
from swingml.model import release_gate
from swingml.skeleton import Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import SwingTiming, generate_swing


def _archive(path: Path, ids: list[int]) -> Path:
    lengths = np.array([40] * len(ids))
    np.savez_compressed(
        path,
        lengths=lengths,
        features=np.zeros((int(lengths.sum()), 4), dtype=np.float32),
        events=np.tile(np.arange(8) * 4, (len(ids), 1)),
        seeds=np.array(ids),
    )
    return path


def test_a_frozen_archive_verifies_until_it_changes(tmp_path: Path) -> None:
    archive = _archive(tmp_path / "holdout.npz", [1, 2, 3])
    manifest = freeze(archive, "t", "holdout", {1: "g1", 2: "g1", 3: "g2"}, "test", tmp_path)
    assert verify(manifest, tmp_path) == archive
    _archive(archive, [1, 2, 4])
    with pytest.raises(ManifestError, match="changed since it was frozen"):
        verify(manifest, tmp_path)


def test_every_clip_must_have_a_leakage_group(tmp_path: Path) -> None:
    archive = _archive(tmp_path / "a.npz", [1, 2])
    with pytest.raises(ManifestError, match="no leakage group"):
        freeze(archive, "t", "holdout", {1: "g1"}, "test", tmp_path)


def test_shared_golfers_are_a_leak_even_without_shared_clips(tmp_path: Path) -> None:
    test = freeze(
        _archive(tmp_path / "t.npz", [1, 2]), "test", "holdout", {1: "a", 2: "b"}, "", tmp_path
    )
    calibration = freeze(
        _archive(tmp_path / "c.npz", [3]), "cal", "calibration", {3: "b"}, "", tmp_path
    )
    problems = leaks([test, calibration])
    assert len(problems) == 1 and "groups" in problems[0]
    clean = freeze(_archive(tmp_path / "d.npz", [4]), "cal2", "calibration", {4: "c"}, "", tmp_path)
    assert leaks([test, clean]) == []


def test_the_groups_of_an_archive_come_from_the_manifest_that_froze_it(tmp_path: Path) -> None:
    archive = _archive(tmp_path / "a.npz", [1, 2, 3])
    manifests = tmp_path / "manifests"
    manifests.mkdir()
    manifest = freeze(archive, "t", "holdout", {1: "g1", 2: "g1", 3: "g2"}, "test", tmp_path)
    (manifests / "t.json").write_text(manifest.model_dump_json())
    assert groups_for(archive, manifests) == ("g1", "g1", "g2")
    # Other bytes, even with the same clips, are not the archive that was frozen.
    other = _archive(tmp_path / "b.npz", [1, 2, 4])
    assert groups_for(other, manifests) is None


def test_a_group_bootstrap_draws_whole_groups_and_is_wider_when_groups_agree() -> None:
    groups = [f"g{i // 5}" for i in range(40)]  # 8 groups of 5 clips
    rng = np.random.default_rng(0)
    for idx in group_resamples(groups, 50, rng):
        drawn = [groups[i] for i in idx]
        # Every group drawn comes whole, and as many group draws as there are groups.
        assert all(drawn.count(g) % 5 == 0 for g in set(drawn))
        assert len(idx) == 40
    # Clips within a group agree: resampling them one by one understates the spread.
    values = np.repeat(np.random.default_rng(1).normal(size=8), 5)
    by_group = [values[i].mean() for i in group_resamples(groups, 2000, np.random.default_rng(2))]
    rng = np.random.default_rng(3)
    by_clip = [values[rng.integers(0, 40, 40)].mean() for _ in range(2000)]
    assert np.std(by_group) > 1.8 * np.std(by_clip)


def test_missing_evidence_exits_two_before_any_number(tmp_path: Path) -> None:
    model = find_event_model()
    if model is None:
        pytest.skip("needs the bundled model")
    status = release_gate.main(
        [
            "--candidate", str(model),
            "--baseline", str(model),
            "--test-manifest", str(tmp_path / "absent.json"),
            "--calibration-manifest", str(tmp_path / "absent.json"),
        ]
    )  # fmt: skip
    assert status == 2


def test_compressing_time_rescales_every_per_second_channel() -> None:
    layout = feature_layout()
    features = np.ones((80, layout.total), dtype=np.float32)
    squeezed = release_gate.compress(features, 4.0)
    assert squeezed.shape[0] == 20
    for start, end in layout.per_second_spans:
        assert np.allclose(squeezed[:, start:end], 4.0)
    start, end = layout.positions
    assert np.allclose(squeezed[:, start:end], 1.0)


def test_group_resampling_brackets_the_point_estimate() -> None:
    rows_a = [release_gate.Scored(answered=True, w1_core=0.5, tempo_error=0.2) for _ in range(40)]
    rows_b = [
        release_gate.Scored(answered=True, w1_core=0.5 + 0.1 * (i % 2), tempo_error=0.15)
        for i in range(40)
    ]
    groups = [f"g{i // 4}" for i in range(40)]
    point, low, high = release_gate.paired_difference(
        rows_a, rows_b, groups, lambda r: r.w1_core, lambda v: float(v.mean()), 500, 0
    )
    assert low <= point <= high
    assert point == pytest.approx(0.05)


@pytest.mark.skipif(find_event_model() is None, reason="needs the bundled model")
def test_the_gate_reads_a_slow_motion_swing_the_way_the_app_does() -> None:
    """Scored with the retry, as the application decides, not as a refusal."""
    timing = SwingTiming(
        address_hold_s=1.0, backswing_s=0.8, downswing_s=0.8 / 3, follow_through_s=0.45,
        finish_hold_s=0.8,
    )  # fmt: skip
    swing = generate_swing(timing=timing, frame_rate_hz=60.0)
    camera = CameraConfig(
        azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
    )
    quiet = NoiseConfig(
        jitter_px=0.0, speed_jitter_px_per_body_length=0.0, fast_landmark_multiplier=1.0,
        dropout_probability=0.0, frame_loss_probability=0.0, timestamp_jitter_s=0.0,
    )  # fmt: skip
    sequence = render_pose_sequence(swing, camera, quiet, seed=0)
    slowed = sequence.model_copy(update={"timestamps_s": sequence.timestamps_s * 4.0})
    resampled, _ = resample_pose(slowed, 60.0)
    features = extract_features(resampled, Handedness.RIGHT)
    path = find_event_model()
    assert path is not None
    model = load_model(path)
    without = release_gate.decide(model, features, AnalysisConfig(slow_motion_factors=()))
    with_retry = release_gate.decide(model, features, AnalysisConfig())
    assert without.positions is None
    assert with_retry.positions is not None
    assert with_retry.slowed_by is not None
    truth = swing.truth.event_frames * 4
    assert release_gate.tempo_of(with_retry.positions) == pytest.approx(
        release_gate.tempo_of(truth), rel=0.25
    )
