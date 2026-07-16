/*
 * EvoSim — "Adapt or Fall Behind" (general-audience mode).
 *
 * A simple, human-readable framing of natural selection over the same real
 * Python engine. Food is scarce; creatures that evolve the winning trait (here,
 * speed — the ability to reach food) ADAPT and thrive, while those that don't
 * get LEFT BEHIND and starve. Each creature is a cute icon, not an abstract dot,
 * and the headline is one number anyone gets: what % of the world has adapted.
 *
 * "Adapted" = a creature faster than the ORIGINAL population's average. As
 * evolution proceeds that share climbs toward 100% — the world adapting, live.
 */

"use strict";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

const ICON_ADAPTED = "🐆";   // fast — kept up / conquered
const ICON_BEHIND = "🐌";    // slow — left behind

const BRIDGE = `
import numpy as np
from evosim import Simulation, SimulationConfig

_S = {}

def make_sim(seed):
    sim = Simulation(SimulationConfig.survival(int(seed)))
    _S['sim'] = sim
    _S['prev'] = {o.id: (float(o.pos[0]), float(o.pos[1])) for o in sim.organisms}
    _S['speed0'] = float(np.mean([o.speed for o in sim.organisms]))
    _S['deaths'] = 0
    _S['adapted_total'] = 0
    return {'width': float(sim.world.width), 'height': float(sim.world.height),
            'speed0': _S['speed0']}

def step_sim(n):
    sim = _S['sim']
    alive = True
    for _ in range(int(n)):
        alive = sim.step()
        if not alive:
            break
    return bool(alive)

def frame():
    sim = _S['sim']
    orgs = sim.organisms
    n = len(orgs)
    meta = np.empty((n, 5), np.float32)   # x, y, size, heading, speed
    for k, o in enumerate(orgs):
        p = o.pos
        meta[k, 0] = p[0]; meta[k, 1] = p[1]
        meta[k, 2] = o.size; meta[k, 3] = o.wander_heading; meta[k, 4] = o.speed

    cur = {o.id: (float(o.pos[0]), float(o.pos[1])) for o in orgs}
    prev = _S['prev']
    dead = [prev[i] for i in prev if i not in cur]
    _S['prev'] = cur
    _S['deaths'] += len(dead)
    dead_arr = np.array(dead, np.float32) if dead else np.empty((0, 2), np.float32)
    gen = float(np.mean([o.genome.generation for o in orgs])) if n else 0.0

    return {
        'n': n, 'tick': int(sim.tick), 'gen': gen,
        'deaths_total': int(_S['deaths']),
        'speed0': _S['speed0'],
        'meta': meta.tobytes(),
        'dead': dead_arr.tobytes(), 'ndead': int(len(dead)),
    }
`;

const els = {};
let pyodide = null, py = {};
let world = { width: 900, height: 600 };
let running = false, stepsPerFrame = 2, rafId = null;
let speed0 = 0;
let deathFx = [];
let adaptedHist = [];
let activeTab = "world";

function $(id) { return document.getElementById(id); }
function setStatus(t, spin = false) { els.status.textContent = t; els.spinner.style.display = spin ? "inline-block" : "none"; }

async function boot() {
  els.canvas = $("arena"); els.ctx = els.canvas.getContext("2d");
  els.status = $("status"); els.spinner = $("spinner");
  wire(); resize(); window.addEventListener("resize", resize);

  setStatus("Warming up the simulation…", true);
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });
  setStatus("Almost ready…", true);
  await pyodide.loadPackage("numpy");
  writeEngine();
  pyodide.runPython(BRIDGE);
  py.make_sim = pyodide.globals.get("make_sim");
  py.step_sim = pyodide.globals.get("step_sim");
  py.frame = pyodide.globals.get("frame");

  fresh();
  setStatus("Ready — press Start.");
  drawOnce();
}

