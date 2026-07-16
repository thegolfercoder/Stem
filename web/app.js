/*
 * EvoSim browser viewer.
 *
 * Runs the REAL evosim Python engine in the browser via Pyodide (CPython on
 * WebAssembly). The Python side only advances the simulation and hands back
 * compact typed-array frames; all drawing happens here on a 2D canvas. Because
 * the engine is the exact same code that powers the Pygame/headless runs, the
 * evolution you watch here is scientifically identical -- nothing is faked or
 * re-implemented in JavaScript.
 */

"use strict";

const PYODIDE_VERSION = "v0.26.2";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

// Python glue: build a sim, step it, and export a drawable frame as raw bytes.
const BRIDGE = `
import numpy as np
from evosim import Simulation, SimulationConfig

_STATE = {}

def make_sim(seed, brain, max_pop):
    cfg = SimulationConfig()
    cfg.seed = int(seed)
    cfg.behavior.brain = brain
    if max_pop:
        cfg.population.max_organisms = int(max_pop)
    sim = Simulation(cfg)
    _STATE['sim'] = sim
    return {'width': float(sim.world.width), 'height': float(sim.world.height)}

def step_sim(n):
    sim = _STATE['sim']
    alive = True
    for _ in range(int(n)):
        alive = sim.step()
        if not alive:
            break
    return bool(alive)

def frame():
    sim = _STATE['sim']
    orgs = sim.organisms
    n = len(orgs)
    meta = np.empty((n, 5), np.float32)   # x, y, size, heading, diet
    gcol = np.empty((n, 3), np.uint8)     # genome RGB
    scol = np.empty((n, 3), np.uint8)     # species RGB
    tr = sim.species_tracker
    for k, o in enumerate(orgs):
        p = o.pos
        meta[k, 0] = p[0]; meta[k, 1] = p[1]
        meta[k, 2] = o.size; meta[k, 3] = o.wander_heading; meta[k, 4] = o.diet
        gc = o.genome.color
        gcol[k, 0] = gc[0]; gcol[k, 1] = gc[1]; gcol[k, 2] = gc[2]
        sp = tr.species.get(o.species_id)
        sc = sp.color if sp is not None else (200, 200, 200)
        scol[k, 0] = sc[0]; scol[k, 1] = sc[1]; scol[k, 2] = sc[2]
    fp = np.ascontiguousarray(sim.world.food_pos, np.float32)

    rec = sim.stats.records[-1] if sim.stats.records else {}
    def g(k):
        v = rec.get(k, 0.0)
        try:
            v = float(v)
        except (TypeError, ValueError):
            return 0.0
        return v if v == v else 0.0   # NaN -> 0
    col = sim.stats.column
    return {
        'n': n,
        'tick': int(sim.tick),
        'species': int(tr.count),
        'nfood': int(len(fp)),
        'meta': meta.tobytes(),
        'gcol': gcol.tobytes(),
        'scol': scol.tobytes(),
        'food': fp.tobytes(),
        # --- analytical metrics (computed once by the engine, reused here) ---
        'shannon': g('shannon_index'),
        'gendiv': g('genetic_diversity'),
        'gen': g('avg_generation'),
        'energy': g('avg_energy'),
        'herb': int(rec.get('herbivores', 0)),
        'omn': int(rec.get('omnivores', 0)),
        'carn': int(rec.get('carnivores', 0)),
        'speed': g('avg_speed'), 'speed_sd': g('std_speed'),
        'vision': g('avg_vision'), 'vision_sd': g('std_vision'),
        'size': g('avg_size'), 'size_sd': g('std_size'),
        'diet': g('avg_diet'), 'diet_sd': g('std_diet'),
        'births': int(col('births').sum()),
        'starv': int(col('deaths_starvation').sum()),
        'pred': int(col('deaths_predation').sum()),
        'old': int(col('deaths_old_age').sum()),
    }
`;

const els = {};
let pyodide = null;
let py = {};              // { make_sim, step_sim, frame } PyProxy callables
let world = { width: 1200, height: 800 };
let running = false;
let stepsPerFrame = 3;
let colorMode = "diet";  // species | diet | genome
let showVision = false;
let rafId = null;
let lastFpsT = performance.now();
let frameCount = 0;

