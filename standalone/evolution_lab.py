#!/usr/bin/env python3
"""EvoSim Lab — a completely self-contained, native evolution sandbox.

A single-file desktop application. It depends on NOTHING outside the Python
standard library (the GUI uses tkinter, which ships with Python), so there is
nothing to install:

    python3 evolution_lab.py

A living 2D world of creatures evolves in real time. Every creature has
heritable traits — speed, size, eyesight, and diet (herbivore ⇄ carnivore) —
and belongs to one of several coloured species. Food is scarce, predators hunt
prey, and only the creatures that gather enough energy reproduce. Nobody scripts
the outcome: species rise, adapt, and go extinct on their own.

Use the sliders on the right to run experiments live:
  • Species          how many distinct lineages start out (apply with Restart)
  • Start population  how crowded the world begins (apply with Restart)
  • Food             how abundant plants are        (live)
  • Mutation         how much offspring vary         (live)
  • Harshness        how costly it is to stay alive  (live)
  • Sim speed        generations per second          (live)

The simulation core (`World`) is plain Python and has no GUI dependency, so it
can also be imported and driven headless for experiments.
"""

from __future__ import annotations

import colorsys
import math
import random

# --------------------------------------------------------------------------- #
#  Simulation model (pure Python — no GUI, importable and testable on its own)  #
# --------------------------------------------------------------------------- #

