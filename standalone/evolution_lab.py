#!/usr/bin/env python3
"""EvoSim — a native evolution simulator.

A self-contained desktop application (Python standard library only — the GUI is
tkinter, which ships with Python, so there is nothing to install):

    python3 evolution_lab.py

Pick one of five worlds — Wings & Flight, Fang & Claw, Mind & Tool, Ice Age, or
Deep Sea — or build a custom one, and watch real natural selection play out:
named species with distinct traits forage, hunt, breed, and go extinct on their
own. Nothing is scripted; every run is different.

Features: colour creatures by species OR by fitness; a live "fitness distribution"
chart showing how the whole population shifts from its ancestors; the current
champion highlighted; death flashes; and order statistics + a species
leaderboard.

Created by Rian Sikka · Grade 9 (IGCSE) · Scottish High International School.

The simulation core (`World`) has no GUI dependency and can be imported and
driven headless for experiments.
"""

from __future__ import annotations

import colorsys
import math
import random

# --------------------------------------------------------------------------- #
#  Simulation model (pure Python — no GUI)                                      #
# --------------------------------------------------------------------------- #

SPEED = (0.4, 3.2)
SIZE = (0.5, 2.4)
VISION = (25.0, 150.0)
DIET = (0.0, 1.0)
MAX_CREATURES = 340
NBINS = 16
TRAIT_RANGE = {"speed": SPEED, "size": SIZE, "vision": VISION, "diet": DIET}
TRAIT_LABEL = {"speed": "Speed", "size": "Size", "vision": "Eyesight", "diet": "Diet"}


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


class Creature:
    __slots__ = ("x", "y", "heading", "energy", "age", "lifespan", "cooldown",
                 "species", "gen", "speed", "size", "vision", "diet", "max_energy")

    def __init__(self, x, y, species, traits, rng, gen=0, energy=None):
        self.x, self.y = x, y
        self.heading = rng.uniform(0, 2 * math.pi)
        self.species = species
        self.gen = gen
        self.speed, self.size, self.vision, self.diet = traits
        self.max_energy = 60.0 + 40.0 * (self.size - SIZE[0]) / (SIZE[1] - SIZE[0])
        self.energy = self.max_energy * 0.6 if energy is None else energy
        self.age = 0
        self.lifespan = int(1200 + self.size * 500 + rng.uniform(-150, 150))
        self.cooldown = 0


