#!/usr/bin/env python3
"""Run EvoSim headless (no display), log data, and generate the analysis report.

This is the scientific workhorse: run thousands of generations on a server,
save the full time series to CSV/JSON, and render the Matplotlib report.

Usage::

    python -m scripts.run_headless --ticks 4000
    python -m scripts.run_headless --ticks 8000 --seed 42 --brain rule --out data
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evosim import Simulation, SimulationConfig  # noqa: E402
from evosim.analysis import generate_report  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="EvoSim headless runner")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--ticks", type=int, default=4000)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--brain", choices=["neural", "rule"], default=None)
    parser.add_argument("--out", default="data", help="output directory")
    parser.add_argument("--prefix", default="evosim")
    parser.add_argument("--progress", type=int, default=500, help="log every N ticks")
    args = parser.parse_args()

    cfg = SimulationConfig.load(args.config) if args.config else SimulationConfig()
    if args.seed is not None:
        cfg.seed = args.seed
    if args.brain:
        cfg.behavior.brain = args.brain

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    sim = Simulation(cfg)
    print(f"EvoSim headless: seed={cfg.seed} brain={cfg.behavior.brain} "
          f"start_pop={sim.population} target_ticks={args.ticks}")

    start = time.time()
    for step in range(args.ticks):
        alive = sim.step()
        if args.progress and sim.tick % args.progress == 0:
            print(f"  tick {sim.tick:>6}  pop {sim.population:>5}  "
                  f"species {sim.species_tracker.count:>3}  "
                  f"food {len(sim.world.food_pos):>5}")
        if not alive:
            print(f"  population went extinct at tick {sim.tick}")
            break
    elapsed = time.time() - start

    cfg.save(out / f"{args.prefix}_config.json")
    sim.stats.to_csv(out / f"{args.prefix}_stats.csv")
    sim.stats.to_json(out / f"{args.prefix}_stats.json")
    report = generate_report(sim.stats, output_dir=str(out), prefix=args.prefix)

    print(f"\nDone in {elapsed:.1f}s over {sim.tick} ticks.")
    print(f"  stats  -> {out / f'{args.prefix}_stats.csv'}")
    print(f"  report -> {report}")


if __name__ == "__main__":
    main()
