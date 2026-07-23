"""Central configuration for the Artificial Life Evolution Simulator.

Every tunable parameter of the ecosystem lives here as a plain dataclass so
that experiments are reproducible and self-documenting. Nothing in the
simulation reads a "magic number" directly -- it always comes from a
``SimulationConfig`` instance, which can be serialized to / loaded from JSON.

This is deliberately data-only (no behavior) so the same config can drive the
headless engine, the Pygame front-end, and future Blender/NEAT back-ends.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class WorldConfig:
    """Physical layout of the digital planet."""

    width: float = 1200.0
    height: float = 800.0
    # Number of coarse terrain patches per axis. Terrain colour drives the
    # camouflage mechanic (an organism hides best on matching terrain).
    terrain_cells_x: int = 12
    terrain_cells_y: int = 8
    # Toroidal world (wraps at the edges) avoids artificial boundary crowding.
    wrap: bool = True


@dataclass
class FoodConfig:
    """Plant / primary-producer dynamics (the base of the food web)."""

    initial_count: int = 700
    carrying_capacity: int = 1400
    # Probability per tick that a new plant spawns (scaled by free capacity).
    regrowth_rate: float = 0.35
    energy_per_item: float = 32.0
    # Plants cluster around "fertile" terrain to create spatial heterogeneity.
    cluster_bias: float = 0.65


@dataclass
class PopulationConfig:
    """Starting population and hard limits."""

    initial_organisms: int = 220
    # Absolute cap keeps runtime bounded even during population booms.
    max_organisms: int = 2200
    # Minimum viable population; below this we log a near-extinction warning.
    extinction_warning: int = 8


@dataclass
class EnergyConfig:
    """Bioenergetics -- the currency that natural selection actually optimizes."""

    start_energy: float = 90.0
    # Base metabolic cost scales with size**0.75 (Kleiber's law) * metabolism.
    base_metabolic_cost: float = 0.35
    # Movement cost scales with speed**2 * size (kinetic-energy analogue).
    movement_cost: float = 0.010
    # Fraction of a prey's energy actually absorbed when eaten.
    predation_efficiency: float = 0.70
    # Energy needed (as a multiple of start_energy) before reproduction.
    max_energy: float = 260.0


@dataclass
class ReproductionConfig:
    """Inheritance and mutation -- the engine of variation."""

    # Per-gene probability of mutation in an offspring.
    mutation_rate: float = 0.14
    # Std-dev of a gaussian mutation, as a fraction of the gene's range.
    mutation_scale: float = 0.09
    # Rare large mutations create the jumps that seed new species.
    macro_mutation_rate: float = 0.015
    macro_mutation_scale: float = 0.45
    # Minimum cool-down (ticks) between reproductions for one organism.
    cooldown: int = 40
    # Sexual reproduction: offspring genomes are a recombination (crossover) of
    # two same-species parents, adding a second engine of variation. When no
    # compatible mate is nearby, reproduction falls back to asexual + mutation.
    sexual: bool = False
    # How far an organism will look for a mate (world units).
    mate_radius: float = 35.0


@dataclass
class SpeciationConfig:
    """NEAT-style compatibility clustering that lets species emerge."""

    # Genetic distance above which two organisms are different species.
    compatibility_threshold: float = 0.32
    # How often (ticks) to re-cluster the population into species.
    reclassify_interval: int = 30
    min_species_size: int = 4


@dataclass
class BehaviorConfig:
    """Selects and tunes the decision-making back-end."""

    # "rule" -> hand-written heuristics; "neural" -> genome-encoded network.
    brain: str = "neural"
    # Hidden-layer width for the NeuralBrain (fixed topology neuroevolution).
    hidden_units: int = 10


@dataclass
class SimulationConfig:
    """Top-level container assembled from the sub-configs above."""

    seed: int = 1234
    world: WorldConfig = field(default_factory=WorldConfig)
    food: FoodConfig = field(default_factory=FoodConfig)
    population: PopulationConfig = field(default_factory=PopulationConfig)
    energy: EnergyConfig = field(default_factory=EnergyConfig)
    reproduction: ReproductionConfig = field(default_factory=ReproductionConfig)
    speciation: SpeciationConfig = field(default_factory=SpeciationConfig)
    behavior: BehaviorConfig = field(default_factory=BehaviorConfig)

    # ----------------------------------------------------------------- IO ---
    def to_dict(self) -> dict:
        return asdict(self)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))

    # ----------------------------------------------------------- presets ---
    @classmethod
    def survival(cls, seed: int = 7) -> "SimulationConfig":
        """A stripped-down 'survival of the fittest' preset for general audiences.

        The full default config celebrates *biodiversity* (many species coexisting
        in balance). This preset does the opposite: it makes one idea impossible
        to miss -- **the fit survive and multiply, the unfit starve.**

        It uses a small world with few, large, easy-to-follow creatures and
        genuinely scarce food, so an onlooker literally watches the slow ones fail
        to reach food and die while the fast ones eat and breed. Selection is
        strong and directional (mean speed climbs generation over generation),
        and the simple, transparent rule-based brain keeps behaviour explainable.
        """
        cfg = cls(seed=seed)
        cfg.world.width = 900.0
        cfg.world.height = 600.0
        cfg.world.terrain_cells_x = 9
        cfg.world.terrain_cells_y = 6
        cfg.population.initial_organisms = 30
        cfg.population.max_organisms = 80
        cfg.food.initial_count = 90
        cfg.food.carrying_capacity = 120
        cfg.food.regrowth_rate = 0.11
        cfg.food.energy_per_item = 40.0
        cfg.energy.base_metabolic_cost = 0.5
        cfg.reproduction.cooldown = 55
        cfg.reproduction.sexual = False
        cfg.behavior.brain = "rule"  # transparent + predictable for a demo
        return cfg

    @classmethod
    def from_dict(cls, data: dict) -> "SimulationConfig":
        return cls(
            seed=data.get("seed", 1234),
            world=WorldConfig(**data.get("world", {})),
            food=FoodConfig(**data.get("food", {})),
            population=PopulationConfig(**data.get("population", {})),
            energy=EnergyConfig(**data.get("energy", {})),
            reproduction=ReproductionConfig(**data.get("reproduction", {})),
            speciation=SpeciationConfig(**data.get("speciation", {})),
            behavior=BehaviorConfig(**data.get("behavior", {})),
        )

    @classmethod
    def load(cls, path: str | Path) -> "SimulationConfig":
        return cls.from_dict(json.loads(Path(path).read_text()))
