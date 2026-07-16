# EvoSim — Artificial Life Evolution Simulator

A scientific digital ecosystem that demonstrates **Darwin's theory of evolution**
in action. Organisms with unique, heritable genomes live on a 2D "digital planet"
where they forage, hunt, hide, compete, and reproduce. Nobody scripts the
outcome: over thousands of simulated generations, populations grow, crash, adapt,
go extinct, and **diverge into new species** purely through natural selection,
mutation, and ecological pressure.

Built for STEM exhibition and research, EvoSim combines **biology, ecology,
artificial intelligence, computer science, and data visualization** in one
clean, modular Python codebase.

---

## Why this is science, not a game

Every dynamic emerges from local rules and selection — there are no scripted
events, win conditions, or hand-tuned outcomes:

| Evolutionary principle | How EvoSim realizes it |
|---|---|
| **Variation** | Each organism has a genome of continuous genes; reproduction adds gaussian mutations (plus rare macro-mutations). |
| **Heredity** | Offspring inherit the parent's genome, including any evolved neural weights — either asexually (parent + mutation) or **sexually** (recombination/crossover of two same-species parents). |
| **Selection** | Traits set the *cost* and *benefit* of every action; only organisms that net enough energy reproduce. Nothing else picks winners. |
| **Adaptation** | Mean traits drift over time toward whatever the current environment rewards (directional selection you can plot). |
| **Speciation** | Populations are clustered by genetic distance (NEAT-style compatibility). As lineages drift apart, new species appear and old ones vanish — unscripted. |
| **Predator–prey dynamics** | A continuous `diet` gene lets herbivores, omnivores, and carnivores co-evolve, producing Lotka–Volterra-style oscillations. |
| **Camouflage / vision arms race** | Prey with colour matching the local terrain are harder to detect; predators with better vision detect more. Both are heritable and under selection. |

---

## The genome

Each organism expresses these heritable traits from its genome. Every trait has
a real cost/benefit trade-off, which is what prevents a single "super organism"
from dominating:

