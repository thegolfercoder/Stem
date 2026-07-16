#!/usr/bin/env python3
"""Run EvoSim headless and export frames for Blender 3D rendering.

Produces ``data/evosim_frames.json`` (schema documented in
``evosim/render/blender_export.py``) which ``blender/import_evosim.py`` turns
into an animated 3D scene.

Usage::

    python -m scripts.export_blender --ticks 1200 --every 2 --out data/evosim_frames.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evosim import Simulation, SimulationConfig  # noqa: E402
from evosim.render.blender_export import BlenderExporter  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="EvoSim -> Blender frame exporter")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--ticks", type=int, default=1200)
    parser.add_argument("--every", type=int, default=2, help="export every Nth tick")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--out", default="data/evosim_frames.json")
    args = parser.parse_args()

    cfg = SimulationConfig.load(args.config) if args.config else SimulationConfig()
    if args.seed is not None:
        cfg.seed = args.seed

    sim = Simulation(cfg)
    exporter = BlenderExporter(output_path=args.out, every=args.every)
    path = exporter.run(sim, ticks=args.ticks)
    print(f"Exported {len(exporter.frames)} frames -> {path}")


if __name__ == "__main__":
    main()
