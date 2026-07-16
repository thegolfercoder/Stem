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
                rec[f"avg_{key}"] = float(np.mean([getattr(o, key) for o in organisms]))
            rec["avg_energy"] = float(np.mean([o.energy for o in organisms]))
            rec["avg_generation"] = float(np.mean([o.genome.generation for o in organisms]))
            diets = np.array([o.diet for o in organisms])
            rec["herbivores"] = int(np.sum(diets < 0.35))
            rec["omnivores"] = int(np.sum((diets >= 0.35) & (diets <= 0.65)))
            rec["carnivores"] = int(np.sum(diets > 0.65))
        else:
            for key in TRAIT_KEYS:
                rec[f"avg_{key}"] = float("nan")
            rec["avg_energy"] = float("nan")
            rec["avg_generation"] = float("nan")
            rec["herbivores"] = rec["omnivores"] = rec["carnivores"] = 0

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
