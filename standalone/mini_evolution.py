#!/usr/bin/env python3
"""A mini, self-contained model of natural selection -- "survival of the fittest".

This is a standalone teaching model: it depends on NOTHING but the Python
standard library (no numpy, no EvoSim), fits on one screen of logic, and runs
with a single command:

    python3 mini_evolution.py

The idea, in one paragraph
--------------------------
A population of creatures each has one heritable trait: SPEED. Food is scarce,
so a faster creature gathers more of it -- but moving fast also burns energy
(cost grows with speed squared). So there is a "best" speed: fast enough to eat
well, not so fast it starves itself. Nobody tells the creatures this. Each
generation, the ones with the most left-over energy (the fittest) survive and
have children that inherit their speed, plus a small random change (mutation).
Run it and watch: a population that starts with totally random speeds converges,
all on its own, onto the best-adapted speed -- and the spread narrows as the
unfit are weeded out. That convergence IS evolution by natural selection.

Everything is deterministic given the seed, so results are reproducible.
"""

from __future__ import annotations

import math
import random

# ---- The world (all the knobs live here) ---------------------------------
POP_SIZE = 300          # how many creatures live at once
GENERATIONS = 60        # how many generations to simulate
SURVIVE_FRACTION = 0.40 # top fraction (by fitness) that lives to reproduce
MUTATION = 0.18         # std-dev of the random change passed to a child's speed
SPEED_MIN, SPEED_MAX = 0.4, 4.2   # a speed can never leave this range
SEED = 7

# Fitness = food gathered - energy burned.
FOOD = 10.0     # how much food a very fast creature could gather (saturating)
HALF = 1.5      # speed at which a creature gathers half the max food
COST = 0.15     # energy cost coefficient; burned energy = COST * speed^2


def fitness(speed: float) -> float:
    """Left-over energy for a creature of the given speed.

    Benefit saturates (you can only eat so much) while cost keeps rising with
    speed squared -- so the function has a single peak: the best-adapted speed.
    """
    benefit = FOOD * speed / (speed + HALF)
    cost = COST * speed * speed
    return benefit - cost


def clamp(x: float) -> float:
    return max(SPEED_MIN, min(SPEED_MAX, x))


def best_possible_speed() -> float:
    """Scan the range to find the theoretical optimum (for reporting only)."""
    return max((s / 1000 for s in range(int(SPEED_MIN * 1000), int(SPEED_MAX * 1000))),
               key=fitness)


def histogram(speeds: list[float], bins: int = 24, width: int = 40) -> list[str]:
    """A tiny ASCII histogram so the model needs no plotting library."""
    counts = [0] * bins
    span = SPEED_MAX - SPEED_MIN
    for s in speeds:
        i = min(bins - 1, int((s - SPEED_MIN) / span * bins))
        counts[i] += 1
    peak = max(counts) or 1
    rows = []
    for i, c in enumerate(counts):
        lo = SPEED_MIN + span * i / bins
        bar = "#" * round(c / peak * width)
        rows.append(f"  {lo:4.2f} | {bar}")
    return rows


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def stdev(xs: list[float]) -> float:
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


def evolve() -> None:
    rng = random.Random(SEED)

    # Generation 0: totally random speeds -- no design, no plan.
    population = [rng.uniform(SPEED_MIN, SPEED_MAX) for _ in range(POP_SIZE)]
    first_generation = list(population)

    print("Survival of the Fittest -- a mini model\n" + "=" * 42)
    print(f"population {POP_SIZE}, {GENERATIONS} generations, "
          f"top {int(SURVIVE_FRACTION*100)}% survive each generation\n")
    print(f"{'gen':>4} {'mean speed':>11} {'spread':>8}   (spread shrinks as the fit take over)")

    n_survivors = max(2, int(POP_SIZE * SURVIVE_FRACTION))
    for gen in range(GENERATIONS + 1):
        if gen % 6 == 0 or gen == GENERATIONS:
            print(f"{gen:>4} {mean(population):>11.3f} {stdev(population):>8.3f}")
        if gen == GENERATIONS:
            break

        # --- Selection: keep the fittest (most left-over energy) ----------
        population.sort(key=fitness, reverse=True)
        survivors = population[:n_survivors]

        # --- Reproduction: survivors have children with small mutations ---
        population = []
        while len(population) < POP_SIZE:
            parent = survivors[rng.randrange(n_survivors)]
            child = clamp(parent + rng.gauss(0.0, MUTATION))
            population.append(child)

    # ---- Results ---------------------------------------------------------
    opt = best_possible_speed()
    print(f"\nBest-adapted speed (the target nobody was told): {opt:.2f}")
    print(f"Final population settled at:                     {mean(population):.2f}")
    print("\nGENERATION 0  (random speeds -- spread all over):")
    for row in histogram(first_generation):
        print(row)
    print("\nFINAL GENERATION  (converged on the fittest speed):")
    for row in histogram(population):
        print(row)
    print("\nNobody designed this. The fittest simply survived and had more "
          "children,\nso the whole population became well-adapted. That is "
          "natural selection.")


if __name__ == "__main__":
    evolve()
