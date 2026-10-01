"""Positions a golfer set by hand, kept so they can become training labels.

The model is fine-tuned on broadcast footage, and more broadcast footage stopped
helping on phone video: it teaches the broadcast labellers' idea of where
address is, and one phone clip in the repository says a phone golfer's address
is somewhere else. The only thing that can settle that is phone swings with
their positions marked, and the person best placed to mark them is the golfer
who filmed them and is already looking at the frames.

So a swing keeps two things next to its pictures: the tracked landmarks, and,
once the golfer has moved any position, the eight frames they chose beside the
eight the model chose. A swing becomes a training label only when the golfer
says all eight are right; moving one position is a correction, not a claim
about the other seven.

Frame numbers here index the tracked sequence, as `event_source_frames` does,
not the video: a 240 fps clip is tracked at 60.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from swingml.pose.base import PoseSequence
from swingml.skeleton import Handedness

POSE_FILE = "pose.npz"
POSITIONS_FILE = "positions.json"
MODEL_ANALYSIS_FILE = "model_analysis.json"
"""The model's own answer, kept when the golfer first moves a position so it can
be put back."""


class GolferPositions(BaseModel):
    """The eight positions as the golfer set them, and as the model had them."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    frames: tuple[int, ...] = Field(description="The golfer's eight, in the tracked sequence.")
    model_frames: tuple[int, ...] = Field(description="Where the model had put them.")
    handedness: Handedness
    training_label: bool = Field(
        default=False,
        description=(
            "The golfer confirmed all eight are right and agreed to the swing being "
            "used to train the model. Never inferred from a correction."
        ),
    )
    set_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def moved(self) -> tuple[bool, ...]:
        return tuple(a != b for a, b in zip(self.frames, self.model_frames, strict=True))


def save_pose(sequence: PoseSequence, directory: Path) -> Path:
    """Keep the tracked landmarks, so positions can be re-measured without the video."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / POSE_FILE
    np.savez_compressed(
        path,
        xy=sequence.xy.astype(np.float32),
        visibility=sequence.visibility.astype(np.float32),
        timestamps_s=sequence.timestamps_s.astype(np.float64),
        frame_width=np.int64(sequence.frame_width),
        frame_height=np.int64(sequence.frame_height),
        world_xyz=(
            sequence.world_xyz.astype(np.float32)
            if sequence.world_xyz is not None
            else np.zeros((0,), dtype=np.float32)
        ),
        detected=(
            sequence.detected.astype(bool)
            if sequence.detected is not None
            else np.zeros((0,), dtype=bool)
        ),
    )
    return path


def load_pose(directory: Path) -> PoseSequence | None:
    path = directory / POSE_FILE
    if not path.is_file():
        return None
    data = np.load(path)
    world = data["world_xyz"]
    detected = data["detected"]
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=world if world.size else None,
        detected=detected if detected.size else None,
    )


def read_positions(directory: Path) -> GolferPositions | None:
    path = directory / POSITIONS_FILE
    if not path.is_file():
        return None
    return GolferPositions.model_validate_json(path.read_text(encoding="utf-8"))


def write_positions(directory: Path, positions: GolferPositions) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / POSITIONS_FILE).write_text(positions.model_dump_json(indent=2), encoding="utf-8")


def clear_positions(directory: Path) -> None:
    for name in (POSITIONS_FILE, MODEL_ANALYSIS_FILE):
        (directory / name).unlink(missing_ok=True)


def save_model_analysis(directory: Path, analysis: dict[str, object]) -> None:
    """Keep the model's answer the first time it is overridden, and only then."""
    path = directory / MODEL_ANALYSIS_FILE
    if not path.is_file():
        path.write_text(json.dumps(analysis), encoding="utf-8")


def load_model_analysis(directory: Path) -> dict[str, object] | None:
    path = directory / MODEL_ANALYSIS_FILE
    if not path.is_file():
        return None
    loaded = json.loads(path.read_text(encoding="utf-8"))
    return loaded if isinstance(loaded, dict) else None


def training_labels(frames_root: Path) -> Iterator[tuple[int, GolferPositions, PoseSequence]]:
    """Every swing the golfer has confirmed as a label, with its landmarks."""
    if not frames_root.is_dir():
        return
    for directory in sorted(frames_root.iterdir(), key=lambda p: (len(p.name), p.name)):
        if not directory.name.isdigit():
            continue
        positions = read_positions(directory)
        if positions is None or not positions.training_label:
            continue
        sequence = load_pose(directory)
        if sequence is None:
            continue
        yield int(directory.name), positions, sequence
