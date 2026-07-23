#!/usr/bin/env python3
"""Render a headless EvoSim run to an animated GIF for talks / exhibitions.

This drives the real :class:`PygameRenderer` off-screen (via SDL's ``dummy``
video driver) and stitches the frames into a GIF with Pillow -- so you get an
exact recording of the live viewer without needing a display or a screen
recorder. Ideal for embedding the "living planet" in slides or a poster.

Usage::

    python -m scripts.capture_animation --out data/evosim_demo.gif
    python -m scripts.capture_animation --ticks 400 --color species --seed 7
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Force off-screen rendering *before* pygame is imported.
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

from evosim import Simulation, SimulationConfig  # noqa: E402
from evosim.render import PygameRenderer  # noqa: E402
from evosim.render.pygame_renderer import COLOR_MODES  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="EvoSim GIF recorder")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--out", default="data/evosim_demo.gif")
    parser.add_argument("--ticks", type=int, default=300, help="simulation ticks to record")
    parser.add_argument("--steps-per-frame", type=int, default=2)
    parser.add_argument("--width", type=int, default=520)
    parser.add_argument("--height", type=int, default=380)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--brain", choices=["neural", "rule"], default=None)
    parser.add_argument("--color", choices=list(COLOR_MODES), default="diet")
    parser.add_argument("--fps", type=int, default=14)
    parser.add_argument("--colors", type=int, default=128, help="GIF palette size")
    args = parser.parse_args()

    import pygame
    from PIL import Image

    cfg = SimulationConfig.load(args.config) if args.config else SimulationConfig()
    if args.seed is not None:
        cfg.seed = args.seed
    if args.brain:
        cfg.behavior.brain = args.brain
    # Match the world to the recording size so nothing is cropped or scaled.
    cfg.world.width = float(args.width)
    cfg.world.height = float(args.height)

    sim = Simulation(cfg)
    renderer = PygameRenderer(width=args.width, height=args.height)
    renderer.color_mode = COLOR_MODES.index(args.color)
    renderer.setup(sim)

    frames = []
    n_frames = max(1, args.ticks // max(1, args.steps_per_frame))
    for _ in range(n_frames):
        extinct = False
        for _ in range(args.steps_per_frame):
            if not sim.step():
                extinct = True
                break
        renderer.render(sim)
        raw = pygame.image.tostring(renderer.screen, "RGB")
        img = Image.frombytes("RGB", (args.width, args.height), raw)
        frames.append(img.convert("P", palette=Image.ADAPTIVE, colors=args.colors))
        if extinct:
            break
    renderer.teardown()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    duration = int(1000 / max(1, args.fps))
    frames[0].save(
        out, save_all=True, append_images=frames[1:], duration=duration, loop=0, optimize=True
    )
    print(f"Recorded {len(frames)} frames -> {out} "
          f"({out.stat().st_size // 1024} KB); final pop {sim.population}, "
          f"species {sim.species_tracker.count}")


if __name__ == "__main__":
    main()
