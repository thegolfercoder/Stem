"""Scientific data logging.

Evolution is only convincing if it is *measured*. Each tick the engine hands the
recorder a snapshot; the recorder derives population-level statistics -- means of
every trait, species counts, births/deaths broken down by cause, trophic
structure -- and stores them as a tidy time series that can be written to
CSV/JSON and fed to the Matplotlib analysis module.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

TRAIT_KEYS = [
    "speed",
    "vision",
    "metabolism",
    "size",
    "lifespan",
    "camouflage",
    "diet",
    "aggression",
]


def _shannon(species_ids: list) -> float:
    """Shannon diversity index H = -Σ pᵢ·ln pᵢ over species.

    A standard ecology measure of biodiversity: it rises with both the number
    of species and how evenly individuals are spread across them. H = 0 means a
    single lineage dominates (competitive exclusion); higher H means a rich,
    balanced community.
    """
    ids, counts = np.unique(np.asarray(species_ids), return_counts=True)
    if len(ids) <= 1:
        return 0.0
    p = counts / counts.sum()
    return float(-np.sum(p * np.log(p)))


def _genetic_diversity(organisms: list) -> float:
    """Mean per-gene variance across the population (genes are normalized 0–1).

    A genotype-level measure of standing variation -- the raw material evolution
    works with. It collapses toward zero as the gene pool converges on one
    'fittest' design and grows when lineages diverge.
    """
    genes = np.array([o.genome.genes for o in organisms], dtype=float)
    return float(genes.var(axis=0).mean())


class StatsRecorder:
    def __init__(self):
        self.records: list[dict] = []
        # Per-tick counters, reset by the engine after each snapshot.
        self.births = 0
        self.deaths_starvation = 0
        self.deaths_predation = 0
        self.deaths_old_age = 0

    def reset_counters(self) -> None:
        self.births = 0
        self.deaths_starvation = 0
        self.deaths_predation = 0
        self.deaths_old_age = 0

    def snapshot(self, tick: int, organisms: list, food_count: int, species_count: int) -> dict:
        n = len(organisms)
        rec: dict = {
            "tick": tick,
            "population": n,
            "food": food_count,
            "species": species_count,
            "births": self.births,
            "deaths_starvation": self.deaths_starvation,
            "deaths_predation": self.deaths_predation,
            "deaths_old_age": self.deaths_old_age,
        }
        if n > 0:
            for key in TRAIT_KEYS:
                vals = np.array([getattr(o, key) for o in organisms], dtype=float)
                rec[f"avg_{key}"] = float(vals.mean())
                # Spread of a trait = how much variation selection still has to
                # act on (it shrinks as a trait is fixed by directional selection).
                rec[f"std_{key}"] = float(vals.std())
            rec["avg_energy"] = float(np.mean([o.energy for o in organisms]))
            rec["avg_generation"] = float(np.mean([o.genome.generation for o in organisms]))
            diets = np.array([o.diet for o in organisms])
            rec["herbivores"] = int(np.sum(diets < 0.35))
            rec["omnivores"] = int(np.sum((diets >= 0.35) & (diets <= 0.65)))
            rec["carnivores"] = int(np.sum(diets > 0.65))
            rec["shannon_index"] = _shannon([o.species_id for o in organisms])
            rec["genetic_diversity"] = _genetic_diversity(organisms)
        else:
            for key in TRAIT_KEYS:
                rec[f"avg_{key}"] = float("nan")
                rec[f"std_{key}"] = float("nan")
            rec["avg_energy"] = float("nan")
            rec["avg_generation"] = float("nan")
            rec["herbivores"] = rec["omnivores"] = rec["carnivores"] = 0
            rec["shannon_index"] = float("nan")
            rec["genetic_diversity"] = float("nan")

        self.records.append(rec)
        self.reset_counters()
        return rec

    # --------------------------------------------------------------- export ---
    def column(self, key: str) -> np.ndarray:
        return np.array([r.get(key, float("nan")) for r in self.records], dtype=float)

    def to_json(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.records, indent=2))

    def to_csv(self, path: str | Path) -> None:
        if not self.records:
            Path(path).write_text("")
            return
        keys = list(self.records[0].keys())
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=keys)
            writer.writeheader()
            writer.writerows(self.records)
