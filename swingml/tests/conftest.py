"""Frozen splits made up for a test, in place of the package's manifests."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

from swingml.dataset import manifest as manifests


@dataclass
class FrozenSplits:
    """Archives written under `root` and frozen into `root/manifests`."""

    root: Path

    def archive(self, name: str, ids: list[int], *, golfdb: bool = True, fill: float = 0.0) -> Path:
        """A pose archive of one-row clips, in the layout every loader reads.

        `golfdb` adds the `golfdb_split` column GolfDB archives carry, which is what
        tells the guard the seeds are GolfDB clip ids rather than synthesis seeds.
        """
        n = len(ids)
        columns = {
            "lengths": np.full(n, 3),
            "features": np.full((3 * n, 4), fill, dtype=np.float32),
            "events": np.tile(np.arange(8), (n, 1)),
            "seeds": np.array(ids),
            "tempo_ratio": np.full(n, 3.0),
            "azimuth_deg": np.zeros(n),
            "capture_rate_hz": np.full(n, 60.0),
            "left_handed": np.zeros(n),
            "slow": np.zeros(n),
        }
        if golfdb:
            columns["golfdb_split"] = np.ones(n)
        path = self.root / f"{name}.npz"
        np.savez(path, **columns)  # type: ignore[arg-type]
        return path

    def freeze(self, archive: Path, split: str) -> Path:
        ids = manifests.clip_ids_of(archive)
        frozen = manifests.freeze(
            archive,
            name=f"test-{split}",
            split=split,
            groups_by_clip={c: f"golfer{c}" for c in ids},
            source="made up for a test",
            relative_to=self.root,
        )
        path = self.root / "manifests" / f"test-{split}.json"
        path.write_text(frozen.model_dump_json(indent=2), encoding="utf-8")
        return path


@pytest.fixture
def frozen_splits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FrozenSplits:
    """Point the package at an empty manifests directory of this test's own."""
    (tmp_path / "manifests").mkdir()
    monkeypatch.setattr(manifests, "MANIFESTS", tmp_path / "manifests")
    return FrozenSplits(tmp_path)