class World:
    """The ecosystem. Toroidal; grid-accelerated neighbour search."""

    def __init__(self, width=740, height=500, rng=None):
        self.width, self.height = width, height
        self.rng = rng or random.Random()
        self.food_mult = 0.6
        self.mutation = 0.09
        self.harshness = 1.0
        self.signature = "speed"
        self.species_names: list[str] = []
        self.species_emoji: list[str] = []
        self.species_colors: list[str] = []
        self._profiles: list[tuple] = []
        self.creatures: list[Creature] = []
        self.food: list[list[float]] = []
        self.tick = 0
        self.births_total = 0
        self.deaths_total = 0
        self.best_ever = 0.0
        self.hist0 = [0] * NBINS
        self.mean0 = 0.0
        self.last_deaths: list[tuple] = []
        self._cell = 60.0
        self.configure_custom(4, 150)

    # ------------------------------------------------------------- set-up ---
    def _sig_hist(self, values):
        lo, hi = TRAIT_RANGE[self.signature]
        h = [0] * NBINS
        span = hi - lo
        for v in values:
            b = min(NBINS - 1, max(0, int((v - lo) / span * NBINS)))
            h[b] += 1
        return h

    def _seed(self, start_pop):
        rng = self.rng
        s = len(self._profiles)
        self.creatures = []
        for i in range(int(start_pop)):
            sp = i % s
            self.creatures.append(Creature(
                rng.uniform(0, self.width), rng.uniform(0, self.height), sp,
                self._mutated(self._profiles[sp], scale=0.10), rng))
        self.food = []
        self._spawn_food(int(self._food_cap() * 0.8))
        self.tick = 0
        self.births_total = 0
        self.deaths_total = 0
        sig = self.signature
        s0 = [getattr(c, sig) for c in self.creatures]
        self.hist0 = self._sig_hist(s0)
        self.mean0 = sum(s0) / len(s0) if s0 else 0.0
        self.best_ever = max(s0) if s0 else 0.0
        self.last_deaths = []

    def configure_scenario(self, specs, signature, start_pop=160):
        self.signature = signature
        self.species_names = [d["name"] for d in specs]
        self.species_emoji = [d.get("emoji", "•") for d in specs]
        self.species_colors = [_hue(i, len(specs)) for i in range(len(specs))]
        self._profiles = [(d["speed"], d["size"], d["vision"], d["diet"]) for d in specs]
        self._seed(start_pop)

    def configure_custom(self, n_species, start_pop, signature="speed"):
        rng = self.rng
        s = max(1, int(n_species))
        self.signature = signature
        self.species_names = [f"Species {i+1}" for i in range(s)]
        self.species_emoji = ["🧬"] * s
        self.species_colors = [_hue(i, s) for i in range(s)]
        self._profiles = [(rng.uniform(*SPEED), rng.uniform(0.7, 2.0),
                           rng.uniform(*VISION), rng.uniform(0.0, 1.0)) for _ in range(s)]
        self._seed(start_pop)

    def _food_cap(self):
        return int(360 * self.food_mult)

    def _spawn_food(self, n):
        for _ in range(n):
            self.food.append([self.rng.uniform(0, self.width), self.rng.uniform(0, self.height)])

    def _mutated(self, traits, scale=None):
        if scale is None:
            scale = self.mutation
        sp, si, vi, di = traits
        r = self.rng.gauss
        sp = _clamp(sp + r(0, scale) * (SPEED[1] - SPEED[0]), *SPEED)
        si = _clamp(si + r(0, scale) * (SIZE[1] - SIZE[0]), *SIZE)
        vi = _clamp(vi + r(0, scale) * (VISION[1] - VISION[0]), *VISION)
        di = _clamp(di + r(0, scale) * (DIET[1] - DIET[0]), *DIET)
        return (sp, si, vi, di)

    # -------------------------------------------------------- neighbours ---
    def _grid(self, points):
        cell = self._cell
        g: dict = {}
        for idx, p in enumerate(points):
            g.setdefault((int(p[0] // cell), int(p[1] // cell)), []).append(idx)
        return g

    def _near(self, g, x, y, radius):
        cell = self._cell
        r = int(radius // cell) + 1
        cx, cy = int(x // cell), int(y // cell)
        out = []
        for gx in range(cx - r, cx + r + 1):
            for gy in range(cy - r, cy + r + 1):
                b = g.get((gx, gy))
                if b:
                    out.extend(b)
        return out

    def _wrap_delta(self, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        if dx > self.width / 2: dx -= self.width
        elif dx < -self.width / 2: dx += self.width
        if dy > self.height / 2: dy -= self.height
        elif dy < -self.height / 2: dy += self.height
        return dx, dy

    # ------------------------------------------------------------- step ----
    def step(self):
        cre = self.creatures
        self.last_deaths = []
        if not cre:
            return
        rng = self.rng
        fpos = self.food
        fgrid = self._grid(fpos)
        cgrid = self._grid([(c.x, c.y) for c in cre])
        eaten_food = set()
        dead = set()
        newborns = []

        for i, c in enumerate(cre):
            if i in dead:
                continue
            vision = c.vision
            tx = ty = None
            best_prey = None; best_prey_d = 1e9; best_prey_dir = None
            threat_dir = None; worst_threat_d = 1e9
            for j in self._near(cgrid, c.x, c.y, vision):
                if j == i or j in dead:
                    continue
                o = cre[j]
                dx, dy = self._wrap_delta(c.x, c.y, o.x, o.y)
                d2 = dx * dx + dy * dy
                if d2 > vision * vision:
                    continue
                if o.size > c.size * 1.15 and o.diet > 0.5 and d2 < worst_threat_d:
                    worst_threat_d = d2; threat_dir = (-dx, -dy)
                if c.diet > 0.35 and c.size > o.size * 1.15 and d2 < best_prey_d:
                    best_prey_d = d2; best_prey = j; best_prey_dir = (dx, dy)

            best_food = None; best_food_d = 1e9; food_dir = None
            if c.diet < 0.85:
                for fi in self._near(fgrid, c.x, c.y, vision):
                    if fi in eaten_food:
                        continue
                    fx, fy = fpos[fi]
                    dx, dy = self._wrap_delta(c.x, c.y, fx, fy)
                    d2 = dx * dx + dy * dy
                    if d2 < best_food_d and d2 <= vision * vision:
                        best_food_d = d2; best_food = fi; food_dir = (dx, dy)

            if threat_dir is not None:
                tx, ty = threat_dir
            elif best_prey is not None:
                tx, ty = best_prey_dir
            elif food_dir is not None:
                tx, ty = food_dir
            if tx is not None:
                n = math.hypot(tx, ty) or 1.0
                c.heading = math.atan2(ty / n, tx / n)
            else:
                c.heading += rng.uniform(-0.4, 0.4)

            step = c.speed * (1.0 if tx is not None else 0.55)
            c.x = (c.x + math.cos(c.heading) * step) % self.width
            c.y = (c.y + math.sin(c.heading) * step) % self.height
            eat_r = 4.0 + c.size * 3.0

            if c.diet < 0.85 and best_food is not None and best_food not in eaten_food:
                fx, fy = fpos[best_food]
                dx, dy = self._wrap_delta(c.x, c.y, fx, fy)
                if dx * dx + dy * dy <= eat_r * eat_r:
                    eaten_food.add(best_food)
                    c.energy = min(c.max_energy, c.energy + 26.0 * (1.0 - 0.6 * c.diet))

            if best_prey is not None and best_prey not in dead:
                o = cre[best_prey]
                dx, dy = self._wrap_delta(c.x, c.y, o.x, o.y)
                reach = eat_r + o.size * 2.0
                if dx * dx + dy * dy <= reach * reach:
                    edge = _clamp((c.size - o.size) / max(o.size, 0.1), 0, 1)
                    if rng.random() < 0.35 + 0.45 * edge:
                        dead.add(best_prey)
                        c.energy = min(c.max_energy,
                                       c.energy + o.energy * 0.6 * (0.4 + 0.6 * c.diet))

            c.energy -= self.harshness * (0.10 * c.size ** 0.75 + 0.012 * step * step * c.size)
            c.age += 1
            if c.cooldown > 0:
                c.cooldown -= 1
            if c.energy <= 0.0 or c.age >= c.lifespan:
                dead.add(i)
                continue

            if (c.cooldown == 0 and c.energy > c.max_energy * 0.7
                    and len(cre) + len(newborns) - len(dead) < MAX_CREATURES):
                invest = c.energy * 0.5
                c.energy -= invest
                c.cooldown = 45
                traits = self._mutated((c.speed, c.size, c.vision, c.diet))
                nx = (c.x + rng.uniform(-8, 8)) % self.width
                ny = (c.y + rng.uniform(-8, 8)) % self.height
                child = Creature(nx, ny, c.species, traits, rng, gen=c.gen + 1, energy=invest)
                newborns.append(child)
                self.best_ever = max(self.best_ever, getattr(child, self.signature))

        if dead:
            self.last_deaths = [(cre[k].x, cre[k].y) for k in dead]
            self.creatures = [c for k, c in enumerate(cre) if k not in dead]
            self.deaths_total += len(dead)
        self.creatures.extend(newborns)
        self.births_total += len(newborns)
        if eaten_food:
            self.food = [f for k, f in enumerate(fpos) if k not in eaten_food]
        cap = self._food_cap()
        if len(self.food) < cap:
            self._spawn_food(min(6, cap - len(self.food)))
        self.tick += 1

    # ------------------------------------------------------------ stats ----
    def stats(self):
        cre = self.creatures
        n = len(cre)
        counts = [0] * len(self.species_colors)
        sig = self.signature
        if n:
            sp = si = di = ge = 0.0
            mx_gen = 0
            svals = []
            for c in cre:
                sp += c.speed; si += c.size; di += c.diet; ge += c.gen
                mx_gen = max(mx_gen, c.gen)
                svals.append(getattr(c, sig))
                if c.species < len(counts):
                    counts[c.species] += 1
            alive = sum(1 for x in counts if x > 0)
            return dict(pop=n, species_alive=alive, avg_speed=sp / n, avg_size=si / n,
                        avg_diet=di / n, gen=ge / n, max_gen=mx_gen, food=len(self.food),
                        counts=counts, tick=self.tick, births=self.births_total,
                        deaths=self.deaths_total, sig_min=min(svals),
                        sig_mean=sum(svals) / n, sig_max=max(svals),
                        best_ever=self.best_ever, hist_now=self._sig_hist(svals))
        return dict(pop=0, species_alive=0, avg_speed=0, avg_size=0, avg_diet=0,
                    gen=0, max_gen=0, food=len(self.food), counts=counts, tick=self.tick,
                    births=self.births_total, deaths=self.deaths_total,
                    sig_min=0, sig_mean=0, sig_max=0, best_ever=self.best_ever,
                    hist_now=[0] * NBINS)


def _hue(i, n, sat=0.62, val=0.92):
    r, g, b = colorsys.hsv_to_rgb(i / max(1, n), sat, val)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


SCENARIOS = [
    dict(id="wings", title="Wings & Flight", emoji="🐦", signature="speed",
         blurb="Food is scattered far and wide. Swift, keen-eyed flyers reach it "
               "first — the grounded fall behind.",
         species=[
             dict(name="Eagles", emoji="🦅", speed=2.9, size=1.4, vision=135, diet=0.2),
             dict(name="Sparrows", emoji="🐦", speed=2.4, size=0.8, vision=115, diet=0.1),
             dict(name="Ground Fowl", emoji="🐔", speed=1.1, size=1.6, vision=70, diet=0.15),
         ]),
    dict(id="fangs", title="Fang & Claw", emoji="🐅", signature="size",
         blurb="A predator's world. Big fanged hunters chase down prey, while the "
               "swift and small try to survive.",
         species=[
             dict(name="Tigers", emoji="🐅", speed=2.2, size=2.2, vision=125, diet=0.85),
             dict(name="Deer", emoji="🦌", speed=2.7, size=1.3, vision=110, diet=0.05),
             dict(name="Hares", emoji="🐇", speed=3.0, size=0.7, vision=90, diet=0.05),
         ]),
    dict(id="minds", title="Mind & Tool", emoji="🦍", signature="vision",
         blurb="Cleverness wins. Sharp-eyed, resourceful apes find food that others "
               "walk straight past.",
         species=[
             dict(name="Humans", emoji="🧑", speed=2.0, size=1.4, vision=148, diet=0.4),
             dict(name="Chimps", emoji="🐒", speed=2.4, size=1.1, vision=100, diet=0.3),
             dict(name="Gorillas", emoji="🦍", speed=1.4, size=2.2, vision=80, diet=0.2),
         ]),
    dict(id="ice", title="Ice Age", emoji="🦣", signature="size",
         blurb="The cold favours the big and well-insulated. Large bodies hold heat; "
               "the small freeze out.",
         species=[
             dict(name="Mammoths", emoji="🦣", speed=1.3, size=2.3, vision=95, diet=0.15),
             dict(name="Wolves", emoji="🐺", speed=2.6, size=1.5, vision=120, diet=0.8),
             dict(name="Rabbits", emoji="🐇", speed=2.8, size=0.7, vision=85, diet=0.05),
         ]),
    dict(id="deep", title="Deep Sea", emoji="🐙", signature="vision",
         blurb="In the lightless deep, only the keenest sensors find scarce food "
               "before their rivals do.",
         species=[
             dict(name="Anglerfish", emoji="🎣", speed=1.8, size=1.6, vision=145, diet=0.7),
             dict(name="Squid", emoji="🦑", speed=2.6, size=1.2, vision=120, diet=0.5),
             dict(name="Shrimp", emoji="🦐", speed=2.2, size=0.7, vision=70, diet=0.1),
         ]),
]


# --------------------------------------------------------------------------- #
#  Native GUI (tkinter)                                                         #
# --------------------------------------------------------------------------- #

def run_gui():
    import os
    import tkinter as tk
    from tkinter import ttk

    BG = "#eef2f5"; CARD = "#ffffff"; INK = "#17222c"; MUT = "#5c6b78"
    FAINT = "#8b98a4"; LINE = "#d9e0e6"; ACCENT = "#127a6b"; ACCENT_D = "#0d5d51"
    VIEW = "#0c1116"; CREDIT = "#0d5d51"; GOLD = "#e0a53c"
    FONT = "Segoe UI"

    root = tk.Tk()
    root.title("EvoSim — Evolution Simulator")
    root.configure(bg=BG)
    root.geometry("1180x830")
    root.minsize(1100, 740)

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass
    style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor="#dbe3e9",
                    bordercolor="#dbe3e9", lightcolor=ACCENT, darkcolor=ACCENT)

    container = tk.Frame(root, bg=BG)
    container.pack(fill="both", expand=True)
    state = {"world": None, "scenario": None}

    def clear():
        for w in container.winfo_children():
            w.destroy()

    def L(parent, text, size=11, fg=INK, bg=CARD, bold=False, **kw):
        return tk.Label(parent, text=text, bg=bg, fg=fg,
                        font=(FONT, size, "bold" if bold else "normal"), **kw)

    def button(parent, text, cmd, kind="accent", big=False):
        colors = {"accent": (ACCENT, ACCENT_D, "white"),
                  "ghost": ("#e7edf1", "#dbe3e9", INK),
                  "gold": (GOLD, "#c98f2a", "white")}
        bgc, hov, fgc = colors[kind]
        b = tk.Button(parent, text=text, command=cmd, relief="flat", cursor="hand2",
                      bg=bgc, fg=fgc, activebackground=hov, activeforeground=fgc, bd=0,
                      font=(FONT, 13 if big else 10, "bold"),
                      padx=20 if big else 12, pady=9 if big else 6)
        b.bind("<Enter>", lambda e: b.config(bg=hov))
        b.bind("<Leave>", lambda e: b.config(bg=bgc))
        return b

    # ================================================================= splash
    def show_splash():
        clear()
        wrap = tk.Frame(container, bg=BG)
        wrap.place(relx=0.5, rely=0.5, anchor="center")
        tk.Label(wrap, text="🧬", bg=BG, font=(FONT, 62)).pack()
        tk.Label(wrap, text="EvoSim", bg=BG, fg=INK, font=(FONT, 42, "bold")).pack()
        tk.Label(wrap, text="An Evolution Simulator", bg=BG, fg=MUT, font=(FONT, 15)).pack(pady=(0, 4))
        card = tk.Frame(wrap, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        card.pack(pady=18, ipadx=28, ipady=16)
        L(card, "Created by", 10, FAINT).pack()
        L(card, "Rian Sikka", 22, CREDIT, bold=True).pack()
        L(card, "Grade 9  ·  IGCSE", 12, INK).pack(pady=(2, 0))
        L(card, "Scottish High International School", 11, MUT).pack()
        pb = ttk.Progressbar(wrap, style="Horizontal.TProgressbar", length=340,
                             mode="determinate", maximum=100)
        pb.pack(pady=(16, 6))
        status = tk.Label(wrap, text="", bg=BG, fg=FAINT, font=(FONT, 10))
        status.pack()
        msgs = ["Seeding primordial genomes…", "Growing the food web…",
                "Warming up natural selection…", "Ready."]

        def load(v=0):
            pb["value"] = v
            status.config(text=msgs[min(len(msgs) - 1, v // 26)])
            if v < 100:
                root.after(26, load, v + 2)
            else:
                button(wrap, "Enter the Simulator  →", show_scenarios, big=True).pack(pady=12)
        root.after(280, load)

    # ============================================================== scenarios
    def show_scenarios():
        clear()
        head = tk.Frame(container, bg=BG); head.pack(fill="x", pady=(24, 4))
        tk.Label(head, text="Choose a world to evolve", bg=BG, fg=INK,
                 font=(FONT, 24, "bold")).pack()
        tk.Label(head, text="Each world starts with different species and traits. "
                            "Nothing is scripted — watch who survives.",
                 bg=BG, fg=MUT, font=(FONT, 12)).pack(pady=(2, 0))
        grid = tk.Frame(container, bg=BG); grid.pack(expand=True)

        def card(scn, r, col):
            c = tk.Frame(grid, bg=CARD, highlightbackground=LINE, highlightthickness=1,
                         width=300, height=290)
            c.grid(row=r, column=col, padx=12, pady=12); c.pack_propagate(False)
            tk.Label(c, text=scn["emoji"], bg=CARD, font=(FONT, 44)).pack(pady=(18, 2))
            L(c, scn["title"], 16, INK, bold=True).pack()
            L(c, "  ".join(f'{s["emoji"]} {s["name"]}' for s in scn["species"]), 10, ACCENT).pack(pady=(3, 6))
            L(c, scn["blurb"], 10, MUT, wraplength=250, justify="center").pack(padx=14)
            button(c, "Simulate  ▶", lambda s=scn: start_scenario(s), big=True).pack(side="bottom", pady=16)

        for i, scn in enumerate(SCENARIOS):
            card(scn, i // 3, i % 3)

        custom = tk.Frame(container, bg=BG); custom.pack(pady=(0, 16))
        L(custom, "…or build a custom world:", 11, MUT, BG).grid(row=0, column=0, padx=(0, 10))
        sp_var = tk.IntVar(value=4); pop_var = tk.IntVar(value=150)
        L(custom, "species", 10, FAINT, BG).grid(row=0, column=1)
        tk.Spinbox(custom, from_=1, to=8, width=3, textvariable=sp_var).grid(row=0, column=2, padx=4)
        L(custom, "population", 10, FAINT, BG).grid(row=0, column=3)
        tk.Spinbox(custom, from_=40, to=300, increment=10, width=4, textvariable=pop_var).grid(row=0, column=4, padx=4)
        button(custom, "Build ▶", lambda: start_custom(sp_var.get(), pop_var.get())).grid(row=0, column=5, padx=10)

    # ============================================================= simulation
    def start_scenario(scn):
        w = World(); w.food_mult, w.mutation, w.harshness = 0.6, 0.09, 1.0
        w.configure_scenario(scn["species"], scn["signature"])
        state["world"], state["scenario"] = w, scn
        show_sim(scn["title"])

    def start_custom(n, pop):
        w = World(); w.food_mult, w.mutation, w.harshness = 0.6, 0.09, 1.0
        w.configure_custom(n, pop)
        state["world"], state["scenario"] = w, dict(title="Custom World", signature="speed")
        show_sim("Custom World")

    def trait_color(v, sig):
        lo, hi = TRAIT_RANGE[sig]
        t = _clamp((v - lo) / (hi - lo), 0, 1)
        a = (206, 221, 217); b = (11, 92, 86)
        return "#%02x%02x%02x" % (int(a[0] + (b[0] - a[0]) * t),
                                  int(a[1] + (b[1] - a[1]) * t),
                                  int(a[2] + (b[2] - a[2]) * t))

    def show_sim(title):
        clear()
        world = state["world"]; sig = world.signature
        CW, CH, CHART_H = 740, 500, 118
        _dist = os.environ.get("LAB_VIEW") == "dist"
        ui = {"run": True, "spf": 3,
              "colour": "fitness" if _dist else "species",
              "chart": "dist" if _dist else "trend"}
        history: list[tuple] = []
        death_fx: list[dict] = []

        top = tk.Frame(container, bg=BG); top.pack(fill="x", padx=16, pady=(12, 0))
        button(top, "←  Worlds", show_scenarios, kind="ghost").pack(side="left")
        tk.Label(top, text=title, bg=BG, fg=INK, font=(FONT, 18, "bold")).pack(side="left", padx=14)
        tk.Label(top, text=f"Fitness trait: {TRAIT_LABEL[sig]}", bg=BG, fg=MUT,
                 font=(FONT, 11)).pack(side="left")
        tk.Label(top, text="EvoSim · by Rian Sikka", bg=BG, fg=FAINT, font=(FONT, 10)).pack(side="right")

        body = tk.Frame(container, bg=BG); body.pack(fill="both", expand=True, padx=16, pady=12)
        left = tk.Frame(body, bg=BG); left.pack(side="left")
        canvas = tk.Canvas(left, width=CW, height=CH, bg=VIEW, highlightthickness=1,
                           highlightbackground=LINE)
        canvas.pack()
        chart = tk.Canvas(left, width=CW, height=CHART_H, bg=VIEW, highlightthickness=1,
                          highlightbackground=LINE)
        chart.pack(pady=(10, 0))
        chart_cap = L(left, "", 10, MUT, BG); chart_cap.pack(anchor="w", pady=(4, 0))

        right = tk.Frame(body, bg=BG, width=346); right.pack(side="left", fill="y", padx=(16, 0))
        right.pack_propagate(False)

        def panel(t):
            box = tk.Frame(right, bg=CARD, highlightbackground=LINE, highlightthickness=1)
            box.pack(fill="x", pady=(0, 10))
            L(box, t, 9, FAINT, bold=True).pack(anchor="w", padx=12, pady=(9, 2))
            return box

        # view toggles
        vbox = panel("VIEW")
        vr = tk.Frame(vbox, bg=CARD); vr.pack(fill="x", padx=12, pady=(0, 4))
        L(vr, "Colour:", 10, MUT).pack(side="left")
        col_btn = button(vr, "By fitness" if ui["colour"] == "fitness" else "By species",
                         None, kind="ghost"); col_btn.pack(side="left", padx=6)
        vr2 = tk.Frame(vbox, bg=CARD); vr2.pack(fill="x", padx=12, pady=(0, 10))
        L(vr2, "Chart:", 10, MUT).pack(side="left")
        chart_btn = button(vr2, "Fitness spread" if ui["chart"] == "dist" else "Population trend",
                           None, kind="ghost"); chart_btn.pack(side="left", padx=6)

        def toggle_colour():
            ui["colour"] = "fitness" if ui["colour"] == "species" else "species"
            col_btn.config(text="By fitness" if ui["colour"] == "fitness" else "By species")
        def toggle_chart():
            ui["chart"] = "dist" if ui["chart"] == "trend" else "trend"
            chart_btn.config(text="Fitness spread" if ui["chart"] == "dist" else "Population trend")
        col_btn.config(command=toggle_colour); chart_btn.config(command=toggle_chart)

        # controls
        cbox = panel("CONTROLS")
        rowb = tk.Frame(cbox, bg=CARD); rowb.pack(fill="x", padx=12, pady=(0, 8))
        start_btn = button(rowb, "⏸ Pause", None); start_btn.pack(side="left")
        button(rowb, "↻ Restart", lambda: do_restart(), kind="ghost").pack(side="left", padx=8)
        sliders = {}
        def add_slider(key, name, lo, hi, init):
            f = tk.Frame(cbox, bg=CARD); f.pack(fill="x", padx=12, pady=(2, 4))
            hd = tk.Frame(f, bg=CARD); hd.pack(fill="x")
            L(hd, name, 10, INK).pack(side="left")
            val = L(hd, "", 10, MUT); val.pack(side="right")
            var = tk.DoubleVar(value=init)
            ttk.Scale(f, from_=lo, to=hi, variable=var, orient="horizontal").pack(fill="x")
            sliders[key] = (var, val)
        add_slider("food", "Food", 0.1, 1.0, world.food_mult)
        add_slider("mut", "Mutation", 0.0, 0.25, world.mutation)
        add_slider("harsh", "Harshness", 0.5, 2.0, world.harshness)
        add_slider("speed", "Sim speed", 1, 16, ui["spf"])
        tk.Frame(cbox, bg=CARD, height=4).pack()

        # statistics
        sbox = panel("STATISTICS")
        stat_var = tk.StringVar()
        tk.Label(sbox, textvariable=stat_var, bg=CARD, fg=INK, justify="left", anchor="w",
                 font=("Consolas", 10)).pack(fill="x", padx=12, pady=(0, 4))
        sig_var = tk.StringVar()
        tk.Label(sbox, textvariable=sig_var, bg=CARD, fg=ACCENT_D, justify="left", anchor="w",
                 font=("Consolas", 10, "bold")).pack(fill="x", padx=12, pady=(0, 10))

        # leaderboard
        lbox = panel("SPECIES LEADERBOARD")
        holder = tk.Frame(lbox, bg=CARD); holder.pack(fill="x", padx=12, pady=(0, 10))
        lb_rows = []
        for i in range(len(world.species_colors)):
            rw = tk.Frame(holder, bg=CARD); rw.pack(fill="x", pady=1)
            sw = tk.Canvas(rw, width=12, height=12, bg=CARD, highlightthickness=0)
            sw.create_oval(1, 1, 11, 11, fill=world.species_colors[i], outline=""); sw.pack(side="left")
            nm = tk.Label(rw, bg=CARD, fg=INK, font=(FONT, 10), anchor="w"); nm.pack(side="left", padx=6)
            ct = tk.Label(rw, bg=CARD, fg=MUT, font=("Consolas", 10), anchor="e"); ct.pack(side="right")
            bar = tk.Canvas(rw, width=68, height=8, bg="#eef2f5", highlightthickness=0); bar.pack(side="right", padx=6)
            lb_rows.append((rw, nm, ct, bar))

        food_ids, cre_ids = [], []

        def draw_chart(st):
            chart.delete("all")
            w, h, pad = CW, CHART_H, 8
            if ui["chart"] == "trend":
                chart_cap.config(text=f"Population (green)   ·   Average {TRAIT_LABEL[sig].lower()} (orange), over time")
                if len(history) < 2:
                    return
                npt = len(history); maxpop = max(1, max(p for p, _ in history))
                slo, shi = TRAIT_RANGE[sig]
                def line(sel, lo, hi, color):
                    co = []
                    for k, rec in enumerate(history):
                        x = pad + k / (npt - 1) * (w - 2 * pad)
                        y = h - pad - (sel(rec) - lo) / (hi - lo) * (h - 2 * pad)
                        co += [x, y]
                    chart.create_line(*co, fill=color, width=2, smooth=True)
                line(lambda r: r[0], 0, maxpop, "#3f9e57")
                line(lambda r: r[1], slo, shi, "#e08a3c")
            else:
                chart_cap.config(text=f"{TRAIT_LABEL[sig]} spread — first generation (grey) vs now (teal)")
                h0, hn = world.hist0, st["hist_now"]
                s0 = sum(h0) or 1; sn = sum(hn) or 1
                f0 = [v / s0 for v in h0]; fn = [v / sn for v in hn]
                mx = max(0.001, max(f0), max(fn))
                bw = (w - 2 * pad) / NBINS
                def area(frac, fill, stroke):
                    pts = [pad, h - pad]
                    for i in range(NBINS):
                        pts += [pad + i * bw + bw / 2, h - pad - frac[i] / mx * (h - 2 * pad)]
                    pts += [w - pad, h - pad]
                    chart.create_polygon(*pts, fill=fill, outline=stroke, width=2)
                area(f0, "", "#8b98a4")
                area(fn, "", "#2f9e8c")

        def render():
            st = world.stats()
            fp = world.food
            while len(food_ids) < len(fp):
                food_ids.append(canvas.create_oval(0, 0, 0, 0, fill="#3f9e57", outline=""))
            for k, fid in enumerate(food_ids):
                if k < len(fp):
                    x, y = fp[k]; canvas.coords(fid, x - 1.5, y - 1.5, x + 1.5, y + 1.5)
                    canvas.itemconfigure(fid, state="normal")
                else:
                    canvas.itemconfigure(fid, state="hidden")

            cre = world.creatures; cols = world.species_colors; by_fit = ui["colour"] == "fitness"
            champ = -1; champ_v = -1e9
            for k, c in enumerate(cre):
                v = getattr(c, sig)
                if v > champ_v: champ_v = v; champ = k
            while len(cre_ids) < len(cre):
                cre_ids.append(canvas.create_oval(0, 0, 0, 0, outline=""))
            for k, cid in enumerate(cre_ids):
                if k < len(cre):
                    c = cre[k]; r = 2.6 + c.size * 2.5
                    col = trait_color(getattr(c, sig), sig) if by_fit else (
                        cols[c.species] if c.species < len(cols) else "#ccc")
                    canvas.coords(cid, c.x - r, c.y - r, c.x + r, c.y + r)
                    canvas.itemconfigure(cid, fill=col, state="normal",
                                         outline="#0b0d12" if c.diet > 0.6 else "",
                                         width=2 if c.diet > 0.6 else 1)
                else:
                    canvas.itemconfigure(cid, state="hidden")

            # champion ring
            canvas.delete("champ")
            if 0 <= champ < len(cre):
                c = cre[champ]; r = 2.6 + c.size * 2.5 + 4
                canvas.create_oval(c.x - r, c.y - r, c.x + r, c.y + r, outline=GOLD,
                                   width=2, tags="champ")
            # death flashes
            canvas.delete("death")
            for fx in death_fx:
                a = 1 - fx["age"] / 12
                if a <= 0: continue
                x, y = fx["x"], fx["y"]; s = 3 + fx["age"]
                canvas.create_line(x - s, y - s, x + s, y + s, fill="#c0454e", width=2, tags="death")
                canvas.create_line(x + s, y - s, x - s, y + s, fill="#c0454e", width=2, tags="death")
                fx["age"] += 1
            death_fx[:] = [f for f in death_fx if f["age"] < 12]

            stat_var.set(
                f"Population    {st['pop']:>4}\n"
                f"Species alive {st['species_alive']:>2} / {len(cols)}\n"
                f"Generation    {st['gen']:>5.1f}   (max {st['max_gen']})\n"
                f"Births        {st['births']:>5}\n"
                f"Deaths        {st['deaths']:>5}\n"
                f"Plants        {st['food']:>5}\n"
                f"Tick          {st['tick']:>5}")
            sl = TRAIT_LABEL[sig]
            sig_var.set(f"{sl}  (order statistics)\n"
                        f"  min  {st['sig_min']:>6.2f}\n"
                        f"  mean {st['sig_mean']:>6.2f}\n"
                        f"  max  {st['sig_max']:>6.2f}\n"
                        f"  best-ever {st['best_ever']:>5.2f}")

            counts = st["counts"]; order = sorted(range(len(counts)), key=lambda i: counts[i], reverse=True)
            mx = max(counts) or 1
            for rank, idx in enumerate(order):
                rw, nm, ct, bar = lb_rows[rank]
                sw = rw.winfo_children()[0]; sw.delete("all")
                sw.create_oval(1, 1, 11, 11, fill=cols[idx], outline="")
                em = world.species_emoji[idx] if idx < len(world.species_emoji) else ""
                name = world.species_names[idx] if idx < len(world.species_names) else f"#{idx}"
                alive = counts[idx] > 0
                nm.config(text=f"{em} {name}", fg=INK if alive else "#9aa6b0")
                ct.config(text=str(counts[idx]), fg=MUT if alive else "#9aa6b0")
                bar.delete("all"); bar.create_rectangle(0, 0, int(counts[idx] / mx * 68), 8,
                                                        fill=cols[idx], outline="")

            history.append((st["pop"], st["sig_mean"]))
            if len(history) > 300: del history[0]
            draw_chart(st)

        def apply_live(*_):
            world.food_mult = float(sliders["food"][0].get())
            world.mutation = float(sliders["mut"][0].get())
            world.harshness = float(sliders["harsh"][0].get())
            ui["spf"] = int(round(float(sliders["speed"][0].get())))
            sliders["food"][1].config(text=f"{world.food_mult:.0%}")
            sliders["mut"][1].config(text=f"{world.mutation:.0%}")
            sliders["harsh"][1].config(text=f"{world.harshness:.0%}")
            sliders["speed"][1].config(text=f"{ui['spf']}×")
        for key in sliders:
            sliders[key][0].trace_add("write", apply_live)

        def do_restart():
            scn = state["scenario"]
            if "species" in scn:
                world.configure_scenario(scn["species"], scn["signature"])
            else:
                world.configure_custom(len(world.species_colors), 150, world.signature)
            history.clear(); death_fx.clear(); render()

        def toggle():
            ui["run"] = not ui["run"]
            start_btn.config(text="⏸ Pause" if ui["run"] else "▶ Resume",
                             bg=ACCENT if ui["run"] else "#2f9e70")
        start_btn.config(command=toggle)

        def loop():
            if ui["run"]:
                for _ in range(ui["spf"]):
                    world.step()
                    for (dx, dy) in world.last_deaths:
                        death_fx.append({"x": dx, "y": dy, "age": 0})
                if len(death_fx) > 120: del death_fx[:-120]
                render()
            root.after(33, loop)

        apply_live(); render(); root.after(33, loop)

        shot = os.environ.get("LAB_SELFTEST")
        if shot and os.environ.get("LAB_SCREEN", "sim") == "sim":
            def cap():
                import subprocess
                root.update_idletasks()
                subprocess.run(["import", "-window", "root", shot], check=False)
                print(f"SIM shot -> {shot}; pop={world.stats()['pop']}")
                root.destroy()
            root.after(4500, cap)

    shot = os.environ.get("LAB_SELFTEST")
    target = os.environ.get("LAB_SCREEN", "")
    if shot and target in ("splash", "scenario"):
        (show_splash if target == "splash" else show_scenarios)()
        def cap():
            import subprocess
            root.update_idletasks()
            subprocess.run(["import", "-window", "root", shot], check=False)
            print(f"{target} shot -> {shot}"); root.destroy()
        root.after(1600 if target == "scenario" else 3600, cap)
    elif shot and target == "sim":
        start_scenario(SCENARIOS[0])
    else:
        show_splash()

    root.mainloop()


if __name__ == "__main__":
    run_gui()
