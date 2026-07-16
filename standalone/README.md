# Mini evolution — a standalone "survival of the fittest" model

Two tiny, **fully independent** programs (no EvoSim, no numpy, no libraries
beyond each language's standard library) that demonstrate natural selection from
scratch. Perfect for a hand-out, a code walkthrough, or a live "run it yourself"
moment at an exhibition — each is one readable file.

## The model, in one paragraph

Every creature has a single heritable trait: **speed**. Food is scarce, so a
faster creature gathers more of it — but moving fast also burns energy (cost
grows with speed²). So there is one *best-adapted* speed: fast enough to eat
well, not so fast it starves. Nobody tells the creatures this. Each generation
the fittest (most left-over energy) survive and have children that inherit their
speed plus a small random **mutation**. Starting from totally random speeds, the
population converges — on its own — onto the best-adapted speed, and the spread
narrows as the unfit are weeded out. That convergence **is** evolution by
natural selection.

## Run it

**Python** (needs only Python 3):
```bash
python3 mini_evolution.py
```

**C++** (needs any C++17 compiler):
```bash
g++ -O2 -std=c++17 -o mini_evolution mini_evolution.cpp && ./mini_evolution
```

Both print the mean speed each generation (watch it converge, and the spread
shrink), the theoretical best speed vs where the population actually settled
(they match!), and ASCII histograms of the first vs final generation so you can
*see* the population go from a random spread to a sharp peak — no plotting
library required.

## What to point at

- **Mean speed** climbs/moves toward the best-adapted value and then holds.
- **Spread** collapses from ~1.0 to ~0.2 — the population becomes uniformly fit.
- The **final histogram** is a tight peak sitting right on the optimum the code
  computes independently. Selection found the best answer with no one designing
  it.

Both files are deterministic (fixed seed), so the result is reproducible every
run. This is the same principle the full EvoSim engine runs on — just stripped
to its absolute core.

---

## Bonus: `evolution_lab.py` — a full native sandbox (also dependency-free)

A complete **native desktop application** in one file, using only the standard
library (the GUI is tkinter, which ships with Python). A living 2D world of
colour-coded species evolves in real time — herbivores forage, carnivores hunt,
species compete and go **extinct** on their own. Live sliders let you run
experiments: number of species, starting population, food abundance, mutation,
harshness, and simulation speed.

```bash
python3 evolution_lab.py
```

Nothing to install. The simulation core (`World`) has no GUI dependency, so it
can also be imported and driven headless. To hand it to someone without Python,
package it into a standalone executable with PyInstaller:

```bash
pip install pyinstaller
pyinstaller --onefile --windowed evolution_lab.py   # -> dist/evolution_lab(.exe)
```
