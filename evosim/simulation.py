"""The simulation engine -- the beating heart of the digital planet.

This module runs the ecological/evolutionary loop and is deliberately
**headless**: it has no dependency on Pygame, Matplotlib, or any display. That
separation is what lets the exact same simulation drive a real-time Pygame
window, a batch run on a server, or (later) a Blender render -- each is just a
consumer of engine state.

One ``step()`` advances the world by one tick and, for every organism, performs:

1. **Perceive** -- build a normalized sensory vector (food, prey, threats).
2. **Decide** -- ask the pluggable :class:`Brain` for an action.
3. **Act** -- move, forage, and hunt (camouflage modulates who gets seen).
4. **Live** -- pay metabolic costs, age, and possibly reproduce or die.

Selection is never scripted: organisms that gather energy and reproduce leave
more (mutated) descendants, and that is the only thing steering the population.
"""

from __future__ import annotations

import numpy as np

from .behavior import make_brain
from .behavior.base import PERCEPTION_SIZE
from .config import SimulationConfig
from .genome import Genome
from .organism import Organism
from .species import SpeciesTracker
from .spatial import SpatialHash
from .stats import StatsRecorder
from .world import World


class Simulation:
    def __init__(self, config: SimulationConfig | None = None):
        self.config = config or SimulationConfig()
        self.rng = np.random.default_rng(self.config.seed)
        self.tick = 0

        self.world = World(self.config, self.rng)
        self.brain = make_brain(self.config.behavior)
        self.species_tracker = SpeciesTracker(self.config.speciation, self.rng)
        self.stats = StatsRecorder()

        self.organisms: list[Organism] = []
        self.positions = np.empty((0, 2))
        self._org_hash = SpatialHash(
            self.world.width,
            self.world.height,
            cell_size=64.0,
            wrap=self.config.world.wrap,
        )
        self._spawn_initial_population()
        self.species_tracker.classify(self.organisms, self.tick)

    # ------------------------------------------------------------- spawning ---
    def _spawn_initial_population(self) -> None:
        n = self.config.population.initial_organisms
        weight_size = self.brain.weight_size if self.brain.uses_weights else 0
        for lineage in range(n):
            genome = Genome.random(self.rng, weight_size=weight_size, lineage_id=lineage)
            pos = self.rng.random(2) * [self.world.width, self.world.height]
            org = Organism(
                genome=genome,
                pos=pos,
                energy=self.config.energy.start_energy,
                rng=self.rng,
                energy_cfg=self.config.energy,
            )
            self.organisms.append(org)
        self._rebuild_positions()

    def _rebuild_positions(self) -> None:
        if self.organisms:
            self.positions = np.array([o.pos for o in self.organisms])
        else:
            self.positions = np.empty((0, 2))

    # ------------------------------------------------------------- geometry ---
    def _relative(self, a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, float]:
        """Shortest displacement a->b and its length, respecting world wrap."""
        d = b - a
        if self.config.world.wrap:
            d[0] -= self.world.width * round(d[0] / self.world.width)
            d[1] -= self.world.height * round(d[1] / self.world.height)
        dist = float(np.hypot(d[0], d[1]))
        return d, dist

    def _camouflage_effect(self, org: Organism) -> float:
        """How hidden an organism is (0..1): camouflage gene * terrain match."""
        terr = self.world.terrain_color_at(org.pos[0], org.pos[1])
        col = np.array(org.genome.color) / 255.0
        match = 1.0 - float(np.mean(np.abs(col - terr)))  # 1 = perfect match
        return org.camouflage * max(0.0, match)

    # ------------------------------------------------------------ main step ---
    def step(self) -> bool:
        """Advance the world one tick. Returns False if the population is extinct."""
        if not self.organisms:
            self.stats.snapshot(self.tick, self.organisms, len(self.world.food_pos), 0)
            return False

        self._rebuild_positions()
        self._org_hash.rebuild(self.positions)
        self.world.rebuild_food_index()

        camo = [self._camouflage_effect(o) for o in self.organisms]
        newborns: list[Organism] = []
        energy_cfg = self.config.energy
        eat_radius_base = 5.0

        for i, org in enumerate(self.organisms):
            if not org.alive:
                continue

            perception, targets = self._perceive(i, org, camo)
            action = self.brain.decide(perception, org)
            throttle = float(np.clip(action[2], 0.0, 1.0))

            # --- Move ------------------------------------------------------
            heading = action[:2]
            norm = np.hypot(heading[0], heading[1])
            if norm > 1e-6:
                heading = heading / norm
                org.wander_heading = float(np.arctan2(heading[1], heading[0]))
                org.pos = org.pos + heading * (org.speed * throttle)
                self.world.wrap_position(org.pos)

            # --- Forage (plants) ------------------------------------------
            eat_radius = eat_radius_base + org.size * 3.0
            self._forage(org, eat_radius)

            # --- Hunt (predation) -----------------------------------------
            prey = targets.get("prey_obj")
            if prey is not None and prey.alive:
                self._attempt_predation(org, prey, eat_radius)

            # --- Metabolism & ageing --------------------------------------
            org.energy -= org.metabolic_cost(energy_cfg, throttle)
            org.energy = min(org.energy, org.max_energy)
            org.age += 1
            if org.repro_cooldown > 0:
                org.repro_cooldown -= 1

            # --- Death ----------------------------------------------------
            if org.energy <= 0.0:
                org.alive = False
                self.stats.deaths_starvation += 1
                continue
            if org.age >= org.lifespan:
                org.alive = False
                self.stats.deaths_old_age += 1
                continue

            # --- Reproduction ---------------------------------------------
            if org.can_reproduce() and (
                len(self.organisms) + len(newborns) < self.config.population.max_organisms
            ):
                child = self._reproduce(org)
                newborns.append(child)

        # --- Bookkeeping --------------------------------------------------
        self.organisms = [o for o in self.organisms if o.alive] + newborns
        self.world.compact_food()
        self.world.regrow()
        self.tick += 1

        if self.tick % self.config.speciation.reclassify_interval == 0:
            self.species_tracker.classify(self.organisms, self.tick)

        self.stats.snapshot(
            self.tick,
            self.organisms,
            len(self.world.food_pos),
            self.species_tracker.count,
        )
        return len(self.organisms) > 0

    # ------------------------------------------------------------ perceive ---
    def _perceive(self, i: int, org: Organism, camo: list[float]):
        p = np.zeros(PERCEPTION_SIZE)
        p[0] = 1.0  # bias
        p[1] = org.energy_fraction
        p[2] = org.age_fraction

        # Nearest plant within vision.
        food_idx = self.world.find_food_near(org.pos[0], org.pos[1], org.vision)
        best_food_d, best_food_vec = org.vision, None
        for fi in food_idx:
            if not self.world.is_food_alive(fi):
                continue
            vec, dist = self._relative(org.pos, self.world.food_pos[fi])
            if dist < best_food_d:
                best_food_d, best_food_vec = dist, vec
        if best_food_vec is not None and best_food_d > 1e-6:
            u = best_food_vec / best_food_d
            p[3], p[4] = u
            p[5] = 1.0 - best_food_d / org.vision

        # Nearest prey and nearest threat among organisms within vision.
        neigh = self._org_hash.query_radius(org.pos[0], org.pos[1], org.vision)
        best_prey_d, best_prey_vec, prey_obj = org.vision, None, None
        best_threat_d, best_threat_vec = org.vision, None
        crowd = 0
        for j in neigh:
            if j == i:
                continue
            other = self.organisms[j]
            if not other.alive:
                continue
            vec, dist = self._relative(org.pos, other.pos)
            if dist > org.vision:
                continue
            crowd += 1
            # Prey: smaller than us, and its camouflage may hide it from view.
            if other.is_prey_of(org) and org.diet > 0.2:
                effective_vision = org.vision * (1.0 - 0.85 * camo[j])
                if dist < best_prey_d and dist <= effective_vision:
                    best_prey_d, best_prey_vec, prey_obj = dist, vec, other
            # Threat: a predator large enough to eat us and inclined to hunt.
            if org.is_prey_of(other) and other.diet > 0.2:
                if dist < best_threat_d:
                    best_threat_d, best_threat_vec = dist, vec

        if best_prey_vec is not None and best_prey_d > 1e-6:
            u = best_prey_vec / best_prey_d
            p[6], p[7] = u
            p[8] = 1.0 - best_prey_d / org.vision
        if best_threat_vec is not None and best_threat_d > 1e-6:
            u = best_threat_vec / best_threat_d
            p[9], p[10] = u
            p[11] = 1.0 - best_threat_d / org.vision

        p[12] = min(1.0, crowd / 20.0)
        p[13] = org.diet
        p[14] = org.aggression

        return p, {"prey_obj": prey_obj}

    # -------------------------------------------------------------- actions ---
    def _forage(self, org: Organism, eat_radius: float) -> None:
        if len(self.world.food_pos) == 0:
            return
        near = self.world.find_food_near(org.pos[0], org.pos[1], eat_radius)
        eaten = []
        # Herbivores digest plants well; carnivores barely at all.
        plant_mult = 1.0 - 0.7 * org.diet
        for fi in near:
            if not self.world.is_food_alive(fi):
                continue
            _, dist = self._relative(org.pos, self.world.food_pos[fi])
            if dist <= eat_radius:
                org.energy += self.world.food_energy[fi] * plant_mult
                eaten.append(fi)
        if eaten:
            org.energy = min(org.energy, org.max_energy)
            self.world.consume_food(eaten)

    def _attempt_predation(self, org: Organism, prey: Organism, eat_radius: float) -> None:
        _, dist = self._relative(org.pos, prey.pos)
        attack_reach = eat_radius + prey.size * 2.0
        if dist > attack_reach:
            return
        # Success chance rises with aggression and size advantage.
        size_edge = np.clip((org.size - prey.size) / max(prey.size, 0.1), 0.0, 1.0)
        success = 0.35 + 0.5 * org.aggression + 0.15 * size_edge
        if self.rng.random() < success:
            prey.alive = False
            self.stats.deaths_predation += 1
            meat_mult = 0.4 + 0.6 * org.diet  # carnivores digest meat better
            gain = prey.energy * self.config.energy.predation_efficiency * meat_mult
            org.energy = min(org.energy + gain, org.max_energy)

    def _reproduce(self, parent: Organism) -> Organism:
        invest = parent.offspring_investment * parent.energy
        parent.energy -= invest
        parent.repro_cooldown = self.config.reproduction.cooldown
        parent.children += 1

        child_genome = parent.genome.mutate(self.rng, self.config.reproduction)
        # Offspring appears next to the parent.
        offset = self.rng.normal(0, 8.0, size=2)
        child_pos = parent.pos + offset
        self.world.wrap_position(child_pos)
        child = Organism(
            genome=child_genome,
            pos=child_pos,
            energy=invest,
            rng=self.rng,
            energy_cfg=self.config.energy,
        )
        child.species_id = parent.species_id
        self.stats.births += 1
        return child

    # ---------------------------------------------------------------- helpers ---
    @property
    def population(self) -> int:
        return len(self.organisms)

    def run(self, ticks: int, on_step=None) -> None:
        """Run headless for ``ticks`` steps (or until extinction)."""
        for _ in range(ticks):
            alive = self.step()
            if on_step is not None:
                on_step(self)
            if not alive:
                break
