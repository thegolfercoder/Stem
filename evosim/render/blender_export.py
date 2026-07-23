"""Blender export: a bridge to high-quality 3D cinematic visualization.

The engine is 2D and headless, but every organism already has a position, size,
colour, species, and diet -- everything a 3D renderer needs. This exporter
serializes the world state each frame to a compact JSON stream with a stable,
documented schema. A companion Blender script (``blender/import_evosim.py``)
reads that stream and instances/animates meshes, so the *same* unscripted
evolution can be rendered as a cinematic on a "living planet".

Frame schema (one JSON object per exported frame)::

    {
      "tick": int,
      "world": {"width": float, "height": float},
      "organisms": [
        {
          "id": int,
          "x": float, "y": float,     # world coordinates
          "size": float,              # body size trait
          "diet": float,              # 0 herbivore .. 1 carnivore
          "species": int,             # species id
          "color": [r, g, b]          # 0-255
        },
        ...
      ],
      "food": [[x, y], ...]
    }

The top-level output file is ``{"meta": {...}, "frames": [frame, ...]}``.
Using JSON keeps the format language-agnostic and trivially inspectable; for
very long runs, swap ``json`` for line-delimited JSON or ``.npz`` without
changing the schema.
"""

from __future__ import annotations

import json
from pathlib import Path

from .base import Renderer


class BlenderExporter(Renderer):
    def __init__(self, output_path: str = "data/evosim_frames.json", every: int = 1):
        self.output_path = output_path
        self.every = max(1, every)
        self.frames: list[dict] = []
        self._meta: dict = {}

    def setup(self, simulation) -> None:
        self._meta = {
            "width": simulation.world.width,
            "height": simulation.world.height,
            "seed": simulation.config.seed,
            "brain": simulation.config.behavior.brain,
        }

    def render(self, simulation) -> None:
        if simulation.tick % self.every != 0:
            return
        self.frames.append(self._frame(simulation))

    def _frame(self, simulation) -> dict:
        organisms = [
            {
                "id": o.id,
                "x": round(float(o.pos[0]), 2),
                "y": round(float(o.pos[1]), 2),
                "size": round(float(o.size), 3),
                "diet": round(float(o.diet), 3),
                "species": int(o.species_id),
                "color": list(o.genome.color),
            }
            for o in simulation.organisms
        ]
        food = [[round(float(x), 1), round(float(y), 1)] for x, y in simulation.world.food_pos]
        return {
            "tick": simulation.tick,
            "world": {"width": simulation.world.width, "height": simulation.world.height},
            "organisms": organisms,
            "food": food,
        }

    def teardown(self) -> None:
        self.save()

    def save(self) -> None:
        path = Path(self.output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"meta": self._meta, "frames": self.frames}))

    # --------------------------------------------------------------- driver ---
    def run(self, simulation, ticks: int) -> str:
        """Run headless for ``ticks`` steps, capturing frames, and save."""
        self.setup(simulation)
        for _ in range(ticks):
            alive = simulation.step()
            self.render(simulation)
            if not alive:
                break
        self.save()
        return self.output_path
