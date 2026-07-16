"""Genome: the heritable blueprint that natural selection acts upon.

A :class:`Genome` is a fixed set of continuous *genes*, each bounded to a
biologically meaningful range. Genes are expressed as *traits* (via
:meth:`Genome.trait`) which the rest of the simulation reads to decide how an
organism moves, eats, hides, fights, and reproduces.

Design goals
------------
* **Continuous & bounded** -- every gene lives in ``[0, 1]`` internally and is
  scaled to a physical range on expression, so mutation can never produce an
  impossible organism.
* **Neuroevolvable** -- an optional flat vector of neural-network weights rides
  along in the genome, so switching to a :class:`NeuralBrain` needs no change
  to reproduction or mutation.
* **Speciation-ready** -- :meth:`distance` gives a NEAT-style compatibility
  metric so populations can be clustered into emergent species.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import numpy as np

# --- Gene specification ------------------------------------------------------
# name -> (physical_min, physical_max, speciation_weight)
# The genome stores each gene normalized in [0, 1]; ``trait()`` maps it back to
# the physical range below. ``speciation_weight`` controls how much a gene
# contributes to the genetic-distance metric used for clustering species --
# ecologically defining traits (diet, size) matter more than e.g. exact colour.
GENE_SPECS: Dict[str, tuple] = {
    # locomotion
    "speed": (0.4, 4.2, 1.0),
    # perception radius (world units)
    "vision": (20.0, 220.0, 1.0),
    # metabolic multiplier: high = fast/hungry, low = slow/thrifty
    "metabolism": (0.5, 1.9, 1.0),
    # body size: affects energy capacity, cost, and who-eats-whom
    "size": (0.5, 3.0, 1.5),
    # maximum age in ticks
    "lifespan": (900.0, 5200.0, 0.6),
    # camouflage: how strongly colour-matching to terrain hides the organism
    "camouflage": (0.0, 1.0, 0.7),
    # diet: 0.0 = pure herbivore, 1.0 = pure carnivore (continuum -> divergence)
    "diet": (0.0, 1.0, 2.0),
    # aggression: willingness to attack when able
    "aggression": (0.0, 1.0, 0.8),
    # energy fraction at which the organism attempts reproduction
    "repro_threshold": (0.45, 0.9, 0.5),
    # fraction of its energy an organism invests into each offspring
    "offspring_investment": (0.25, 0.6, 0.5),
    # heritable colour, also the phenotype used for camouflage matching
    "color_r": (0.0, 1.0, 0.3),
    "color_g": (0.0, 1.0, 0.3),
    "color_b": (0.0, 1.0, 0.3),
}

GENE_NAMES = list(GENE_SPECS.keys())
_MINS = np.array([GENE_SPECS[g][0] for g in GENE_NAMES])
_MAXS = np.array([GENE_SPECS[g][1] for g in GENE_NAMES])
_RANGES = _MAXS - _MINS
_WEIGHTS = np.array([GENE_SPECS[g][2] for g in GENE_NAMES])
_WEIGHTS = _WEIGHTS / _WEIGHTS.sum()
_INDEX = {name: i for i, name in enumerate(GENE_NAMES)}


@dataclass
class Genome:
    """A vector of normalized genes plus optional neural weights."""

    genes: np.ndarray  # shape (len(GENE_NAMES),), values in [0, 1]
    weights: np.ndarray | None = None  # flat neural-network weight vector
    # Lineage bookkeeping for phylogeny / analysis.
    generation: int = 0
    lineage_id: int = 0

    # ------------------------------------------------------------ factory ---
    @classmethod
    def random(
        cls,
        rng: np.random.Generator,
        weight_size: int = 0,
        lineage_id: int = 0,
    ) -> "Genome":
        genes = rng.random(len(GENE_NAMES))
        weights = None
        if weight_size > 0:
            # Small initial weights keep early behaviour gentle before selection.
            weights = rng.normal(0.0, 0.5, size=weight_size)
        return cls(genes=genes, weights=weights, generation=0, lineage_id=lineage_id)

    # ---------------------------------------------------------- expression ---
    def trait(self, name: str) -> float:
        """Return the physical value of a named trait."""
        i = _INDEX[name]
        return float(_MINS[i] + self.genes[i] * _RANGES[i])

    @property
    def color(self) -> tuple[int, int, int]:
        """RGB colour (0-255) expressed by the colour genes."""
        r = int(self.trait("color_r") * 255)
        g = int(self.trait("color_g") * 255)
        b = int(self.trait("color_b") * 255)
        return (r, g, b)

    # ----------------------------------------------------------- heredity ---
    def mutate(self, rng: np.random.Generator, repro_cfg) -> "Genome":
        """Return a mutated copy of this genome (asexual reproduction)."""
        genes = self.genes.copy()

        # Point mutations: small gaussian nudges to a random subset of genes.
        mask = rng.random(genes.shape) < repro_cfg.mutation_rate
        genes[mask] += rng.normal(0.0, repro_cfg.mutation_scale, size=mask.sum())

        # Macro mutations: rare large jumps that can found new species.
        macro = rng.random(genes.shape) < repro_cfg.macro_mutation_rate
        genes[macro] += rng.normal(0.0, repro_cfg.macro_mutation_scale, size=macro.sum())

        np.clip(genes, 0.0, 1.0, out=genes)

        weights = None
        if self.weights is not None:
            weights = self.weights.copy()
            wmask = rng.random(weights.shape) < repro_cfg.mutation_rate
            weights[wmask] += rng.normal(
                0.0, repro_cfg.mutation_scale * 2.0, size=wmask.sum()
            )

        return Genome(
            genes=genes,
            weights=weights,
            generation=self.generation + 1,
            lineage_id=self.lineage_id,
        )

    # --------------------------------------------------------- speciation ---
    def distance(self, other: "Genome") -> float:
        """Weighted genetic distance used for NEAT-style speciation.

        Only the phenotype genes contribute (not neural weights): two organisms
        that behave differently but look/eat/live identically are still the same
        species, which matches how biologists actually delimit species.
        """
        diff = np.abs(self.genes - other.genes)
        return float(np.dot(diff, _WEIGHTS))

    def copy(self) -> "Genome":
        return Genome(
            genes=self.genes.copy(),
            weights=None if self.weights is None else self.weights.copy(),
            generation=self.generation,
            lineage_id=self.lineage_id,
        )
