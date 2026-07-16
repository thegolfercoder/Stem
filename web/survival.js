/*
 * EvoSim — "Survival of the Fittest" (general-audience mode).
 *
 * A deliberately SIMPLE front door to the same real Python engine: a small world
 * with a few large, followable creatures and scarce food. Onlookers watch the
 * slow ones fail to reach food and starve while the fast ones eat and breed, and
 * one plain-English meter shows the whole herd getting faster over generations.
 *
 * No jargon (no "genome", "species", "neural net") is shown to the viewer. The
 * science is identical to the expert viewer — only the framing is stripped down.
 */

"use strict";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

const SPEED_MIN = 0.4, SPEED_MAX = 4.2; // from the genome's speed gene range

// Python glue: build the survival preset, step it, and export drawable frames
// plus who died/was born since the last frame (for on-screen drama).
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
    meta = np.empty((n, 5), np.float32)   # x, y, size, heading, speed_norm
    fastest = -1; fastest_spd = -1.0; spd_sum = 0.0
    cur = {}
    for k, o in enumerate(orgs):
        p = o.pos
        meta[k, 0] = p[0]; meta[k, 1] = p[1]
        meta[k, 2] = o.size; meta[k, 3] = o.wander_heading
        meta[k, 4] = o.speed
        spd_sum += o.speed
        if o.speed > fastest_spd:
            fastest_spd = o.speed; fastest = k
        cur[o.id] = (float(p[0]), float(p[1]))

    prev = _S['prev']
    dead = [prev[i] for i in prev if i not in cur]      # positions of the just-dead
    births = sum(1 for i in cur if i not in prev)
    _S['prev'] = cur
    _S['deaths'] += len(dead)

    dead_arr = np.array(dead, np.float32) if dead else np.empty((0, 2), np.float32)
    gen = float(np.mean([o.genome.generation for o in orgs])) if n else 0.0

    return {
        'n': n,
        'tick': int(sim.tick),
        'gen': gen,
        'deaths_total': int(_S['deaths']),
        'births': int(births),
        'speed_mean': float(spd_sum / n) if n else 0.0,
        'speed0': _S['speed0'],
        'fastest': int(fastest),
        'meta': meta.tobytes(),
        'dead': dead_arr.tobytes(),
        'ndead': int(len(dead)),
    }