- **speed** — move faster (but locomotion cost scales with speed²·size)
- **vision** — larger sensing radius (find food/prey/threats sooner)
- **metabolism** — fast & hungry vs. slow & thrifty (basal cost multiplier)
- **size** — energy capacity and who-eats-whom, but higher upkeep (Kleiber's law, ~size⁰·⁷⁵)
- **lifespan** — maximum age before death by old age
- **camouflage** — how strongly terrain-colour matching hides you from predators
- **diet** — 0 = pure herbivore … 1 = pure carnivore (a continuum, so trophic roles evolve)
- **aggression** — willingness/success when hunting
- **reproduction threshold & offspring investment** — reproductive strategy (r/K-style)
- **colour (RGB)** — heritable phenotype, also drives camouflage matching

---

## Architecture

The **simulation core is fully headless** (pure NumPy/Python). Visualization and
analysis are optional layers that only *consume* engine state, so the same
unscripted evolution can drive a Pygame window today and Blender/NEAT tomorrow.

```
evosim/
├── config.py            # All tunable parameters (dataclasses, JSON-serializable)
├── genome.py            # Heritable genome, mutation, genetic-distance for speciation
├── organism.py          # Individual agent: bioenergetics, life cycle
├── world.py             # Terrain (camouflage), regrowing plants, geometry
├── spatial.py           # Spatial-hash grid for fast neighbour queries
├── species.py           # Emergent speciation via compatibility clustering
├── simulation.py        # The engine: perceive → decide → act → live (headless)
├── stats.py             # Scientific time-series logging → CSV/JSON
├── behavior/            # Pluggable "minds"
│   ├── base.py          #   Brain interface (perception vector → action vector)
│   ├── rule_based.py    #   Transparent heuristics (scientific control)
│   └── neural.py        #   Genome-encoded neural network (neuroevolution; NEAT-ready)
├── render/              # Pluggable visualization back-ends
│   ├── base.py          #   Renderer interface
│   ├── pygame_renderer.py  # Real-time 2D viewer
│   └── blender_export.py   # Serialize frames → JSON for 3D rendering
└── analysis/
    └── plots.py         # Matplotlib scientific report (6 panels)

scripts/                 # Entry points (run_simulation, run_headless, export_blender)
blender/import_evosim.py # Blender-side importer (uses bpy; standalone)
tests/                   # pytest suite
```

### Design principles
- **Separation of concerns** — physics never imports a renderer; renderers never
  mutate biology.
- **Determinism** — a single seeded `numpy.Generator` flows through everything, so
  runs are exactly reproducible (great for experiments and grading).
- **Swappable brains** — behaviour is a fixed `perception → action` contract, so
  rule-based, neuroevolution, and future NEAT brains are drop-in interchangeable.
- **Config-driven** — no magic numbers in the logic; everything comes from
  `SimulationConfig`, which round-trips to JSON.

---

## Installation

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # numpy, matplotlib, pygame, pytest
```

Requires Python 3.10+.

---

## Usage

### 1. Real-time visualization (Pygame)

```bash
python -m scripts.run_simulation                      # default config
python -m scripts.run_simulation --seed 7 --brain neural
```

**Controls:** `SPACE` pause · `↑/↓` speed · `c` colour mode (species → diet →
true colour) · `v` toggle vision radii · `g` toggle terrain · `Esc/Q` quit.

### 2. Headless scientific run + analysis (no display needed)

```bash
python -m scripts.run_headless --ticks 4000 --seed 42
```

Writes to `data/`:
- `evosim_stats.csv` / `.json` — the full per-tick time series
- `evosim_report.png` — a 6-panel Matplotlib report (population dynamics, trait
  evolution, species count, trophic composition, mortality by cause, and a
  predator–prey phase portrait)
- `evosim_config.json` — the exact config used (for reproducibility)

### 3. Record an animated demo (no display needed)

```bash
python -m scripts.capture_animation --out data/evosim_demo.gif --color diet
python -m scripts.capture_animation --color species --ticks 400 --seed 7
```

Drives the real Pygame viewer off-screen and writes an animated GIF — handy for
slides and posters. `--color` picks `diet`, `species`, or `genome` colouring.

### 4. Real-time in the browser (no install — great for exhibitions)

```bash
python -m scripts.build_web             # bundle the engine into web/evosim_pkg.js
python -m http.server -d web 8000       # then open http://localhost:8000
```

Runs the **actual Python engine live in the browser** via Pyodide
(CPython→WebAssembly), drawing to an HTML canvas with play/pause, speed,
colour-mode, seed and brain controls. Nothing to install on the presentation
machine — open a URL on any laptop or tablet and press Play. Deploy the `web/`
folder to any static host (GitHub Pages, Netlify, …) to share a link. See
[`web/README.md`](web/README.md) for hosting and offline setup.

### 5. Export for Blender 3D rendering

```bash
python -m scripts.export_blender --ticks 1200 --every 2
# then, inside Blender:
blender --python blender/import_evosim.py
```

### As a library

```python
from evosim import Simulation, SimulationConfig
from evosim.analysis import generate_report

cfg = SimulationConfig()
cfg.behavior.brain = "neural"      # or "rule"
cfg.reproduction.sexual = True     # enable recombination (default: asexual)
sim = Simulation(cfg)
sim.run(4000)                      # thousands of generations, headless
generate_report(sim.stats, "data")
```

---

## Evolving intelligence (neuroevolution → NEAT)

By default (`brain = "neural"`) each organism carries a small neural network
**inside its genome**. The weights mutate and are inherited like any other gene,
so the mapping from perception to action is *discovered by natural selection*
rather than hardcoded — this is neuroevolution with a fixed topology.

Because the engine only depends on the `Brain` contract (perception vector in,
action vector out), upgrading to **NEAT** (which also evolves network *topology*
via `neat-python`) is a localized change: store a NEAT genome instead of a weight
vector and build the network in `decide()`. No changes to organisms, reproduction,
or the simulation loop are required. See `evosim/behavior/neural.py` for the exact
seam. Set `brain = "rule"` for the transparent heuristic control group.

---

## Roadmap

- [x] Headless NumPy evolution engine with energy-based selection
- [x] Emergent speciation via compatibility clustering
- [x] Predator–prey, camouflage, and metabolism trade-offs
- [x] Pygame real-time viewer
- [x] Matplotlib scientific report
- [x] Neuroevolution (genome-encoded neural brains, vectorized/batched inference)
- [x] Sexual reproduction & genetic recombination (crossover)
- [x] Vectorized perception — ~6× faster (thousand-generation runs in seconds)
- [x] Blender frame export + importer
- [x] Off-screen GIF recorder for talks/exhibitions
- [x] In-browser real-time viewer (real engine via Pyodide/WebAssembly, no install)
- [ ] Full NEAT (topology-evolving) via `neat-python`
- [ ] Phylogenetic tree reconstruction and export

---

## Testing

```bash
python -m pytest -q
```

The suite covers genome bounds/mutation/distance, world & food dynamics, the
spatial hash, deterministic reproducibility, emergent speciation, energy
conservation bounds, and report generation.

---

## License

MIT.
