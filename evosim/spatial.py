"""Spatial hash grid for O(1)-ish neighbour queries.

Vision, eating and predation all boil down to "what is near position P?".
A naive all-pairs scan is O(n^2) and kills performance once the population
grows into the thousands. This uniform-grid spatial hash buckets entities by
cell so a radius query only inspects the handful of nearby cells.

The grid is rebuilt each tick from the current positions (cheap, vectorized),
which keeps the data structure simple and correct as organisms move.
"""

from __future__ import annotations

import math
from typing import Iterable, List, Tuple

import numpy as np


class SpatialHash:
    def __init__(self, width: float, height: float, cell_size: float, wrap: bool = True):
        self.width = width
        self.height = height
        self.cell_size = max(cell_size, 1.0)
        self.wrap = wrap
        self.cols = max(1, int(math.ceil(width / self.cell_size)))
        self.rows = max(1, int(math.ceil(height / self.cell_size)))
        self._cells: dict[Tuple[int, int], List[int]] = {}

    def _cell_of(self, x: float, y: float) -> Tuple[int, int]:
        return (int(x // self.cell_size) % self.cols, int(y // self.cell_size) % self.rows)

    def rebuild(self, positions: np.ndarray) -> None:
        """Rebuild the grid from an (n, 2) array of positions."""
        self._cells = {}
        if len(positions) == 0:
            return
        cx = (positions[:, 0] // self.cell_size).astype(int) % self.cols
        cy = (positions[:, 1] // self.cell_size).astype(int) % self.rows
        for idx, (i, j) in enumerate(zip(cx, cy)):
            self._cells.setdefault((int(i), int(j)), []).append(idx)

    def query_radius(self, x: float, y: float, radius: float) -> List[int]:
        """Return indices of entities whose *cell* is within ``radius`` of (x, y).

        This is a broad-phase filter: it may return a few entities just outside
        the radius, so callers still do an exact distance check. That trade-off
        is what makes it fast.
        """
        reach = int(math.ceil(radius / self.cell_size))
        cx, cy = self._cell_of(x, y)
        found: List[int] = []
        for di in range(-reach, reach + 1):
            for dj in range(-reach, reach + 1):
                i = (cx + di) % self.cols if self.wrap else cx + di
                j = (cy + dj) % self.rows if self.wrap else cy + dj
                bucket = self._cells.get((i, j))
                if bucket:
                    found.extend(bucket)
        return found


def toroidal_delta(a: np.ndarray, b: np.ndarray, width: float, height: float) -> np.ndarray:
    """Shortest vector from ``a`` to ``b`` on a wrapping (toroidal) world."""
    d = b - a
    d[..., 0] -= width * np.round(d[..., 0] / width)
    d[..., 1] -= height * np.round(d[..., 1] / height)
    return d
