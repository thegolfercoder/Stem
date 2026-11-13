"""The holdout is read only through the release gate.

Every loader that trains or scores refuses the frozen holdout, whether it is
named by its manifest, passed as its archive, or copied into different bytes;
the release gate alone may read it; and image features are projected only with a
basis fitted on the frozen train split. Each test freezes made-up archives of its
own (tests/conftest.py), so none of them reads a real clip.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from swingml.dataset.manifest import (
    HOLDOUT_RULE,
    HoldoutError,
    ManifestError,
    guard_archive,
    holdout_access,
    load,
)
from swingml.model.benchmark import load_samples
from swingml.model.release_gate import read_archive
from swingml.model.rgb import SidecarError, check_basis, fuse_archive, load_sidecar
from tests.conftest import FrozenSplits

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import benchmark_baselines  # noqa: E402
import calibrate_events  # noqa: E402
import error_breakdown  # noqa: E402
import experiment  # noqa: E402
import extract_frame_embeddings  # noqa: E402
import finetune_on_detected  # noqa: E402
import tempo_experiments  # noqa: E402
import train_ensemble  # noqa: E402

HOLDOUT_IDS = [101, 102, 103]


def _with_holdout(frozen: FrozenSplits) -> Path:
    archive = frozen.archive("holdout", HOLDOUT_IDS)
    frozen.freeze(archive, "holdout")
    return archive


LOADERS: dict[str, Any] = {
    "benchmark.load_samples": lambda p: load_samples([p]),
    "release_gate.read_archive": read_archive,
    "rgb.fuse_archive": lambda p: fuse_archive(p, p, p.with_name("fused.npz")),
    "benchmark_baselines.load": benchmark_baselines.load,
    "calibrate_events.load_clips": lambda p: calibrate_events.load_clips([p]),
    "error_breakdown.read_conditions": error_breakdown.read_conditions,
    "finetune_on_detected.load_detected": finetune_on_detected.load_detected,
    "train_ensemble.load_detected": lambda p: train_ensemble.load_detected([p]),
}


@pytest.mark.parametrize("loader", sorted(LOADERS))
def test_every_loader_refuses_the_frozen_holdout(frozen_splits: FrozenSplits, loader: str) -> None:
    archive = _with_holdout(frozen_splits)
    with pytest.raises(HoldoutError, match="release_gate"):
        LOADERS[loader](archive)


def test_the_release_gate_alone_may_read_it(frozen_splits: FrozenSplits) -> None:
    archive = _with_holdout(frozen_splits)
    with holdout_access():
        assert len(load_samples([archive])) == len(HOLDOUT_IDS)
        assert len(read_archive(archive)) == len(HOLDOUT_IDS)
    with pytest.raises(HoldoutError):
        load_samples([archive])  # the access ends with the gate's run


def test_holdout_clips_in_other_bytes_are_refused(frozen_splits: FrozenSplits) -> None:
    _with_holdout(frozen_splits)
    # Re-extracted into different bytes, or mixed with train clips.
    copy = frozen_splits.archive("copy", [7, 102], fill=1.0)
    with pytest.raises(HoldoutError, match="1 clips of the frozen holdout"):
        guard_archive(copy)
    # Synthetic archives number their clips by synthesis seed, not GolfDB id:
    # the same numbers there are not the holdout's clips.
    synthetic = frozen_splits.archive("synthetic", HOLDOUT_IDS, golfdb=False, fill=2.0)
    guard_archive(synthetic)
    assert len(load_samples([synthetic])) == len(HOLDOUT_IDS)


def test_tempo_experiments_refuses_a_holdout_manifest_before_loading(
    frozen_splits: FrozenSplits, tmp_path: Path
) -> None:
    manifest = frozen_splits.freeze(_with_holdout(frozen_splits), "holdout")
    # A root with no archive in it: the refusal must come first, not a missing file.
    with pytest.raises(HoldoutError, match="holdout manifest"):
        tempo_experiments.load_split(manifest, tmp_path / "nowhere")
    with pytest.raises(HoldoutError, match="holdout manifest"):
        tempo_experiments.main(
            ["decode", "--manifest", str(manifest), "--out", str(tmp_path / "x.json")]
        )


def test_experiment_refuses_the_holdout_flag(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        sys, "argv", ["experiment.py", "--name", "x", "--holdout", str(tmp_path / "h.npz")]
    )
    with pytest.raises(SystemExit, match="--holdout is refused"):
        experiment.main()


def _basis(path: Path, **provenance: Any) -> Path:
    np.savez(path, mean=np.zeros(4), components=np.eye(4), scale=np.ones(4), **provenance)
    return path


def _sidecar(path: Path, ids: list[int], basis: Path | None) -> Path:
    columns: dict[str, Any] = {
        "seeds": np.array(ids),
        "lengths": np.full(len(ids), 3),
        "embeddings": np.zeros((3 * len(ids), 2), dtype=np.float16),
    }
    if basis is not None:
        columns["basis"] = str(basis)
    np.savez(path, **columns)
    return path


def test_image_features_need_a_basis_fitted_on_train(frozen_splits: FrozenSplits) -> None:
    root = frozen_splits.root
    train = frozen_splits.archive("train", [1, 2])
    validation = frozen_splits.archive("validation", [3, 4], fill=1.0)
    train_manifest = load(frozen_splits.freeze(train, "train"))
    validation_manifest = load(frozen_splits.freeze(validation, "validation"))
    _with_holdout(frozen_splits)

    good = _basis(root / "good.npz", fitted_on_sha256=train_manifest.sha256)
    assert check_basis(good).name == train_manifest.name
    # The first basis recorded only the archive's path.
    assert check_basis(_basis(root / "legacy.npz", fitted_on=str(train))).split == "train"
    for bad in (
        _basis(root / "on_validation.npz", fitted_on_sha256=validation_manifest.sha256),
        _basis(root / "on_validation_path.npz", fitted_on=str(validation)),
        _basis(root / "unrecorded.npz"),
    ):
        with pytest.raises(SidecarError):
            check_basis(bad)

    assert sorted(load_sidecar(_sidecar(root / "ok.npz", [3, 4], good))) == [3, 4]
    with pytest.raises(SidecarError, match="does not name the basis"):
        load_sidecar(_sidecar(root / "nameless.npz", [3, 4], None))
    with pytest.raises(SidecarError):
        load_sidecar(_sidecar(root / "wrong.npz", [3, 4], root / "on_validation.npz"))
    with pytest.raises(HoldoutError):
        load_sidecar(_sidecar(root / "held.npz", [3, 101], good))


def _extract(monkeypatch: pytest.MonkeyPatch, archive: Path, basis: Path, *flags: str) -> None:
    def no_backbone() -> None:
        raise AssertionError("the backbone loaded before the archive was checked")

    monkeypatch.setattr(extract_frame_embeddings, "backbone", no_backbone)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "extract_frame_embeddings.py",
            "--videos",
            str(archive.parent),
            "--archive",
            str(archive),
            "--out",
            str(archive.with_name("sidecar.npz")),
            "--basis",
            str(basis),
            *flags,
        ],
    )
    extract_frame_embeddings.main()


def test_extraction_fits_the_basis_on_train_only(
    frozen_splits: FrozenSplits, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = frozen_splits.root
    train = frozen_splits.archive("train", [1, 2])
    validation = frozen_splits.archive("validation", [3, 4], fill=1.0)
    frozen_splits.freeze(train, "train")
    frozen_splits.freeze(validation, "validation")
    holdout = _with_holdout(frozen_splits)
    basis = root / "basis.npz"

    with pytest.raises(ManifestError, match="not the archive of any frozen `train`"):
        _extract(monkeypatch, validation, basis, "--fit-basis")
    with pytest.raises(HoldoutError, match="release_gate"):
        _extract(monkeypatch, holdout, basis, "--fit-basis")
    with pytest.raises(HoldoutError):
        _extract(monkeypatch, holdout, basis)
    # Without --fit-basis, a stored basis must itself have been fitted on train.
    _basis(basis, fitted_on=str(validation))
    with pytest.raises(SidecarError):
        _extract(monkeypatch, validation, basis)
    # Fitting on the frozen train archive gets as far as the backbone.
    with pytest.raises(AssertionError, match="backbone loaded"):
        _extract(monkeypatch, train, basis, "--fit-basis")


def test_the_rule_names_the_gate() -> None:
    assert "python -m swingml.model.release_gate" in HOLDOUT_RULE