function $(id) { return document.getElementById(id); }

function setStatus(text, spinning = false) {
  els.status.textContent = text;
  els.spinner.style.display = spinning ? "inline-block" : "none";
}

async function boot() {
  els.canvas = $("view");
  els.ctx = els.canvas.getContext("2d");
  els.status = $("status");
  els.spinner = $("spinner");
  els.fps = $("a-fps");

  wireControls();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  setStatus("Loading Python runtime (Pyodide)…", true);
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

  setStatus("Loading NumPy…", true);
  await pyodide.loadPackage("numpy");

  setStatus("Loading EvoSim engine…", true);
  writeEngineFiles();
  pyodide.runPython(BRIDGE);
  py.make_sim = pyodide.globals.get("make_sim");
  py.step_sim = pyodide.globals.get("step_sim");
  py.frame = pyodide.globals.get("frame");

  newSim();
  setStatus("Ready — press Play (or Space).");
  drawOnce();
}

// Materialize the bundled evosim source into Pyodide's virtual filesystem.
function writeEngineFiles() {
  const files = self.EVOSIM_FILES || {};
  const made = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    let dir = "";
    for (let i = 0; i < parts.length - 1; i++) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i];
      if (!made.has(dir)) {
        try { pyodide.FS.mkdir(dir); } catch (e) { /* exists */ }
        made.add(dir);
      }
    }
    pyodide.FS.writeFile(path, files[path]);
  }
}

function newSim() {
  const seed = parseInt(els.seed.value, 10) || 0;
  const brain = els.brain.value;
  const maxPop = parseInt(els.maxpop.value, 10) || 0;
  const dims = py.make_sim(seed, brain, maxPop).toJs({ dict_converter: Object.fromEntries });
  world.width = dims.width;
  world.height = dims.height;
  for (const k in hist) hist[k].length = 0;   // fresh analytics history
  drawOnce();
}

// Pull one frame of draw data back from Python as typed arrays.
function pullFrame() {
  const proxy = py.frame();
  const d = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return {
    n: d.n,
    tick: d.tick,
    species: d.species,
    nfood: d.nfood,
    meta: new Float32Array(d.meta.buffer, d.meta.byteOffset, d.n * 5),
    gcol: d.gcol,          // Uint8Array, 3 per organism
    scol: d.scol,          // Uint8Array, 3 per organism
    food: new Float32Array(d.food.buffer, d.food.byteOffset, d.nfood * 2),
    m: {
      shannon: d.shannon, gendiv: d.gendiv, gen: d.gen, energy: d.energy,
      herb: d.herb, omn: d.omn, carn: d.carn,
      speed: d.speed, speed_sd: d.speed_sd, vision: d.vision, vision_sd: d.vision_sd,
      size: d.size, size_sd: d.size_sd, diet: d.diet, diet_sd: d.diet_sd,
      births: d.births, starv: d.starv, pred: d.pred, old: d.old,
    },
  };
}

// --- Live analytics: rolling history + sparklines --------------------------
const HIST_MAX = 160;
const hist = { pop: [], species: [], shannon: [], speed: [] };

function pushHist(f) {
  hist.pop.push(f.n);
  hist.species.push(f.species);
  hist.shannon.push(f.m.shannon);
  hist.speed.push(f.m.speed);
  for (const k in hist) if (hist[k].length > HIST_MAX) hist[k].shift();
}

function drawSpark(id, series, color) {
  const cv = document.getElementById(id);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (series.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const v of series) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = (i / (series.length - 1)) * (W - 2) + 1;
    const y = H - 2 - ((series[i] - lo) / span) * (H - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  // last-point dot
  const lx = W - 1, ly = H - 2 - ((series[series.length - 1] - lo) / span) * (H - 4);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx, ly, 1.8, 0, Math.PI * 2); ctx.fill();
}

