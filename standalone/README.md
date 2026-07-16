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
