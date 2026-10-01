"""A right-handed swing as a left-hander would make it, for tests (#33).

The picture is flipped left to right and MediaPipe's left and right landmarks
trade places, so the pose is the same body seen in a mirror: a right-handed
swing becomes a left-handed one with identical timing.
"""

from __future__ import annotations

import numpy as np

from swingml.pose.base import PoseSequence

# MediaPipe Pose's left/right landmark pairs (the nose, 0, has no partner).
PAIRS = (
    (1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
    (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32),
)  # fmt: skip


def swap_sides(index: np.ndarray) -> np.ndarray:
    order = np.arange(33)
    for a, b in PAIRS:
        order[a], order[b] = b, a
    return index[:, order]


def mirrored(sequence: PoseSequence) -> PoseSequence:
    xy = sequence.xy.copy()
    xy[..., 0] = 1.0 - xy[..., 0]
    world = None
    if sequence.world_xyz is not None:
        world = sequence.world_xyz.copy()
        world[..., 0] = -world[..., 0]
        world = swap_sides(world)
    return sequence.model_copy(
        update={
            "xy": swap_sides(xy),
            "visibility": swap_sides(sequence.visibility),
            "world_xyz": world,
        }
    )