function writeEngine() {
  const files = self.EVOSIM_FILES || {}, made = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split("/"); let dir = "";
    for (let i = 0; i < parts.length - 1; i++) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i];
      if (!made.has(dir)) { try { pyodide.FS.mkdir(dir); } catch (e) {} made.add(dir); }
    }
    pyodide.FS.writeFile(path, files[path]);
  }
}

function fresh() {
  const seed = (Math.random() * 100000) | 0;
  const d = py.make_sim(seed).toJs({ dict_converter: Object.fromEntries });
  world.width = d.width; world.height = d.height; speed0 = d.speed0;
  deathFx = []; adaptedHist = [];
  resize();
}

function pull() {
  const proxy = py.frame();
  const d = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return {
    n: d.n, tick: d.tick, gen: d.gen, deaths_total: d.deaths_total, speed0: d.speed0,
    meta: new Float32Array(d.meta.buffer, d.meta.byteOffset, d.n * 5),
    dead: new Float32Array(d.dead.buffer, d.dead.byteOffset, d.ndead * 2),
  };
}

// Split the living population into "adapted" (faster than the original average)
// and "left behind", and gather the numbers the whole UI is built on.
function classify(f) {
  const meta = f.meta;
  let adapted = 0, sumA = 0, sumB = 0;
  for (let i = 0; i < f.n; i++) {
    const spd = meta[i * 5 + 4];
    if (spd >= f.speed0) { adapted++; sumA += spd; } else { sumB += spd; }
  }
  const behind = f.n - adapted;
  return {
    adapted, behind,
    pctA: f.n ? adapted / f.n * 100 : 0,
    avgA: adapted ? sumA / adapted : 0,
    avgB: behind ? sumB / behind : 0,
  };
}

function drawWorld(f, g) {
  const ctx = els.ctx, W = els.canvas.width, H = els.canvas.height;
  const sx = W / world.width, sy = H / world.height, s = Math.min(sx, sy);
  ctx.fillStyle = "#eef2f4"; ctx.fillRect(0, 0, W, H);

  // register + draw fading "fell behind" marks
  for (let k = 0; k < f.dead.length; k += 2) deathFx.push({ x: f.dead[k] * sx, y: f.dead[k + 1] * sy, age: 0 });
  if (deathFx.length > 200) deathFx.splice(0, deathFx.length - 200);
  for (const d of deathFx) {
    const a = 1 - d.age / 22; if (a <= 0) continue;
    ctx.strokeStyle = `rgba(178,52,60,${a * 0.9})`; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(d.x - 4, d.y - 4); ctx.lineTo(d.x + 4, d.y + 4);
    ctx.moveTo(d.x + 4, d.y - 4); ctx.lineTo(d.x - 4, d.y + 4); ctx.stroke();
    d.age++;
  }
  deathFx = deathFx.filter(d => d.age < 22);

  // creatures as cute icons
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const meta = f.meta;
  for (let i = 0; i < f.n; i++) {
    const m = i * 5;
    const x = meta[m] * sx, y = meta[m + 1] * sy, size = meta[m + 2], spd = meta[m + 4];
    const adapted = spd >= f.speed0;
    const px = Math.max(14, size * 8 * s);
    ctx.font = `${px}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif`;
    ctx.globalAlpha = adapted ? 1.0 : 0.85;
    ctx.fillText(adapted ? ICON_ADAPTED : ICON_BEHIND, x, y);
  }
  ctx.globalAlpha = 1.0;
}

function updateHeadline(f, g) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("pct-adapted", `${g.pctA.toFixed(0)}%`);
  set("pct-behind", `${(100 - g.pctA).toFixed(0)}%`);
  const bar = $("split-adapted"); if (bar) bar.style.width = `${g.pctA.toFixed(1)}%`;
  set("hl-caption", captionFor(f, g));
}

