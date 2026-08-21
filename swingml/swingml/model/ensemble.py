"""Several models answering together, and one of them answering twice.

Two ways to buy accuracy that need no new data and no larger network.

**An ensemble.** Models trained from different starting points make different
mistakes, and averaging their scores cancels the disagreements while leaving the
agreement. It costs training time, which is cheap and happens once, and inference
time proportional to the number of members, which at this size is milliseconds.

**Test-time augmentation.** The same clip, played at slightly different speeds,
gives the model several looks at the same swing. Where it is sure the looks agree
and averaging changes nothing; where it is unsure they disagree and averaging
finds the middle. It costs nothing but repeated forward passes.

Both are averaged in *probability* space rather than over logits. Logits from
independently trained networks are not on a common scale - one model can be
systematically more emphatic than another and would dominate a mean of logits
without being any more right.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.features import feature_layout
from swingml.model.augment import time_warp
from swingml.model.tcn import SwingEventNet


class EnsembleConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    time_warps: tuple[float, ...] = Field(
        default=(1.0,),
        description=(
            "Speed factors to evaluate each member at. (1.0,) is off. Values either "
            "side of one give the model a slower and a faster look at the same swing."
        ),
    )


class SwingEventEnsemble:
    """One or more trained models, answering as one.

    A single model loaded through here behaves exactly as it would alone, so the
    rest of the pipeline does not need to know which it has.
    """

    def __init__(self, members: list[SwingEventNet], config: EnsembleConfig | None = None) -> None:
        if not members:
            raise ValueError("an ensemble needs at least one model")
        self.members = members
        self.config = config or EnsembleConfig()
        self.layout = feature_layout()
        for member in self.members:
            member.eval()

    @classmethod
    def load(
        cls, paths: list[Path] | Path, config: EnsembleConfig | None = None
    ) -> SwingEventEnsemble:
        from swingml.analysis import load_model

        if isinstance(paths, Path):
            paths = [paths]
        return cls([load_model(path) for path in paths], config)

    @property
    def n_members(self) -> int:
        return len(self.members)

    def probabilities(self, features: NDArray[np.float32]) -> NDArray[np.float32]:
        """Per-frame class probabilities, shape (T, classes).

        Each member is run at each requested speed, every result is mapped back
        onto the original frame grid, and the lot is averaged.
        """
        n_frames = features.shape[0]
        events = np.array([0, 1, 2, 3, 4, 5, 6, 7], dtype=np.int64)
        accumulated: NDArray[np.float64] | None = None
        count = 0

        for factor in self.config.time_warps:
            if factor == 1.0:
                view = features
            else:
                view, _ = time_warp(features, events, factor, self.layout)
            tensor = torch.from_numpy(np.ascontiguousarray(view))[None, ...]

            for member in self.members:
                with torch.no_grad():
                    logits = member(tensor)[0]
                probabilities = torch.softmax(logits, dim=-1).numpy().astype(np.float64)
                if probabilities.shape[0] != n_frames:
                    probabilities = _resample_rows(probabilities, n_frames)
                accumulated = probabilities if accumulated is None else accumulated + probabilities
                count += 1

        assert accumulated is not None
        return (accumulated / count).astype(np.float32)

    def logits(self, features: NDArray[np.float32]) -> NDArray[np.float32]:
        """Log of the averaged probabilities, for a decoder that wants scores."""
        return np.log(np.maximum(self.probabilities(features), 1e-12)).astype(np.float32)


def _resample_rows(values: NDArray[np.float64], target: int) -> NDArray[np.float64]:
    """Put a warped result back on the original frame grid."""
    n = values.shape[0]
    source = np.linspace(0.0, n - 1, target)
    lower = np.floor(source).astype(int)
    upper = np.minimum(lower + 1, n - 1)
    blend = (source - lower)[:, None]
    return np.asarray(values[lower] * (1.0 - blend) + values[upper] * blend, dtype=np.float64)