SPEED = (0.4, 3.2)
SIZE = (0.5, 2.4)
VISION = (25.0, 150.0)
DIET = (0.0, 1.0)          # 0 = pure herbivore, 1 = pure carnivore
MAX_CREATURES = 340


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
    """The ecosystem. Toroidal (wraps at edges); grid-accelerated neighbour search."""

    def __init__(self, width=760, height=580, rng=None):
        self.width, self.height = width, height
        self.rng = rng or random.Random()
        # live-adjustable knobs (0..1-ish multipliers set by the GUI)
        self.food_mult = 0.6
        self.mutation = 0.09
        self.harshness = 1.0
        self.n_species = 4
        self.start_pop = 150
        self.species_colors: list[str] = []
        self.creatures: list[Creature] = []
        self.food: list[list[float]] = []
        self.tick = 0
        self._cell = 60.0
        self.reset()

    # ---------------------------------------------------------------- setup ---
    def reset(self):
        rng = self.rng
        s = max(1, int(self.n_species))
        self.species_colors = [_hue(i, s) for i in range(s)]
        # each species gets its own starting "niche" (trait profile)
        self._profiles = []
        for _ in range(s):
            self._profiles.append((
                rng.uniform(*SPEED), rng.uniform(0.7, 2.0),
                rng.uniform(*VISION), rng.uniform(0.0, 1.0),
            ))
        self.creatures = []
        for i in range(int(self.start_pop)):
            sp = i % s
            self.creatures.append(Creature(
                rng.uniform(0, self.width), rng.uniform(0, self.height), sp,
                self._mutated(self._profiles[sp], scale=0.12), rng))
        self.food = []
        self._spawn_food(int(self._food_cap() * 0.8))
        self.tick = 0

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

    # ----------------------------------------------------------- neighbours ---
    def _grid(self, points):
        cell = self._cell
        g: dict[tuple[int, int], list[int]] = {}
        for idx, p in enumerate(points):
            key = (int(p[0] // cell), int(p[1] // cell))
            g.setdefault(key, []).append(idx)
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

    # ------------------------------------------------------------- one step ---
    def step(self):
        cre = self.creatures
        if not cre:
            return
        rng = self.rng
        fpos = self.food
        fgrid = self._grid(fpos)
        cpos = [(c.x, c.y) for c in cre]
        cgrid = self._grid(cpos)
        eaten_food = set()
        dead = set()
        newborns = []

        for i, c in enumerate(cre):
            if i in dead:
                continue
            vision = c.vision
            tx = ty = None          # target direction (dx, dy)
            flee = False

            # --- look at nearby creatures: threats and prey ------------------
            best_prey = None; best_prey_d = 1e9
            worst_threat_d = 1e9; threat_dir = None
            for j in self._near(cgrid, c.x, c.y, vision):
                if j == i or j in dead:
                    continue
                o = cre[j]
                dx, dy = self._wrap_delta(c.x, c.y, o.x, o.y)
                d2 = dx * dx + dy * dy
                if d2 > vision * vision:
                    continue
                # threat: a bigger, meat-eating creature
                if o.size > c.size * 1.15 and o.diet > 0.5 and d2 < worst_threat_d:
                    worst_threat_d = d2; threat_dir = (-dx, -dy)
                # prey: smaller than me, if I eat meat
                if c.diet > 0.35 and c.size > o.size * 1.15 and d2 < best_prey_d:
                    best_prey_d = d2; best_prey = j; best_prey_dir = (dx, dy)

            # --- look at nearby food (plants) --------------------------------
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

            # --- decide heading (flee > hunt > forage > wander) --------------
            if threat_dir is not None:
                tx, ty = threat_dir; flee = True
            elif best_prey is not None:
                tx, ty = best_prey_dir
            elif food_dir is not None:
                tx, ty = food_dir
            if tx is not None:
                n = math.hypot(tx, ty) or 1.0
                c.heading = math.atan2(ty / n, tx / n)
            else:
                c.heading += rng.uniform(-0.4, 0.4)

            # --- move --------------------------------------------------------
            throttle = 1.0 if (tx is not None) else 0.55
            step = c.speed * throttle
            c.x = (c.x + math.cos(c.heading) * step) % self.width
            c.y = (c.y + math.sin(c.heading) * step) % self.height

            eat_r = 4.0 + c.size * 3.0

            # --- eat plants --------------------------------------------------
            if c.diet < 0.85 and best_food is not None and best_food not in eaten_food:
                fx, fy = fpos[best_food]
                dx, dy = self._wrap_delta(c.x, c.y, fx, fy)
                if dx * dx + dy * dy <= eat_r * eat_r:
                    eaten_food.add(best_food)
                    c.energy = min(c.max_energy, c.energy + 26.0 * (1.0 - 0.6 * c.diet))

            # --- hunt prey ---------------------------------------------------
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

            # --- metabolism, ageing, death -----------------------------------
            c.energy -= self.harshness * (0.10 * c.size ** 0.75 + 0.012 * step * step * c.size)
            c.age += 1
            if c.cooldown > 0:
                c.cooldown -= 1
            if c.energy <= 0.0 or c.age >= c.lifespan:
                dead.add(i)
                continue

            # --- reproduce ---------------------------------------------------
            if (c.cooldown == 0 and c.energy > c.max_energy * 0.7
                    and len(cre) + len(newborns) - len(dead) < MAX_CREATURES):
                invest = c.energy * 0.5
                c.energy -= invest
                c.cooldown = 45
                traits = self._mutated((c.speed, c.size, c.vision, c.diet))
                nx = (c.x + rng.uniform(-8, 8)) % self.width
                ny = (c.y + rng.uniform(-8, 8)) % self.height
                newborns.append(Creature(nx, ny, c.species, traits, rng,
                                          gen=c.gen + 1, energy=invest))

        # --- commit deaths / births / food -----------------------------------
        if dead:
            self.creatures = [c for k, c in enumerate(cre) if k not in dead]
        self.creatures.extend(newborns)
        if eaten_food:
            self.food = [f for k, f in enumerate(fpos) if k not in eaten_food]
        # regrow food up to the (live) capacity
        cap = self._food_cap()
        if len(self.food) < cap:
            self._spawn_food(min(6, cap - len(self.food)))
        self.tick += 1

    # ---------------------------------------------------------------- stats ---
    def stats(self):
        cre = self.creatures
        n = len(cre)
        counts = [0] * len(self.species_colors)
        if n:
            sp = si = di = ge = 0.0
            for c in cre:
                sp += c.speed; si += c.size; di += c.diet; ge += c.gen
                if c.species < len(counts):
                    counts[c.species] += 1
            alive = sum(1 for x in counts if x > 0)
            return dict(pop=n, species_alive=alive, avg_speed=sp / n, avg_size=si / n,
                        avg_diet=di / n, gen=ge / n, food=len(self.food),
                        counts=counts, tick=self.tick)
        return dict(pop=0, species_alive=0, avg_speed=0, avg_size=0, avg_diet=0,
                    gen=0, food=len(self.food), counts=counts, tick=self.tick)


def _hue(i, n):
    r, g, b = colorsys.hsv_to_rgb(i / max(1, n), 0.62, 0.92)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


# --------------------------------------------------------------------------- #
#  Native GUI (tkinter — part of the Python standard library)                  #
# --------------------------------------------------------------------------- #

def run_gui():
    import tkinter as tk
    from tkinter import ttk

    BG, PANEL, INK, MUT = "#0f1218", "#171c24", "#e7ecf3", "#93a1b0"
    CW, CH, TREND_H = 760, 520, 120

    root = tk.Tk()
    root.title("EvoSim Lab — Evolution Sandbox")
    root.configure(bg=BG)
    root.minsize(1040, 660)
    root.geometry("1120x800")

    world = World(CW, CH, rng=random.Random(7))

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass
    style.configure("TScale", background=PANEL)

    main = tk.Frame(root, bg=BG)
    main.pack(fill="both", expand=True)

    left = tk.Frame(main, bg=BG)
    left.pack(side="left", padx=10, pady=10)
    canvas = tk.Canvas(left, width=CW, height=CH, bg="#0b0d12", highlightthickness=0)
    canvas.pack()
    trend = tk.Canvas(left, width=CW, height=TREND_H, bg="#0b0d12", highlightthickness=0)
    trend.pack(pady=(8, 0))
    tk.Label(left, text="Population (green)   ·   Average speed (orange)   — over time",
             bg=BG, fg=MUT, font=("Helvetica", 9)).pack(anchor="w", pady=(4, 0))
    history: list[tuple[int, float]] = []

    panel = tk.Frame(main, bg=PANEL, width=300)
    panel.pack(side="right", fill="y", padx=(0, 10), pady=10)
    panel.pack_propagate(False)

    def label(parent, text, size=10, fg=INK, bold=False):
        return tk.Label(parent, text=text, bg=PANEL, fg=fg,
                        font=("Helvetica", size, "bold" if bold else "normal"),
                        anchor="w", justify="left")

    label(panel, "EvoSim Lab", 15, INK, True).pack(fill="x", padx=14, pady=(12, 0))
    label(panel, "A living world that evolves on its own.", 9, MUT).pack(fill="x", padx=14, pady=(0, 8))

    running = {"on": False}
    steps_per_frame = {"n": 3}

    # --- sliders ---
    def slider(name, lo, hi, init, note):
        f = tk.Frame(panel, bg=PANEL)
        f.pack(fill="x", padx=14, pady=(6, 0))
        head = tk.Frame(f, bg=PANEL); head.pack(fill="x")
        label(head, name, 10, INK, True).pack(side="left")
        val = label(head, "", 10, MUT); val.pack(side="right")
        var = tk.DoubleVar(value=init)
        s = ttk.Scale(f, from_=lo, to=hi, variable=var, orient="horizontal")
        s.pack(fill="x")
        label(f, note, 8, MUT).pack(fill="x")
        return var, val

    v_species, l_species = slider("Species", 1, 8, world.n_species, "how many lineages start (Restart)")
    v_pop, l_pop = slider("Start population", 40, 300, world.start_pop, "starting crowd (Restart)")
    v_food, l_food = slider("Food", 0.1, 1.0, world.food_mult, "plant abundance")
    v_mut, l_mut = slider("Mutation", 0.0, 0.25, world.mutation, "how much offspring vary")
    v_harsh, l_harsh = slider("Harshness", 0.5, 2.0, world.harshness, "cost of staying alive")
    v_speed, l_speed = slider("Sim speed", 1, 16, steps_per_frame["n"], "generations per second")

    # --- buttons ---
    btns = tk.Frame(panel, bg=PANEL); btns.pack(fill="x", padx=14, pady=10)
    start_btn = tk.Button(btns, text="▶ Start", width=9, relief="flat",
                          bg="#2f9e70", fg="white", font=("Helvetica", 11, "bold"))
    start_btn.pack(side="left")
    restart_btn = tk.Button(btns, text="↻ Restart", width=9, relief="flat",
                            bg="#3a4453", fg="white", font=("Helvetica", 11, "bold"))
    restart_btn.pack(side="left", padx=8)

    # --- stats ---
    stat_var = tk.StringVar(value="")
    label(panel, "", 10).pack()  # spacer
    stats_lbl = tk.Label(panel, textvariable=stat_var, bg=PANEL, fg=INK, justify="left",
                         anchor="w", font=("Menlo", 10))
    stats_lbl.pack(fill="x", padx=14)

    label(panel, "Species (live counts)", 10, MUT, True).pack(fill="x", padx=14, pady=(10, 2))
    legend = tk.Frame(panel, bg=PANEL); legend.pack(fill="x", padx=14)
    legend_rows: list[tuple] = []

    def rebuild_legend():
        for w in legend.winfo_children():
            w.destroy()
        legend_rows.clear()
        for i, col in enumerate(world.species_colors):
            row = tk.Frame(legend, bg=PANEL); row.pack(fill="x", pady=1)
            sw = tk.Canvas(row, width=14, height=14, bg=PANEL, highlightthickness=0)
            sw.create_oval(2, 2, 12, 12, fill=col, outline="")
            sw.pack(side="left")
            lab = tk.Label(row, text=f"Species {i+1}", bg=PANEL, fg=INK,
                           font=("Menlo", 10), anchor="w")
            lab.pack(side="left", padx=6)
            cnt = tk.Label(row, text="0", bg=PANEL, fg=MUT, font=("Menlo", 10), anchor="e")
            cnt.pack(side="right")
            legend_rows.append((lab, cnt))

    # --- canvas item pools (reused every frame for speed) ---
    food_ids: list[int] = []
    cre_ids: list[int] = []

    def render():
        st = world.stats()
        # food
        fp = world.food
        while len(food_ids) < len(fp):
            food_ids.append(canvas.create_oval(0, 0, 0, 0, fill="#3f9e57", outline=""))
        for k, fid in enumerate(food_ids):
            if k < len(fp):
                x, y = fp[k]
                canvas.coords(fid, x - 1.5, y - 1.5, x + 1.5, y + 1.5)
                canvas.itemconfigure(fid, state="normal")
            else:
                canvas.itemconfigure(fid, state="hidden")
        # creatures
        cre = world.creatures
        while len(cre_ids) < len(cre):
            cre_ids.append(canvas.create_oval(0, 0, 0, 0, outline=""))
        cols = world.species_colors
        for k, cid in enumerate(cre_ids):
            if k < len(cre):
                c = cre[k]
                r = 2.5 + c.size * 2.4
                col = cols[c.species] if c.species < len(cols) else "#cccccc"
                canvas.coords(cid, c.x - r, c.y - r, c.x + r, c.y + r)
                # carnivores get a dark rim so predators stand out
                canvas.itemconfigure(cid, fill=col, state="normal",
                                     outline="#0b0d12" if c.diet > 0.6 else "",
                                     width=2 if c.diet > 0.6 else 1)
            else:
                canvas.itemconfigure(cid, state="hidden")
        # stats text + legend
        stat_var.set(
            f"Population   {st['pop']:>4}\n"
            f"Species alive {st['species_alive']:>3} / {len(cols)}\n"
            f"Avg speed    {st['avg_speed']:>5.2f}\n"
            f"Avg size     {st['avg_size']:>5.2f}\n"
            f"Avg diet     {st['avg_diet']:>5.2f}  (0=plant,1=meat)\n"
            f"Generation   {st['gen']:>5.1f}\n"
            f"Plants       {st['food']:>4}\n"
            f"Tick         {st['tick']:>5}")
        for i, (lab, cnt) in enumerate(legend_rows):
            n = st["counts"][i] if i < len(st["counts"]) else 0
            cnt.configure(text=str(n), fg=MUT if n else "#555f6c")
            lab.configure(fg=INK if n else "#555f6c")

        # --- live trend graph (population + average speed over time) ---
        history.append((st["pop"], st["avg_speed"]))
        if len(history) > 300:
            del history[0]
        trend.delete("all")
        if len(history) >= 2:
            w, h, pad = CW, TREND_H, 6
            npt = len(history)
            maxpop = max(1, max(p for p, _ in history))
            slo, shi = SPEED

            def line(select, lo, hi, color):
                coords = []
                for k, rec in enumerate(history):
                    v = select(rec)
                    x = pad + k / (npt - 1) * (w - 2 * pad)
                    y = h - pad - (v - lo) / (hi - lo) * (h - 2 * pad)
                    coords += [x, y]
                trend.create_line(*coords, fill=color, width=2, smooth=True)

            line(lambda r: r[0], 0, maxpop, "#3f9e57")     # population
            line(lambda r: r[1], slo, shi, "#e08a3c")      # average speed

    # --- live control wiring ---
    def apply_live(*_):
        world.food_mult = float(v_food.get())
        world.mutation = float(v_mut.get())
        world.harshness = float(v_harsh.get())
        steps_per_frame["n"] = int(round(float(v_speed.get())))
        l_food.configure(text=f"{world.food_mult:.0%}")
        l_mut.configure(text=f"{world.mutation:.0%}")
        l_harsh.configure(text=f"{world.harshness:.0%}")
        l_speed.configure(text=f"{steps_per_frame['n']}×")
        l_species.configure(text=str(int(round(float(v_species.get())))))
        l_pop.configure(text=str(int(round(float(v_pop.get())))))

    for v in (v_food, v_mut, v_harsh, v_speed, v_species, v_pop):
        v.trace_add("write", apply_live)

    def do_restart():
        world.n_species = int(round(float(v_species.get())))
        world.start_pop = int(round(float(v_pop.get())))
        apply_live()
        world.reset()
        history.clear()
        rebuild_legend()
        render()

    def toggle():
        running["on"] = not running["on"]
        start_btn.configure(text="⏸ Pause" if running["on"] else "▶ Start",
                            bg="#c25a4a" if running["on"] else "#2f9e70")

    start_btn.configure(command=toggle)
    restart_btn.configure(command=do_restart)

    def loop():
        if running["on"]:
            for _ in range(steps_per_frame["n"]):
                world.step()
            render()
        root.after(33, loop)

    apply_live()
    rebuild_legend()
    render()
    root.after(33, loop)

    # Optional self-test: LAB_SELFTEST=<png> auto-runs, screenshots, and quits.
    import os
    shot = os.environ.get("LAB_SELFTEST")
    if shot:
        running["on"] = True
        start_btn.configure(text="⏸ Pause", bg="#c25a4a")
        def _capture():
            import subprocess
            root.update_idletasks()
            subprocess.run(["import", "-window", "root", shot], check=False)
            print(f"SELFTEST screenshot -> {shot}; pop={world.stats()['pop']}")
            root.destroy()
        root.after(4000, _capture)

    root.mainloop()


if __name__ == "__main__":
    run_gui()