function renderAnalytics(f) {
  const m = f.m, S = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  pushHist(f);

  S("a-tick", f.tick); S("a-pop", f.n); S("a-species", f.species); S("a-food", f.nfood);
  S("a-speed-x", m.speed.toFixed(2));
  S("a-shannon", m.shannon.toFixed(2)); S("a-gendiv", m.gendiv.toFixed(3));
  S("a-gen", m.gen.toFixed(1)); S("a-energy", m.energy.toFixed(0));

  drawSpark("sp-pop", hist.pop, "#0f766e");
  drawSpark("sp-species", hist.species, "#6ea8ff");
  drawSpark("sp-shannon", hist.shannon, "#1b9e77");
  drawSpark("sp-speed", hist.speed, "#e6550d");

  // trophic mix bar
  const total = Math.max(1, m.herb + m.omn + m.carn);
  const seg = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = `${(v / total * 100).toFixed(1)}%`; };
  seg("troph-herb", m.herb); seg("troph-omn", m.omn); seg("troph-carn", m.carn);
  S("troph-label", `${m.herb} herbivore · ${m.omn} omnivore · ${m.carn} carnivore`);

  // trait table: mean ± sd
  S("tr-speed", `${m.speed.toFixed(2)} ± ${m.speed_sd.toFixed(2)}`);
  S("tr-vision", `${m.vision.toFixed(0)} ± ${m.vision_sd.toFixed(0)}`);
  S("tr-size", `${m.size.toFixed(2)} ± ${m.size_sd.toFixed(2)}`);
  S("tr-diet", `${m.diet.toFixed(2)} ± ${m.diet_sd.toFixed(2)}`);

  // cumulative mortality / births
  S("mo-births", m.births); S("mo-starv", m.starv);
  S("mo-pred", m.pred); S("mo-old", m.old);
}

// --- Clinical palette helpers -------------------------------------------
// A restrained, desaturated look: muted specimen dots on a sterile light plate.
function lerp(a, b, t) { return a + (b - a) * t; }

