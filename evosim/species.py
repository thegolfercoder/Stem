"""Emergent speciation via compatibility clustering (NEAT-style).

Species are **not** predefined. Instead, every so often the whole population is
clustered by genetic distance: an organism joins the first existing species
whose representative is within :attr:`compatibility_threshold`, otherwise it
founds a brand-new species. As lineages accumulate mutations and drift apart,
clusters split -- so the *number* and *identity* of species is an emergent,
unscripted output of the simulation, which is precisely what Darwinian
divergence predicts.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import numpy as np

from .config import SpeciationConfig
from .genome import Genome


@dataclass
class Species:
    id: int
    representative: Genome
    color: tuple[int, int, int]
    members: list = field(default_factory=list)
    born_tick: int = 0
    peak_size: int = 0


class SpeciesTracker:
    def __init__(self, config: SpeciationConfig, rng: np.random.Generator):
        self.config = config
        self.rng = rng
        self.species: dict[int, Species] = {}
        self._id = itertools.count(1)

    def _new_species(self, rep: Genome, tick: int) -> Species:
        sid = next(self._id)
        color = tuple(int(c) for c in self.rng.integers(60, 255, size=3))
        sp = Species(id=sid, representative=rep.copy(), color=color, born_tick=tick)
        self.species[sid] = sp
        return sp

    def classify(self, organisms: list, tick: int) -> None:
        """Assign every organism to a species, creating/pruning as needed."""
        # Reset membership; keep representatives from last round for stability.
        for sp in self.species.values():
            sp.members = []

        rep_items = list(self.species.values())
        threshold = self.config.compatibility_threshold

        for org in organisms:
            best_sp = None
            best_dist = threshold
            for sp in rep_items:
                d = org.genome.distance(sp.representative)
                if d < best_dist:
                    best_dist = d
                    best_sp = sp
            if best_sp is None:
                best_sp = self._new_species(org.genome, tick)
                rep_items.append(best_sp)
            best_sp.members.append(org)
            org.species_id = best_sp.id

        # Update representatives to a random member and prune empty/tiny species.
        survivors: dict[int, Species] = {}
        for sp in self.species.values():
            if len(sp.members) >= self.config.min_species_size:
                rep = sp.members[self.rng.integers(len(sp.members))]
                sp.representative = rep.genome.copy()
                sp.peak_size = max(sp.peak_size, len(sp.members))
                survivors[sp.id] = sp
            elif sp.members:
                # Too small to be its own species: fold members into nearest.
                for org in sp.members:
                    org.species_id = self._nearest_existing(org, survivors, threshold)
        self.species = survivors

    def _nearest_existing(self, org, pool: dict, threshold: float) -> int:
        best_id, best = -1, float("inf")
        for sid, sp in pool.items():
            d = org.genome.distance(sp.representative)
            if d < best:
                best, best_id = d, sid
        if best_id != -1 and best <= threshold * 1.5:
            pool[best_id].members.append(org)
            return best_id
        return org.species_id

    @property
    def count(self) -> int:
        return len(self.species)