function renderDivide(f, g) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("d-adapted-n", g.adapted); set("d-behind-n", g.behind);
  set("d-adapted-pct", `${g.pctA.toFixed(0)}%`); set("d-behind-pct", `${(100 - g.pctA).toFixed(0)}%`);
  set("d-adapted-spd", g.avgA ? g.avgA.toFixed(2) : "–");
  set("d-behind-spd", g.avgB ? g.avgB.toFixed(2) : "–");
  set("d-gen", f.gen.toFixed(1));
  set("d-fell", f.deaths_total);
  set("d-alive", f.n);

  // pictograph: 20 icons filled to the adapted share
  const slots = 20, filled = Math.round(g.pctA / 100 * slots);
  let s = "";
  for (let i = 0; i < slots; i++) s += (i < filled ? ICON_ADAPTED : ICON_BEHIND);
  const pg = $("pictograph"); if (pg) pg.textContent = s;

  drawSpark("sp-adapted", adaptedHist, "#0b5c56", 0, 100);
}

function drawSpark(id, series, color, lo, hi) {
  const cv = $(id); if (!cv) return;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (series.length < 2) return;
  if (lo === undefined) { lo = Math.min(...series); hi = Math.max(...series); }
  const span = (hi - lo) || 1;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = (i / (series.length - 1)) * (W - 2) + 1;
    const y = H - 2 - ((series[i] - lo) / span) * (H - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function captionFor(f, g) {
  if (f.n <= 18) return "Hard times — food is scarce. Only those quick enough to reach it are surviving.";
  if (g.pctA >= 75) return "The world has adapted: most are now fast enough to thrive. The slow have been left behind.";
  if (g.pctA >= 55) return "More and more are adapting — the fast reach food, breed, and pass speed to their young.";
  return "Watch the split: 🐆 adapted creatures reach food and multiply; 🐌 the left-behind fade out (✕).";
}

function frameTick(f) {
  const g = classify(f);
  adaptedHist.push(g.pctA);
  if (adaptedHist.length > 200) adaptedHist.shift();
  if (activeTab === "world") drawWorld(f, g);
  updateHeadline(f, g);
  if (activeTab === "divide") renderDivide(f, g);
}

function loop() {
  if (!running) return;
  const alive = py.step_sim(stepsPerFrame);
  frameTick(pull());
  if (!alive) { setStatus("Everyone fell behind — press Restart to try a new world."); stop(); return; }
  rafId = requestAnimationFrame(loop);
}

function start() { if (running || !py.step_sim) return; running = true; els.start.textContent = "Pause"; setStatus("Running — natural selection in action."); rafId = requestAnimationFrame(loop); }
function stop() { running = false; els.start.textContent = "Start"; if (rafId) cancelAnimationFrame(rafId); }
function toggle() { running ? stop() : start(); }

function resize() {
  const wrap = els.canvas.parentElement, w = wrap.clientWidth;
  els.canvas.width = w; els.canvas.height = Math.round(w * (world.height / world.width));
  if (!running) drawOnce();
}
function drawOnce() { if (py.frame) frameTick(pull()); }

function setTab(tab) {
  activeTab = tab;
  for (const b of document.querySelectorAll("[data-tab]")) b.classList.toggle("active", b.dataset.tab === tab);
  $("tab-world").style.display = tab === "world" ? "" : "none";
  $("tab-divide").style.display = tab === "divide" ? "" : "none";
  if (!running) drawOnce();
  if (tab === "world") resize();
}

function wire() {
  els.start = $("start"); els.restart = $("restart"); els.speed = $("time"); els.speedVal = $("time-val");
  els.start.addEventListener("click", toggle);
  els.restart.addEventListener("click", () => {
    const was = running; stop(); fresh(); setStatus("New world. Press Start."); drawOnce(); if (was) start();
  });
  els.speed.addEventListener("input", () => { stepsPerFrame = +els.speed.value; els.speedVal.textContent = `${stepsPerFrame}×`; });
  for (const b of document.querySelectorAll("[data-tab]")) b.addEventListener("click", () => setTab(b.dataset.tab));
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
  });
}

boot().catch((err) => { console.error(err); setStatus("Failed to load: " + err.message); });