// Diverging diet ramp: teal (herbivore) -> slate -> crimson (carnivore).
function dietColor(t) {
  const H = [43, 122, 120], M = [120, 132, 145], C = [168, 50, 70];
  let r, g, b;
  if (t < 0.5) { const u = t / 0.5; r = lerp(H[0], M[0], u); g = lerp(H[1], M[1], u); b = lerp(H[2], M[2], u); }
  else { const u = (t - 0.5) / 0.5; r = lerp(M[0], C[0], u); g = lerp(M[1], C[1], u); b = lerp(M[2], C[2], u); }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Desaturate an engine-assigned colour toward its luminance and cap its
// lightness, so species/genome hues stay distinct but muted and legible on the
// light plate.
function muted(r, g, b) {
  const luma = 0.3 * r + 0.59 * g + 0.11 * b, a = 0.5;
  let R = r + (luma - r) * a, G = g + (luma - g) * a, B = b + (luma - b) * a;
  const m = Math.max(R, G, B);
  if (m > 190) { const k = 190 / m; R *= k; G *= k; B *= k; }
  return `rgb(${R | 0},${G | 0},${B | 0})`;
}

function draw(f) {
  const ctx = els.ctx;
  const W = els.canvas.width, H = els.canvas.height;
  const sx = W / world.width, sy = H / world.height;
  const s = Math.min(sx, sy);

  // Sterile plate + faint measurement grid.
  ctx.fillStyle = "#e9edf1";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(31,42,51,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const grid = 48;
  for (let gx = grid; gx < W; gx += grid) { ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); }
  for (let gy = grid; gy < H; gy += grid) { ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); }
  ctx.stroke();

  // Plants — muted sage squares (cheap for thousands).
  ctx.fillStyle = "#7ba586";
  const food = f.food;
  for (let k = 0; k < food.length; k += 2) {
    ctx.fillRect(food[k] * sx - 1, food[k + 1] * sy - 1, 2, 2);
  }

  // Organisms.
  const meta = f.meta, gcol = f.gcol, scol = f.scol;
  ctx.lineWidth = 1;
  for (let i = 0; i < f.n; i++) {
    const m = i * 5, c = i * 3;
    const x = meta[m] * sx, y = meta[m + 1] * sy;
    const size = meta[m + 2], diet = meta[m + 4];
    const r = Math.max(2, size * 2.4 * s);

    let fill;
    if (colorMode === "species") {
      fill = muted(scol[c], scol[c + 1], scol[c + 2]);
    } else if (colorMode === "genome") {
      fill = muted(gcol[c], gcol[c + 1], gcol[c + 2]);
    } else { // diet: teal herbivore -> crimson carnivore
      fill = dietColor(diet);
    }

    if (showVision) {
      // vision radius (in world units) is size-independent; approximate with a
      // faint ring scaled from the organism's drawn radius for a visual cue.
      ctx.strokeStyle = "rgba(15,118,110,0.18)";
      ctx.beginPath();
      ctx.arc(x, y, r * 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Thin hairline keeps every specimen legible on the light plate.
    ctx.strokeStyle = "rgba(31,42,51,0.35)";
    ctx.stroke();
  }

  renderAnalytics(f);
}

function drawOnce() {
  if (!py.frame) return;
  draw(pullFrame());
}

function loop() {
  if (!running) return;
  const alive = py.step_sim(stepsPerFrame);
  draw(pullFrame());

  frameCount++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    els.fps.textContent = Math.round((frameCount * 1000) / (now - lastFpsT));
    frameCount = 0;
    lastFpsT = now;
  }

  if (!alive) {
    setStatus("Population went extinct — reset to run again.");
    stop();
    return;
  }
  rafId = requestAnimationFrame(loop);
}

function start() {
  if (running || !py.step_sim) return;
  running = true;
  els.play.textContent = "⏸ Pause";
  setStatus("Running — evolution in progress.");
  lastFpsT = performance.now();
  frameCount = 0;
  rafId = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  els.play.textContent = "▶ Play";
  if (rafId) cancelAnimationFrame(rafId);
}

function toggle() { running ? stop() : start(); }

function resizeCanvas() {
  const wrap = els.canvas.parentElement;
  const w = wrap.clientWidth;
  const h = Math.round(w * (world.height / world.width));
  els.canvas.width = w;
  els.canvas.height = h;
  if (!running) drawOnce();
}

function setColorMode(mode) {
  colorMode = mode;
  for (const b of document.querySelectorAll("[data-color]")) {
    b.classList.toggle("active", b.dataset.color === mode);
  }
  if (!running) drawOnce();
}

function wireControls() {
  els.play = $("play");
  els.reset = $("reset");
  els.seed = $("seed");
  els.brain = $("brain");
  els.maxpop = $("maxpop");
  els.speed = $("speed");
  els.vision = $("vision");

  els.play.addEventListener("click", toggle);
  els.reset.addEventListener("click", () => {
    const wasRunning = running;
    stop();
    newSim();
    els.fps.textContent = "0";
    setStatus("Reset. Press Play (or Space).");
    if (wasRunning) start();
  });

  els.speed.addEventListener("input", () => {
    stepsPerFrame = parseInt(els.speed.value, 10);
    $("speed-val").textContent = `${stepsPerFrame}×`;
  });
  els.vision.addEventListener("change", () => {
    showVision = els.vision.checked;
    if (!running) drawOnce();
  });

  for (const b of document.querySelectorAll("[data-color]")) {
    b.addEventListener("click", () => setColorMode(b.dataset.color));
  }
  setColorMode(colorMode);

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowUp") {
      els.speed.value = Math.min(20, stepsPerFrame + 1); els.speed.dispatchEvent(new Event("input"));
    } else if (e.code === "ArrowDown") {
      els.speed.value = Math.max(1, stepsPerFrame - 1); els.speed.dispatchEvent(new Event("input"));
    } else if (e.key === "c") {
      const order = ["species", "diet", "genome"];
      setColorMode(order[(order.indexOf(colorMode) + 1) % order.length]);
    } else if (e.key === "v") {
      els.vision.checked = !els.vision.checked; els.vision.dispatchEvent(new Event("change"));
    }
  });
}

boot().catch((err) => {
  console.error(err);
  setStatus("Failed to load: " + err.message);
});
