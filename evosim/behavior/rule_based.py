"""Transparent, hand-written behaviour heuristics.

This brain is the scientific *control group*: its logic is fully legible, so it
makes the ecosystem's dynamics easy to reason about and to compare against the
evolved :class:`NeuralBrain`. Even though the rules are fixed, behaviour still
*varies* between organisms because every decision is weighted by heritable
traits (diet, aggression, vision), so selection still shapes the population.
"""

from __future__ import annotations

import numpy as np

from .base import Brain


class RuleBasedBrain(Brain):
    uses_weights = False
    weight_size = 0

    def decide(self, perception: np.ndarray, organism) -> np.ndarray:
        energy_frac = perception[1]
        food_dir = perception[3:5]
        food_close = perception[5]
        prey_dir = perception[6:8]
        prey_close = perception[8]
        threat_dir = perception[9:11]
        threat_close = perception[11]
        diet = perception[13]
        aggression = perception[14]

        # 1. Survival first: flee a nearby, larger threat.
        if threat_close > 0.05:
            direction = -threat_dir
            return np.array([direction[0], direction[1], 1.0])

        # 2. Carnivores/omnivores hunt visible prey (more so when hungry/aggressive).
        hunt_drive = diet * (0.4 + 0.6 * (1.0 - energy_frac)) + 0.3 * aggression
        if prey_close > 0.02 and hunt_drive > 0.35:
            return np.array([prey_dir[0], prey_dir[1], 1.0])

        # 3. Herbivores/omnivores forage for plants.
        forage_drive = (1.0 - diet) * (0.4 + 0.6 * (1.0 - energy_frac))
        if food_close > 0.02 and forage_drive > 0.2:
            return np.array([food_dir[0], food_dir[1], 0.85])

        # 4. Otherwise wander with persistence (correlated random walk).
        organism.wander_heading += organism.rng.normal(0.0, 0.4)
        wx = np.cos(organism.wander_heading)
        wy = np.sin(organism.wander_heading)
        return np.array([wx, wy, 0.5])
