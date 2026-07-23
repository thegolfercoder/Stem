"""Organism: an individual agent in the ecosystem.

An organism is the unit of selection. It carries a :class:`Genome`, a position,
an energy budget, and an age. Its heritable traits are *expressed* from the
genome once at birth and cached for speed. All of its verbs -- move, eat, hunt,
reproduce, die -- are driven by that genome, so differences in survival and
reproduction are differences in genes: natural selection.

Interaction logic that needs the whole world (who is near whom, who eats whom)
lives in :class:`~evosim.simulation.Simulation`; this class owns the individual
state and the bioenergetics of a single life.
"""

from __future__ import annotations

import itertools

import numpy as np

from .config import EnergyConfig
from .genome import Genome

_id_counter = itertools.count(1)


class Organism:
    __slots__ = (
        "id",
        "genome",
        "pos",
        "energy",
        "age",
        "alive",
        "repro_cooldown",
        "wander_heading",
        "rng",
        "species_id",
        "children",
        # cached expressed traits
        "speed",
        "vision",
        "metabolism",
        "size",
        "lifespan",
        "camouflage",
        "diet",
        "aggression",
        "repro_threshold",
        "offspring_investment",
        "max_energy",
    )

    def __init__(
        self,
        genome: Genome,
        pos: np.ndarray,
        energy: float,
        rng: np.random.Generator,
        energy_cfg: EnergyConfig,
    ):
        self.id = next(_id_counter)
        self.genome = genome
        self.pos = pos.astype(float)
        self.energy = float(energy)
        self.age = 0
        self.alive = True
        self.repro_cooldown = 0
        self.rng = rng
        self.species_id = -1
        self.children = 0

        # Express phenotype from genotype (done once; traits are fixed for life).
        self.speed = genome.trait("speed")
        self.vision = genome.trait("vision")
        self.metabolism = genome.trait("metabolism")
        self.size = genome.trait("size")
        self.lifespan = genome.trait("lifespan")
        self.camouflage = genome.trait("camouflage")
        self.diet = genome.trait("diet")
        self.aggression = genome.trait("aggression")
        self.repro_threshold = genome.trait("repro_threshold")
        self.offspring_investment = genome.trait("offspring_investment")
        # Larger bodies can bank more energy.
        self.max_energy = energy_cfg.max_energy * (0.6 + 0.4 * self.size)
        self.wander_heading = float(rng.random() * 2 * np.pi)

    # -------------------------------------------------------- bioenergetics ---
    def metabolic_cost(self, energy_cfg: EnergyConfig, throttle: float) -> float:
        """Energy spent this tick: basal (Kleiber ~ size**0.75) + locomotion.

        Faster, bigger, higher-metabolism bodies cost more to run -- which is
        exactly the trade-off that stops "maximum everything" from winning.
        """
        basal = energy_cfg.base_metabolic_cost * (self.size ** 0.75) * self.metabolism
        realized_speed = self.speed * throttle
        locomotion = energy_cfg.movement_cost * (realized_speed ** 2) * self.size
        return basal + locomotion

    @property
    def energy_fraction(self) -> float:
        return min(1.0, self.energy / self.max_energy)

    @property
    def age_fraction(self) -> float:
        return min(1.0, self.age / self.lifespan)

    def can_reproduce(self) -> bool:
        return (
            self.alive
            and self.repro_cooldown <= 0
            and self.energy_fraction >= self.repro_threshold
        )

    def is_prey_of(self, predator: "Organism") -> bool:
        """A predator can eat prey that is meaningfully smaller than itself."""
        return predator.size > self.size * 1.15
