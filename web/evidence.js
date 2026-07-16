/*
 * EvoSim — "Survival of the Fittest, Measured".
 *
 * The honest, reliable evidence view. In a scarce world the fastest creatures
 * reach food, survive, and pass their speed to their young — so generation after
 * generation the WHOLE population shifts toward faster. We measure that directly:
 * the speed distribution of the very first generation vs the population now.
 *
 * Why this and not a per-creature "who survived" bar? Because in a real
 * ecosystem individual survival is noisy (luck, timing, and traits carry
 * trade-offs — being TOO fast wastes energy). But the population-level shift is
 * rock-solid every single run: the average creature gets measurably fitter. That
 * IS natural selection, and it's honest.
 */

"use strict";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";
const SPD_LO = 0.4, SPD_HI = 4.2, NBINS = 16;

const BRIDGE = `
import numpy as np
from evosim import Simulation, SimulationConfig

_S = {}
_EDGES = np.linspace(${SPD_LO}, ${SPD_HI}, ${NBINS}+1)

def _hist(speeds):
    if len(speeds) == 0: return [0]*${NBINS}
    h, _ = np.histogram(np.asarray(speeds), bins=_EDGES)
    return [int(x) for x in h]

def make_sim(seed):
    sim = Simulation(SimulationConfig.survival(int(seed)))
    _S['sim'] = sim
    s0 = [o.speed for o in sim.organisms]
    _S['hist0'] = _hist(s0)
    _S['mean0'] = float(np.mean(s0))
    return {'width': float(sim.world.width), 'height': float(sim.world.height)}

def step_sim(n):
    sim = _S['sim']; alive = True
    for _ in range(int(n)):
        alive = sim.step()
        if not alive: break
    return bool(alive)

def frame():
    sim = _S['sim']; orgs = sim.organisms; n = len(orgs)
    speeds = np.array([o.speed for o in orgs], np.float32) if n else np.empty(0, np.float32)
    meta = np.empty((n, 3), np.float32)
    for k, o in enumerate(orgs):
        meta[k,0]=o.pos[0]; meta[k,1]=o.pos[1]; meta[k,2]=o.speed
    gen = float(np.mean([o.genome.generation for o in orgs])) if n else 0.0
    return {
        'n': n, 'tick': int(sim.tick), 'gen': gen,
        'mean0': _S['mean0'], 'mean_now': float(speeds.mean()) if n else 0.0,
        'hist0': _S['hist0'], 'hist_now': _hist(speeds),
        'meta': meta.tobytes(),
    }
`;

const els = {};
let pyodide = null, py = {};
let world = { width: 900, height: 600 };
let running = false, stepsPerFrame = 4, rafId = null;
let peakGen = 0;

function $(id) { return document.getElementById(id); }
function setStatus(t, s = false) { els.status.textContent = t; els.spinner.style.display = s ? "inline-block" : "none"; }

async function boot() {
  els.mini = $("mini"); els.mctx = els.mini.getContext("2d");
  els.chart = $("chart"); els.cctx = els.chart.getContext("2d");
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
  setStatus("Ready — press Start and watch the population get fitter.");
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
  world.width = d.width; world.height = d.height; peakGen = 0;
  resize();
}

function pull() {
  const proxy = py.frame();
  const d = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return {
    n: d.n, tick: d.tick, gen: d.gen, mean0: d.mean0, mean_now: d.mean_now,
    hist0: d.hist0, hist_now: d.hist_now,
    meta: new Float32Array(d.meta.buffer, d.meta.byteOffset, d.n * 3),
  };
}

function speedColor(spd) {
  let t = Math.max(0, Math.min(1, (spd - SPD_LO) / (SPD_HI - SPD_LO)));
  const A = [206, 221, 217], B = [11, 92, 86];
  return `rgb(${(A[0] + (B[0] - A[0]) * t) | 0},${(A[1] + (B[1] - A[1]) * t) | 0},${(A[2] + (B[2] - A[2]) * t) | 0})`;
}

