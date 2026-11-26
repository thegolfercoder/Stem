"""The phone test set: several golfers' labelled swings, frozen, scored apart (#13).

Each test freezes made-up swings of its own into a temporary manifests directory
(tests/conftest.py), so no real swing is read.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, load_model
from swingml.assets import find_event_model
from swingml.dataset.manifest import (
    HoldoutError,
    guard_archive,
    holdout_access,
    load,
    refuse_holdout_manifest,
    verify,
)
from swingml.features import extract_features, resample_pose
from swingml.model import release_gate
from swingml.model.benchmark import load_samples
from swingml.model.calibration import load_calibration
from swingml.skeleton import Handedness
from synth.camera import CameraConfig, NoiseConfig, render_pose_sequence
from synth.swing import SwingTiming, generate_swing
from tests.conftest import FrozenSplits

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import make_phone_test_set

CAMERA = CameraConfig(
    azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
)
QUIET = NoiseConfig(
    jitter_px=0.0, speed_jitter_px_per_body_length=0.0, fast_landmark_multiplier=1.0,
    dropout_probability=0.0, frame_loss_probability=0.0, timestamp_jitter_s=0.0,
)  # fmt: skip


def _export(path: Path, backswings: list[float]) -> Path:
    """What `make_labelled_dataset.py` writes for one golfer: swings 1, 2, ..."""
    features, events = [], []
    for backswing in backswings:
        timing = SwingTiming(
            address_hold_s=1.0, backswing_s=backswing, downswing_s=0.27,
            follow_through_s=0.45, finish_hold_s=0.8,
        )  # fmt: skip
        swing = generate_swing(timing=timing, frame_rate_hz=60.0)
        resampled, _ = resample_pose(render_pose_sequence(swing, CAMERA, QUIET, seed=0), 60.0)
        features.append(extract_features(resampled, Handedness.RIGHT))
        events.append(np.asarray(swing.truth.event_frames, dtype=np.int64))
    n = len(backswings)
    column = np.zeros(n)
    np.savez_compressed(
        path,
        lengths=np.array([f.shape[0] for f in features]),
        features=np.concatenate(features),
        events=np.stack(events),
        seeds=np.arange(1, n + 1),
        tempo_ratio=np.array(backswings) / 0.27,
        azimuth_deg=np.full(n, np.nan),
        capture_rate_hz=np.full(n, 60.0),
        left_handed=column,
        landscape=column,
        detection_rate=np.ones(n),
        handedness_margin=np.full(n, np.nan),
        slow=column,
        golfdb_split=np.full(n, -1.0),
    )
    return path


def _freeze(frozen: FrozenSplits, exports: dict[str, list[float]]) -> Path:
    args = [f"--export={g}={_export(frozen.root / f'{g}.npz', b)}" for g, b in exports.items()]
    out = frozen.root / "phone.npz"
    manifest = frozen.root / "manifests" / "phone-holdout-test.json"
    make_phone_test_set.main(
        [*args, "--name", "phone-holdout-test", "--source", "made up for a test",
         "--out", str(out), "--manifest-out", str(manifest), "--root", str(frozen.root)]
    )  # fmt: skip
    return manifest


def test_golfers_swings_are_renumbered_and_grouped_by_golfer(frozen_splits: FrozenSplits) -> None:
    manifest = load(_freeze(frozen_splits, {"alice": [0.8, 0.9], "bob": [1.0]}))
    assert manifest.split == "phone-holdout"
    assert manifest.clip_ids == (1, 2, 3)  # both golfers' swing 1 kept apart
    assert manifest.groups == ("phone:alice", "phone:alice", "phone:bob")
    assert verify(manifest, frozen_splits.root).name == "phone.npz"


def test_a_frozen_phone_set_is_read_only_through_the_gate(frozen_splits: FrozenSplits) -> None:
    manifest_path = _freeze(frozen_splits, {"alice": [0.8], "bob": [0.9]})
    archive = frozen_splits.root / "phone.npz"
    with pytest.raises(HoldoutError):
        refuse_holdout_manifest(load(manifest_path))
    with pytest.raises(HoldoutError, match="phone-holdout-test"):
        load_samples([archive])
    with holdout_access():
        assert len(load_samples([archive])) == 2


def test_phone_swing_numbers_never_match_golfdb_clip_ids(frozen_splits: FrozenSplits) -> None:
    """A labelled export numbers swings 1, 2, ... and marks them golfdb_split -1."""
    golfdb = frozen_splits.archive("holdout", [1, 2, 3])
    frozen_splits.freeze(golfdb, "holdout")
    guard_archive(_export(frozen_splits.root / "mine.npz", [0.8, 0.9]))  # swings 1 and 2


def test_an_export_holding_golfdb_clips_is_refused(frozen_splits: FrozenSplits) -> None:
    mixed = frozen_splits.archive("mixed", [5, 6])  # golfdb_split 1
    with pytest.raises(SystemExit, match="GolfDB clips"):
        make_phone_test_set.combine([("alice", mixed)])


def _section(frozen: FrozenSplits, manifest: Any) -> dict[str, Any]:
    path = find_event_model()
    assert path is not None
    model = load_model(path)
    calibration = load_calibration(path.with_name("event_calibration.json"))
    return release_gate.phone_section(
        manifest,
        frozen.root,
        (model, model),
        (calibration, calibration),
        (AnalysisConfig(), AnalysisConfig()),
        200,
    )


@pytest.mark.skipif(find_event_model() is None, reason="needs the bundled model")
def test_the_gate_reports_phone_swings_apart_and_gates_only_when_enough(
    frozen_splits: FrozenSplits, monkeypatch: pytest.MonkeyPatch
) -> None:
    absent = _section(frozen_splits, None)
    assert absent["status"] == "no phone evidence" and absent["passed"] is None
    manifest = load(_freeze(frozen_splits, {"alice": [0.8, 0.9], "bob": [1.0, 0.85]}))
    with holdout_access():
        small = _section(frozen_splits, manifest)
    assert not small["gating"] and small["passed"] is None
    assert small["status"].startswith("reported, not gating: 4 swings from 2 golfers")
    assert small["baseline_summary"]["n"] == 4.0
    monkeypatch.setattr(release_gate, "PHONE_MIN_SWINGS", 4)
    monkeypatch.setattr(release_gate, "PHONE_MIN_GOLFERS", 2)
    with holdout_access():
        enough = _section(frozen_splits, manifest)
    # The same weights on both sides: every paired difference is exactly zero.
    assert enough["gating"] and enough["passed"] is True
    assert enough["within_1_core4_difference"] == [0.0, 0.0, 0.0]


def test_phone_and_golfdb_clip_numbers_are_not_compared_but_groups_are() -> None:
    """QA's reproduction (#13): phone swings 1..150 against GolfDB ids 0..1395."""
    from swingml.dataset.manifest import Manifest, leaks

    def manifest(name: str, split: str, ids: range, group: str) -> Manifest:
        return Manifest(
            name=name, split=split, archive=f"{name}.npz", sha256=name, n_clips=len(ids),
            clip_ids=tuple(ids), groups=tuple(f"{group}{i % 7}" for i in ids),
            source="made up for a test", frozen_at="2026-09-30",
        )  # fmt: skip

    golfdb = manifest("golfdb-holdout-test", "holdout", range(0, 200), "golfer")
    calibration = manifest("golfdb-calibration-test", "calibration", range(100, 300), "other")
    phone = manifest("phone-holdout-test", "phone-holdout", range(1, 151), "phone:p")
    assert leaks([golfdb, phone]) == []  # clip 5 of each is not the same swing
    problems = leaks([golfdb, calibration, phone])
    assert problems == ["golfdb-holdout-test and golfdb-calibration-test share 100 clips"]
    # A golfer group in both is still a leak, whichever ids the clips carry.
    same_golfer = manifest("phone-holdout-2", "phone-holdout", range(1, 3), "golfer")
    assert any("groups" in p for p in leaks([golfdb, same_golfer]))
