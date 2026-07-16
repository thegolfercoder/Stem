"""Renderer abstraction.

Rendering is intentionally decoupled from the engine. A :class:`Renderer` is a
pure *consumer* of :class:`~evosim.simulation.Simulation` state, so multiple
back-ends coexist without the physics knowing about any of them:

* :class:`~evosim.render.pygame_renderer.PygameRenderer` -- real-time 2D.
* :class:`~evosim.render.blender_export.BlenderExporter` -- serializes frames
  for high-quality 3D rendering in Blender.

To add a new visualization (e.g. web/WebGL), implement this interface only.
"""

from __future__ import annotations


class Renderer:
    def setup(self, simulation) -> None:
        """One-time initialization (open window, allocate buffers, ...)."""

    def render(self, simulation) -> None:
        """Present the current simulation state."""
        raise NotImplementedError

    def handle_events(self, simulation) -> bool:
        """Process input. Return False to request shutdown."""
        return True

    def teardown(self) -> None:
        """Release resources."""
