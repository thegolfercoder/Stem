"""Image features beside the pose features: sidecars, fusion, and mixed scoring.

`scripts/extract_frame_embeddings.py` writes, per GolfDB clip, a compact image
description of every row of the 60 Hz grid the poses are on. This module appends
those columns to the pose features (after them, so the pose columns keep their
indices and `compress` keeps rescaling only the per-second pose channels), widens
a trained pose-only network to take them with zero weights, so training starts
from exactly the pose-only model's answers, and lets a pose-only model be scored
on fused clips by reading only the columns it was trained on.

The frozen archives are never rewritten: fused training archives are new files
under out/, and scoring verifies the pose archive against its manifest first and
appends the sidecar afterwards, checking clip ids and lengths row for row.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray


class SidecarError(ValueError):
    """The sidecar does not describe the same clips, row for row, as the archive."""


def load_sidecar(path: Path) -> dict[int, NDArray[np.float32]]:
    data = np.load(path)
    offsets = np.concatenate(([0], np.cumsum(data["lengths"])))
    embeddings = data["embeddings"]
    return {
        int(clip): np.asarray(embeddings[offsets[i] : offsets[i + 1]], dtype=np.float32)
        for i, clip in enumerate(data["seeds"])
    }


def fuse(
    features: NDArray[np.float32], clip_id: int, sidecar: dict[int, NDArray[np.float32]]
) -> NDArray[np.float32]:
    extra = sidecar.get(int(clip_id))
    if extra is None:
        raise SidecarError(f"clip {clip_id} has no image features")
    if len(extra) != len(features):
        raise SidecarError(f"clip {clip_id}: {len(extra)} image rows against {len(features)}")
    return np.concatenate([features, extra], axis=1).astype(np.float32)


def fuse_archive(archive: Path, sidecar_path: Path, out: Path) -> int:
    """A copy of `archive` with the image columns appended to every row."""
    data = dict(np.load(archive))
    sidecar = load_sidecar(sidecar_path)
    offsets = np.concatenate(([0], np.cumsum(data["lengths"])))
    rows = [
        fuse(data["features"][offsets[i] : offsets[i + 1]], int(clip), sidecar)
        for i, clip in enumerate(data["seeds"])
    ]
    data["features"] = np.concatenate(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **data)
    return int(data["features"].shape[1])


def widen_inputs(model: Any, in_features: int) -> Any:
    """The same network taking `in_features` inputs, the new ones weighted zero."""
    import torch

    old = model.input_projection
    if in_features == old.in_channels:
        return model
    if in_features < old.in_channels:
        raise ValueError(f"cannot narrow {old.in_channels} inputs to {in_features}")
    new = torch.nn.Conv1d(in_features, old.out_channels, kernel_size=1)
    with torch.no_grad():
        new.weight.zero_()
        new.weight[:, : old.in_channels] = old.weight
        if new.bias is not None and old.bias is not None:
            new.bias.copy_(old.bias)
    model.input_projection = new
    model.in_features = in_features
    return model


class FirstColumns:
    """A model that reads only the first `n` columns, for scoring on fused clips."""

    def __init__(self, model: Any, n: int) -> None:
        self.model = model
        self.n = n

    def logits(self, features: NDArray[np.float32]) -> NDArray[np.float32]:
        from swingml.model.release_gate import logits_of

        return logits_of(self.model, np.ascontiguousarray(features[:, : self.n]))


def input_width(model: Any) -> int | None:
    width = getattr(model, "in_features", None)
    return int(width) if width is not None else None


def reading(model: Any, clip_width: int) -> Any:
    """`model` as it should read clips `clip_width` columns wide."""
    width = input_width(model)
    return FirstColumns(model, width) if width is not None and width < clip_width else model