// Two overlaid distributions: the first generation (grey) vs the population now
// (teal). The teal curve marches to the right as the fit out-breed the slow.
function drawChart(f) {
  const ctx = els.cctx, W = els.chart.width, H = els.chart.height;
  const dpr = window.devicePixelRatio || 1;
  const w = W / dpr, h = H / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 8, padR = 8, padB = 26, padT = 8;
  const cw = w - padL - padR, ch = h - padT - padB;
  const norm = (arr) => { const s = arr.reduce((a, b) => a + b, 0) || 1; return arr.map(v => v / s); };
  const h0 = norm(f.hist0), hn = norm(f.hist_now);
  const maxY = Math.max(0.001, ...h0, ...hn);
  const bw = cw / NBINS;
  const X = (i) => padL + i * bw;
  const Y = (v) => padT + ch - (v / maxY) * ch;

  const area = (hist, fill, stroke) => {
    ctx.beginPath(); ctx.moveTo(X(0), padT + ch);
    for (let i = 0; i < NBINS; i++) { ctx.lineTo(X(i) + bw / 2, Y(hist[i])); }
    ctx.lineTo(X(NBINS - 1) + bw / 2, padT + ch); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < NBINS; i++) { const px = X(i) + bw / 2, py = Y(hist[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  };
  area(h0, "rgba(132,148,162,0.28)", "rgba(132,148,162,0.9)");   // first generation (grey)
  area(hn, "rgba(11,92,86,0.30)", "rgba(11,92,86,1)");           // now (teal)

  // mean markers
  const meanX = (m) => padL + ((m - SPD_LO) / (SPD_HI - SPD_LO)) * cw;
  const mark = (m, color, dash) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(meanX(m), padT); ctx.lineTo(meanX(m), padT + ch); ctx.stroke(); ctx.restore();
  };
  mark(f.mean0, "rgba(120,134,148,0.95)", [4, 3]);
  mark(f.mean_now, "#0b5c56", []);

  // x axis labels
  ctx.fillStyle = "#8494a2"; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText("slower", padL + cw * 0.12, h - 8);
  ctx.fillText("speed →", padL + cw * 0.5, h - 8);
  ctx.fillText("faster", padL + cw * 0.88, h - 8);
}

function drawMini(f) {
  const ctx = els.mctx, W = els.mini.width, H = els.mini.height;
  const sx = W / world.width, sy = H / world.height, s = Math.min(sx, sy);
  ctx.fillStyle = "#f2f5f6"; ctx.fillRect(0, 0, W, H);
  const meta = f.meta;
  for (let i = 0; i < f.n; i++) {
    const m = i * 3;
    ctx.fillStyle = speedColor(meta[m + 2]);
    ctx.beginPath(); ctx.arc(meta[m] * sx, meta[m + 1] * sy, Math.max(2.5, 3 * s), 0, Math.PI * 2); ctx.fill();
  }
}

function render(f) {
  drawChart(f); drawMini(f);
  peakGen = Math.max(peakGen, f.gen);
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("mean0", f.mean0.toFixed(2));
  set("mean-now", f.mean_now.toFixed(2));
  set("m-gen", f.gen.toFixed(1));
  set("m-alive", f.n);
  const gain = f.mean0 > 0 ? (f.mean_now / f.mean0 - 1) * 100 : 0;
  const head = $("headline");
  if (f.gen < 0.5) head.textContent = "Generation 1. Watch what happens to the whole population over time…";
  else head.innerHTML = `After <b>${f.gen.toFixed(0)} generations</b>, the average creature is <b>${gain.toFixed(0)}% faster</b> than its ancestors — because in every generation, the fittest survived and the slow did not.`;
}

function step() { render(pull()); }

function loop() {
  if (!running) return;
  const alive = py.step_sim(stepsPerFrame);
  step();
  if (!alive) fresh();
  rafId = requestAnimationFrame(loop);
}
function start() { if (running || !py.step_sim) return; running = true; els.start.textContent = "Pause"; setStatus("Running — natural selection in action."); rafId = requestAnimationFrame(loop); }
function stop() { running = false; els.start.textContent = "Start"; if (rafId) cancelAnimationFrame(rafId); }
function toggle() { running ? stop() : start(); }

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const mw = els.mini.parentElement.clientWidth;
  els.mini.width = mw; els.mini.height = Math.round(mw * (world.height / world.width));
  const cw = els.chart.parentElement.clientWidth;
  els.chart.style.width = cw + "px"; els.chart.style.height = "230px";
  els.chart.width = cw * dpr; els.chart.height = 230 * dpr;
  if (!running) drawOnce();
}
function drawOnce() { if (py.frame) step(); }

function wire() {
  els.start = $("start"); els.restart = $("restart"); els.speed = $("time"); els.speedVal = $("time-val");
  els.start.addEventListener("click", toggle);
  els.restart.addEventListener("click", () => { const was = running; stop(); fresh(); setStatus("New world. Press Start."); drawOnce(); if (was) start(); });
  els.speed.addEventListener("input", () => { stepsPerFrame = +els.speed.value; els.speedVal.textContent = `${stepsPerFrame}×`; });
  document.addEventListener("keydown", (e) => { if (e.target.tagName === "INPUT") return; if (e.code === "Space") { e.preventDefault(); toggle(); } });
}

boot().catch((err) => { console.error(err); setStatus("Failed to load: " + err.message); });
