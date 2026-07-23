"""Visualization back-ends (all optional consumers of engine state)."""

from __future__ import annotations

from .base import Renderer
from .blender_export import BlenderExporter

__all__ = ["Renderer", "BlenderExporter", "PygameRenderer"]


def __getattr__(name):
    # Import PygameRenderer lazily so importing the package never requires
    # pygame/SDL (e.g. on a headless CI box).
    if name == "PygameRenderer":
        from .pygame_renderer import PygameRenderer

        return PygameRenderer
    raise AttributeError(name)
