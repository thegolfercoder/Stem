"""The digital planet: terrain, plants, and the spatial environment.

The world provides three things the ecosystem depends on:

* **Terrain** -- a coarse colour field. Camouflage effectiveness is the match
  between an organism's colour and the terrain it sits on, so terrain creates
  spatially varying selection pressure (an organism adapted to one biome is
  exposed in another).
* **Food (plants)** -- primary producers that regrow up to a carrying capacity
  and cluster on fertile terrain, forming the base of the food web.
* **Geometry** -- world size and toroidal wrapping helpers.
"""

from __future__ import annotations

import numpy as np

from .config import SimulationConfig
from .spatial import SpatialHash


class World:
    def __init__(self, config: SimulationConfig, rng: np.random.Generator):
        self.config = config
        self.rng = rng
        self.width = config.world.width
        self.height = config.world.height

        # --- Terrain colour field (used for the camouflage mechanic) --------
        tx, ty = config.world.terrain_cells_x, config.world.terrain_cells_y
        # Smoothly varying RGB in [0, 1] per terrain cell.
        base = rng.random((ty, tx, 3))
        # Blend with neighbours so biomes look coherent rather than static.
        self.terrain = 0.5 * base + 0.5 * np.roll(base, 1, axis=1)
        # "Fertility" per cell biases where plants grow (greener = more fertile).
        self.fertility = 0.3 + 0.7 * self.terrain[:, :, 1]
        self._terr_cell_w = self.width / tx
        self._terr_cell_h = self.height / ty

        # --- Food state -----------------------------------------------------
        # ``food_alive`` lets us mark plants eaten *during* a tick without
        # resizing the arrays (which would invalidate the spatial-hash indices
        # built at the start of the tick). Dead plants are compacted away once
        # per tick by :meth:`compact_food`.
        self.food_pos = np.empty((0, 2))
        self.food_energy = np.empty((0,))
        self.food_alive = np.empty((0,), dtype=bool)
        self._food_hash = SpatialHash(
            self.width, self.height, cell_size=48.0, wrap=config.world.wrap
        )
        self._seed_initial_food()

    # ---------------------------------------------------------------- food ---
    def _sample_fertile_positions(self, n: int) -> np.ndarray:
        """Sample n positions, biased toward fertile terrain when configured."""
        if n <= 0:
            return np.empty((0, 2))
        bias = self.config.food.cluster_bias
        # A fraction of plants are placed uniformly; the rest cluster on fertile
        # cells chosen proportionally to fertility.
        n_cluster = int(n * bias)
        n_uniform = n - n_cluster

        pos = []
        if n_uniform > 0:
            pos.append(
                self.rng.random((n_uniform, 2)) * [self.width, self.height]
            )
        if n_cluster > 0:
            flat = self.fertility.flatten()
            probs = flat / flat.sum()
            cells = self.rng.choice(len(flat), size=n_cluster, p=probs)
            ty, tx = self.fertility.shape
            cy, cx = np.divmod(cells, tx)
            jitter = self.rng.random((n_cluster, 2))
            xs = (cx + jitter[:, 0]) * self._terr_cell_w
            ys = (cy + jitter[:, 1]) * self._terr_cell_h
            pos.append(np.stack([xs, ys], axis=1))
        return np.concatenate(pos, axis=0)

    def _seed_initial_food(self) -> None:
        n = self.config.food.initial_count
        self.food_pos = self._sample_fertile_positions(n)
        self.food_energy = np.full(n, self.config.food.energy_per_item)
        self.food_alive = np.ones(n, dtype=bool)

    def compact_food(self) -> None:
        """Drop plants marked eaten this tick. Call once at end of a tick."""
        if len(self.food_pos) == 0 or self.food_alive.all():
            return
        keep = self.food_alive
        self.food_pos = self.food_pos[keep]
        self.food_energy = self.food_energy[keep]
        self.food_alive = np.ones(len(self.food_pos), dtype=bool)

    def regrow(self) -> None:
        """Grow new plants toward the carrying capacity (logistic-ish)."""
        cap = self.config.food.carrying_capacity
        current = len(self.food_pos)
        free = cap - current
        if free <= 0:
            return
        # More plants regrow when there is more free capacity (density feedback).
        expected = self.config.food.regrowth_rate * free * (free / cap)
        n_new = self.rng.poisson(max(expected, 0.0))
        n_new = int(min(n_new, free))
        if n_new <= 0:
            return
        new_pos = self._sample_fertile_positions(n_new)
        new_energy = np.full(n_new, self.config.food.energy_per_item)
        self.food_pos = np.concatenate([self.food_pos, new_pos], axis=0)
        self.food_energy = np.concatenate([self.food_energy, new_energy])
        self.food_alive = np.concatenate([self.food_alive, np.ones(n_new, dtype=bool)])

    def rebuild_food_index(self) -> None:
        self._food_hash.rebuild(self.food_pos)

    def find_food_near(self, x: float, y: float, radius: float) -> list[int]:
        return self._food_hash.query_radius(x, y, radius)

    def is_food_alive(self, index: int) -> bool:
        return 0 <= index < len(self.food_alive) and bool(self.food_alive[index])

    def consume_food(self, indices: list[int]) -> None:
        """Mark plants as eaten (compacted away at end of tick)."""
        for i in indices:
            if 0 <= i < len(self.food_alive):
                self.food_alive[i] = False

    # ------------------------------------------------------------- terrain ---
    def terrain_color_at(self, x: float, y: float) -> np.ndarray:
        """RGB terrain colour (0-1) at a world position."""
        ty, tx = self.fertility.shape
        cx = int((x % self.width) / self._terr_cell_w) % tx
        cy = int((y % self.height) / self._terr_cell_h) % ty
        return self.terrain[cy, cx]

    # ------------------------------------------------------------ geometry ---
    def wrap_position(self, pos: np.ndarray) -> np.ndarray:
        if self.config.world.wrap:
            pos[..., 0] %= self.width
            pos[..., 1] %= self.height
        else:
            pos[..., 0] = np.clip(pos[..., 0], 0, self.width)
            pos[..., 1] = np.clip(pos[..., 1], 0, self.height)
        return pos
