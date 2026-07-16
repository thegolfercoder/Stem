"""The simulation engine -- the beating heart of the digital planet.

This module runs the ecological/evolutionary loop and is deliberately
**headless**: it has no dependency on Pygame, Matplotlib, or any display. That
separation is what lets the exact same simulation drive a real-time Pygame
window, a batch run on a server, or (later) a Blender render -- each is just a
consumer of engine state.

One ``step()`` advances the world by one tick in three passes:

1. **Perceive** -- every organism builds a normalized sensory vector (food,
   prey, threats) from the start-of-tick world. Distances are computed with
   vectorized NumPy ops, not a Python loop per candidate.
2. **Decide** -- the whole population is scored in a single batched call to the
   pluggable :class:`Brain`.
3. **Act & live** -- move, forage, hunt (camouflage modulates who gets seen),
   pay metabolic costs, age, and possibly reproduce (asexually or sexually) or
   die.

Selection is never scripted: organisms that gather energy and reproduce leave
more (mutated/recombined) descendants, and that is the only thing steering the
population.
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

    def _deltas(self, origin: np.ndarray, targets: np.ndarray) -> np.ndarray:
        """Vectorized shortest displacements from ``origin`` to each target row.

        ``targets`` is an ``(m, 2)`` array; returns an ``(m, 2)`` array of wrap-
        aware deltas. Doing this in one NumPy op (instead of a Python call per
        candidate) is the key to keeping large populations fast.
        """
        d = targets - origin
        if self.config.world.wrap:
            d[:, 0] -= self.world.width * np.round(d[:, 0] / self.world.width)
            d[:, 1] -= self.world.height * np.round(d[:, 1] / self.world.height)
        return d

    # ------------------------------------------------------------ main step ---
    def step(self) -> bool:
        """Advance the world one tick. Returns False if the population is extinct."""
        if not self.organisms:
            self.stats.snapshot(self.tick, self.organisms, len(self.world.food_pos), 0)
            return False

        self._rebuild_positions()
        self._org_hash.rebuild(self.positions)
        self.world.rebuild_food_index()

        n = len(self.organisms)
        # Per-tick trait arrays (aligned with self.organisms / self.positions)
        # so perception can compare against neighbours with vectorized ops.
        self._sizes = np.fromiter((o.size for o in self.organisms), float, n)
        self._diets = np.fromiter((o.diet for o in self.organisms), float, n)
        self._camo = np.array([self._camouflage_effect(o) for o in self.organisms])

        newborns: list[Organism] = []
        energy_cfg = self.config.energy
        eat_radius_base = 5.0

        # --- Pass 1: perceive (all organisms sense the start-of-tick world) --
        # Perceiving up-front (rather than interleaved with movement) means the
        # whole population can be scored in one vectorized batch, and models
        # simultaneous perception -- more biologically faithful than a serial
        # scan where late movers react to early movers within the same instant.
        perceptions = np.zeros((n, PERCEPTION_SIZE))
        prey_targets: list = [None] * n
        for i, org in enumerate(self.organisms):
            perceptions[i], prey_targets[i] = self._perceive(i, org)

        # --- Pass 2: decide (batched through the brain) ----------------------
        actions = self.brain.decide_batch(perceptions, self.organisms)

        # --- Pass 3: act & live ---------------------------------------------
        for i, org in enumerate(self.organisms):
            if not org.alive:
                continue

            action = actions[i]
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
            prey = prey_targets[i]
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
    def _perceive(self, i: int, org: Organism):
        """Build the sensory vector for one organism (vectorized over candidates).

        Returns ``(perception, prey_obj)`` where ``prey_obj`` is the hunt target
        (or ``None``). All neighbour/food distances for this organism are
        computed with array ops rather than a Python loop per candidate.
        """
        vision = org.vision
        p = np.zeros(PERCEPTION_SIZE)
        p[0] = 1.0  # bias
        p[1] = org.energy_fraction
        p[2] = org.age_fraction
        p[13] = org.diet
        p[14] = org.aggression

        # --- Nearest plant within vision ---------------------------------
        fidx = self.world.find_food_near(org.pos[0], org.pos[1], vision)
        if fidx:
            fidx = np.asarray(fidx, dtype=int)
            fidx = fidx[self.world.food_alive[fidx]]
            if len(fidx):
                d = self._deltas(org.pos, self.world.food_pos[fidx])
                dist = np.hypot(d[:, 0], d[:, 1])
                m = int(np.argmin(dist))
                if 1e-6 < dist[m] < vision:
                    u = d[m] / dist[m]
                    p[3], p[4] = u
                    p[5] = 1.0 - dist[m] / vision

        # --- Nearest prey & threat among organisms within vision ----------
        prey_obj = None
        neigh = self._org_hash.query_radius(org.pos[0], org.pos[1], vision)
        if neigh:
            neigh = np.asarray(neigh, dtype=int)
            neigh = neigh[neigh != i]
            if len(neigh):
                d = self._deltas(org.pos, self.positions[neigh])
                dist = np.hypot(d[:, 0], d[:, 1])
                within = dist <= vision
                if within.any():
                    neigh = neigh[within]
                    d, dist = d[within], dist[within]
                    sizes = self._sizes[neigh]
                    diets = self._diets[neigh]
                    camo = self._camo[neigh]
                    p[12] = min(1.0, len(neigh) / 20.0)

                    # Prey: smaller than us; camouflage shrinks our sight of them.
                    if org.diet > 0.2:
                        eff_vision = vision * (1.0 - 0.85 * camo)
                        prey_mask = (org.size > sizes * 1.15) & (dist <= eff_vision)
                        if prey_mask.any():
                            masked = np.where(prey_mask, dist, np.inf)
                            m = int(np.argmin(masked))
                            if dist[m] > 1e-6:
                                u = d[m] / dist[m]
                                p[6], p[7] = u
                                p[8] = 1.0 - dist[m] / vision
                            prey_obj = self.organisms[neigh[m]]

                    # Threat: a predator big enough to eat us and inclined to hunt.
                    threat_mask = (sizes > org.size * 1.15) & (diets > 0.2)
                    if threat_mask.any():
                        masked = np.where(threat_mask, dist, np.inf)
                        m = int(np.argmin(masked))
                        if dist[m] > 1e-6:
                            u = d[m] / dist[m]
                            p[9], p[10] = u
                            p[11] = 1.0 - dist[m] / vision

        return p, prey_obj

    # -------------------------------------------------------------- actions ---
    def _forage(self, org: Organism, eat_radius: float) -> None:
        if len(self.world.food_pos) == 0:
            return
        near = self.world.find_food_near(org.pos[0], org.pos[1], eat_radius)
        if not near:
            return
        idx = np.asarray(near, dtype=int)
        idx = idx[self.world.food_alive[idx]]
        if not len(idx):
            return
        d = self._deltas(org.pos, self.world.food_pos[idx])
        dist = np.hypot(d[:, 0], d[:, 1])
        eaten = idx[dist <= eat_radius]
        if len(eaten):
            # Herbivores digest plants well; carnivores barely at all.
            plant_mult = 1.0 - 0.7 * org.diet
            org.energy = min(
                org.energy + float(self.world.food_energy[eaten].sum()) * plant_mult,
                org.max_energy,
            )
            self.world.consume_food(eaten.tolist())

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

    def _find_mate(self, parent: Organism) -> Organism | None:
        """Nearest reproducible, same-species organism within the mate radius."""
        radius = self.config.reproduction.mate_radius
        candidates = self._org_hash.query_radius(parent.pos[0], parent.pos[1], radius)
        best, best_d = None, radius
        for j in candidates:
            other = self.organisms[j]
            if other is parent or not other.alive:
                continue
            if other.species_id != parent.species_id:
                continue
            if other.energy_fraction < other.repro_threshold:
                continue
            _, dist = self._relative(parent.pos, other.pos)
            if dist < best_d:
                best, best_d = other, dist
        return best

    def _reproduce(self, parent: Organism) -> Organism:
        invest = parent.offspring_investment * parent.energy
        parent.energy -= invest
        parent.repro_cooldown = self.config.reproduction.cooldown
        parent.children += 1

        repro_cfg = self.config.reproduction
        if repro_cfg.sexual:
            mate = self._find_mate(parent)
            if mate is not None:
                # Recombine then mutate; the mate also pays a small cool-down so
                # it can't co-parent every tick.
                recombined = parent.genome.crossover(mate.genome, self.rng)
                child_genome = recombined.mutate(self.rng, repro_cfg)
                mate.repro_cooldown = max(mate.repro_cooldown, repro_cfg.cooldown // 2)
            else:
                child_genome = parent.genome.mutate(self.rng, repro_cfg)
        else:
            child_genome = parent.genome.mutate(self.rng, repro_cfg)
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
