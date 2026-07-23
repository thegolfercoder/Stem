"""Pluggable behaviour back-ends for organisms."""

from __future__ import annotations

from .base import ACTION_SIZE, PERCEPTION_SIZE, Brain
from .neural import NeuralBrain
from .rule_based import RuleBasedBrain


def make_brain(behavior_cfg) -> Brain:
    """Factory: build the brain selected in :class:`BehaviorConfig`."""
    kind = behavior_cfg.brain.lower()
    if kind == "rule":
        return RuleBasedBrain()
    if kind == "neural":
        return NeuralBrain(hidden_units=behavior_cfg.hidden_units)
    raise ValueError(f"Unknown brain type: {behavior_cfg.brain!r}")


__all__ = [
    "Brain",
    "NeuralBrain",
    "RuleBasedBrain",
    "make_brain",
    "PERCEPTION_SIZE",
    "ACTION_SIZE",
]
