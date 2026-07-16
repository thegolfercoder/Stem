"""Genome-encoded neural brain: evolving intelligence via neuroevolution.

Each organism carries a flat vector of network weights *inside its genome*.
Those weights mutate and are inherited exactly like any other gene, so the
mapping from perception to action is **discovered by natural selection** rather
than hand-coded. This is neuroevolution with a fixed topology -- the direct
conceptual predecessor of NEAT.

Upgrading to NEAT
-----------------
NEAT adds *topology* evolution (new nodes/connections via innovation numbers)
on top of weight evolution. Because the rest of the engine only depends on the
:class:`Brain` contract (perception vector in, action vector out), swapping this
class for a ``NeatBrain`` that wraps ``neat-python`` requires **no changes** to
organisms, reproduction, or the simulation loop -- only:

1. store a NEAT genome instead of a weight vector, and
2. build a network with ``neat.nn.FeedForwardNetwork.create`` in ``decide``.

That seam is intentional and is why weights live behind this interface.
"""

from __future__ import annotations

import numpy as np

from .base import ACTION_SIZE, PERCEPTION_SIZE, Brain


class NeuralBrain(Brain):
    """A small fixed-topology MLP whose weights are evolved in the genome."""

    uses_weights = True
    supports_batch = True

    def __init__(self, hidden_units: int = 10):
        self.n_in = PERCEPTION_SIZE
        self.hidden = hidden_units
        self.n_out = ACTION_SIZE
        # Two weight matrices; the perception vector's index-0 bias term feeds
        # the hidden layer, and we fold an explicit bias into the output layer.
        self.w1_size = self.n_in * self.hidden
        self.w2_size = (self.hidden + 1) * self.n_out
        self.weight_size = self.w1_size + self.w2_size

    def decide(self, perception: np.ndarray, organism) -> np.ndarray:
        w = organism.genome.weights
        w1 = w[: self.w1_size].reshape(self.n_in, self.hidden)
        w2 = w[self.w1_size :].reshape(self.hidden + 1, self.n_out)

        hidden = np.tanh(perception @ w1)
        hidden_b = np.concatenate([hidden, [1.0]])  # bias unit
        out = np.tanh(hidden_b @ w2)
        # out[:2] -> heading, out[2] -> throttle mapped to 0..1
        throttle = (out[2] + 1.0) * 0.5
        return np.array([out[0], out[1], throttle])

    def decide_batch(self, perceptions: np.ndarray, organisms: list) -> np.ndarray:
        """Score the whole population in two batched matmuls.

        Every organism shares this network's topology but carries its *own*
        evolved weights, so we stack the weight vectors into per-organism weight
        tensors and evaluate them all at once with ``einsum`` -- mathematically
        identical to calling :meth:`decide` in a loop, but far faster for large
        populations (this is the hot path in long, thousand-generation runs).
        """
        n = len(organisms)
        if n == 0:
            return np.empty((0, self.n_out))
        w = np.stack([org.genome.weights for org in organisms])  # (n, weight_size)
        w1 = w[:, : self.w1_size].reshape(n, self.n_in, self.hidden)
        w2 = w[:, self.w1_size :].reshape(n, self.hidden + 1, self.n_out)

        hidden = np.tanh(np.einsum("np,nph->nh", perceptions, w1))
        ones = np.ones((n, 1))
        hidden_b = np.concatenate([hidden, ones], axis=1)  # (n, hidden+1)
        out = np.tanh(np.einsum("nh,nho->no", hidden_b, w2))  # (n, n_out)

        actions = out.copy()
        actions[:, 2] = (out[:, 2] + 1.0) * 0.5  # throttle -> 0..1
        return actions
