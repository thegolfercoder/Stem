"""Real-time 2D visualization with Pygame.

Draws the terrain, plants, and organisms, plus a live HUD of population and
trait statistics. Organisms can be coloured by *species* (to watch divergence)
or by *genotype/diet* (to watch trait selection). This is a viewer only -- it
reads engine state and never changes the biology.

Controls
--------
==========  =====================================================
key         action
==========  =====================================================
SPACE       pause / resume
UP / DOWN   faster / slower (steps per rendered frame)
c           cycle colour mode: species -> diet -> true colour
v           toggle vision radius overlay
g           toggle terrain background
ESC / Q     quit
==========  =====================================================
"""

from __future__ import annotations

import numpy as np

from .base import Renderer

COLOR_MODES = ("species", "diet", "genome")


class PygameRenderer(Renderer):
    def __init__(self, width: int = 1200, height: int = 800, fps: int = 60):
        self.width = width
        self.height = height
        self.fps = fps
        self.paused = False
        self.steps_per_frame = 1
        self.color_mode = 0
        self.show_vision = False
        self.show_terrain = True
        self._pg = None
        self.screen = None
        self.clock = None
        self.font = None
        self._terrain_surface = None
        self.sx = 1.0
        self.sy = 1.0

    # --------------------------------------------------------------- setup ---
    def setup(self, simulation) -> None:
        import pygame  # imported lazily so the engine has no hard dependency

        self._pg = pygame
        pygame.init()
        pygame.display.set_caption("EvoSim - Artificial Life Evolution Simulator")
        self.screen = pygame.display.set_mode((self.width, self.height))
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("consolas,menlo,monospace", 15)
        self.sx = self.width / simulation.world.width
        self.sy = self.height / simulation.world.height
        self._build_terrain(simulation)

    def _build_terrain(self, simulation) -> None:
        pygame = self._pg
        terr = simulation.world.terrain  # (ty, tx, 3) in 0..1
        ty, tx, _ = terr.shape
        small = pygame.Surface((tx, ty))
        for y in range(ty):
            for x in range(tx):
                c = (terr[y, x] * 255).astype(int)
                small.set_at((x, y), (int(c[0]), int(c[1]), int(c[2])))
        self._terrain_surface = pygame.transform.smoothscale(
            small, (self.width, self.height)
        )

    # -------------------------------------------------------------- events ---
    def handle_events(self, simulation) -> bool:
        pygame = self._pg
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            if event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    return False
                if event.key == pygame.K_SPACE:
                    self.paused = not self.paused
                elif event.key == pygame.K_UP:
                    self.steps_per_frame = min(50, self.steps_per_frame + 1)
                elif event.key == pygame.K_DOWN:
                    self.steps_per_frame = max(1, self.steps_per_frame - 1)
                elif event.key == pygame.K_c:
                    self.color_mode = (self.color_mode + 1) % len(COLOR_MODES)
                elif event.key == pygame.K_v:
                    self.show_vision = not self.show_vision
                elif event.key == pygame.K_g:
                    self.show_terrain = not self.show_terrain
        return True

    # -------------------------------------------------------------- drawing ---
    def _org_color(self, simulation, org):
        mode = COLOR_MODES[self.color_mode]
        if mode == "species":
            sp = simulation.species_tracker.species.get(org.species_id)
            return sp.color if sp else (200, 200, 200)
        if mode == "diet":
            # green (herbivore) -> red (carnivore)
            return (int(255 * org.diet), int(200 * (1 - org.diet)), 60)
        return org.genome.color

    def render(self, simulation) -> None:
        pygame = self._pg
        if self.show_terrain and self._terrain_surface is not None:
            self.screen.blit(self._terrain_surface, (0, 0))
        else:
            self.screen.fill((18, 20, 26))

        # Plants.
        fp = simulation.world.food_pos
        for k in range(len(fp)):
            x = int(fp[k, 0] * self.sx)
            y = int(fp[k, 1] * self.sy)
            pygame.draw.circle(self.screen, (90, 200, 90), (x, y), 2)

        # Organisms.
        for org in simulation.organisms:
            x = int(org.pos[0] * self.sx)
            y = int(org.pos[1] * self.sy)
            r = max(2, int(org.size * 2.4))
            color = self._org_color(simulation, org)
            if self.show_vision:
                pygame.draw.circle(
                    self.screen, (80, 80, 120), (x, y), int(org.vision * self.sx), 1
                )
            pygame.draw.circle(self.screen, color, (x, y), r)
            # Small facing indicator.
            fx = int(x + np.cos(org.wander_heading) * (r + 3))
            fy = int(y + np.sin(org.wander_heading) * (r + 3))
            pygame.draw.line(self.screen, (10, 10, 10), (x, y), (fx, fy), 1)

        self._draw_hud(simulation)
        pygame.display.flip()
        self.clock.tick(self.fps)

    def _draw_hud(self, simulation) -> None:
        pygame = self._pg
        rec = simulation.stats.records[-1] if simulation.stats.records else {}
        lines = [
            f"tick {simulation.tick}   pop {simulation.population}   "
            f"species {simulation.species_tracker.count}   food {len(simulation.world.food_pos)}",
            f"herb {rec.get('herbivores', 0)}  omni {rec.get('omnivores', 0)}  "
            f"carn {rec.get('carnivores', 0)}   gen~{rec.get('avg_generation', 0):.1f}",
            f"avg speed {rec.get('avg_speed', 0):.2f}  vision {rec.get('avg_vision', 0):.0f}  "
            f"size {rec.get('avg_size', 0):.2f}  camo {rec.get('avg_camouflage', 0):.2f}",
            f"[{'PAUSED' if self.paused else 'RUN'}] color={COLOR_MODES[self.color_mode]}  "
            f"x{self.steps_per_frame}   SPACE pause  UP/DOWN speed  c color  v vision  g terrain",
        ]
        panel = pygame.Surface((self.width, 74))
        panel.set_alpha(180)
        panel.fill((10, 10, 14))
        self.screen.blit(panel, (0, 0))
        for i, text in enumerate(lines):
            surf = self.font.render(text, True, (235, 235, 235))
            self.screen.blit(surf, (8, 6 + i * 17))

    def teardown(self) -> None:
        if self._pg is not None:
            self._pg.quit()

    # --------------------------------------------------------------- driver ---
    def run(self, simulation, max_ticks: int | None = None) -> None:
        """Open a window and drive the simulation until quit/extinction."""
        self.setup(simulation)
        running = True
        try:
            while running:
                running = self.handle_events(simulation)
                if not self.paused:
                    for _ in range(self.steps_per_frame):
                        if not simulation.step():
                            running = False
                            break
                        if max_ticks is not None and simulation.tick >= max_ticks:
                            running = False
                            break
                self.render(simulation)
        finally:
            self.teardown()
