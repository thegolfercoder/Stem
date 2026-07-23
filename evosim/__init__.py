"""EvoSim -- Artificial Life Evolution Simulator.

A scientific digital ecosystem in which organisms with heritable genomes evolve
through natural selection, mutation, competition, and predator-prey dynamics.

Public API::

    from evosim import Simulation, SimulationConfig

The core (:mod:`evosim.simulation`) is fully headless. Visualization
(:mod:`evosim.render`) and analysis (:mod:`evosim.analysis`) are optional layers
built on top, so the same engine can drive Pygame today and Blender/NEAT later.
"""

from __future__ import annotations

from .config import SimulationConfig
from .genome import Genome
from .organism import Organism
from .simulation import Simulation
from .world import World

__version__ = "0.1.0"

__all__ = [
    "Simulation",
    "SimulationConfig",
    "Genome",
    "Organism",
    "World",
    "__version__",
]
