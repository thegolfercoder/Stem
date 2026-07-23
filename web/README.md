# EvoSim — Browser Viewer (real-time, no install)

A web page that runs the **real EvoSim Python engine live in the browser** via
[Pyodide](https://pyodide.org) (CPython compiled to WebAssembly). Organisms
forage, hunt, hide, and reproduce in real time on an HTML canvas — the same
unscripted evolution as the desktop viewer, with **nothing to install** on the
presentation machine. Perfect for a STEM booth: open a URL (or a local file
server) on any laptop, tablet, or borrowed screen and press Play.

The Python side only advances the simulation and hands back compact frames;
all drawing happens in `app.js`. Because it imports the actual `evosim`
package, the science is identical to the Pygame/headless runs — not a
JavaScript re-implementation.

## Files

| File | What it is |
|---|---|
| `survival.html` + `survival.js` | **Survival of the Fittest** — a simple, jargon-free view for a general audience (few big creatures, scarce food, visible starvation/breeding, one "speed of the herd" meter). Best for a booth. |
| `index.html` + `app.js` | The full scientific viewer: species/diet/genome colouring, neural vs rule brains, seed control, live trait stats. |
| `evosim_pkg.js` | The bundled `evosim` engine source (auto-generated). |

Both pages run the same real engine; they differ only in framing. Start a
general audience on `survival.html`, then switch to `index.html` for the
detailed science.

`evosim_pkg.js` is produced from the Python package by:

```bash
python -m scripts.build_web      # regenerate after changing the engine
```

Re-run that whenever you change anything under `evosim/` so the browser build
stays in sync with the engine.

## Single-file build (double-click, no server)

Compile the whole viewer into one self-contained `.html` you can download and
open directly (`file://`) — nothing to serve, no sibling files:

```bash
python -m scripts.build_web          # refresh the engine bundle
python -m scripts.build_single       # -> dist/index.html  (Survival view)
python -m scripts.build_single --page index   # or the full scientific viewer
```

Our engine + front-end are inlined into the file. The Pyodide runtime
(CPython+NumPy, ~15 MB) still streams from its CDN on the **first** open (too
large to embed in a clickable file) and is cached afterwards — so the single
file needs internet once, then runs offline from cache. For a guaranteed
no-internet booth, use the vendored-Pyodide setup below instead.

## Run it locally

Pyodide needs the files served over HTTP (not opened with `file://`), so use
any static server:

```bash
python -m scripts.build_web          # once, to (re)generate evosim_pkg.js
python -m http.server -d web 8000    # serve this folder
# then open http://localhost:8000
```

First load fetches the Pyodide runtime + NumPy from a CDN (~15 MB, cached
afterwards), so the very first boot takes a few seconds. Everything after that
is instant.

## Host it (share a URL)

Any static host works — GitHub Pages, Netlify, S3, etc. Copy the `web/` folder
to the site root. No build server or backend is required; the CDN supplies the
Python runtime.

## Controls

| Control | Action |
|---|---|
| **Play / Pause**, `Space` | Start/stop the simulation. |
| **Speed** slider, `↑` / `↓` | Ticks computed per animation frame (1–20×). |
| **Colour** buttons, `c` | Colour organisms by **species**, **diet** (🟢 herbivore → 🔴 carnivore), or **genome** (true colour). |
| **Vision rings**, `v` | Toggle faint vision indicators. |
| **Seed / Brain / Max pop** + **Reset** | Spawn a fresh world. `neural` = neuroevolution; `rule` = transparent control. |

## Offline / no-Wi-Fi booths

By default the runtime loads from a CDN. To run with **no internet at all**
(the safest setup for an unreliable venue), vendor Pyodide next to these files
and point the page at the local copy:

1. Download the matching Pyodide release (`v0.26.2`) `full/` distribution and
   the `numpy` wheel into a local folder, e.g. `web/pyodide/`.
2. In `index.html`, change the `pyodide.js` `<script src>` to
   `pyodide/pyodide.js`.
3. In `app.js`, set `PYODIDE_CDN = "./pyodide/"`.

Then the whole exhibit runs from a local `http.server` with the network
unplugged.

## Notes / limits

- Speed scales with population: Pyodide is slower than native CPython, so very
  large worlds run at a few frames per second. The default `max pop` of 1500
  stays smooth on typical laptops; lower it for older machines.
- This is a **viewer**. For the quantitative scientific report (trait-evolution
  curves, predator–prey phase portrait, etc.) use the headless run:
  `python -m scripts.run_headless --ticks 4000`.
