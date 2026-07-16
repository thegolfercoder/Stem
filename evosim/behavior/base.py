"""Behaviour abstraction: the swappable "mind" of an organism.

The simulation never calls behaviour logic directly. Instead it builds a fixed
**perception vector** for each organism and asks a :class:`Brain` for an
**action vector**. Because both are plain numpy arrays of fixed size, any brain
implementation is interchangeable:

* :class:`~evosim.behavior.rule_based.RuleBasedBrain` -- transparent heuristics.
* :class:`~evosim.behavior.neural.NeuralBrain` -- a genome-encoded network that
  *evolves* (fixed-topology neuroevolution today; a clean seam for NEAT's
  topology evolution tomorrow -- see ``neural.py``).

Perception layout (all values pre-normalized by the engine)
-----------------------------------------------------------
=====  ===========================================================
index  meaning
=====  ===========================================================
0      bias (always 1.0)
1      energy fraction (0..1)
2      age fraction (0..1)
3-4    unit direction to nearest food (0,0 if none)
5      food proximity (1 - dist/vision, 0 if none)
6-7    unit direction to nearest prey
8      prey proximity
9-10   unit direction to nearest predator/threat
11     threat proximity
12     local crowding (0..1)
13     own diet gene (0 herbivore .. 1 carnivore)
14     own aggression gene
=====  ===========================================================

Action layout
-------------
``[dir_x, dir_y, throttle]`` -- desired heading (auto-normalized) and speed
fraction in 0..1.
"""

from __future__ import annotations

import numpy as np

PERCEPTION_SIZE = 15
ACTION_SIZE = 3


class Brain:
    """Abstract decision-maker. Subclasses implement :meth:`decide`."""

    #: whether this brain type carries evolvable weights in the genome
    uses_weights: bool = False
    #: size of the flat weight vector each genome must carry (0 if none)
    weight_size: int = 0
    #: whether :meth:`decide_batch` can score the whole population at once
    supports_batch: bool = False

    def decide(self, perception: np.ndarray, organism) -> np.ndarray:
        raise NotImplementedError

    def decide_batch(self, perceptions: np.ndarray, organisms: list) -> np.ndarray:
        """Vectorized decisions for a whole population.

        ``perceptions`` is an ``(n, PERCEPTION_SIZE)`` array aligned with
        ``organisms``; returns an ``(n, ACTION_SIZE)`` array. The default falls
        back to calling :meth:`decide` per organism, so any brain works even if
        it hasn't implemented a fast path.
        """
        return np.array(
            [self.decide(perceptions[i], org) for i, org in enumerate(organisms)]
        )
