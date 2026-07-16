#!/usr/bin/env python3
"""Run EvoSim with the real-time Pygame visualization.

Usage::

    python -m scripts.run_simulation                 # default config
    python -m scripts.run_simulation --seed 7 --brain rule
    python -m scripts.run_simulation --config config/default.json --ticks 5000

Requires a display. On a headless machine use ``run_headless.py`` instead.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evosim import Simulation, SimulationConfig  # noqa: E402
from evosim.render import PygameRenderer  # noqa: E402


def build_config(args) -> SimulationConfig:
    cfg = SimulationConfig.load(args.config) if args.config else SimulationConfig()
    if args.seed is not None:
        cfg.seed = args.seed
    if args.brain:
        cfg.behavior.brain = args.brain
    return cfg


def main() -> None:
    parser = argparse.ArgumentParser(description="EvoSim real-time viewer")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--seed", type=int, help="override RNG seed")
    parser.add_argument("--brain", choices=["neural", "rule"], help="behaviour back-end")
    parser.add_argument("--ticks", type=int, default=None, help="stop after N ticks")
    parser.add_argument("--width", type=int, default=1200)
    parser.add_argument("--height", type=int, default=800)
    args = parser.parse_args()

    cfg = build_config(args)
    sim = Simulation(cfg)
    print(f"Starting EvoSim: seed={cfg.seed} brain={cfg.behavior.brain} "
          f"pop={sim.population}")
    renderer = PygameRenderer(width=args.width, height=args.height)
    renderer.run(sim, max_ticks=args.ticks)


if __name__ == "__main__":
    main()
