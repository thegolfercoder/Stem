"""Image columns beside the pose columns, without disturbing the pose model.

A fused model starts from the shipped pose-only network with the new inputs
weighted zero, so before any training it must give exactly the shipped answers;
a sidecar that does not describe the same clips row for row must be refused
rather than silently misaligned; and a pose-only model scored on fused clips must
read only the columns it was trained on.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import torch

from swingml.model.rgb import (
    FirstColumns,
    SidecarError,
    fuse,
    fuse_archive,
    load_sidecar,
    reading,
    widen_inputs,
)
from swingml.model.tcn import SwingEventNet
from tests.conftest import FrozenSplits


def _net(width: int) -> SwingEventNet:
    torch.manual_seed(0)
    return SwingEventNet(width, channels=16, dilations=(1, 2), kernel_size=3).eval()


def test_widening_leaves_the_answers_unchanged() -> None:
    net = _net(10)
    pose = torch.randn(1, 40, 10)
    before = net(pose).detach()
    widened = widen_inputs(net, 14).eval()
    images = torch.randn(1, 40, 4)
    after = widened(torch.cat([pose, images], dim=2)).detach()
    assert widened.in_features == 14
    torch.testing.assert_close(after, before)
    with pytest.raises(ValueError):
        widen_inputs(widened, 12)


def test_a_pose_only_model_reads_only_its_own_columns() -> None:
    net = _net(10)
    fused = np.random.default_rng(0).normal(size=(40, 14)).astype(np.float32)
    wrapped = reading(net, 14)
    assert isinstance(wrapped, FirstColumns)
    with torch.no_grad():
        direct = net(torch.from_numpy(fused[:, :10]).unsqueeze(0))[0].numpy()
    np.testing.assert_allclose(wrapped.logits(fused), direct, rtol=1e-6)
    assert reading(net, 10) is net


def _archive(path: Path, ids: list[int], lengths: list[int], width: int) -> Path:
    np.savez(
        path,
        lengths=np.array(lengths),
        features=np.arange(sum(lengths) * width, dtype=np.float32).reshape(-1, width),
        events=np.zeros((len(ids), 8), dtype=np.int64),
        seeds=np.array(ids),
    )
    return path


def test_fusing_checks_clips_and_rows(tmp_path: Path, frozen_splits: FrozenSplits) -> None:
    archive = _archive(tmp_path / "a.npz", [7, 9], [5, 3], 2)
    frozen_splits.freeze(archive, "train")
    basis = tmp_path / "basis.npz"
    np.savez(basis, fitted_on=str(archive))  # projected with a basis fitted on train
    sidecar = tmp_path / "s.npz"
    np.savez(
        sidecar,
        seeds=np.array([9, 7]),
        lengths=np.array([3, 5]),
        embeddings=np.ones((8, 4), dtype=np.float16),
        basis=str(basis),
    )
    width = fuse_archive(archive, sidecar, tmp_path / "fused.npz")
    fused = np.load(tmp_path / "fused.npz")
    assert width == 6 and fused["features"].shape == (8, 6)
    np.testing.assert_array_equal(fused["features"][:, :2], np.load(archive)["features"])
    table = load_sidecar(sidecar)
    with pytest.raises(SidecarError):
        fuse(np.zeros((4, 2), dtype=np.float32), 7, table)  # 5 image rows, 4 pose rows
    with pytest.raises(SidecarError):
        fuse(np.zeros((5, 2), dtype=np.float32), 8, table)  # no such clip