`;

const els = {};
let pyodide = null, py = {};
let world = { width: 900, height: 600 };
let running = false, stepsPerFrame = 2, rafId = null;
let speed0 = 0;
let deathFx = [];   // {x, y, age}
let birthFx = [];   // {x, y, age}
let lastFpsT = performance.now(), frameCount = 0;
let peakSpeed = 0;

function $(id) { return document.getElementById(id); }
function setStatus(t, spin = false) { els.status.textContent = t; els.spinner.style.display = spin ? "inline-block" : "none"; }

async function boot() {
  els.canvas = $("arena"); els.ctx = els.canvas.getContext("2d");
  els.status = $("status"); els.spinner = $("spinner");
  els.speedNow = $("speed-now"); els.speedBar = $("speed-bar"); els.speedArrow = $("speed-arrow");
  els.alive = $("m-alive"); els.starved = $("m-starved"); els.gen = $("m-gen");
  els.caption = $("caption");

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
  world.width = d.width; world.height = d.height;
  speed0 = d.speed0; peakSpeed = speed0;
  deathFx = []; birthFx = [];
  resize();
}

function pull() {
  const proxy = py.frame();
  const d = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return {
    n: d.n, tick: d.tick, gen: d.gen, deaths_total: d.deaths_total, births: d.births,
    speed_mean: d.speed_mean, speed0: d.speed0, fastest: d.fastest,
    meta: new Float32Array(d.meta.buffer, d.meta.byteOffset, d.n * 5),
    dead: new Float32Array(d.dead.buffer, d.dead.byteOffset, d.ndead * 2),
  };
}

// Slow (pale) -> fast (deep teal): colour IS fitness, so it reads at a glance.
function speedColor(spd) {
  let t = (spd - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  t = Math.max(0, Math.min(1, t));
  const A = [201, 214, 211], B = [11, 92, 86]; // pale slate -> deep teal
  const r = A[0] + (B[0] - A[0]) * t, g = A[1] + (B[1] - A[1]) * t, b = A[2] + (B[2] - A[2]) * t;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function draw(f) {
  const ctx = els.ctx, W = els.canvas.width, H = els.canvas.height;
  const sx = W / world.width, sy = H / world.height, s = Math.min(sx, sy);

  ctx.fillStyle = "#eef2f4"; ctx.fillRect(0, 0, W, H);

  // register new death / birth effects
  if (f) {
    for (let k = 0; k < f.dead.length; k += 2) deathFx.push({ x: f.dead[k] * sx, y: f.dead[k + 1] * sy, age: 0 });
    if (deathFx.length > 200) deathFx.splice(0, deathFx.length - 200);
  }

  // dying: fading red rings
  for (const d of deathFx) {
    const a = 1 - d.age / 22;
    if (a <= 0) continue;
    ctx.strokeStyle = `rgba(178,52,60,${a * 0.9})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d.x, d.y, 6 + d.age * 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d.x - 3, d.y - 3); ctx.lineTo(d.x + 3, d.y + 3);
    ctx.moveTo(d.x + 3, d.y - 3); ctx.lineTo(d.x - 3, d.y + 3); ctx.stroke();
    d.age++;
  }
  deathFx = deathFx.filter(d => d.age < 22);

  if (!f) return;

  // creatures
  const meta = f.meta;
  for (let i = 0; i < f.n; i++) {
    const m = i * 5;
    const x = meta[m] * sx, y = meta[m + 1] * sy;
    const size = meta[m + 2], head = meta[m + 3], spd = meta[m + 4];
    const r = Math.max(4, size * 4.6 * s);

    // motion streak in the facing direction (a sense of speed)
    const streak = spd * 2.2 * s;
    ctx.strokeStyle = "rgba(31,42,51,0.12)"; ctx.lineWidth = Math.max(1, r * 0.5);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(head) * streak, y - Math.sin(head) * streak); ctx.stroke();

    ctx.fillStyle = speedColor(spd);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(31,42,51,0.4)"; ctx.lineWidth = 1; ctx.stroke();

    if (i === f.fastest) {   // spotlight the current champion
      ctx.strokeStyle = "#0b5c56"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // HUD numbers
  peakSpeed = Math.max(peakSpeed, f.speed_mean);
  els.speedNow.textContent = f.speed_mean.toFixed(2);
  const gain = f.speed0 > 0 ? (f.speed_mean / f.speed0 - 1) : 0;
  const pct = Math.max(0, Math.min(1, (f.speed_mean - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)));
  els.speedBar.style.width = `${(pct * 100).toFixed(0)}%`;
  els.speedArrow.textContent = gain > 0.02 ? "▲" : (gain < -0.02 ? "▼" : "•");
  els.speedArrow.style.color = gain > 0.02 ? "#0b5c56" : (gain < -0.02 ? "#b2343c" : "#8494a2");

  els.alive.textContent = f.n;
  els.starved.textContent = f.deaths_total;
  els.gen.textContent = f.gen.toFixed(1);
  els.caption.textContent = captionFor(f, gain);
}

function captionFor(f, gain) {
  if (f.n <= 18)
    return "Hard times — food is scarce and many are starving. Only the quickest are reaching it in time.";
  if (gain > 0.12)
    return "The survivors are the fast ones — and their babies are fast too. The whole herd is speeding up.";
  if (gain > 0.03)
    return "Fast creatures reach food first and have more babies. Slowly, the group is getting faster.";
  return "Watch closely: the slow ones can't reach food and fade out (✕), while the fast ones eat and breed.";
}

function loop() {
  if (!running) return;
  const alive = py.step_sim(stepsPerFrame);
  draw(pull());
  frameCount++;
  const now = performance.now();
  if (now - lastFpsT >= 500) { frameCount = 0; lastFpsT = now; }
  if (!alive) { setStatus("Everyone died out — press Restart to try a new world."); stop(); return; }
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
function drawOnce() { if (py.frame) draw(pull()); }

function wire() {
  els.start = $("start"); els.restart = $("restart"); els.speed = $("time"); els.speedVal = $("time-val");
  els.start.addEventListener("click", toggle);
  els.restart.addEventListener("click", () => {
    const was = running; stop(); fresh(); peakSpeed = speed0;
    setStatus("New world. Press Start."); drawOnce(); if (was) start();
  });
  els.speed.addEventListener("input", () => { stepsPerFrame = +els.speed.value; els.speedVal.textContent = `${stepsPerFrame}×`; });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
  });
}

boot().catch((err) => { console.error(err); setStatus("Failed to load: " + err.message); });
