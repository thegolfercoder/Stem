/* The application: a video goes in, a swing comes out.
 *
 * Frames are stepped one at a time rather than played through. The video is
 * allowed to advance exactly one frame, paused inside the frame callback, run
 * through the pose estimator, and only then released - so nothing is dropped
 * however slow the estimator is, and every frame carries the real presentation
 * time the container recorded rather than an assumed frame rate. That is what
 * lets the same code read a thirty-frame clip and an iPhone slow-motion one
 * without being told which it has.
 */

import { PoseSequence, resamplePose, extractFeatures, normalisePose,
         BONES, EVENT_NAMES, CLUB_DEFINED, L } from "./engine.js";
import { POSE_MODEL_URL, SwingEventModel, bandsVaryWithConfidence, checkPoseModel, decodeEvents,
  errorBand } from "./model.js";
import { computeMetrics, implausible, readAtSpeeds, slowMotionCheck, slowedMetrics } from "./metrics.js";
import { PracticeLog, cameraSignature, clipKey, formatG3, storedMetrics } from "./practice.js";
import { SwingWatcher, cameraConstraints, extensionFor, frameRateNote, framingVerdict, levelVerdict,
  recordingType } from "./capture.js";
import { cardText, stemRead, voiceCue } from "./read.js";
import { MIN_SWINGS, localDay, progressSeries, progressSvg } from "./progress.js";
import { ILLUSTRATION, drillDemoSvg, repLabel, repState } from "./drills.js";
import { frameLines, headBox, headInside, lineLabels } from "./overlay.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
// Pinned to the version the analysis was measured with (#51; model.js).
const POSE_MODEL = POSE_MODEL_URL;

/* A copy of the estimator published beside the page, when there is one.
 *
 * Some places this page is served from refuse every request to another host,
 * the CDN included, so the thirty megabytes cannot be fetched from Google there
 * however good the connection. A build that ships its own copy sets this, and
 * the model comes in as a few chunks - each file a host will take has a size
 * ceiling, and the estimator is larger than it. Unset, nothing changes.
 */
const LOCAL = globalThis.SWING_ASSETS || null;
const here = (path) => new URL(path, document.baseURI).href;

const el = (id) => document.getElementById(id);

/* A short technical record of each run, kept where the page's owner can read it.
 *
 * The page failed on somebody's phone, and the whole report that could be given was
 * that it did not work. What decides these failures - the browser, whether it can
 * decode the codec, whether WebAssembly is allowed where the page is hosted, which
 * stage stopped and after how long - is nothing a person can be expected to know,
 * so the page writes it down. Never the video, a frame, or the file's name.
 *
 * Written at the start of a run and again at each stage, not only at the end: a run
 * that freezes the tab never reaches its end, and that is the run most worth
 * seeing.
 */
const reports = { db: null, assets: null, chain: Promise.resolve() };
function connectReports() {
  const claude = window.claude;
  if (!claude || typeof claude.use !== "function") return;
  reports.db = claude.use("db").catch(() => null);
  // Only the page's owner gets this: it stores files with the page. It is what
  // lets a clip that went wrong be sent back for fixing, on request.
  reports.assets = claude.use("assets").catch(() => null);
}

/* Send what this run saw, so a clip that went wrong can be fixed without the
 * person having to get the video to anyone.
 *
 * Only on a press of the button, and only for the page's owner. What goes: the
 * poses the estimator found and the model's scores - enough to replay the whole
 * analysis exactly - and two contact sheets, one of the whole clip and one of the
 * stretch that was analysed. The clip itself goes too when it is small enough to
 * store (20 MB); a phone's 4K clip is not, and the sheets show what it showed.
 * Everything is filed under this run's report. */
async function sendDiagnostics() {
  const button = el("send-diag");
  const note = el("send-diag-note");
  const assets = reports.assets ? await reports.assets : null;
  const run = state.run;
  if (!assets || !run || !state.diag) return;
  button.disabled = true;
  const sent = {};
  const upload = async (key, blob, type) => {
    note.textContent = `Sending ${key}\u2026`;
    try {
      const result = await assets.upload(blob, type ? { type } : undefined);
      sent[key] = result.id;
    } catch (error) {
      sent[key] = `failed: ${(error && error.code) || "error"}`;
    }
  };
  try {
    await upload("data", new Blob([JSON.stringify(diagnosticData())], { type: "application/json" }),
                 "application/json");
    const overview = await overviewSheet();
    if (overview) await upload("overview", overview, "image/jpeg");
    const stretch = await stretchSheet();
    if (stretch) await upload("analysed", stretch, "image/jpeg");
    const file = state.file;
    if (file && file.size <= 20 * 1024 * 1024) {
      const type = file.type === "video/quicktime" ? "video/quicktime"
        : (file.type && file.type.startsWith("video/") ? file.type : "video/mp4");
      await upload("clip", file, type);
    }
    run.body.diagnostics = sent;
    saveRun(run);
    const failures = Object.values(sent).filter((v) => String(v).startsWith("failed")).length;
    note.textContent = failures
      ? `Sent, with ${failures} part${failures > 1 ? "s" : ""} refused. Tell Claude in the chat.`
      : "Sent. Tell Claude in the chat, and it can look at exactly what happened.";
    button.textContent = "Sent";
  } catch (error) {
    note.textContent = "Could not send: " + ((error && error.message) || error);
    button.disabled = false;
  }
}

/* The send button, where the owner can use it: under a refusal, or under the
 * results for a clip whose positions look wrong. */
async function offerDiagnostics(where) {
  const box = el("send-diag-box");
  const assets = reports.assets ? await reports.assets : null;
  if (!assets || !state.run) { box.hidden = true; return; }
  const home = where === "results" ? el("send-diag-slot") : el("refusal");
  if (box.parentNode !== home) home.appendChild(box);
  el("send-diag").disabled = false;
  el("send-diag").textContent = where === "results"
    ? "Positions look wrong? Send this clip's diagnostics to Claude"
    : "Send this clip's diagnostics to Claude";
  box.hidden = false;
}

function diagnosticData() {
  const d = state.diag || {};
  const round = (x, k = 4) => Number(Number(x).toFixed(k));
  const seq = d.sequence;
  const v = d.verdict || {};
  const decoded = v.decoded || {};
  const logits = decoded.logits ? Array.from(decoded.logits, (x) => round(x, 3)) : null;
  return {
    run: state.run ? state.run.id : null,
    report: state.run ? state.run.body : null,
    attempts: d.attempts || [],
    scan: d.scan || null,
    tracked: seq ? {
      width: seq.width, height: seq.height,
      times: seq.times.map((t) => round(t, 4)),
      xy: seq.xy.map((f) => f.map((p) => [round(p[0]), round(p[1])])),
      visibility: seq.visibility.map((f) => f.map((x) => round(x, 3))),
      detected: seq.detected.map(Boolean),
    } : null,
    model: {
      ok: Boolean(v.ok), reason: v.reason || null, handedness: v.handedness || null,
      handednessFrom: v.handednessFrom || null,
      frames: decoded.frames || null, confidence: decoded.confidence || null,
      meanConfidence: decoded.meanConfidence ?? null,
      canonicalRateHz: state.payload.features.canonical_rate_hz,
      classes: state.payload.architecture.classes,
      logits,
    },
  };
}

/* Tiles on one sheet, each labelled with its time. */
function sheetOf(tiles, tileH, perRow) {
  if (!tiles.length) return null;
  const tileW = Math.round((tileH * tiles[0].canvas.width) / tiles[0].canvas.height);
  const rows = Math.ceil(tiles.length / perRow);
  const sheet = document.createElement("canvas");
  sheet.width = tileW * Math.min(perRow, tiles.length);
  sheet.height = tileH * rows;
  const g = sheet.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, sheet.width, sheet.height);
  tiles.forEach((tile, k) => {
    const x = (k % perRow) * tileW, y = Math.floor(k / perRow) * tileH;
    g.drawImage(tile.canvas, x, y, tileW, tileH);
    g.font = "600 12px system-ui, sans-serif";
    const label = tile.label;
    g.fillStyle = "rgba(0,0,0,.7)";
    g.fillRect(x + 2, y + 2, g.measureText(label).width + 8, 16);
    g.fillStyle = "#fff";
    g.fillText(label, x + 6, y + 14);
  });
  return new Promise((resolve) => sheet.toBlob(resolve, "image/jpeg", 0.8));
}

/* The whole clip, from the thumbnails the scan kept, poses drawn on. */
async function overviewSheet() {
  const thumbs = (state.diag && state.diag.thumbs) || [];
  if (!thumbs.length) return null;
  const step = Math.max(1, Math.ceil(thumbs.length / 60));
  const tiles = [];
  for (let k = 0; k < thumbs.length; k += step) {
    const t = thumbs[k];
    const canvas = document.createElement("canvas");
    canvas.width = t.canvas.width;
    canvas.height = t.canvas.height;
    canvas.getContext("2d").drawImage(t.canvas, 0, 0);
    if (t.marks) {
      drawPose(canvas, t.marks.map((m) => [m.x, m.y]),
               t.marks.map((m) => Math.min(m.visibility ?? 1, m.presence ?? 1)));
    }
    tiles.push({ canvas, label: `${t.t.toFixed(1)} s` });
  }
  return sheetOf(tiles, 120, 10);
}

/* The stretch that was analysed, every few frames, as tracked. */
async function stretchSheet() {
  const seq = state.diag && state.diag.sequence;
  if (!seq || !state.images) return null;
  const step = Math.max(1, Math.ceil(seq.n / 40));
  const tiles = [];
  for (let i = 0; i < seq.n; i += step) {
    const canvas = await frameCanvas(seq, i);
    tiles.push({ canvas, label: `${seq.times[i].toFixed(2)} s${seq.detected[i] ? "" : " no body"}` });
  }
  return sheetOf(tiles, 200, 8);
}

/* Stem's read (#52): a few sentences from the numbers on the page and the practice
 * engine's priority, written here and never sent anywhere. read.js builds them;
 * this only puts them on the page. */
function renderStemRead() {
  const a = state.analysis;
  const m = state.last && state.last.metrics;
  if (!a || !m) { show("read-section", false); return; }
  const rules = state.payload.practice || null;
  const left = a.handedness === "left";
  const sentences = stemRead({
    metrics: m, handedness: a.handedness,
    band: state.payload.calibration && state.payload.calibration.tempo,
    rules, userSet: [...a.userSet], insight: state.readInsight,
    camera: cameraSignature(a.sequence, nearestFrame(a.sequence, m.eventTimes[0])),
    noPriority: state.readNote ||
      (rules && rules.one_swing ? rules.one_swing[left ? "left" : "right"] : null),
  });
  el("stem-read").innerHTML = sentences.map((s) =>
    `<li data-key="${s.key}"><p>${escapeHtml(s.text)}<span class="prov prov-${s.provenance}">` +
    `${s.provenance}</span></p>${s.caveats.map((c) =>
      `<span class="read-caveat">${escapeHtml(c)}</span>`).join("")}</li>`).join("");
  show("read-section", true);
}

function environment() {
  const probe = document.createElement("video");
  const can = (type) => probe.canPlayType(type) || "no";
  let webgl2 = false;
  try { webgl2 = Boolean(document.createElement("canvas").getContext("webgl2")); } catch { /* no */ }
  let wasm = "yes";
  try { new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); }
  catch (error) { wasm = String((error && error.message) || error).slice(0, 160); }
  return {
    ua: navigator.userAgent.slice(0, 300),
    cores: navigator.hardwareConcurrency || null,
    memoryGb: navigator.deviceMemory || null,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    webgl2,
    wasm,
    frameCallback: typeof probe.requestVideoFrameCallback === "function",
    h264: can('video/mp4; codecs="avc1.42E01E"'),
    hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    vp9: can('video/webm; codecs="vp9"'),
    hosted: Boolean(LOCAL),
  };
}

function beginRun(file) {
  const t0 = performance.now();
  const run = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    done: false,
    body: {
      at: new Date().toISOString(),
      env: environment(),
      file: {
        type: file.type || "",
        ext: (file.name.split(".").pop() || "").toLowerCase().slice(0, 8),
        mb: Number((file.size / 1e6).toFixed(1)),
      },
      stages: {},
      notes: {},
      outcome: "running",
    },
  };
  run.stage = (name) => {
    run.body.stages[name] = Math.round(performance.now() - t0);
    saveRun(run);
  };
  run.note = (fields) => Object.assign(run.body.notes, fields);
  run.end = (fields) => {
    if (run.done) return;
    run.done = true;
    run.body.stages.total = Math.round(performance.now() - t0);
    Object.assign(run.body, fields);
    saveRun(run);
  };
  state.run = run;
  // The latest report, where a test driving the page can read it.
  globalThis.__swingRun = run.body;
  saveRun(run);
  return run;
}

/* One write at a time, in order, and never allowed to break the analysis. */
function saveRun(run) {
  const body = JSON.parse(JSON.stringify(run.body));
  reports.chain = reports.chain.then(async () => {
    const db = reports.db ? await reports.db : null;
    if (!db) return;
    try { await db.collection("runs").doc(run.id).set(body); }
    catch (error) { console.warn("run report not saved:", error && error.code); }
  });
}
const state = { net: null, landmarker: null, busy: false, last: null, clockMs: -1 };

/* Show and hide, without caring which of the two mechanisms the markup used.
 *
 * This page had both: a `.hidden` class that sets display:none, and the `hidden`
 * attribute that browsers honour natively. The JavaScript set the attribute and
 * two of the panels carried the class, so removing the attribute changed nothing
 * and they stayed invisible. Those two panels were the progress bar and the error
 * banner - which is to say, everything the page had to say about what it was
 * doing and everything it had to say about what had gone wrong.
 *
 * The visible symptom was a page that did nothing at all when given a file: no
 * progress, no result, no error, whatever actually happened underneath. Both are
 * cleared here, so it cannot come back by editing the markup.
 */
function show(id, visible) {
  const node = el(id);
  node.hidden = !visible;
  node.classList.toggle("hidden", !visible);
}


/* Which of the four named stages is running, so the wait has a shape.
 *
 * The bar alone could not distinguish "downloading thirty megabytes" from
 * "halfway through a long clip" from "wedged", and those want very different
 * reactions from whoever is watching.
 */
function stage(index) {
  const steps = document.querySelectorAll("#steps .step");
  steps.forEach((node, i) => {
    node.dataset.state = i < index ? "done" : i === index ? "active" : "";
    node.querySelector(".dot").textContent = i < index ? "\u2713" : String(i + 1);
  });
}


function status(text, detail) {
  el("status").textContent = text;
  el("status-detail").textContent = detail || "";
}
function progress(fraction) {
  el("bar").style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

/* Give up on a promise after a while, saying what it was waiting for.
 *
 * The page is one file and everything in it is local except the pose estimator,
 * which is fetched from a CDN because it is thirty megabytes and cannot be
 * inlined. That fetch is the one thing here that can be slow, blocked or simply
 * never answered - a corporate network, an offline laptop, a firewall - and an
 * unanswered fetch is a promise that never settles. Every await on it is bounded
 * so that "no network" reads as "no network" rather than as a page doing nothing.
 */
function deadline(promise, ms, message) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timed out")), ms));
  // Both the timeout and an outright refusal get the explanation. A fetch that is
  // blocked fails in milliseconds rather than hanging, and "Failed to fetch
  // dynamically imported module https://cdn.jsdelivr.net/..." tells a person
  // nothing about what to do next. The original is kept on the end for anyone
  // who wants it.
  return Promise.race([promise, timeout]).catch((error) => {
    const detail = (error && error.message) || String(error);
    throw new Error(`${message}\n\n(${detail})`);
  });
}

const NO_ESTIMATOR =
  "Could not load the pose estimator.\n\n" +
  "The page itself is self-contained, but the body-tracking model is about 30 MB " +
  "and is fetched from the internet the first time you use it, then cached by " +
  "your browser. So this needs a working connection on the first run, and a " +
  "network that does not block cdn.jsdelivr.net or storage.googleapis.com.";

async function ready() {
  if (state.landmarker) return;
  stage(0);
  status("Loading the pose estimator", "about 30 MB, once - your browser will cache it");

  const root = LOCAL ? here(LOCAL.mediapipe) : MEDIAPIPE;
  const vision = await deadline(
    import(`${root}/vision_bundle.mjs`), 60000, NO_ESTIMATOR);
  const files = await deadline(
    vision.FilesetResolver.forVisionTasks(`${root}/wasm`), 120000, NO_ESTIMATOR);
  // No chunks means no copy shipped with the page: the pinned URL is fetched instead.
  const buffer = LOCAL && LOCAL.model && LOCAL.model.length
    ? await deadline(loadChunks(LOCAL.model), 300000, NO_ESTIMATOR) : null;
  // A copy shipped with the page is checked before use. Fetched from Google, the
  // pinned version is fetched by the estimator itself, out of the page's reach.
  if (buffer) state.poseModelChecked = (await checkPoseModel(buffer)).checked;
  // A fresh copy for each attempt: the estimator may take ownership of what it
  // is handed, and the processor fallback below needs the bytes again.
  const source = () => buffer ? { modelAssetBuffer: buffer.slice() } : { modelAssetPath: POSE_MODEL };

  // The GPU path is faster and is not everywhere: a machine without WebGL, or a
  // browser that has switched it off, fails here rather than falling back on its
  // own. Trying the processor afterwards costs one retry and turns a dead page
  // into a slow one.
  const options = {
    baseOptions: { ...source(), delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    // A test driving this page on a machine whose only GPU is a software one can
    // ask for the processor, which there is many times faster.
    if (globalThis.__swingForceCpu) throw new Error("processor requested");
    state.landmarker = await deadline(
      vision.PoseLandmarker.createFromOptions(files, options), 180000, NO_ESTIMATOR);
    state.delegate = "GPU";
  } catch (error) {
    if (String(error.message).startsWith("Could not load")) throw error;
    status("Loading the pose estimator", "no graphics acceleration; using the processor");
    state.landmarker = await deadline(
      vision.PoseLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { ...source(), delegate: "CPU" },
      }), 180000, NO_ESTIMATOR);
    state.delegate = "CPU";
  }
  // A second estimator with the same settings, for a range session's live camera
  // (#56): in video mode an estimator follows the body from one frame to the next,
  // so the camera and a clip being analysed cannot share one.
  state.makeLandmarker = () => vision.PoseLandmarker.createFromOptions(files, {
    ...options, baseOptions: { ...source(), delegate: state.delegate } });
}

function fromBase64(text) {
  const binary = atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* The estimator's weights, reassembled from the chunks published with the page.
 * Chunks named .b64.txt are base64 text, for hosts that serve text but not an
 * arbitrary binary file. */
async function loadChunks(paths) {
  const parts = [];
  let total = 0;
  for (const [index, path] of paths.entries()) {
    const response = await fetch(here(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const part = path.endsWith(".b64.txt")
      ? fromBase64(await response.text())
      : new Uint8Array(await response.arrayBuffer());
    parts.push(part);
    total += part.length;
    status("Loading the pose estimator", `${Math.round(total / 1e6)} of about 31 MB`);
    progress(0.02 + (0.12 * (index + 1)) / paths.length);
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { whole.set(part, at); at += part.length; }
  return whole;
}

/* Waiting on a video element, with the waiting made survivable.
 *
 * Every one of these used to be a bare promise that resolved on an event and had
 * no other way out. That is fine while the browser can decode what it was given
 * and a disaster when it cannot: a clip the browser will not open fires neither
 * "loadedmetadata" nor "error" in some builds, so the promise never settles, the
 * catch never runs, and the page sits there looking like it is thinking. A user
 * reported exactly that and had no way of knowing what had gone wrong, which is
 * the worst failure this page can have - worse than a wrong answer, because a
 * wrong answer at least tells you something.
 *
 * So nothing waits forever any more. Each wait has a deadline and a message that
 * says what did not happen.
 */
function waitFor(target, event, { timeout, what }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      fn(arg);
    };
    const onEvent = () => finish(resolve);
    const onError = () => finish(reject, new Error(what));
    const timer = setTimeout(() => finish(reject, new Error(what)), timeout);
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

const UNREADABLE =
  "Your browser could not open that video.\n\n" +
  "If it came from an iPhone, it is probably HEVC (H.265), which most browsers on " +
  "Windows and Linux cannot decode. Safari can, and Chrome on a Mac usually can.\n\n" +
  "Two ways round it: set the phone to Settings \u203a Camera \u203a Formats \u203a " +
  "Most Compatible before recording, or open this page in Safari.";

const CODEC_NAMES = { h264: "H.264", vp8: "VP8", vp9: "VP9", av1: "AV1" };

/* What to say when a file cannot be decoded, from what is actually in it. */
function unreadableFor(codec) {
  if (codec === "hevc") return HEVC_UNREADABLE;
  const name = CODEC_NAMES[codec];
  if (!name) return UNREADABLE;
  return `This video is ${name}, and this browser could not decode it.\n\n` +
    "That is unusual for a phone recording. The file may be damaged or only partly " +
    "copied - try sending it again - or this browser may be missing the decoder; " +
    "a current Chrome, Edge or Safari has it.";
}

/* How the clip is read, and why these numbers.
 *
 * Phone video is the case this has to be right for, and it is the case the first
 * version was never tried on: a 360-pixel test clip at thirty frames a second hid
 * every one of the following.
 *
 * Frames are tracked at TRACK_LONG_SIDE, not at the video's own size. An iPhone
 * records 4K, and tracking at 4K meant a 3840-pixel canvas drawn and handed to the
 * estimator hundreds of times, when the estimator crops the body to 256 pixels
 * anyway. It also changed the answer: the same frame tracked at 4K and at 720 pixels
 * put the wrist in visibly different places, and the model learnt from landmarks
 * tracked on small video, so a small fixed size is the one it knows.
 *
 * Frames closer together than 1/MAX_RATE_HZ are skipped. The model resamples to
 * sixty a second before it looks, so a 240 fps slow-motion clip tracked in full was
 * four times the work for nothing.
 *
 * Clips longer than SCAN_ABOVE_S are searched for the swing first, a few frames a
 * second, and only the stretch around it is tracked in full. Somebody filming
 * themselves records the walk up, the waggles and the walk away; tracking all of it
 * frame by frame was most of why a phone clip took minutes.
 *
 * Key frames are kept at KEEP_LONG_SIDE. Eight of them at 4K was a quarter of a
 * gigabyte of canvas, which is enough on its own to kill a tab on a phone.
 */
const TRACK_LONG_SIDE = 640;
const KEEP_LONG_SIDE = 960;
const MAX_RATE_HZ = 60;
const SCAN_ABOVE_S = 12;
const SCAN_RATE_HZ = 6;

const HEVC_UNREADABLE =
  "This video is HEVC (H.265), which is how iPhones record by default, and this " +
  "browser cannot decode it.\n\n" +
  "On an iPhone, iPad or Mac, open this page in Safari and it will work. Otherwise " +
  "set the phone to Settings › Camera › Formats › Most Compatible and record " +
  "again, or send the video to yourself from Photos, which usually converts it.";

/* Which codec a file holds, read from its header rather than learned by failing.
 *
 * MP4 and MOV name the codec in a four-letter code inside the sample description;
 * WebM names it in a string. The header is usually at the start and, in files some
 * phones write, at the end, so both ends are read. HEVC is looked for first
 * because an HEVC file can still list "avc1" among the brands it is compatible
 * with. */
async function sniffCodec(file) {
  // A four-letter code counts only where it opens a sample description - six
  // reserved zero bytes follow it - because four letters turn up by chance in
  // compressed video, and a VP9 file was once taken for HEVC that way.
  const codes = [["hvc1", "hevc"], ["hev1", "hevc"], ["av01", "av1"], ["vp09", "vp9"],
                 ["vp08", "vp8"], ["avc1", "h264"], ["avc3", "h264"],
                 ["V_VP9", "vp9"], ["V_AV1", "av1"], ["V_VP8", "vp8"], ["V_MPEG4/ISO/AVC", "h264"]];
  const entry = (text, code) => {
    if (code.startsWith("V_")) return text.includes(code);
    for (let at = text.indexOf(code); at >= 0; at = text.indexOf(code, at + 1)) {
      if (text.slice(at + 4, at + 10) === "\0\0\0\0\0\0") return true;
    }
    return false;
  };
  const span = 4 << 20;
  const slices = [file.slice(0, span)];
  if (file.size > span) slices.push(file.slice(file.size - span));
  const decoder = new TextDecoder("latin1");
  try {
    for (const slice of slices) {
      const text = decoder.decode(new Uint8Array(await slice.arrayBuffer()));
      for (const [code, name] of codes) if (entry(text, code)) return name;
    }
  } catch { /* unreadable header: let the video element have its say */ }
  return "unknown";
}

/* Whether a file is an ISO media file (MP4, MOV, M4V) by its first box, not its name. */
async function isIsoMedia(file) {
  try {
    const head = new TextDecoder("latin1").decode(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(head.slice(4, 8));
  } catch {
    return false;
  }
}

async function openVideo(file, codec) {
  const video = el("scratch-video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();
  const unreadable = unreadableFor(codec);
  try {
    await waitFor(video, "loadedmetadata", { timeout: 20000, what: unreadable });
    // A container can be read by a browser that cannot decode what is inside it,
    // so metadata alone is not proof. The first decoded frame is.
    if (video.readyState < 2) {
      await waitFor(video, "loadeddata", { timeout: 20000, what: unreadable });
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  if (!video.videoWidth || !video.videoHeight) {
    URL.revokeObjectURL(url);
    throw new Error(unreadable);
  }
  if (video.duration === Infinity) await learnDuration(video);
  if (!(video.duration > 0) || !isFinite(video.duration)) {
    URL.revokeObjectURL(url);
    throw new Error(
      "That file has no readable duration, so it cannot be stepped through frame " +
      "by frame. Re-exporting it from Photos usually fixes it.");
  }
  return { video, url };
}

/* A WebM written by MediaRecorder (this page's own recordings, in Chrome) carries
 * no duration until its end has been read. Asking for a time past the end makes
 * the browser read it; then back to the start. Left as it is if that fails, and
 * the caller refuses the clip as before. */
async function learnDuration(video) {
  try {
    for (let i = 0; i < 4 && !isFinite(video.duration); i++) {
      const changed = waitFor(video, "durationchange", { timeout: 10000, what: "no duration" });
      if (i === 0) video.currentTime = 1e7;
      await changed;
    }
    const back = waitFor(video, "seeked", { timeout: 8000, what: "seek stalled" });
    video.currentTime = 0;
    await back;
  } catch { /* the duration check after this refuses it */ }
}

async function seekTo(video, time) {
  const seeked = waitFor(video, "seeked", { timeout: 8000, what: "seek stalled" });
  video.currentTime = Math.max(0, Math.min(time, video.duration - 1e-3));
  await seeked;
}

/* Every frame of an MP4 or MOV, decoded one at a time.
 *
 * The first version played the video and took frames as the browser presented
 * them. That is at the mercy of the decoder keeping up: when it cannot, frames are
 * dropped without a sound, and dropped frames do not just slow things down - they
 * change the answer. The same swing padded into a longer clip came back with a
 * tempo of 3.66 instead of 3.32 because 13 of its 144 frames never arrived.
 *
 * So MP4 and MOV - which is what every phone records - are demuxed here and each
 * frame is decoded explicitly with WebCodecs, in hardware where there is hardware,
 * with the exact time the file gives it. Nothing is played, nothing races a clock,
 * and no frame can be skipped by accident.
 *
 * Two things the video element used to do silently have to be done here. Phones
 * store portrait video sideways with a rotation flag, and a decoded frame comes out
 * sideways; drawn as it is, the golfer lies on their side and is not found. And
 * times are counted from the first frame shown, so a file whose first frame is
 * stamped a little after zero lines up with the timeline everything else uses.
 */
async function parseMp4(file) {
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function" ||
      typeof MP4Box === "undefined") return null;
  // Only the index is read here - where every frame is, when it is shown, which are
  // key frames - never the frames themselves: those are read from the file as they
  // are decoded, so a two-gigabyte clip costs what a small one does. Phones often
  // write the index after the frames; the parser says where it wants to read next
  // and this follows it, which skips the frames rather than reading through them.
  const mp4 = MP4Box.createFile();
  let info = null;
  let failure = null;
  mp4.onError = (error) => { failure = error; };
  mp4.onReady = (ready) => { info = ready; };
  const chunk = 4 << 20;
  let at = 0;
  let lastStart = -1;
  let lastEnd = 0;
  for (let reads = 0; !info && !failure && at < file.size && reads < 400; reads++) {
    const buffer = await file.slice(at, at + chunk).arrayBuffer();
    buffer.fileStart = at;
    lastStart = at;
    lastEnd = at + buffer.byteLength;
    const next = mp4.appendBuffer(buffer);
    status("Reading the clip", "");
    if (info || typeof next !== "number") break;
    // Asked again for somewhere inside what it already has: it wants more of the
    // same box, so carry on from the end of it.
    at = next >= lastStart && next < lastEnd ? lastEnd : next;
  }
  if (failure || !info || !info.videoTracks || !info.videoTracks.length) return null;
  const trak = mp4.getTrackById(info.videoTracks[0].id);
  const samples = (trak && trak.samples) || [];
  if (samples.length < 2 || !samples.every((x) => x.size > 0 && x.offset + x.size <= file.size)) {
    return null;
  }

  const track = info.videoTracks[0];
  const entry = mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  let description;
  if (box) {
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(stream);
    description = new Uint8Array(stream.buffer, 8);
  }
  const config = {
    codec: track.codec.startsWith("vp08") ? "vp8" : track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
  };
  if (description) config.description = description;
  let supported = false;
  try { supported = (await VideoDecoder.isConfigSupported(config)).supported; } catch { /* no */ }
  if (!supported) return { unsupported: track.codec };

  // The rotation flag: the first column of the track matrix, in 16.16 fixed point.
  const m = track.matrix || [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  const rotation = ((Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI / 90) * 90) + 360) % 360;
  let first = Infinity;
  let last = -Infinity;
  for (const s of samples) {
    first = Math.min(first, s.cts / s.timescale);
    last = Math.max(last, (s.cts + s.duration) / s.timescale);
  }
  const w = track.video.width, h = track.video.height;
  return {
    file,
    samples,
    config,
    rotation,
    first,
    duration: last - first,
    width: rotation % 180 ? h : w,
    height: rotation % 180 ? w : h,
    codec: track.codec,
  };
}

/* Decode [start, end] of a parsed file, handing over frames at least minGap apart. */
async function decodeRange(media, { start = 0, end = Infinity, minGap = 0, onFrame, label }) {
  const { file, samples, config, rotation, first } = media;
  const time = (s) => s.cts / s.timescale - first;
  // Frames are read from the file a few megabytes at a time: one read per frame is
  // slow, and frames sit next to each other on disk in the order they are decoded.
  let block = null;
  let blockStart = 0;
  const bytes = async (s) => {
    if (!block || s.offset < blockStart || s.offset + s.size > blockStart + block.byteLength) {
      blockStart = s.offset;
      block = new Uint8Array(await file.slice(s.offset, s.offset + Math.max(s.size, 4 << 20)).arrayBuffer());
    }
    return block.subarray(s.offset - blockStart, s.offset - blockStart + s.size);
  };
  // Decoding has to begin on a key frame, so start from the last one before the
  // window and throw away what comes out ahead of it.
  let begin = 0;
  for (let i = 0; i < samples.length; i++) {
    if (time(samples[i]) > start) break;
    if (samples[i].is_sync) begin = i;
  }
  let failure = null;
  let kept = -Infinity;
  const handed = [];
  const decoder = new VideoDecoder({
    output: (frame) => {
      const t = frame.timestamp / 1e6;
      try {
        if (t >= start - 1e-3 && t <= end + 1e-3 && t - kept >= minGap - 2e-3) {
          kept = t;
          handed.push(onFrame(t, frame, turnFor(media, frame)));
        }
      } catch (error) {
        failure = failure || error;
      } finally {
        frame.close();
      }
    },
    error: (error) => { failure = failure || error; },
  });
  decoder.configure(config);
  const span = Math.max(1e-3, Math.min(end, time(samples[samples.length - 1])) - start);
  for (let i = begin; i < samples.length && !failure; i++) {
    const s = samples[i];
    const t = time(s);
    // A little past the end, for frames that are decoded out of order.
    if (t > end + 0.5 && s.is_sync) break;
    decoder.decode(new EncodedVideoChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(t * 1e6),
      duration: Math.round((1e6 * s.duration) / s.timescale),
      data: await bytes(s),
    }));
    while (decoder.decodeQueueSize > 8 && !failure) {
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    if (label) label(Math.max(0, Math.min(1, (t - start) / span)));
  }
  if (!failure) await decoder.flush().catch((error) => { failure = error; });
  decoder.close();
  await Promise.all(handed);
  if (failure) throw failure;
}

/* How far a decoded frame still has to be turned to stand the right way up.
 *
 * The file says how it was filmed; the browser decides whether its decoder has
 * already acted on that. Chromium hands frames over as stored, sideways for a
 * phone held upright. WebKit on an iPhone can hand them over already turned, and
 * turning those again lays the golfer on their side - which the estimator mostly
 * fails to find and the model reads as no swing at all. So the frame's own shape
 * decides: a frame already the shape the clip is meant to be shown at needs no
 * more turning. A frame that carries its own rotation, which drawImage applies by
 * itself, is left to it. What each browser did is kept with the run report. */
function turnFor(media, frame) {
  const rotation = media.rotation;
  let turn = rotation;
  if (media.turn !== undefined) {
    turn = media.turn;
  } else if (rotation) {
    const own = typeof frame.rotation === "number" ? frame.rotation : 0;
    const upright = rotation % 180 !== 0 && media.width !== media.height &&
      frame.displayWidth === media.width && frame.displayHeight === media.height;
    if (upright || own === rotation) turn = 0;
  }
  if (!media.reported) {
    media.reported = true;
    if (state.run) {
      state.run.note({
        frame: {
          display: `${frame.displayWidth}x${frame.displayHeight}`,
          coded: `${frame.codedWidth}x${frame.codedHeight}`,
          own: typeof frame.rotation === "number" ? frame.rotation : null,
          turned: turn,
        },
      });
    }
  }
  return turn;
}

/* Which way up the frames really are, asked of the estimator rather than assumed.
 *
 * The rotation flag, the browser's decoder and drawImage each may or may not turn
 * a frame, and a phone in one app can differ from the same phone in another. A
 * frame drawn the wrong way round lays the golfer on their side, the estimator
 * mostly misses them, and the model reports no swing - which is what the first
 * run from an iPhone did. So one frame is drawn all four ways and handed to the
 * estimator, and the way it finds a body standing upright - shoulders over hips
 * over ankles - is the way every frame is drawn. A few moments of the clip are
 * tried in case the golfer is out of shot in the first. When nobody is found
 * any way up, the flag and the frame's shape decide, as before. */
async function probeOrientation(media) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const upright = (marks) => {
    if (!marks) return 0;
    const mid = (a, b) => [(marks[a].x + marks[b].x) / 2, (marks[a].y + marks[b].y) / 2];
    const seen = [11, 12, 23, 24, 27, 28].map((i) => Math.min(marks[i].visibility ?? 1, marks[i].presence ?? 1));
    const confidence = seen.reduce((a, b) => a + b, 0) / seen.length;
    const [sx, sy] = mid(11, 12), [ax, ay] = mid(27, 28);
    const dx = (ax - sx) * canvas.width, dy = (ay - sy) * canvas.height;
    const length = Math.hypot(dx, dy);
    return length > 0 ? confidence * Math.max(0, dy / length) : 0;
  };
  const tried = [];
  for (const fraction of [0.35, 0.6, 0.15, 0.85]) {
    const at = fraction * media.duration;
    let scores = null;
    await decodeRange(media, {
      start: at, end: at + 0.5, minGap: 60,
      onFrame: (_t, frame) => {
        if (scores) return;
        const dw = frame.displayWidth, dh = frame.displayHeight;
        scores = [0, 90, 180, 270].map((turn) => {
          const cw = turn % 180 ? dh : dw, ch = turn % 180 ? dw : dh;
          const scale = Math.min(1, TRACK_LONG_SIDE / Math.max(cw, ch));
          canvas.width = Math.max(1, Math.round(cw * scale));
          canvas.height = Math.max(1, Math.round(ch * scale));
          drawOriented(context, frame, turn, canvas.width, canvas.height);
          // Twice: in video mode the estimator looks where the body last was, and
          // the last one it saw was lying the other way.
          let result = null;
          for (let k = 0; k < 2; k++) {
            state.clockMs += 40;
            try { result = state.landmarker.detectForVideo(canvas, state.clockMs); } catch { result = null; }
          }
          const marks = result && result.landmarks && result.landmarks[0];
          return { turn, score: upright(marks), width: cw, height: ch };
        });
      },
    });
    if (!scores) continue;
    tried.push({ at: Number(at.toFixed(2)), scores: scores.map((x) => Number(x.score.toFixed(2))) });
    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score >= 0.35) return { ...best, tried };
  }
  return { turn: null, tried };
}

/* Draw a frame the right way up. */
function drawOriented(context, source, rotation, width, height) {
  if (!rotation) {
    context.drawImage(source, 0, 0, width, height);
    return;
  }
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((rotation * Math.PI) / 180);
  const sideways = rotation % 180 !== 0;
  const w = sideways ? height : width, h = sideways ? width : height;
  context.drawImage(source, -w / 2, -h / 2, w, h);
  context.restore();
}

/* The two canvases every frame passes through: one small, for the estimator, and
 * one larger, kept as a JPEG so the key frames and the position editor show the
 * exact frame each pose came from - not a frame found again by seeking, which can
 * land one either side of it. */
function makeTracker(width, height) {
  const keepScale = Math.min(1, KEEP_LONG_SIDE / Math.max(width, height));
  const keep = document.createElement("canvas");
  keep.width = Math.max(1, Math.round(width * keepScale));
  keep.height = Math.max(1, Math.round(height * keepScale));
  const keepContext = keep.getContext("2d");
  const trackScale = Math.min(1, TRACK_LONG_SIDE / Math.max(width, height));
  const canvas = el("scratch-canvas");
  canvas.width = Math.max(1, Math.round(width * trackScale));
  canvas.height = Math.max(1, Math.round(height * trackScale));
  const context = canvas.getContext("2d");

  const detect = (time, baseMs, source, rotation, store) => {
    drawOriented(keepContext, source, rotation, keep.width, keep.height);
    context.drawImage(keep, 0, 0, canvas.width, canvas.height);
    // The clip time of the frame being tracked, for tests that stand in for the
    // estimator and need to know which frame they are being shown.
    globalThis.__swingFrameTime = time;
    // The estimator's clock, not the clip's: in video mode it refuses any timestamp
    // not after the last one it saw, over its whole life rather than per clip.
    let stamp = baseMs + Math.round(time * 1000);
    if (stamp <= state.clockMs) stamp = state.clockMs + 1;
    state.clockMs = stamp;
    let result = null;
    try { result = state.landmarker.detectForVideo(canvas, stamp); } catch { result = null; }
    const image = store
      ? new Promise((resolve) => keep.toBlob(resolve, "image/jpeg", 0.82))
      : null;
    return { result, image };
  };
  return { detect, width, height, keep };
}

/* Find the stretches of a long clip most likely to hold the swing, best first.
 *
 * Sampled a few times a second. Every moment where the hands move fastest for a
 * second either side is a candidate; each is scored by how fast the hands went,
 * raised where they also rose above the shoulders (every full swing does, and
 * waggles, picking up a ball and walking do not) and lowered where the feet were
 * moving (a golfer swinging stands still; one walking to the camera does not).
 * Up to three, at least two and a half seconds apart, go back to be tracked in
 * full and put to the model, which decides.
 *
 * Hand speed is measured in torso lengths a second, so it means the same thing
 * whether the golfer fills the frame or stands at the back of it. Each window is
 * the stretch around its peak where the hands are still moving, padded so the model
 * sees the address before it and the held finish after it - it was trained on clips
 * with both - and never shorter than a normal swing needs, because a slow-motion
 * clip stretches all of it.
 */
async function scanForSwing(duration, tracker, frames) {
  const baseMs = state.clockMs + 1000;
  const samples = [];
  const thumbs = [];
  await frames(1 / SCAN_RATE_HZ, (t, source, rotation) => {
    const { result } = tracker.detect(t, baseMs, source, rotation, false);
    const marks = result && result.landmarks && result.landmarks[0];
    samples.push({ t, marks: marks || null });
    // A thumbnail now and then, for the diagnostics a person can choose to send.
    if (samples.length % 2 === 1) {
      const thumb = document.createElement("canvas");
      thumb.height = 120;
      thumb.width = Math.max(1, Math.round((120 * tracker.keep.width) / tracker.keep.height));
      thumb.getContext("2d").drawImage(tracker.keep, 0, 0, thumb.width, thumb.height);
      thumbs.push({ t, canvas: thumb, marks: marks || null });
    }
    progress(0.05 + 0.2 * Math.min(1, t / duration));
    status("Looking for the swing", `${t.toFixed(0)} of ${duration.toFixed(0)} s`);
  });
  if (state.diag) {
    state.diag.thumbs = thumbs;
    state.diag.scan = samples.map((x) => ({
      t: Number(x.t.toFixed(3)),
      xy: x.marks ? x.marks.map((m) => [Number(m.x.toFixed(4)), Number(m.y.toFixed(4))]) : null,
      v: x.marks ? x.marks.map((m) => Number(Math.min(m.visibility ?? 1, m.presence ?? 1).toFixed(2))) : null,
    }));
  }

  const w = tracker.width, h = tracker.height;
  const mid = (m, a, b) => [(m[a].x + m[b].x) * 0.5 * w, (m[a].y + m[b].y) * 0.5 * h];
  const torsoOf = (m) => {
    const [sx, sy] = mid(m, 11, 12), [hx, hy] = mid(m, 23, 24);
    return Math.hypot(sx - hx, sy - hy);
  };
  const n = samples.length;
  const speed = new Array(n).fill(0);
  const feet = new Array(n).fill(0);
  const high = new Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const b = samples[i].marks;
    if (!b) continue;
    const torso = torsoOf(b);
    if (torso < 1) continue;
    // Positive when the hands are above the shoulders; image y grows downwards.
    high[i] = (mid(b, 11, 12)[1] - mid(b, 15, 16)[1]) / torso;
    const a = i > 0 ? samples[i - 1].marks : null;
    if (!a) continue;
    const dt = Math.max(1e-3, samples[i].t - samples[i - 1].t);
    const [ax, ay] = mid(a, 15, 16), [bx, by] = mid(b, 15, 16);
    speed[i] = Math.hypot(bx - ax, by - ay) / torso / dt;
    const [fax, fay] = mid(a, 27, 28), [fbx, fby] = mid(b, 27, 28);
    feet[i] = Math.hypot(fbx - fax, fby - fay) / torso / dt;
  }
  const smooth = speed.map((_, i) =>
    (speed[Math.max(0, i - 1)] + 2 * speed[i] + speed[Math.min(n - 1, i + 1)]) / 4);
  const around = (i, before, after, pick) => {
    const out = [];
    for (let j = 0; j < n; j++) {
      if (samples[j].t >= samples[i].t - before && samples[j].t <= samples[i].t + after) out.push(pick(j));
    }
    return out;
  };

  const peaks = [];
  for (let i = 0; i < n; i++) {
    if (!(smooth[i] > 0)) continue;
    const neighbourhood = around(i, 1.0, 1.0, (j) => smooth[j]);
    if (smooth[i] < Math.max(...neighbourhood)) continue;
    const raised = Math.max(...around(i, 2.0, 1.0, (j) => high[j]));
    const walking = around(i, 1.5, 1.5, (j) => feet[j]);
    const feetSpeed = walking.reduce((a, b) => a + b, 0) / Math.max(1, walking.length);
    let score = smooth[i] * (1 + 2 * Math.max(0, Math.min(1, raised + 0.2)));
    if (feetSpeed > 0.8) score *= 0.3;
    peaks.push({ i, score });
  }
  peaks.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const p of peaks) {
    if (chosen.length >= 3) break;
    if (chosen.some((c) => Math.abs(samples[c.i].t - samples[p.i].t) < 2.5)) continue;
    chosen.push(p);
  }
  return chosen.map(({ i: peak }) => {
    const active = 0.25 * smooth[peak];
    let left = peak, right = peak;
    while (left > 0 && Math.max(smooth[left - 1], smooth[Math.max(0, left - 2)]) > active) left--;
    while (right < n - 1 && Math.max(smooth[right + 1], smooth[Math.min(n - 1, right + 2)]) > active) right++;
    const tp = samples[peak].t;
    // Never more than about seven seconds: a clip where the hands keep moving
    // would otherwise stretch one candidate over all of it.
    // The fastest hands a few-times-a-second scan catches are often in the
    // follow-through, a second and a half after address, so the window reaches
    // three seconds back: the model was trained on clips with a settled address
    // in them, and a window that starts at the takeaway leaves it guessing.
    return {
      start: Math.max(0, tp - 4.5, Math.min(samples[left].t - 1.5, tp - 3.0)),
      end: Math.min(duration, tp + 3.5, Math.max(samples[right].t + 1.2, tp + 2.0)),
      peak: tp,
    };
  });
}

/* Track every frame the model needs in [start, end], keeping each as a JPEG. */
async function trackRange(tracker, frames, start, end) {
  const collected = { xy: [], visibility: [], world: [], detected: [], times: [], images: [] };
  const baseMs = state.clockMs + 1000;
  const span = Math.max(end - start, 1e-3);
  await frames(1 / MAX_RATE_HZ, (time, source, rotation) => {
    const { result, image } = tracker.detect(time, baseMs, source, rotation, true);
    const marks = result && result.landmarks && result.landmarks[0];
    const found = Boolean(marks);
    const previous = collected.xy.length ? collected.xy[collected.xy.length - 1] : null;
    // An undetected frame keeps the last known pose at zero confidence rather than
    // being dropped: dropping it would compress the time axis, and time is what
    // tempo is measured from.
    collected.xy.push(found ? marks.map((m) => [m.x, m.y])
                            : (previous || Array.from({ length: 33 }, () => [0, 0])));
    collected.visibility.push(found
      ? marks.map((m) => Math.min(m.visibility ?? 1, m.presence ?? 1))
      : new Array(33).fill(0));
    const world = result && result.worldLandmarks && result.worldLandmarks[0];
    collected.world.push(world ? world.map((m) => [m.x, m.y, m.z]) : new Array(33).fill([0, 0, 0]));
    collected.detected.push(found);
    collected.times.push(time + collected.times.length * 1e-9);
    collected.images.push(image);
    progress(0.25 + 0.6 * Math.min(1, (time - start) / span));
    status("Finding the body in each frame",
           `${collected.times.length} frames${state.stretch ? ", " + state.stretch : ""}`);
  }, start, end);
  if (collected.times.length < 2) {
    throw new Error(
      "The video opened but no frames could be read from it. That usually means the " +
      "browser can display it but cannot decode it fast enough to step through. " +
      "Safari handles iPhone clips best.");
  }
  return {
    sequence: new PoseSequence(collected.xy, collected.visibility, collected.world,
                               collected.detected, collected.times,
                               tracker.width, tracker.height),
    images: collected.images,
  };
}

/* Frames from a parsed MP4: explicit decoding, every frame, in order. */
function mp4Frames(media) {
  return (minGap, onFrame, start = 0, end = Infinity) =>
    decodeRange(media, {
      start, end, minGap,
      onFrame: (t, frame, rotation) => onFrame(t, frame, rotation),
    });
}

/* Frames from the video element, for files WebCodecs cannot take: played with a
 * frame callback where the browser has one, sought one by one where it does not. */
function elementFrames(video) {
  return async (minGap, onFrame, start = 0, end = video.duration) => {
    let got = 0;
    const record = (t) => { got++; onFrame(t, video, 0); };
    if (typeof video.requestVideoFrameCallback === "function") {
      if (start > 0.02) await seekTo(video, start);
      await playThrough(video, record, end, minGap);
      state.how = "played";
      if (got >= 2) return;
    }
    state.how = "stepped";
    const reached = await seekThrough(video, record, start, end, minGap);
    // Stopping short and analysing what was read would hand the model part of the
    // swing and report that no swing was found in it. It happened: a busy machine
    // hit the time limit after 1.7 seconds of a 7-second swing.
    if (reached < Math.min(end, video.duration) - 0.5) {
      throw new Error(
        `This browser read only ${(reached - start).toFixed(1)} of the ` +
        `${(Math.min(end, video.duration) - start).toFixed(1)} seconds it needed before ` +
        "giving up, so the rest was never looked at. Chrome or Safari on a computer " +
        "reads clips far faster than most phones; a shorter clip also helps.");
    }
  };
}

/* Play the clip from where it stands and take each frame the decoder hands over.
 *
 * Playback does not wait for anyone: between resuming and the next callback a
 * busy device lets the video run on, and the frames it runs past are simply never
 * shown. A dropped frame is not a small loss - it changes the answer (a clip that
 * lost 13 of 144 frames came back with a tempo of 3.66 instead of 3.32). So this
 * plays slower than real time, notices a frame gone missing from the gap it
 * leaves, and goes back for it: seek to the last frame kept and carry on at half
 * the speed again. The estimator only ever sees frames in order.
 *
 * The frame interval is learned from the smallest step seen, which is the true
 * one as soon as two neighbouring frames have both been shown.
 *
 * The watchdog is the other point. If frames stop arriving - the decoder gives up,
 * the tab is backgrounded, the callback never fires - this returns with whatever it
 * has instead of waiting for an event that is not coming.
 */
function playThrough(video, record, end, minGap = 1 / MAX_RATE_HZ) {
  const until = end === undefined ? video.duration : end;
  return new Promise((resolve) => {
    let last = performance.now();
    let kept = -Infinity;
    let finished = false;
    let rate = 0.5;
    let nominal = Infinity;
    let previous = null;
    let repairs = 0;
    let repairing = false;
    const setRate = (r) => { try { video.playbackRate = r; } catch { /* keep the old rate */ } };
    setRate(rate);
    const stop = () => {
      if (!finished) {
        finished = true;
        clearInterval(watchdog);
        video.pause();
        setRate(1);
        state.playRepairs = repairs;
        resolve();
      }
    };
    const watchdog = setInterval(() => {
      if (!repairing && performance.now() - last > 8000) stop();
    }, 1000);

    /* Pausing inside the frame callback is what stops frames being dropped while
     * the estimator thinks, and it rejects whichever play() is still outstanding
     * with an AbortError. That abort is this code's own doing and means nothing has
     * gone wrong; treating it as a failure ended the loop after one frame. */
    const resume = () => video.play().catch((error) => {
      if (error && error.name === "AbortError") return;
      stop();
    });

    const onFrame = async (_now, meta) => {
      if (finished) return;
      last = performance.now();
      const time = meta.mediaTime;
      if (previous !== null && time > previous + 1e-4) nominal = Math.min(nominal, time - previous);
      previous = time;
      if (time > until + 1e-3) { stop(); return; }
      // Closer than the model will ever look: let the video run on without
      // stopping for it. This is what keeps a 240 fps clip at 60 fps of work.
      if (time - kept < minGap - 2e-3) {
        video.requestVideoFrameCallback(onFrame);
        return;
      }
      // Further from the last kept frame than the next one due: something was
      // skipped. Back to the last kept frame, slower.
      if (kept > -Infinity && isFinite(nominal) && rate > 0.0625 && repairs < 60) {
        const due = Math.max(1, Math.ceil((minGap - 2e-3) / nominal)) * nominal;
        if (time - kept > due + 0.5 * nominal) {
          video.pause();
          repairs++;
          rate = Math.max(0.0625, rate / 2);
          setRate(rate);
          repairing = true;
          try { await seekTo(video, kept); } catch { /* carry on from wherever it is */ }
          repairing = false;
          last = performance.now();
          previous = null;
          if (finished) return;
          video.requestVideoFrameCallback(onFrame);
          resume();
          return;
        }
      }
      video.pause();
      kept = time;
      try {
        record(time);
      } catch (error) {
        console.error(error);
        stop();
        return;
      }
      if (video.ended || time >= Math.min(until, video.duration - 1e-3)) { stop(); return; }
      video.requestVideoFrameCallback(onFrame);
      resume();
    };

    video.onended = stop;
    video.onerror = stop;
    video.requestVideoFrameCallback(onFrame);
    resume();
  });
}

/* Walk [start, end] by seeking, for browsers with no frame callback.
 *
 * Sampled at MAX_RATE_HZ, and a sample that shows the same picture as the last one
 * is thrown away: after a seek, currentTime reads back the time asked for rather
 * than the time of the frame shown, so a 30 fps clip sampled at 60 would otherwise
 * record every frame twice - a staircase through every velocity the model reads,
 * which once moved the tempo by a quarter. A 16x16 thumbnail settles it on what is
 * actually on screen.
 */
async function seekThrough(video, record, start = 0, end = video.duration, minGap = 1 / MAX_RATE_HZ) {
  const step = minGap;
  // Generous, because this is the slow path on the slow machines. Each seek has its
  // own short timeout for a stall; this one only stops a runaway.
  const limit = performance.now() + 900000;
  const thumb = document.createElement("canvas");
  thumb.width = 16;
  thumb.height = 16;
  const thumbContext = thumb.getContext("2d", { willReadFrequently: true });
  let previous = null;
  let reached = start;
  for (let t = start; t < Math.min(end, video.duration - 1e-3); t += step) {
    if (performance.now() > limit) break;
    try {
      await seekTo(video, t);
    } catch {
      break;
    }
    thumbContext.drawImage(video, 0, 0, thumb.width, thumb.height);
    const signature = thumbContext.getImageData(0, 0, thumb.width, thumb.height).data;
    if (previous && sameFrame(previous, signature)) { reached = t; continue; }
    previous = signature.slice();
    record(t);
    reached = t;
  }
  return Math.min(end, reached + step);
}

function sameFrame(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function drawPose(canvas, coordsFrame, visibilityFrame) {
  const context = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const thickness = Math.max(3, Math.round(Math.min(w, h) / 190));
  const point = (i) => [coordsFrame[i][0] * w, coordsFrame[i][1] * h];

  for (const [colour, extra] of [["rgba(18,18,22,0.85)", 3], ["#5cd6ff", 0]]) {
    context.strokeStyle = colour;
    context.lineWidth = thickness + extra;
    context.lineCap = "round";
    for (const [a, b] of BONES) {
      if (Math.min(visibilityFrame[a], visibilityFrame[b]) < 0.3) continue;
      const [ax, ay] = point(a), [bx, by] = point(b);
      context.beginPath(); context.moveTo(ax, ay); context.lineTo(bx, by); context.stroke();
    }
  }
  context.fillStyle = "#ffd65c";
  for (let i = 0; i < 33; i++) {
    if (visibilityFrame[i] < 0.3) continue;
    const [x, y] = point(i);
    context.beginPath(); context.arc(x, y, thickness, 0, Math.PI * 2); context.fill();
  }
}

/* `sample`: the page's own demonstration clip, which is not the golfer's swing
 * and is never kept in their practice log. */
async function analyse(file, { sample = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  state.fromSample = sample;
  releaseClip();
  show("results", false);
  show("refusal", false);
  show("working", true);
  stage(0);
  // Confirm what was picked. Without it the panel looks identical whether the
  // file was taken or silently ignored.
  el("drop-main").textContent = file.name;
  el("drop-sub").textContent =
    `${(file.size / 1e6).toFixed(1)} MB \u00b7 choose another to start again`;
  progress(0.02);
  const run = beginRun(file);
  state.file = file;
  state.diag = null;

  try {
    const codec = await sniffCodec(file);
    state.codec = codec;
    run.note({ codec });

    await ready();
    run.note({ delegate: state.delegate || "" });
    run.stage("estimator");
    stage(1);
    status("Reading the clip", file.name);

    // WebCodecs for every MP4 and MOV it can decode, which is every phone clip on a
    // current browser; the video element for anything else. The element is not
    // asked first: it is the one that refuses files it could not play back smoothly,
    // and a file this decodes needs nothing from it.
    let media = null;
    if (await isIsoMedia(file)) {
      try { media = await parseMp4(file); } catch (error) { media = null; run.note({ parseError: String(error).slice(0, 200) }); }
      if (media && media.unsupported) {
        run.note({ webcodecs: `unsupported ${media.unsupported}` });
        media = null;
      }
    }
    let video = null;
    let duration;
    if (media) {
      state.clip = { media };
      duration = media.duration;
      status("Working out which way up the clip is", "");
      try {
        const probe = await probeOrientation(media);
        run.note({ orientation: { turn: probe.turn, tried: probe.tried } });
        if (probe.turn !== null) {
          media.turn = probe.turn;
          media.width = probe.width;
          media.height = probe.height;
        }
      } catch (error) {
        run.note({ orientationError: String((error && error.message) || error).slice(0, 200) });
      }
      run.note({ width: media.width, height: media.height, duration: Number(duration.toFixed(2)),
                 rotation: media.rotation, streamCodec: media.codec });
    } else {
      const opened = await openVideo(file, codec);
      video = opened.video;
      state.clip = { url: opened.url, video };
      duration = video.duration;
      run.note({ width: video.videoWidth, height: video.videoHeight,
                 duration: Number(duration.toFixed(2)) });
    }
    run.stage("opened");

    const config = state.payload.features;
    const thresholds = state.payload.thresholds;
    state.diag = { attempts: [] };

    /* What the model makes of one tracked stretch at its own timestamps: a verdict,
     * never a throw. `refusedBy` says which layer refused, so only a refusal of
     * the events is retried as slow motion. */
    const attemptAt = (sequence) => {
      const { sequence: resampled, grid } = resamplePose(sequence, config.canonical_rate_hz);
      const detectionRate =
        resampled.detected.reduce((a, b) => a + (b ? 1 : 0), 0) / Math.max(1, resampled.n);
      const verdict = { resampled, grid, detectionRate, ok: false, score: detectionRate - 1,
                        refusedBy: "detection" };
      if (detectionRate < thresholds.min_detection_rate) {
        verdict.reason =
          `a body was found in only ${Math.round(detectionRate * 100)} percent of frames, ` +
          `below the ${Math.round(thresholds.min_detection_rate * 100)} percent a swing needs`;
        verdict.advice =
          "Make sure the golfer is fully in shot for the whole clip and reasonably well lit. " +
          "Standing further back so the whole body fits beats filling the frame and losing the feet.";
        return verdict;
      }
      const model = (hand) => {
        const { features, n, width } = extractFeatures(resampled, hand, config);
        const logits = state.net.forward(features, n, width);
        const decoded = decodeEvents(logits, n, state.payload.architecture.classes,
                                     thresholds.min_mean_confidence,
                                     thresholds.min_core_confidence || 0);
        decoded.logits = logits;
        return decoded;
      };
      // Handedness only reaches a few of the model's inputs, so a first pass either
      // way finds the top well enough to ask the body which way round it is. When
      // the first pass finds nothing, the other way round gets its own chance.
      let handedness = state.handedness === "left" ? "left" : "right";
      let decoded = model(handedness);
      let handednessFrom = "chosen";
      if (state.handedness === "auto") {
        if (!decoded.ok) {
          const other = model("left");
          if (other.ok || (other.meanConfidence || 0) > (decoded.meanConfidence || 0)) {
            decoded = other;
            handedness = "left";
          }
        }
        handednessFrom = "assumed";
        if (decoded.ok) {
          const call = inferHandedness(resampled, decoded.frames[3]);
          if (call) {
            handednessFrom = "detected";
            verdict.handednessCall = call;
            if (call.hand !== handedness) {
              const again = model(call.hand);
              if (again.ok) { decoded = again; handedness = call.hand; }
            }
          }
        }
      }
      Object.assign(verdict, { decoded, handedness, handednessFrom, refusedBy: "events" });
      if (!decoded.ok) {
        verdict.score = decoded.meanConfidence || 0;
        verdict.reason = decoded.reason;
        verdict.advice =
          "This is most often a clip that stops before the finish, or one filmed from " +
          "behind the golfer where the body hides itself. Face on, square to the target " +
          "line, is what it handles best.";
        return verdict;
      }
      const metrics = computeMetrics(resampled, decoded, handedness, config);
      const problem = implausible(metrics, thresholds);
      verdict.metrics = metrics;
      if (problem) {
        verdict.score = 0.5 * decoded.meanConfidence;
        verdict.reason = problem;
        verdict.advice =
          "The clip probably does not contain a whole swing. Start recording before the " +
          "takeaway and keep going until the finish is held.";
        return verdict;
      }
      verdict.ok = true;
      verdict.refusedBy = null;
      verdict.score = 1 + decoded.meanConfidence;
      return verdict;
    };
    // A slow-motion export is refused at playback speed; read as if played 2, 4
    // or 8 times faster it is the same swing (see readAtSpeeds in metrics.js).
    const judge = (sequence) =>
      readAtSpeeds(sequence, attemptAt, thresholds.slow_motion_factors || [2, 4, 8],
                   slowMotionCheck(thresholds, config));

    // A short clip is tracked whole. A long one is scanned for the stretches that
    // look most like a swing, and each is tracked and put to the model in turn
    // until one is plainly a swing; the one the model is surest of is kept. The
    // fastest hands in a phone clip are not always the swing - walking up, a
    // waggle, reaching for the phone to stop recording - and only the model can
    // tell a swing from the rest.
    const read = async (frames, width, height) => {
      const tracker = makeTracker(width, height);
      let windows = [{ start: 0, end: duration }];
      if (duration > SCAN_ABOVE_S) {
        const found = await scanForSwing(duration, tracker, frames);
        if (found.length) windows = found;
        run.note({ windows: found.map((w) => [Number(w.start.toFixed(2)), Number(w.end.toFixed(2))]) });
        run.stage("scanned");
      }
      let best = null;
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        state.stretch = windows.length > 1 ? `stretch ${i + 1} of ${windows.length}` : "";
        const tracked = await trackRange(tracker, frames, w.start, w.end);
        const verdict = judge(tracked.sequence);
        const attempt = {
          start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)),
          frames: tracked.sequence.n,
          detection: Number(verdict.detectionRate.toFixed(3)),
          confidence: verdict.decoded && verdict.decoded.meanConfidence !== undefined
            ? Number(verdict.decoded.meanConfidence.toFixed(3)) : null,
          ok: verdict.ok,
        };
        state.diag.attempts.push(attempt);
        run.note({ attempts: state.diag.attempts });
        const candidate = { ...tracked, ...w, verdict };
        if (!best || verdict.score > best.verdict.score) best = candidate;
        if (verdict.ok && verdict.decoded.meanConfidence >= 0.5) break;
      }
      state.stretch = "";
      return best;
    };
    let tracked;
    if (media) {
      state.how = "decoded";
      try {
        tracked = await read(mp4Frames(media), media.width, media.height);
      } catch (error) {
        // A decoder that said yes and then failed - it happens with hardware
        // decoders on some phones. The video element may still manage it.
        run.note({ decodeError: String(error && error.message || error).slice(0, 200) });
        const opened = await openVideo(file, codec);
        video = opened.video;
        state.clip = { url: opened.url, video };
        state.how = null;
        state.diag = { attempts: [] };
        tracked = await read(elementFrames(video), video.videoWidth, video.videoHeight);
      }
    } else {
      tracked = await read(elementFrames(video), video.videoWidth, video.videoHeight);
    }
    const { sequence, images, start, end, verdict } = tracked;
    state.images = images;
    state.diag.sequence = sequence;
    state.diag.verdict = verdict;
    const how = state.how || "decoded";
    run.note({
      how,
      repairs: how === "played" ? state.playRepairs || 0 : undefined,
      window: [Number(start.toFixed(2)), Number(end.toFixed(2))],
      frames: sequence.n,
      trackedFps: Number((sequence.n / Math.max(end - start, 1e-3)).toFixed(1)),
      detection: Number(verdict.detectionRate.toFixed(3)),
    });
    if (verdict.handednessCall) {
      run.note({ handedness: verdict.handednessCall.hand,
                 handednessMargin: Number(verdict.handednessCall.margin.toFixed(3)) });
    }
    run.stage("tracked");
    progress(0.87);
    stage(2);
    status("Finding the swing", "");
    await new Promise((r) => setTimeout(r, 30));
    run.stage("modelled");
    state.handednessFrom = verdict.handednessFrom;
    if (!verdict.ok) {
      recordSwing({ ok: false, refusal: verdict.reason, detection_rate: verdict.detectionRate,
                    handedness: null, camera: null, metrics: null, slowed_by: null });
      return refuse(verdict.reason, verdict.advice);
    }
    const { resampled, grid, decoded, handedness, metrics, detectionRate, slowedBy, retimed } = verdict;
    if (slowedBy) run.note({ slowedBy });

    state.analysis = { sequence, resampled, grid, decoded, metrics, detectionRate,
                       handedness, config, model: decoded, userSet: new Set(),
                       slowedBy: slowedBy || null, retimed: retimed !== false };
    progress(0.92);
    stage(3);
    status("Drawing the key frames", "");
    await renderFrames(sequence, decoded, metrics, detectionRate);
    recordSwing(analysedRecord());
    run.end({
      outcome: "analysed",
      tempo: metrics.tempoRatio === null ? null : Number(metrics.tempoRatio.toFixed(3)),
      slowedBy: slowedBy || null,
      eventTimes: metrics.eventTimes.map((t) => Number(t.toFixed(3))),
      confidence: decoded.confidence.map((c) => Number(c.toFixed(3))),
    });
    progress(1);
    stage(4);
  } catch (error) {
    console.error(error);
    failed(error);
  } finally {
    state.busy = false;
    show("working", false);
  }
}

/* Let go of the previous clip's video. It is kept while its results are on screen,
 * because correcting a position means showing frames from it again. */
function releaseClip() {
  show("practice", false);
  el("bar-practice").hidden = true;
  show("read-section", false);
  state.readInsight = null;
  state.readNote = null;
  if (state.clip && state.clip.url) URL.revokeObjectURL(state.clip.url);
  state.clip = null;
  state.analysis = null;
  state.images = null;
  state.frames = null;
}

/* Which way round the golfer stands, from where the hands are at the top.
 *
 * At the top a right-hander's hands are above the right shoulder and a
 * left-hander's above the left. The estimator names left and right by anatomy,
 * not by side of the picture, so this holds from any camera position. It is the
 * rule the training data was labelled with, which on 48 clips of players whose
 * handedness is known was right 45 times. A few frames either side of the top are
 * averaged, because one frame through the fastest part of a swing is often a blur.
 * Nothing is returned when neither wrist can be seen there. */
function inferHandedness(sequence, top) {
  const square = sequence.squareXY();
  let left = 0, right = 0, seen = 0;
  for (let f = Math.max(0, top - 4); f <= Math.min(sequence.n - 1, top + 4); f++) {
    const v = sequence.visibility[f];
    if (Math.min(v[L.LEFT_WRIST], v[L.RIGHT_WRIST]) < 0.3) continue;
    const p = square[f];
    const hx = 0.5 * (p[L.LEFT_WRIST][0] + p[L.RIGHT_WRIST][0]);
    const hy = 0.5 * (p[L.LEFT_WRIST][1] + p[L.RIGHT_WRIST][1]);
    left += Math.hypot(hx - p[L.LEFT_SHOULDER][0], hy - p[L.LEFT_SHOULDER][1]);
    right += Math.hypot(hx - p[L.RIGHT_SHOULDER][0], hy - p[L.RIGHT_SHOULDER][1]);
    seen++;
  }
  if (!seen) return null;
  return { hand: right < left ? "right" : "left", margin: Math.abs(right - left) / Math.max(right + left, 1e-9) };
}

/* Say what happened, under a heading that matches what happened.
 *
 * The banner used to be headed "No swing was found in this clip" whatever it was
 * reporting, which is right for a clip the model declined and wrong - actively
 * misleading - for a video the browser could not open or an estimator that never
 * downloaded. Those are not the user's swing being rejected, they are the tool
 * failing, and telling someone their swing was not found when the real problem is
 * a codec sends them off to re-record for nothing.
 */
function refuse(reason, advice, title) {
  if (state.run) {
    state.run.end({
      outcome: title ? "error" : "refused",
      reason: String(reason).slice(0, 600),
      stage: el("status").textContent,
    });
  }
  show("results", false);
  show("refusal", true);
  el("refusal-title").textContent = title || "No swing was found in this clip";
  el("refusal-reason").textContent = reason;
  show("refusal-advice-line", Boolean(advice));
  el("refusal-advice").textContent = advice || "";
  // The note about a refusal being better than a wrong number is true of a clip
  // the model declined and false of the tool falling over, so it goes away for
  // the second kind.
  show("refusal-footnote", !title);
  show("refusal-diagnostics", Boolean(title));
  el("refusal-diagnostics").textContent = title ? diagnostics() : "";
  offerDiagnostics("refusal");
  // In a range session the golfer is watching the camera, not the results.
  if (!session.active) el("refusal").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* A failure of the tool rather than a judgement about the swing. */
function failed(error) {
  const message = (error && error.message) || String(error);
  refuse(message, "", "This could not be analysed");
}

/* One line describing this browser, shown whenever the tool itself fails.
 *
 * Because the last time this page failed, the whole report anybody could give was
 * "nothing happened" - which was accurate and left nothing to work with. What
 * decides most of these failures is which codecs the browser has and whether it
 * can step video frame by frame, and neither is something a person can be
 * expected to know. So the page says.
 */
function diagnostics() {
  const env = environment();
  const parts = [
    `frame callback: ${env.frameCallback ? "yes" : "no"}`,
    `file codec: ${state.codec || "unknown"}`,
    `h264: ${env.h264}`,
    `hevc: ${env.hevc}`,
    `webassembly: ${env.wasm}`,
    `webgl2: ${env.webgl2 ? "yes" : "no"}`,
    `stage: ${el("status").textContent}`,
    env.ua,
  ];
  return parts.join(" \u00b7 ");
}

/* The tracked frame nearest a time, which is what a key frame shows. */
function nearestFrame(sequence, time) {
  let best = 0, gap = Infinity;
  for (let i = 0; i < sequence.times.length; i++) {
    const d = Math.abs(sequence.times[i] - time);
    if (d < gap) { gap = d; best = i; }
  }
  return best;
}

/* A tracked frame, exactly as it was tracked, with its pose drawn on (unless
 * `pose` is false). */
async function frameCanvas(sequence, index, pose = true) {
  const blob = state.images && (await state.images[index]);
  const canvas = document.createElement("canvas");
  if (blob) {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    // Nothing stored (a browser that would not encode it): find it again.
    const time = sequence.times[index];
    const scaled = (w, h) => {
      const scale = Math.min(1, KEEP_LONG_SIDE / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
    };
    if (state.clip.media) {
      const media = state.clip.media;
      scaled(media.width, media.height);
      const context = canvas.getContext("2d");
      await decodeRange(media, {
        start: time - 0.004, end: time + 0.004,
        onFrame: (_t, frame, rotation) => drawOriented(context, frame, rotation, canvas.width, canvas.height),
      });
    } else {
      const video = state.clip.video;
      await seekTo(video, time);
      scaled(video.videoWidth, video.videoHeight);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  }
  if (pose) drawPose(canvas, sequence.xy[index], sequence.visibility[index]);
  return canvas;
}

/* Fetch back only the frames worth looking at. The clip was streamed and thrown
 * away as it was tracked, which is what lets it be any length; eight seeks are
 * cheap, and the video stays open so a position can be moved afterwards. */
async function renderFrames(sequence, decoded, metrics, detectionRate, quiet = false) {
  const strip = el("strip");
  strip.innerHTML = "";
  const frames = [];
  for (let e = 0; e < 8; e++) {
    const index = nearestFrame(sequence, metrics.eventTimes[e]);
    const canvas = await frameCanvas(sequence, index);
    frames.push({ canvas, label: EVENT_NAMES[e], time: metrics.eventTimes[e], index });

    const figure = document.createElement("figure");
    figure.className = "frame";
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", `${EVENT_NAMES[e]}, see full size`);
    const open = () => openFrame(e);
    figure.addEventListener("click", open);
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
    });
    const shrunk = document.createElement("canvas");
    const scale = Math.min(1, 420 / canvas.height);
    shrunk.width = Math.round(canvas.width * scale);
    shrunk.height = Math.round(canvas.height * scale);
    shrunk.getContext("2d").drawImage(canvas, 0, 0, shrunk.width, shrunk.height);
    figure.appendChild(shrunk);

    const caption = document.createElement("figcaption");
    // A position the user set is theirs: the model's band and confidence were
    // about the model's frame, and say nothing about this one.
    const mine = state.analysis && state.analysis.userSet.has(e);
    caption.innerHTML =
      `<span class="frame-label">${EVENT_NAMES[e]}${CLUB_DEFINED.has(e) ? '<span class="ast">*</span>' : ""}</span>` +
      `<span class="frame-time">${metrics.eventTimes[e].toFixed(3)} s</span>` +
      (mine
        ? `<span class="prov prov-set_by_you">set by you</span>`
        : (metrics.slowedBy ? "" : bandMarkup(state.payload.calibration, e, decoded.confidence[e])) +
          `<span class="conf"><i style="width:${(decoded.confidence[e] * 100).toFixed(0)}%"></i></span>`);
    figure.appendChild(caption);
    strip.appendChild(figure);
    if (!quiet) progress(0.92 + 0.08 * ((e + 1) / 8));
  }
  state.frames = frames;
  renderScrubber();

  showBandNote(state.payload.calibration, decoded);
  showMetrics(metrics, decoded, detectionRate, sequence);
  renderStory(metrics);
  renderSummaryCard(metrics);
  renderStemRead();
  if (!quiet) offerDiagnostics("results");
  show("results", true);
  if (!quiet && !session.active) el("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* The card at the top of the results (#37): the swing at impact, the tempo with
 * its measured spread, and the practice priority. Every value here is also in the
 * sections below, with the same provenance; this only puts the one thing to work
 * on first, so a phone does not have to scroll past everything to find it. */
function renderSummaryCard(m) {
  const shot = el("sum-shot");
  shot.innerHTML = "";
  const impact = state.frames && state.frames[5];
  if (impact) {
    const small = document.createElement("canvas");
    const scale = Math.min(1, 320 / impact.canvas.height);
    small.width = Math.round(impact.canvas.width * scale);
    small.height = Math.round(impact.canvas.height * scale);
    small.getContext("2d").drawImage(impact.canvas, 0, 0, small.width, small.height);
    small.setAttribute("aria-label", `The swing at impact, ${impact.time.toFixed(3)} s`);
    shot.appendChild(small);
  }
  el("sum-tempo").textContent = m.tempoRatio.toFixed(2);
  const band = state.payload.calibration && state.payload.calibration.tempo;
  const range = el("sum-range");
  const byHand = tempoSetByHand();
  range.title = "";
  if (byHand) {
    range.textContent = `backswing ÷ downswing · ${byHand}`;
  } else if (band) {
    const spread = Math.abs(m.tempoRatio) * band.half_width_fraction;
    range.title = `+/-${Math.round(100 * band.half_width_fraction)}% for ` +
      `${Math.round(100 * band.coverage)}% of ${band.n_calibration} held-out swings on ` +
      band.measured_on;
    range.textContent = `measured spread ${(m.tempoRatio - spread).toFixed(2)} – ` +
      `${(m.tempoRatio + spread).toFixed(2)} · backswing ÷ downswing` +
      (m.slowedBy ? ", assuming the whole swing was slowed evenly" : "");
  } else {
    range.textContent = "backswing ÷ downswing";
  }
  // The left-handed note is about the band, so it goes with it.
  const caveat = leftHandedCaveat(state.payload, state.analysis && state.analysis.handedness);
  if (caveat && !byHand) range.textContent += ` · ${caveat}`;
  el("again-record").hidden = el("record").hidden;
  el("share-card").hidden = true;
  summaryPriority(null);
}

/* The practice priority, in short, on the summary card; the whole of it, with its
 * evidence and what it cannot tell, stays in the practice section. */
function summaryPriority(insight, swingId) {
  show("sum-priority", Boolean(insight));
  if (!insight) return;
  el("sum-priority-title").textContent = insight.title;
  el("sum-drill").textContent = (insight.drill ? `Drill: ${insight.drill.title}. ` : "") +
    `Priority after swing ${swingId} · confidence: ${insight.confidence}.`;
}

/* The detail sections fold on a phone and open on a wide screen, unless the
 * golfer has opened or closed one, which this browser then remembers. */
const FOLDS_KEY = "swing-folds-v1";
function wireFolds() {
  let saved = {};
  try { saved = JSON.parse(browserStorage().getItem(FOLDS_KEY) || "{}") || {}; } catch (error) { saved = {}; }
  const wide = window.matchMedia ? window.matchMedia("(min-width: 721px)").matches : true;
  for (const fold of document.querySelectorAll("details.fold")) {
    const name = fold.dataset.fold;
    fold.open = typeof saved[name] === "boolean" ? saved[name] : wide;
    fold.addEventListener("toggle", () => {
      saved[name] = fold.open;
      try { browserStorage().setItem(FOLDS_KEY, JSON.stringify(saved)); } catch (error) { /* not kept */ }
    });
  }
}

/* An event's measured error band, or nothing at all where none was measured.
 * Never a zero: a missing band and a band of zero mean opposite things. */
function bandMarkup(calibration, event, confidence) {
  const band = errorBand(calibration, event, confidence);
  if (!band) return "";
  const title = `+/-${band.frames.toFixed(1)} frames (${band.ms.toFixed(0)} ms) for ` +
    `${Math.round(band.coverage * 100)}% of ${band.n} held-out events on ${band.measuredOn}`;
  return `<span class="frame-band" title="${title}">&plusmn;${band.ms.toFixed(0)} ms</span>`;
}


/* Where the bands came from, said once beneath the strip rather than eight times.
 * Hidden entirely when no table was measured, so the page never implies one. */
function showBandNote(calibration, decoded) {
  const note = el("band-note");
  let band = null;
  for (let e = 0; e < 8 && !band; e++) band = errorBand(calibration, e, decoded.confidence[e]);
  show("band-note", Boolean(band));
  if (!band) return;
  const how = bandsVaryWithConfidence(calibration)
    ? ` at the confidence the model reported here, so a doubtful event gets a wider ` +
      `band than a certain one. A band appears only where enough held-out clips ` +
      `landed at that confidence to measure one.`
    : `. There is one band per event, measured on ${band.n} clips, so every swing ` +
      `gets the same band: it does not widen when the model is doubtful or narrow ` +
      `when it is sure.`;
  note.innerHTML =
    `The &plusmn; figures are measured, not assumed. This model was run over ` +
    `${band.measuredOn}, and the spread of its errors recorded. Each figure is the ` +
    `distance that contained ${Math.round(band.coverage * 100)}% of those errors${how} ` +
    `None of this is a claim about footage of a real golfer on grass.`;
}


const card = (label, value, unit, note, provenance, range) => `
  <div class="metric">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit">${unit || ""}</span></div>
    ${range || ""}
    <div class="metric-foot"><span class="prov prov-${provenance}">${provenance.replace("_", " ")}</span>
      ${note ? `<span class="metric-hint">${note}</span>` : ""}</div>
  </div>`;

/* Address, top or impact the golfer placed by hand (#50). The tempo is then
 * measured from their frames, and the model's band, which describes where the
 * model puts positions, says nothing about it. The desktop's wording (swing.html). */
function tempoSetByHand() {
  const set = state.analysis ? state.analysis.userSet : new Set();
  const names = [0, 3, 5].filter((e) => set.has(e)).map((e) => EVENT_NAMES[e]);
  return names.length ? `${names.join(", ")} set by you: measured from your frames; the model's ` +
    "error bands describe the model, so they are not shown" : "";
}

/* The measured spread on the tempo ratio, or nothing where none was measured.
 * Never a range of zero: absent and exact are not the same statement. */
function tempoRange(calibration, tempo, caveat) {
  const byHand = tempoSetByHand();
  if (byHand) return `<div class="metric-caveat">${byHand}.</div>`;
  const band = calibration && calibration.tempo;
  if (!band) return "";
  const spread = Math.abs(tempo) * band.half_width_fraction;
  const note = `+/-${Math.round(100 * band.half_width_fraction)}% for ` +
    `${Math.round(100 * band.coverage)}% of ${band.n_calibration} held-out swings on ` +
    band.measured_on;
  return `<div class="metric-range" title="${note}">measured spread ` +
    `${(tempo - spread).toFixed(2)} &ndash; ${(tempo + spread).toFixed(2)}</div>` +
    (caveat ? `<div class="metric-caveat">${caveat}</div>` : "");
}

/* The band was measured on mostly right-handed swings (#33); the payload carries
 * the wording so every app says the same thing. */
function leftHandedCaveat(payload, handedness) {
  return handedness === "left" && payload.notes ? payload.notes.left_handed_tempo_band : "";
}

/* The swing in order: a timeline to scale, then each part in words.
 *
 * Every sentence is assembled from a number already on the page and says how
 * that number was obtained. Nothing is inferred beyond it - no "you should", no
 * diagnosis - because the measurements do not support one, and a story that
 * reads well while claiming more than was measured is the fault this project
 * exists to avoid.
 */
function renderStory(m) {
  const t = m.eventTimes;
  const start = t[0], span = Math.max(t[7] - t[0], 1e-6);
  const W = 720, H = 132, left = 14, right = 14, y = 64;
  const x = (time) => left + ((time - start) / span) * (W - left - right);
  const seg = (a, b, color) =>
    `<rect x="${x(a).toFixed(1)}" y="${y - 7}" width="${Math.max(1, x(b) - x(a)).toFixed(1)}" ` +
    `height="14" rx="3" fill="${color}"></rect>`;
  const ticks = EVENT_NAMES.map((name, e) => {
    const above = e % 2 === 0;
    const key = e === 0 || e === 3 || e === 5 || e === 7;
    const tx = x(t[e]);
    const anchor = e === 0 ? "start" : e === 7 ? "end" : "middle";
    return `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${above ? y - 20 : y + 8}" ` +
      `y2="${above ? y - 8 : y + 20}" stroke="var(--ink-faint)" stroke-width="1"></line>` +
      `<text x="${tx.toFixed(1)}" y="${above ? y - 26 : y + 34}" text-anchor="${anchor}" ` +
      `class="${key ? "t-strong" : ""}">${name}</text>` +
      `<text x="${tx.toFixed(1)}" y="${above ? y - 40 : y + 48}" text-anchor="${anchor}" ` +
      `class="t-time">${(t[e] - start).toFixed(2)}s</text>`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of the swing from ` +
    `address to finish">${seg(t[0], t[3], "var(--back)")}${seg(t[3], t[5], "var(--down)")}` +
    `${seg(t[5], t[7], "var(--follow)")}${ticks}</svg>`;

  const s = (ms) => (ms / 1000).toFixed(2);
  const ratio = m.tempoRatio;
  const tempoNote = ratio === null ? "" :
    ratio >= 2.7 && ratio <= 3.3 ? "which sits in the band tour players are usually quoted at, near 3 to 1" :
    ratio > 3.3 ? "a longer backswing relative to the downswing than the 3 to 1 tour players are usually quoted at" :
    "a quicker backswing relative to the downswing than the 3 to 1 tour players are usually quoted at";
  const beats = [];
  if (m.slowedBy) {
    // Only the ratio survives a guessed playback speed; say so rather than
    // printing durations measured against a clock the clip does not have.
    beats.push(["Address to impact",
      (m.slowedRetimed === false
        ? `This clip reads more confidently as slow motion, played about ` +
          `<b>${m.slowedBy.toFixed(0)} times</b> slower than it happened, than at the speed it was ` +
          `recorded, so no durations are `
        : `This clip only reads as a swing when treated as slow motion, played about ` +
          `<b>${m.slowedBy.toFixed(0)} times</b> slower than it happened, so no durations are `) +
      `given. Backswing over downswing gives a tempo of ` +
      `<b>${ratio === null ? "no reading" : ratio.toFixed(2) + " : 1"}</b>, which assumes the ` +
      `whole swing was slowed evenly; a phone's slow motion ramps speed at its ends.`,
      "derived"]);
  } else {
    beats.push(["Address to the top",
      `The backswing took <b>${s(m.backswingMs)} s</b>, from the last still frame at address ` +
      `to the instant the hands changed direction.`, "measured"]);
    beats.push(["The top to impact",
      `The downswing took <b>${s(m.downswingMs)} s</b>. Backswing over downswing gives a tempo of ` +
      `<b>${ratio === null ? "no reading" : ratio.toFixed(2) + " : 1"}</b>` +
      `${tempoNote ? ", " + tempoNote : ""}.`, "derived"]);
    const peak = Math.round(m.peakHandSpeedMs);
    beats.push(["Speed through the ball",
      peak === 0
        ? `The hands were moving fastest in the impact frame itself.`
        : `The hands were moving fastest <b>${Math.abs(peak)} ms ${peak < 0 ? "before" : "after"}</b> ` +
          `impact. At 30 frames a second one frame is 33 ms, so read this to the nearest frame.`,
      "measured"]);
  }
  if (m.shoulderTurnDeg !== null && m.hipTurnDeg !== null) {
    beats.push(["The turn at the top",
      `Shoulders turned <b>${m.shoulderTurnDeg.toFixed(0)}&deg;</b> and hips ` +
      `<b>${m.hipTurnDeg.toFixed(0)}&deg;</b> away from square to the camera, a separation of ` +
      `<b>${(m.shoulderTurnDeg - m.hipTurnDeg).toFixed(0)}&deg;</b>. These come from how much ` +
      `each line foreshortens, read low against reality, and compare best with other clips ` +
      `filmed from the same spot.`, "projected"]);
  }
  if (m.feetInShot) {
    beats.push(["Staying centred",
      `From address to impact the head moved <b>${m.headMovement.toFixed(3)}</b> body lengths ` +
      `and the pelvis swayed <b>${m.pelvisSway.toFixed(3)}</b>, measured against the feet.`,
      "projected"]);
  }
  beats.push(["Impact to the finish",
    `The finish is marked on the timeline, but not timed: on real swings the model places ` +
    `it about half a second from where a person would, so no follow-through or ` +
    `whole-swing duration is given.`, "refused"]);

  el("story").innerHTML =
    `<div class="phase-key"><span><i style="background:var(--back)"></i>Backswing</span>` +
    `<span><i style="background:var(--down)"></i>Downswing</span>` +
    `<span><i style="background:var(--follow)"></i>Follow-through</span></div>` +
    `<div class="timeline">${svg}</div>` +
    `<ol class="beats">${beats.map(([h, body, prov]) =>
      `<li><div><h3>${h}<span class="prov prov-${prov}">${prov}</span></h3><p>${body}</p></div></li>`
    ).join("")}</ol>`;
}

function showMetrics(m, decoded, detectionRate, sequence) {
  el("summary").textContent =
    `${sequence.width}×${sequence.height}, ${sequence.n} frames, ` +
    `body found in ${Math.round(detectionRate * 100)}% of them \u00b7 ` +
    `${state.analysis ? state.analysis.handedness : state.handedness}-handed ` +
    `(${{ detected: "detected", chosen: "as you set it", assumed: "assumed: hands not seen at the top" }[state.handednessFrom] || "as you set it"})` +
    (state.how === "stepped"
      ? " \u00b7 read by seeking, because this browser has no frame callback"
      : "") +
    (state.analysis && state.analysis.userSet.size
      ? ` \u00b7 positions set by you: ${[...state.analysis.userSet].sort().map((e) => EVENT_NAMES[e]).join(", ")}`
      : "");

  // A duration read at a guessed playback speed is refused, never shown as 0.
  const slowNote = "slow motion: how much slower cannot be known from the video";
  const duration = (label, ms, note) => ms === null
    ? card(label, "no reading", "", slowNote, "refused")
    : card(label, Math.round(ms), "ms", note, "measured");
  if (m.slowedBy) {
    el("summary").textContent +=
      (m.slowedRetimed === false
        ? ` · may be slow motion played about ${m.slowedBy.toFixed(0)} times slower: durations withheld`
        : ` · read as slow motion played about ${m.slowedBy.toFixed(0)} times slower`);
  }
  el("tempo-cards").innerHTML =
    card("Tempo ratio", m.tempoRatio.toFixed(2), "",
         m.slowedBy ? "backswing ÷ downswing; assumes the whole swing was slowed evenly"
                    : "backswing ÷ downswing", "derived",
         tempoRange(state.payload.calibration, m.tempoRatio,
                    leftHandedCaveat(state.payload, state.analysis && state.analysis.handedness))) +
    duration("Backswing", m.backswingMs, "address → top") +
    duration("Downswing", m.downswingMs, "top → impact") +
    card("Whole swing", "no reading", "", "the finish cannot be placed reliably from one camera", "refused") +
    duration("Peak hand speed", m.peakHandSpeedMs, "relative to impact; negative is before");

  el("turn-cards").innerHTML =
    (m.shoulderTurnDeg === null
      ? card("Shoulder turn", "no reading", "", "the shoulders were never seen clearly enough", "projected")
      : card("Shoulder turn", m.shoulderTurnDeg.toFixed(1), "deg", "from foreshortening", "projected")) +
    (m.hipTurnDeg === null
      ? card("Hip turn", "no reading", "", "the hips were never seen clearly enough", "projected")
      : card("Hip turn", m.hipTurnDeg.toFixed(1), "deg", "from foreshortening", "projected"));

  el("stability-cards").innerHTML = m.feetInShot
    ? card("Head movement", m.headMovement.toFixed(3), "body lengths", "address → impact", "projected") +
      card("Pelvis sway", m.pelvisSway.toFixed(3), "body lengths", "side to side", "projected") +
      card("Pelvis lift", m.pelvisLift.toFixed(3), "body lengths", "up and down", "projected")
    : `<p class="empty">The feet were not in shot, so movement cannot be measured against
       the ground. Stand further back and the whole body will fit.</p>`;

  state.last = { metrics: m, decoded };
  const extra = state.analysis && state.analysis.userSet.size
    ? { set_by_user: [...state.analysis.userSet].sort().map((e) => EVENT_NAMES[e]),
        model_events: state.analysis.model }
    : {};
  const text = JSON.stringify({ metrics: m, events: decoded, ...extra }, null, 2);
  if (LOCAL && LOCAL.copyInsteadOfDownload) {
    // A plain download link does nothing where this build is served. The viewer
    // saves files for the page when asked through its own prompt; where it
    // cannot, the numbers go to the clipboard instead - and say so, rather than
    // looking like nothing happened.
    const button = el("download");
    const label = "Save the numbers as JSON";
    const say = (text) => {
      button.textContent = text;
      setTimeout(() => { button.textContent = label; }, 2500);
    };
    button.textContent = label;
    button.onclick = async () => {
      const claude = window.claude;
      const downloads = claude && typeof claude.use === "function"
        ? await claude.use("downloads").catch(() => null) : null;
      if (downloads) {
        try {
          await downloads.save({ filename: "swing.json", data: text });
          say("Saved");
          return;
        } catch (error) {
          const code = error && error.code;
          if (code === "declined") { say("Not saved"); return; }
          if (code === "rate_limited") { say("A save is already open"); return; }
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        say("Copied to the clipboard instead");
      } catch {
        say("This browser refused both saving and copying");
      }
    };
    return;
  }
  el("download").onclick = () => {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "swing.json";
    a.click();
  };
}

/* Step through the swing (#58): any tracked frame, with the skeleton, the
 * shoulder, hip and spine lines and a head box held where the head was at address
 * (overlay.js). Frames come from what was kept while tracking, as the lightbox's
 * do. A slow-motion clip plays back at the speed the swing happened. */
const scrub = { index: 0, analysis: null, timer: null, ticket: 0,
                show: { skeleton: true, shoulders: true, hips: true, spine: true, head: true } };
const SCRUB_COLOURS = { shoulders: "#ffb84d", hips: "#5ad19a", spine: "#f48fb1", head: "#ffffff" };

function renderScrubber() {
  const analysis = state.analysis;
  if (!analysis || !state.frames || !analysis.sequence) return;
  const n = analysis.sequence.n;
  el("scrub-slider").max = String(n - 1);
  el("scrub-jumps").innerHTML = state.frames.map((f, e) =>
    `<button class="btn" type="button" data-jump="${e}">${escapeHtml(f.label)}</button>`).join("");
  if (scrub.analysis !== analysis) {
    stopScrub();
    scrub.analysis = analysis;
    scrub.index = state.frames[0].index;
  }
  el("scrubber").hidden = false;
  // Drawn when it can be seen, and never during a range session, whose queue of
  // clips should not wait on a frame nobody is looking at.
  if (el("scrubber").open && !session.active) scrubTo(scrub.index);
}

function scrubFaceOn(sequence) {
  const rules = state.payload.practice;
  const camera = cameraSignature(sequence, state.frames[0].index);
  if (!camera || !Number.isFinite(camera.shoulder_ratio) || !rules) return null;
  return camera.shoulder_ratio >= rules.face_on_min_shoulder_ratio;
}

async function scrubTo(index) {
  const analysis = state.analysis;
  if (!analysis || !state.frames) return;
  const sequence = analysis.sequence;
  const n = sequence.n;
  const i = Math.max(0, Math.min(n - 1, Math.round(index)));
  scrub.index = i;
  el("scrub-slider").value = String(i);
  const ticket = ++scrub.ticket;
  const canvas = await frameCanvas(sequence, i, scrub.show.skeleton);
  if (ticket !== scrub.ticket) return;
  const g = canvas.getContext("2d");
  const lines = frameLines(sequence.xy[i], sequence.visibility[i], canvas.width, canvas.height);
  const thick = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 200));
  const px = ([x, y]) => [x * canvas.width, y * canvas.height];
  for (const key of ["shoulders", "hips", "spine"]) {
    const line = lines[key];
    if (!scrub.show[key] || !line) continue;
    // Drawn past both ends so the angle is easy to see against the body.
    const [ax, ay] = px(line.a), [bx, by] = px(line.b);
    const dx = (bx - ax) * 0.35, dy = (by - ay) * 0.35;
    for (const [colour, width] of [["rgba(0,0,0,0.75)", thick + 3], [SCRUB_COLOURS[key], thick]]) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.lineCap = "round";
      g.beginPath(); g.moveTo(ax - dx, ay - dy); g.lineTo(bx + dx, by + dy); g.stroke();
    }
  }
  const address = state.frames[0].index;
  const box = headBox(sequence.xy[address], sequence.visibility[address]);
  const inside = headInside(box, sequence.xy[i], sequence.visibility[i]);
  if (scrub.show.head && box) {
    g.setLineDash([thick * 3, thick * 2]);
    for (const [colour, width] of [["rgba(0,0,0,0.75)", thick + 3],
                                   [inside === false ? "#ffb84d" : SCRUB_COLOURS.head, thick]]) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.strokeRect(box.x * canvas.width, box.y * canvas.height, box.width * canvas.width, box.height * canvas.height);
    }
    g.setLineDash([]);
  }
  canvas.dataset.frame = String(i);
  el("scrub-canvas").replaceChildren(canvas);

  const time = sequence.times[i];
  const at = state.frames.findIndex((f) => f.index === i);
  const real = analysis.slowedBy && analysis.retimed !== false
    ? ` \u00b7 about ${(time / analysis.slowedBy).toFixed(3)} s as the swing happened` : "";
  el("scrub-time").textContent = `Frame ${i + 1} of ${n} \u00b7 ${time.toFixed(3)} s in the clip${real}` +
    (at >= 0 ? ` \u00b7 ${state.frames[at].label}` : "");
  for (const button of el("scrub-jumps").querySelectorAll("[data-jump]")) {
    button.setAttribute("aria-current", String(Number(button.dataset.jump) === at));
  }
  const labels = lineLabels(lines, scrubFaceOn(sequence));
  const rows = ["shoulders", "hips", "spine"].filter((k) => scrub.show[k] && labels[k]).map((k) =>
    [k, labels[k].replace(/, in the picture$/, "")]);
  if (scrub.show.head && inside !== null) {
    rows.push(["head", inside ? "Head inside its address box" : "Head outside its address box"]);
  }
  el("scrub-angles").innerHTML = rows.map(([k, text]) =>
    `<li data-line="${k}"><span style="color:${SCRUB_COLOURS[k] === "#ffffff" ? "inherit" : SCRUB_COLOURS[k]}">` +
    `&#9632;</span>${escapeHtml(text)}<span class="prov prov-projected">in the picture</span></li>`).join("");
}

function stopScrub() {
  if (scrub.timer) clearInterval(scrub.timer);
  scrub.timer = null;
  el("scrub-play").textContent = "Play";
}

function playScrub() {
  const analysis = state.analysis;
  if (!analysis) return;
  const sequence = analysis.sequence;
  const n = sequence.n;
  if (scrub.index >= n - 1) scrub.index = 0;
  // A slow-motion clip's frames are further apart than the swing's were.
  const slowed = analysis.slowedBy && analysis.retimed !== false ? analysis.slowedBy : 1;
  const speed = Number(el("scrub-speed").value) * slowed;
  const from = sequence.times[scrub.index], started = performance.now();
  el("scrub-play").textContent = "Pause";
  scrub.timer = setInterval(() => {
    const target = from + ((performance.now() - started) / 1000) * speed;
    let i = scrub.index;
    while (i < n - 1 && sequence.times[i + 1] <= target) i++;
    if (i !== scrub.index) scrubTo(i);
    if (i >= n - 1) stopScrub();
  }, 40);
}

function wireScrubber() {
  el("scrubber").addEventListener("toggle", () => {
    if (el("scrubber").open && !session.active && state.frames) scrubTo(scrub.index);
  });
  el("scrub-slider").addEventListener("input", (event) => { stopScrub(); scrubTo(Number(event.target.value)); });
  el("scrub-back").addEventListener("click", () => { stopScrub(); scrubTo(scrub.index - 1); });
  el("scrub-next").addEventListener("click", () => { stopScrub(); scrubTo(scrub.index + 1); });
  el("scrub-jumps").addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump]");
    if (!button || !state.frames) return;
    stopScrub();
    scrubTo(state.frames[Number(button.dataset.jump)].index);
  });
  el("scrub-play").addEventListener("click", () => (scrub.timer ? stopScrub() : playScrub()));
  el("scrub-speed").addEventListener("change", () => { if (scrub.timer) { stopScrub(); playScrub(); } });
  for (const box of document.querySelectorAll("[data-show]")) {
    box.addEventListener("change", () => { scrub.show[box.dataset.show] = box.checked; scrubTo(scrub.index); });
  }
}

/* One position, full size, with the arrow keys to walk the swing.
 *
 * Eight frames across a laptop makes each about the size of a stamp - enough to
 * check the model picked the right instant, not enough to look at a swing. The
 * canvases are already drawn at the video's own resolution, so this only has to
 * put one on screen.
 */
function openFrame(index) {
  const frames = state.frames || [];
  if (!frames.length) return;
  state.frameIndex = ((index % frames.length) + frames.length) % frames.length;
  state.lbFrame = frames[state.frameIndex].index;
  showLightboxFrame();
  show("lightbox", true);
  el("lb-close").focus();
}

/* Draw whichever tracked frame the lightbox is on, and say how it relates to the
 * position being looked at. Frames are drawn from what was kept while tracking,
 * so stepping never goes back to the video. */
let lightboxDraw = 0;
async function showLightboxFrame() {
  const analysis = state.analysis;
  const item = state.frames[state.frameIndex];
  const e = state.frameIndex;
  const index = state.lbFrame;
  const onPosition = index === item.index;
  const ticket = ++lightboxDraw;
  const canvas = onPosition ? item.canvas : await frameCanvas(analysis.sequence, index);
  if (ticket !== lightboxDraw) return;
  const holder = el("lb-canvas");
  holder.innerHTML = "";
  holder.appendChild(canvas);
  const time = analysis.sequence.times[index];
  const steps = index - item.index;
  el("lb-label").textContent = item.label;
  el("lb-time").textContent = `${time.toFixed(3)} s` +
    (onPosition ? "" : ` \u00b7 ${steps > 0 ? "+" : ""}${steps} frame${Math.abs(steps) === 1 ? "" : "s"}`);
  el("lb-use").textContent = `Use this frame for ${item.label}`;
  el("lb-use").disabled = onPosition;
  el("lb-reset").hidden = !analysis.userSet.has(e);
  el("lb-note").textContent = analysis.userSet.has(e)
    ? "You set this position. Every number and the story use it."
    : "Not the right moment? Step to the frame where it happens and use that one.";
}

function stepFrame(delta) {
  if (el("lightbox").hidden || !state.analysis) return;
  const n = state.analysis.sequence.n;
  state.lbFrame = Math.max(0, Math.min(n - 1, state.lbFrame + delta));
  showLightboxFrame();
}

/* Put position e at a clip time and recompute everything that depends on it.
 * Returns why not, when the time would put the positions out of order. */
async function setPosition(e, time) {
  const analysis = state.analysis;
  const { resampled, grid, sequence } = analysis;
  const rate = analysis.config.canonical_rate_hz;
  // A slow-motion read lives on the sped-up timeline; the clip time goes onto it.
  const onGrid = analysis.slowedBy && analysis.retimed ? time / analysis.slowedBy : time;
  const position = Math.max(0, Math.min(resampled.n - 1, (onGrid - grid[0]) * rate));
  const decoded = analysis.decoded;
  for (let other = 0; other < 8; other++) {
    if (other < e && decoded.subframe[other] >= position) {
      return `That is not after ${EVENT_NAMES[other]}. Move ${EVENT_NAMES[other]} first, or pick a later frame.`;
    }
    if (other > e && decoded.subframe[other] <= position) {
      return `That is not before ${EVENT_NAMES[other]}. Move ${EVENT_NAMES[other]} first, or pick an earlier frame.`;
    }
  }
  const next = {
    ...decoded,
    frames: decoded.frames.slice(),
    subframe: decoded.subframe.slice(),
  };
  next.frames[e] = Math.round(position);
  next.subframe[e] = position;
  return apply(next, e);
}

async function apply(next, e) {
  const analysis = state.analysis;
  analysis.decoded = next;
  const measure = (events) => {
    const m = computeMetrics(analysis.resampled, events, analysis.handedness, analysis.config);
    return analysis.slowedBy ? slowedMetrics(m, analysis.slowedBy, analysis.retimed) : m;
  };
  analysis.metrics = measure(next);
  const byModel = measure(analysis.model);
  // How far off the model was, kept with the run report: the only measure there
  // is of how it does on footage like this person's.
  if (state.run) {
    state.run.body.corrections = state.run.body.corrections || {};
    state.run.body.corrections[EVENT_NAMES[e]] = analysis.userSet.has(e)
      ? Math.round(1000 * (analysis.metrics.eventTimes[e] - byModel.eventTimes[e]))
      : null;
    saveRun(state.run);
  }
  await renderFrames(analysis.sequence, next, analysis.metrics, analysis.detectionRate, true);
  // A position moved by hand changes the numbers kept for the practice loop too.
  if (analysis.logId && state.log) {
    state.log.update(analysis.logId, analysedRecord());
    renderPractice(analysis.logId);
  }
  return null;
}

async function useLightboxFrame() {
  const e = state.frameIndex;
  const time = state.analysis.sequence.times[state.lbFrame];
  const wasSet = state.analysis.userSet.has(e);
  state.analysis.userSet.add(e);
  const problem = await setPosition(e, time);
  if (problem) {
    if (!wasSet) state.analysis.userSet.delete(e);
    el("lb-note").textContent = problem;
    return;
  }
  openFrame(e);
}

async function resetLightboxPosition() {
  const analysis = state.analysis;
  const e = state.frameIndex;
  analysis.userSet.delete(e);
  const next = { ...analysis.decoded, frames: analysis.decoded.frames.slice(),
                 subframe: analysis.decoded.subframe.slice() };
  next.frames[e] = analysis.model.frames[e];
  next.subframe[e] = analysis.model.subframe[e];
  // The model's frame may now sit out of order with one the user moved.
  for (let other = 0; other < 8; other++) {
    if ((other < e && next.subframe[other] >= next.subframe[e]) ||
        (other > e && next.subframe[other] <= next.subframe[e])) {
      analysis.userSet.add(e);
      el("lb-note").textContent =
        `The model's frame for this is out of order with ${EVENT_NAMES[other]}, which you moved. Put that back first.`;
      return;
    }
  }
  await apply(next, e);
  openFrame(e);
}

function closeFrame() {
  show("lightbox", false);
  el("lb-canvas").innerHTML = "";
}

function wireLightbox() {
  el("lb-close").onclick = closeFrame;
  el("lb-prev").onclick = () => openFrame(state.frameIndex - 1);
  el("lb-next").onclick = () => openFrame(state.frameIndex + 1);
  el("lb-back").onclick = () => stepFrame(-1);
  el("lb-fwd").onclick = () => stepFrame(1);
  el("lb-use").onclick = () => useLightboxFrame();
  el("lb-reset").onclick = () => resetLightboxPosition();
  el("lightbox").addEventListener("click", (event) => {
    if (event.target === el("lightbox")) closeFrame();
  });
  document.addEventListener("keydown", (event) => {
    if (el("lightbox").hidden) return;
    if (event.key === "Escape") closeFrame();
    if (event.key === "ArrowLeft") openFrame(state.frameIndex - 1);
    if (event.key === "ArrowRight") openFrame(state.frameIndex + 1);
    if (event.key === ",") stepFrame(-1);
    if (event.key === ".") stepFrame(1);
  });
}


/* ---- The practice loop: one priority, one drill, a retest, a verdict. ----
 *
 * The rules are in practice.js, held to the desktop's by tests. What is kept is
 * the numbers of each clip, in this browser's own storage, never the clip. */

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function browserStorage() {
  // Reading localStorage throws where site data is blocked; the page still works.
  try { return window.localStorage; } catch (error) { return null; }
}

function analysedRecord() {
  const a = state.analysis;
  const address = nearestFrame(a.sequence, a.metrics.eventTimes[0]);
  return {
    ok: true, refusal: null, detection_rate: a.detectionRate, handedness: a.handedness,
    camera: cameraSignature(a.sequence, address),
    metrics: storedMetrics(a.metrics, a.detectionRate),
    slowed_by: a.slowedBy || null,
    positions_set_by_you: a.userSet.size,
  };
}

function recordSwing(record) {
  state.lastRecord = record;
  if (!state.log) return;
  if (state.fromSample) {
    // A demonstration, not the golfer's swing: show their own log unchanged.
    renderPractice(state.practiceSwing || null, "The sample swing is not kept in your practice log.");
    return;
  }
  const club = el("club").value.trim().slice(0, 40) || null;
  const forPlan = Boolean(state.log.activePlan()) && el("for-plan").checked;
  const file = state.file;
  const key = file ? clipKey(file.name, file.size, file.lastModified) : null;
  const swing = state.log.add({ ...record, club, clip_key: key }, forPlan);
  if (record.ok && state.analysis) state.analysis.logId = swing.id;
  if (!record.ok && swing.ok) {
    renderPractice(swing.id, `This run was refused, so swing ${swing.id} keeps its earlier ` +
      `reading of the same clip (tempo ${reading(swing.metrics && swing.metrics.tempo_ratio)}).`);
    return;
  }
  renderPractice(swing.id, swing.reread_at ? `The same clip was analysed before, so swing ${swing.id} ` +
    "was replaced by this reading rather than kept twice." : "");
}

const VERDICT_TITLES = {
  improved: "Yes: it moved the way the drill aims",
  worsened: "It moved, the opposite way to the drill",
  no_detectable_change: "No change the swings can show yet",
  not_comparable: "These swings cannot be compared",
  not_enough_swings: "Not enough swings to tell yet",
};

const METRIC_NAMES = {
  tempo_ratio: "tempo", head_movement: "head movement", pelvis_sway: "pelvis sway",
  shoulder_turn_foreshortened: "shoulder turn", detection_rate: "body found",
};

const signed = (x) => (x >= 0 ? "+" : "") + formatG3(x);
const reading = (x) => (x === null || x === undefined ? "no reading"
  : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3));

/* A drill shown as well as told (#57): its figure from drills.js beside the steps,
 * and a rep counter for its sets with an optional pace timer. The count is kept
 * for this visit only. */
const repCounts = new Map();
const PACES = [0, 8, 12, 20];

function drillMarkup(drill) {
  const poses = state.payload.practice.drill_poses;
  const demo = drill.demo && poses
    ? `<figure class="drill-demo">${drillDemoSvg(drill, poses)}
         <figcaption>${escapeHtml(ILLUSTRATION)}</figcaption></figure>` : "";
  return `<p class="eyebrow">The drill</p><h3>${escapeHtml(drill.title)}</h3>
    <div class="drill-body">${demo}<div>
    <ol>${drill.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    <p><b>${escapeHtml(drill.reps)}.</b> ${escapeHtml(drill.what_counts)}</p>
    ${drill.sets ? repCounterMarkup(drill) : ""}</div></div>`;
}

function repCounterMarkup(drill) {
  const count = repCounts.get(drill.id) || { done: 0, pace: 0 };
  return `<div class="rep-counter" data-drill="${escapeHtml(drill.id)}">
    <output class="rep-count" aria-live="polite">${escapeHtml(repLabel(drill, count.done))}</output>
    <div class="rep-actions">
      <button class="btn btn-primary" type="button" data-rep="add">+1 rep</button>
      <button class="btn" type="button" data-rep="undo">Undo</button>
      <button class="btn" type="button" data-rep="reset">Start over</button>
    </div>
    <label class="rep-pace">Pace timer
      <select data-rep="pace">${PACES.map((s) => `<option value="${s}"${s === count.pace ? " selected" : ""}>` +
        `${s ? `a rep every ${s} s` : "off"}</option>`).join("")}</select></label>
    <span class="rep-timer">${escapeHtml(paceText(count))}</span>
  </div>`;
}

function paceText(count) {
  if (!count.pace) return "";
  return `Next rep counted in ${Math.max(0, Math.ceil((count.next - Date.now()) / 1000))} s`;
}

function setReps(id, change) {
  const drill = state.payload.practice.drills.find((d) => d.id === id);
  if (!drill) return;
  const count = { done: 0, pace: 0, next: 0, ...repCounts.get(id) };
  if (change === "add") count.done += 1;
  if (change === "undo") count.done = Math.max(0, count.done - 1);
  if (change === "reset") Object.assign(count, { done: 0, pace: 0 });
  if (typeof change === "number") {
    count.pace = change;
    count.next = Date.now() + change * 1000;
  }
  const now = repState(drill, count.done);
  count.done = now.done;
  // The timer stops at the end of each set, for the rest, and at the end of the drill.
  if (change === "add" && (now.setDone || now.finished)) count.pace = 0;
  repCounts.set(id, count);
  for (const box of document.querySelectorAll(`.rep-counter[data-drill="${CSS.escape(id)}"]`)) {
    box.querySelector(".rep-count").textContent = repLabel(drill, count.done);
    box.querySelector("select").value = String(count.pace);
    box.querySelector(".rep-timer").textContent = paceText(count);
  }
  paceTimer();
}

let paceTicker = null;
function paceTimer() {
  const running = [...repCounts.values()].some((c) => c.pace);
  if (running && !paceTicker) {
    paceTicker = setInterval(() => {
      for (const [id, count] of repCounts) {
        if (!count.pace) continue;
        if (Date.now() >= count.next) {
          setReps(id, "add");
          const after = repCounts.get(id);
          if (after.pace) after.next = Date.now() + after.pace * 1000;
        }
        for (const box of document.querySelectorAll(`.rep-counter[data-drill="${CSS.escape(id)}"]`)) {
          box.querySelector(".rep-timer").textContent = paceText(repCounts.get(id));
        }
      }
    }, 250);
  } else if (!running && paceTicker) {
    clearInterval(paceTicker);
    paceTicker = null;
  }
}

function wireDrills() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest(".rep-counter [data-rep]");
    if (!button || button.tagName === "SELECT") return;
    setReps(button.closest(".rep-counter").dataset.drill, button.dataset.rep);
  });
  document.addEventListener("change", (event) => {
    const select = event.target.closest && event.target.closest(".rep-counter select[data-rep]");
    if (select) setReps(select.closest(".rep-counter").dataset.drill, Number(select.value));
  });
}

/* A golfer who asks for less motion sees each figure held still. */
function settleDrillDemos() {
  if (!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const svg of document.querySelectorAll(".drill-demo-svg")) {
    if (svg.pauseAnimations) svg.pauseAnimations();
  }
}

function planMarkup(plan) {
  const rules = state.payload.practice;
  const log = state.log;
  const drill = rules.drills.find((d) => d.id === plan.drill_id);
  const name = drill ? drill.title : plan.focus;
  const values = (ids) => ids.map((id) => log.get(id)).filter(Boolean).map((s) =>
    `<li>Swing ${s.id}: <b>${s.ok ? reading(s.metrics && s.metrics[plan.metric]) : "refused"}</b></li>`).join("");
  let verdict;
  if (drill && drill.focus === "capture") {
    const progress = log.captureProgress(plan);
    const done = progress.clean_in_a_row >= 3;
    verdict = `<div class="practice-card ${done ? "v-improved" : ""}">
      <p class="eyebrow">Is it working?</p>
      <h3>${done ? "Done: three clean recordings in a row"
        : `${progress.clean_in_a_row} of 3 clean recordings in a row`}</h3>
      <p>${progress.recorded} retest swing(s) recorded for this plan.</p></div>`;
  } else {
    const change = log.planChange(rules, plan);
    const numbers = change.difference === null ? "" : `<div class="metric-grid">
        ${card(`Before (${change.n_before} swings)`, reading(change.mean_before), "", "", "derived")}
        ${card(`After (${change.n_after} swings)`, reading(change.mean_after), "", "", "derived")}
        ${card("Change, 95% interval", signed(change.difference), "", "", "derived",
               `<div class="metric-range">${signed(change.interval[0])} to ${signed(change.interval[1])}</div>`)}
      </div>`;
    const notes = [
      ...change.comparability.blocking.map((b) => `<li class="blocking">${escapeHtml(b)}</li>`),
      ...change.comparability.warnings.map((w) => `<li>${escapeHtml(w)}</li>`),
    ].join("");
    verdict = `<div class="practice-card v-${change.verdict}">
      <p class="eyebrow">Is it working?</p>
      <h3>${VERDICT_TITLES[change.verdict]}</h3>
      <p>${escapeHtml(change.explanation)}</p>${numbers}
      ${notes ? `<ul>${notes}</ul>` : ""}</div>`;
  }
  return `<div class="practice-card">
      <p class="eyebrow">Your plan, started ${escapeHtml(plan.created_at.slice(0, 10))}${plan.club ? ` &middot; ${escapeHtml(plan.club)}` : ""}</p>
      <h3>${escapeHtml(name)}</h3>
      <p>Measured by ${METRIC_NAMES[plan.metric] || escapeHtml(plan.metric)}, aiming to ${plan.direction} it.
        Analyse clips with the box above ticked to add retest swings.</p>
      ${plan.baseline.length ? `<p class="eyebrow">Before the drill</p><ul class="evidence">${values(plan.baseline)}</ul>` : ""}
      ${plan.retest.length ? `<p class="eyebrow">Retest swings</p><ul class="evidence">${values(plan.retest)}</ul>` : ""}
      <div class="practice-actions">
        <button class="btn" type="button" data-close="completed">Finish plan</button>
        <button class="btn" type="button" data-close="abandoned">Stop</button>
      </div>
    </div>${verdict}${drill ? `<div class="practice-card">${drillMarkup(drill)}</div>` : ""}`;
}

function insightMarkup(insight, swingId) {
  const evidence = insight.evidence.map((e) =>
    `<li><span>${escapeHtml(e.label)}</span> <b>${escapeHtml(e.value)}</b>
       <span class="prov prov-${e.provenance}">${e.provenance}</span></li>`).join("");
  const plan = state.log.activePlan();
  const start = insight.drill && !plan
    ? `<button class="btn btn-primary" type="button" data-focus="${insight.drill.focus}">
         Start this drill as a plan</button>` : "";
  const choices = insight.choices.length && !plan
    ? `<p class="eyebrow">Choose a focus</p><div class="practice-actions">${insight.choices.map(([focus, label]) =>
        `<button class="btn" type="button" data-focus="${focus}">${escapeHtml(label)}</button>`).join("")}</div>` : "";
  return `<div class="practice-card">
      <p class="eyebrow">The priority after swing ${swingId}
        <span class="confidence">&middot; confidence: ${insight.confidence}</span></p>
      <h3>${escapeHtml(insight.title)}</h3>
      <p>${escapeHtml(insight.summary)}</p>
      ${evidence ? `<ul class="evidence">${evidence}</ul>` : ""}
      ${insight.drill ? drillMarkup(insight.drill) : ""}
      <p><b>Retest:</b> ${escapeHtml(insight.retest)} <b>What counts:</b> ${escapeHtml(insight.success)}</p>
      ${insight.limitations.length ? `<p class="eyebrow">What this cannot tell</p>
        <ul>${insight.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : ""}
      ${start || choices ? `<div class="practice-actions">${start}</div>${choices}` : ""}
    </div>`;
}

function keptMarkup(log) {
  const plan = log.activePlan();
  const role = (id) => !plan ? "" : plan.baseline.includes(id) ? " · before the drill"
    : plan.retest.includes(id) ? " · retest" : "";
  const rows = log.swings.slice().reverse().map((s) => `<li><span>Swing ${s.id} · ${escapeHtml(
    (s.at || "").slice(0, 10))}${s.club ? ` · ${escapeHtml(s.club)}` : ""}${role(s.id)}</span>
      <b>${s.ok ? `tempo ${reading(s.metrics && s.metrics.tempo_ratio)}` : "refused"}</b>
      <button class="btn" type="button" data-remove="${s.id}">Remove</button></li>`).join("");
  return `<details class="kept"><summary>Swings kept (${log.swings.length})</summary>
    <ul class="evidence">${rows}</ul></details>`;
}

function renderPractice(swingId, note = "") {
  const log = state.log;
  const rules = state.payload.practice;
  if (!log || !rules) return;
  state.practiceSwing = swingId;
  const plan = log.activePlan();
  el("plan-panel").innerHTML = plan ? planMarkup(plan) : "";
  const insight = swingId ? log.insightFor(rules, swingId) : null;
  el("priority-panel").innerHTML = insight ? insightMarkup(insight, swingId) : "";
  settleDrillDemos();
  summaryPriority(insight, swingId);
  // The read gives this swing's priority only; a sample or an earlier swing's is not its own.
  const own = Boolean(swingId) && Boolean(state.analysis) && state.analysis.logId === swingId;
  state.readInsight = own ? insight : null;
  state.readNote = own || !state.analysis ? null
    : "This clip is not kept in your practice log, so no priority is set from it";
  renderStemRead();
  const kept = log.swings.length;
  el("practice-data").innerHTML = log.available
    ? `${note ? `<p class="practice-note">${escapeHtml(note)}</p>` : ""}${kept ? keptMarkup(log) : ""}
       <span>${kept} clip${kept === 1 ? "" : "s"} kept in this browser, numbers only.</span>
       <button class="btn" type="button" id="practice-export">Export</button>
       <button class="btn" type="button" id="practice-erase">Erase everything</button>
       <span id="erase-confirm" hidden>
         <label for="erase-typed">Type ERASE to delete every kept swing and plan:</label>
         <input id="erase-typed" class="text-input" autocomplete="off" maxlength="10">
         <button class="btn" type="button" id="erase-go">Delete</button>
       </span>`
    : "<span>This browser is not letting the page keep anything, so each clip is judged " +
      "on its own and no plan can be kept. A private window or blocked site data does this.</span>";
  refreshPracticeOptions();
  show("practice", Boolean(swingId || plan));
  el("bar-practice").hidden = !(swingId || plan);
  renderProgress();
}

function refreshPracticeOptions() {
  const log = state.log;
  if (!log) return;
  el("club-list").innerHTML = log.clubs().map((c) => `<option value="${escapeHtml(c)}">`).join("");
  const plan = log.activePlan();
  const drill = plan && state.payload.practice.drills.find((d) => d.id === plan.drill_id);
  el("for-plan-box").hidden = !plan;
  el("for-plan-name").textContent = drill ? drill.title : "";
}

function wirePractice() {
  state.log = new PracticeLog(browserStorage());
  // Coming back to the page shows the plan and the latest priority straight away.
  const kept = state.log.swings;
  if (kept.length || state.log.activePlan()) {
    renderPractice(kept.length ? kept[kept.length - 1].id : null);
  } else {
    refreshPracticeOptions();
    renderProgress();
  }
  el("practice").addEventListener("click", (event) => {
    const log = state.log;
    const rules = state.payload.practice;
    const focus = event.target.closest("[data-focus]");
    const close = event.target.closest("[data-close]");
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      const id = Number(remove.dataset.remove);
      log.remove(id);
      if (state.analysis && state.analysis.logId === id) state.analysis.logId = null;
      if (state.practiceSwing === id) {
        const left = log.swings;
        state.practiceSwing = left.length ? left[left.length - 1].id : null;
      }
    } else if (focus) {
      log.startPlan(rules, focus.dataset.focus, state.practiceSwing);
      el("for-plan").checked = true;
    } else if (close) {
      log.closePlan(close.dataset.close);
    } else if (event.target.id === "practice-export") {
      const blob = new Blob([JSON.stringify(log.exportAll(), null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "swing-practice.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    } else if (event.target.id === "practice-erase") {
      // Asked on the page rather than in a prompt dialog, which a sandboxed page
      // may not be allowed to open.
      el("erase-confirm").hidden = false;
      el("erase-typed").focus();
      return;
    } else if (event.target.id === "erase-go") {
      if (el("erase-typed").value.trim() !== "ERASE") {
        el("erase-typed").focus();
        return;
      }
      log.eraseAll();
      state.practiceSwing = null;
      if (state.analysis) state.analysis.logId = null;
    } else {
      return;
    }
    renderPractice(state.practiceSwing);
  });
}

export function boot(payload) {
  state.payload = payload;
  connectReports();
  el("send-diag").onclick = () => sendDiagnostics();
  state.net = new SwingEventModel(payload);
  state.handedness = "auto";
  wireLightbox();
  if (payload.practice) wirePractice();

  const input = el("file");
  const pick = () => input.click();
  el("browse").onclick = (e) => { e.stopPropagation(); pick(); };
  input.onchange = () => { if (input.files[0]) analyse(input.files[0]); input.value = ""; };
  wireRecorder();
  wireFolds();
  el("bar-practice").onclick = () =>
    el("practice").scrollIntoView({ behavior: "smooth", block: "start" });

  // Three choices, so three buttons rather than a dropdown: the state is visible
  // without opening anything, and it is one click instead of three.
  const group = el("handedness");
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    state.handedness = button.dataset.value;
    group.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b === button)));
  });

  const zone = el("drop");
  // The whole panel is the target, not just the button in it. Somebody who reads
  // "Drop a swing here" and clicks the middle of the box has done nothing wrong.
  zone.addEventListener("click", pick);
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files[0]) analyse(e.dataTransfer.files[0]);
  });

  if (LOCAL && LOCAL.sample) {
    el("sample").hidden = false;
    el("sample").onclick = async (event) => {
      event.stopPropagation();
      try {
        // The same clip in two encodings, taking whichever this browser decodes:
        // H.264 is everywhere Apple and Google ship a browser, VP9 everywhere else.
        const probe = document.createElement("video");
        const pick = LOCAL.sample.find((s) => probe.canPlayType(s.type)) || LOCAL.sample[0];
        const response = await fetch(here(pick.src));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        analyse(new File([blob], pick.src.split("/").pop(), { type: pick.type }), { sample: true });
      } catch (error) {
        failed(new Error(`Could not load the sample swing.\n\n(${error.message})`));
      }
    };
    el("footer-note").textContent =
      "Runs entirely in your browser. The clip never leaves this device, and the pose " +
      "estimator is loaded from this page rather than from anyone else's servers. Each " +
      "run leaves a short technical note for the page's owner - browser, video format, " +
      "timings, any error, and how far any position you moved was from the model's - " +
      "never the video, a frame or its name - so failures can be fixed. Pictures and " +
      "poses from a clip are sent only if you press the button that says so.";
  }

  for (const id of ["again", "again-bottom", "bar-analyse"]) {
    el(id).onclick = () => {
      el("drop").scrollIntoView({ behavior: "smooth", block: "center" });
      pick();
    };
  }
  el("share-swing").onclick = () => { shareSwing().catch((error) => console.error(error)); };
}


/* Recording in the page (#34): the camera with a framing band, a live check that
 * the whole body is in shot, a level indicator, then a 3 s countdown and 6 s of
 * recording. The recording becomes a File and goes to `analyse` like any picked
 * clip; it is never sent anywhere. Where the camera is refused or missing, the
 * panel says so and points back to choosing a video. */
const rec = { stream: null, recorder: null, chunks: [], type: "", check: null, timers: [],
              tilt: null, canvas: null };

function wireRecorder() {
  const button = el("record");
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined") return;
  button.hidden = false;
  button.onclick = (event) => { event.stopPropagation(); openRecorder(); };
  el("bar-record").hidden = false;
  el("bar-record").onclick = () => openRecorder();
  el("again-record").onclick = () => openRecorder();
  el("rec-close").onclick = () => closeRecorder();
  el("rec-start").onclick = () => startRecording();
  el("rec-stop").onclick = () => stopRecording();
  el("rec-session").onclick = () => startSession();
  wireVoice();
  wireDrills();
  wireScrubber();
  el("rec-session-stop").onclick = () => stopSession();
  document.addEventListener("visibilitychange", () => {
    // A wake lock is released whenever the page is hidden; take it again on return.
    if (session.active && document.visibilityState === "visible") keepAwake();
  });
}

function recMessage(text) { el("rec-message").textContent = text; }

function recControls(visible) {
  for (const id of ["rec-stage", "rec-start", "rec-session"]) el(id).hidden = !visible;
  el("rec-framing").hidden = !visible;
  el("rec-rate").hidden = !visible;
}

async function openRecorder() {
  if (state.busy) return;
  show("recorder", true);
  recControls(true);
  el("rec-stop").hidden = true;
  el("rec-start").disabled = false;
  el("rec-rate-note").hidden = true;
  el("recorder").scrollIntoView({ behavior: "smooth", block: "start" });
  recMessage("Asking for the camera…");
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
  } catch (error) {
    cameraUnavailable(error);
    return;
  }
  const video = el("rec-preview");
  video.srcObject = rec.stream;
  try { await video.play(); } catch { /* autoplay muted normally succeeds */ }
  recMessage("");
  const track = rec.stream.getVideoTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : {};
  const note = frameRateNote(settings.frameRate);
  el("rec-rate").textContent = settings.frameRate ? `${Math.round(settings.frameRate)} fps` : "fps unknown";
  el("rec-rate").className = "rec-chip " + (note.low ? "warn" : "ok");
  el("rec-rate-note").textContent = note.text;
  el("rec-rate-note").hidden = !note.low;
  watchTilt();
  // The estimator loads in the background; the framing check starts using it as
  // soon as it is there. Recording does not wait for it.
  ready().catch(() => { el("rec-framing").textContent = "Framing check unavailable"; });
  rec.check = setInterval(checkFraming, 400);
}

function cameraUnavailable(error) {
  stopStream();
  recControls(false);
  el("rec-stop").hidden = true;
  const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
  recMessage(denied
    ? "The camera was not allowed, so nothing can be recorded here. Choose a video you " +
      "recorded instead: the analysis is the same."
    : "No camera could be opened on this device. Choose a video you recorded instead: " +
      "the analysis is the same.");
}

function watchTilt() {
  const onTilt = (event) => {
    const landscape = window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
    const verdict = levelVerdict(event.beta, event.gamma, landscape);
    const chip = el("rec-level");
    if (!verdict) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = verdict.text;
    chip.className = "rec-chip " + (verdict.level ? "ok" : "warn");
  };
  const start = () => { window.addEventListener("deviceorientation", onTilt); rec.tilt = onTilt; };
  // iOS asks for motion access, and only from a tap; this runs inside one.
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then((answer) => {
      if (answer === "granted") start();
    }).catch(() => {});
  } else if (typeof DeviceOrientationEvent !== "undefined") {
    start();
  }
}

function checkFraming() {
  const video = el("rec-preview");
  if (!state.landmarker || !video.videoWidth || state.busy) return;
  if (!rec.canvas) rec.canvas = document.createElement("canvas");
  const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight));
  rec.canvas.width = Math.round(video.videoWidth * scale);
  rec.canvas.height = Math.round(video.videoHeight * scale);
  rec.canvas.getContext("2d").drawImage(video, 0, 0, rec.canvas.width, rec.canvas.height);
  // The estimator's clock only moves forward, over its whole life.
  let stamp = Math.round(performance.now());
  if (stamp <= state.clockMs) stamp = state.clockMs + 1;
  state.clockMs = stamp;
  let result = null;
  try { result = state.landmarker.detectForVideo(rec.canvas, stamp); } catch { result = null; }
  const landmarks = result && result.landmarks && result.landmarks[0];
  const verdict = framingVerdict(landmarks);
  const chip = el("rec-framing");
  chip.textContent = verdict.message;
  chip.className = "rec-chip " + (verdict.ok ? "ok" : "warn");
  el("rec-band").classList.toggle("ok", verdict.ok);
}

function startRecording() {
  if (!rec.stream || (rec.recorder && rec.recorder.state === "recording")) return;
  el("rec-start").disabled = true;
  const countdown = globalThis.__recordCountdown ?? 3;
  const seconds = globalThis.__recordSeconds ?? 6;
  const count = el("rec-count");
  const tick = (n) => {
    if (n > 0) {
      count.textContent = String(n);
      rec.timers.push(setTimeout(() => tick(n - 1), 1000));
      return;
    }
    count.textContent = "";
    // The framing check has done its job; recording needs the processor more.
    if (rec.check) { clearInterval(rec.check); rec.check = null; }
    rec.type = recordingType((t) => MediaRecorder.isTypeSupported(t));
    rec.chunks = [];
    try {
      rec.recorder = new MediaRecorder(rec.stream, rec.type ? { mimeType: rec.type } : undefined);
    } catch (error) {
      recMessage(`This browser could not record (${error.message}). Choose a video instead.`);
      el("rec-start").disabled = false;
      return;
    }
    rec.recorder.ondataavailable = (event) => { if (event.data && event.data.size) rec.chunks.push(event.data); };
    rec.recorder.onstop = finishRecording;
    rec.recorder.start(250);
    el("rec-stop").hidden = false;
    recMessage(`Recording… stops by itself after ${seconds} s.`);
    rec.timers.push(setTimeout(stopRecording, seconds * 1000));
  };
  tick(countdown);
}

function stopRecording() {
  for (const timer of rec.timers) clearTimeout(timer);
  rec.timers = [];
  if (rec.recorder && rec.recorder.state === "recording") rec.recorder.stop();
}

function finishRecording() {
  const type = (rec.recorder && rec.recorder.mimeType) || rec.type || "video/webm";
  const blob = new Blob(rec.chunks, { type });
  rec.chunks = [];
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = new File([blob], `swing-${stamp}.${extensionFor(type)}`, { type });
  closeRecorder();
  if (blob.size === 0) {
    failed(new Error("The recording came out empty. Try again, or choose a video you recorded."));
    return;
  }
  analyse(file);
}

function stopStream() {
  if (rec.stream) for (const track of rec.stream.getTracks()) track.stop();
  rec.stream = null;
  const video = el("rec-preview");
  video.srcObject = null;
}

function closeRecorder() {
  stopSession();
  for (const timer of rec.timers) clearTimeout(timer);
  rec.timers = [];
  if (rec.check) clearInterval(rec.check);
  rec.check = null;
  if (rec.tilt) window.removeEventListener("deviceorientation", rec.tilt);
  rec.tilt = null;
  if (rec.recorder && rec.recorder.state === "recording") {
    rec.recorder.onstop = null;
    rec.recorder.stop();
  }
  rec.recorder = null;
  stopStream();
  el("rec-count").textContent = "";
  show("recorder", false);
}


/* A range session (#56): the camera stays on and every swing is recorded by itself.
 * capture.js `SwingWatcher` decides from the estimator's landmarks, sampled five
 * times a second, when the golfer is at address (start) and when the finish has
 * settled (stop). Each clip is analysed while the next is recorded, one at a time,
 * through the same `analyse` and practice log as any clip, so the one-clip-one-swing
 * rules hold. A clip the analysis refuses is counted as not read, and a recording
 * with no swing in it is counted too: nothing is dropped without a word. Nothing
 * leaves the device. */
const session = { active: false, watcher: null, sampler: null, recorder: null, canvas: null,
                  live: null, liveClockMs: 0,
                  queue: [], working: false, index: 0, recorded: 0, read: 0, refused: 0,
                  noSwing: 0, lastTempo: null, lastTempoOf: 0, wake: null, note: "" };

function startSession() {
  if (!rec.stream || session.active || state.busy || session.working || session.queue.length) return;
  if (rec.check) { clearInterval(rec.check); rec.check = null; }
  Object.assign(session, { active: true, watcher: new SwingWatcher(), recorder: null, index: 0,
                           recorded: 0, read: 0, refused: 0, noSwing: 0, lastTempo: null, note: "" });
  for (const id of ["rec-start", "rec-session"]) el(id).hidden = true;
  el("rec-session-stop").hidden = false;
  el("session-board").hidden = false;
  // The bar at the foot of a phone's screen would cover the board.
  el("action-bar").hidden = true;
  // The board is what the golfer reads from the tee: bring it to the top.
  el("session-board").scrollIntoView({ block: "start" });
  recMessage("");
  renderSession("Waiting for you at address");
  keepAwake();
  ready().then(async () => {
    if (!session.live) {
      try { session.live = await state.makeLandmarker(); } catch { session.live = null; }
    }
    if (session.active && !session.sampler) session.sampler = setInterval(sampleSession, 200);
  }).catch(() => renderSession("The pose estimator could not load, so swings cannot be found"));
}

function stopSession() {
  if (!session.active) return;
  session.active = false;
  if (session.sampler) clearInterval(session.sampler);
  session.sampler = null;
  // A swing cut off by the stop is not a swing: dropped, and said so.
  if (session.recorder && session.recorder.state === "recording") {
    session.note = "The recording in progress when you stopped was not kept.";
  }
  cutClip(false);
  if (session.wake) session.wake.release().catch(() => {});
  session.wake = null;
  el("rec-session-stop").hidden = true;
  el("action-bar").hidden = false;
  for (const id of ["rec-start", "rec-session"]) el(id).hidden = !rec.stream;
  if (rec.stream && !rec.check) rec.check = setInterval(checkFraming, 400);
  renderSession(session.queue.length || session.working ? "Session stopped; finishing the analysis"
    : "Session stopped");
  if (state.frames) renderScrubber();
}

async function keepAwake() {
  if (!navigator.wakeLock || typeof navigator.wakeLock.request !== "function") {
    recMessage("This browser cannot keep the screen on: turn auto-lock off yourself for the session.");
    return;
  }
  try { session.wake = await navigator.wakeLock.request("screen"); } catch { session.wake = null; }
}

function sampleSession() {
  const video = el("rec-preview");
  if (!session.active || !state.landmarker || !video.videoWidth) return;
  // Without an estimator of its own the camera waits while a clip is analysed.
  const estimator = session.live || state.landmarker;
  if (!session.live && state.busy) {
    if (!session.recorder) renderSession("Analysing the last swing: wait a moment before the next");
    return;
  }
  // Its own canvas: the analysis running alongside draws on the scratch canvas.
  if (!session.canvas) session.canvas = document.createElement("canvas");
  const canvas = session.canvas;
  const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  // Each estimator's clock only moves forward, over its whole life.
  const last = session.live ? session.liveClockMs : state.clockMs;
  const stamp = Math.max(Math.round(performance.now()), last + 1);
  if (session.live) session.liveClockMs = stamp; else state.clockMs = stamp;
  let result = null;
  try { result = estimator.detectForVideo(canvas, stamp); } catch { result = null; }
  const landmarks = result && result.landmarks && result.landmarks[0];
  const framing = framingVerdict(landmarks);
  const chip = el("rec-framing");
  chip.textContent = framing.message;
  chip.className = "rec-chip " + (framing.ok ? "ok" : "warn");
  el("rec-band").classList.toggle("ok", framing.ok);
  // Wall-clock time: the estimator's stamp can run ahead of it while a clip is analysed.
  const event = session.watcher.push(performance.now() / 1000, landmarks || null, framing.ok);
  if (!event) return;
  if (event.type === "start") {
    beginClip();
  } else if (event.type === "cancel") {
    cutClip(false);
    renderSession("Waiting for you at address");
  } else if (event.swing !== false) {
    // A swing seen, or one the samples were too sparse to rule out: kept, and
    // the analysis judges it.
    cutClip(true);
  } else {
    cutClip(false);
    session.noSwing += 1;
    renderSession("No swing in that one; waiting for you at address");
  }
}

function beginClip() {
  const type = recordingType((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(rec.stream, type ? { mimeType: type } : undefined);
  } catch (error) {
    session.note = `This browser could not record (${error.message}).`;
    stopSession();
    return;
  }
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
  recorder.chunks = chunks;
  recorder.start(250);
  session.recorder = recorder;
  renderSession("Recording", true);
}

function cutClip(keep) {
  const recorder = session.recorder;
  session.recorder = null;
  if (!recorder || recorder.state !== "recording") return;
  recorder.onstop = keep ? () => queueClip(recorder.chunks, recorder.mimeType) : null;
  recorder.stop();
}

function queueClip(chunks, mimeType) {
  const type = mimeType || "video/webm";
  const blob = new Blob(chunks, { type });
  session.index += 1;
  session.recorded += 1;
  // A name of its own per swing, so the practice log never takes two swings for one clip.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = new File([blob], `swing-${stamp}-${session.index}.${extensionFor(type)}`, { type });
  session.queue.push({ file, index: session.index });
  renderSession(session.active ? "Waiting for you at address" : "Session stopped; finishing the analysis");
  drainSession();
}

async function drainSession() {
  if (session.working || !session.queue.length) return;
  // Not while a swing is being recorded: analysing competes with the camera's
  // sampling, and a sparsely sampled swing is harder to see (capture.js).
  if (state.busy || session.recorder) { setTimeout(drainSession, 500); return; }
  session.working = true;
  const { file, index } = session.queue.shift();
  renderSession();
  state.lastRecord = null;
  await analyse(file);
  const record = state.lastRecord;
  if (record && record.ok) {
    session.read += 1;
    const tempo = record.metrics && record.metrics.tempo_ratio;
    if (tempo !== null && tempo !== undefined) { session.lastTempo = tempo; session.lastTempoOf = index; }
  } else {
    session.refused += 1;
  }
  speakSwing(index, record);
  session.working = false;
  renderSession(session.active ? undefined : (session.queue.length ? "Session stopped; finishing the analysis"
    : "Session stopped"));
  drainSession();
}

function renderSession(stateText, recording = false) {
  if (stateText !== undefined) {
    el("session-state").textContent = stateText;
    el("session-state").classList.toggle("recording", recording);
  }
  el("session-count").textContent = session.recorded ? `Swing ${session.recorded}` : "No swings yet";
  // The last tempo the analysis read, which may be an earlier swing's while this one is analysed.
  el("session-tempo").hidden = session.lastTempo === null;
  el("session-tempo").textContent = session.lastTempo === null ? "" : `tempo ${session.lastTempo.toFixed(2)}`;
  if (session.lastTempo !== null && session.lastTempoOf !== session.recorded) {
    const of = document.createElement("small");
    of.textContent = ` swing ${session.lastTempoOf}`;
    el("session-tempo").append(of);
  }
  const pending = session.queue.length + (session.working ? 1 : 0);
  const parts = [`${session.read} read`, `${session.refused} not read`];
  if (session.noSwing) parts.push(`${session.noSwing} recording${session.noSwing === 1 ? "" : "s"} with no swing`);
  if (pending) parts.push(`${pending} being analysed`);
  el("session-tally").textContent = parts.join(" \u00b7 ") + (session.note ? `. ${session.note}` : "");
}

/* The spoken cue (#62): after each swing in a range session, one short sentence
 * from read.js `voiceCue`, in the device's own voice (speechSynthesis). Off by
 * default and remembered per browser; where the browser cannot speak, the
 * option is not offered. */
const VOICE_KEY = "swing-voice-v1";

function wireVoice() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  const box = el("session-voice");
  el("session-voice-box").hidden = false;
  try { box.checked = browserStorage().getItem(VOICE_KEY) === "on"; } catch { box.checked = false; }
  box.onchange = () => {
    try { browserStorage().setItem(VOICE_KEY, box.checked ? "on" : "off"); } catch { /* not kept */ }
  };
}

function speakSwing(index, record) {
  if (el("session-voice-box").hidden || !el("session-voice").checked) return;
  const a = state.analysis;
  const ok = Boolean(record && record.ok && a);
  const text = voiceCue(ok ? {
    metrics: (state.last && state.last.metrics) || a.metrics, handedness: a.handedness,
    band: state.payload.calibration && state.payload.calibration.tempo,
    rules: state.payload.practice || null, userSet: [...a.userSet], swing: index, refused: false,
  } : { metrics: {}, swing: index, refused: true });
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* silent */ }
}

/* Progress over time (#38): one chart per measure from the practice log kept in
 * this browser (progress.js), redrawn whenever the log changes. */
function renderProgress() {
  if (!state.log || !state.payload) return;
  const rules = state.payload.practice || null;
  const verdicts = state.log.data.plans.filter((plan) => plan.retest.length)
    .map((plan) => ({ plan, change: state.log.planChange(rules, plan) }));
  const series = progressSeries({
    swings: state.log.swings, verdicts, rules,
    band: state.payload.calibration && state.payload.calibration.tempo,
  });
  show("progress", true);
  el("progress-empty").hidden = series.enough;
  el("progress-empty").textContent = `Record ${MIN_SWINGS} swings to see a trend` +
    (series.swings ? ` (${series.swings} kept so far).` : ".");
  el("progress-charts").innerHTML = !series.enough ? "" : series.measures
    .filter((m) => m.points.length)
    .map((m) => `<figure class="progress-card" data-measure="${m.key}">
      <h3>${escapeHtml(m.label)}</h3><p class="unit">${escapeHtml(m.unit)}</p>
      ${progressSvg(m)}
      <details><summary>As a table</summary><table><thead><tr><th>Swing</th><th>Day</th>
        <th>${escapeHtml(m.label)}</th><th></th></tr></thead><tbody>${m.points.map((p) =>
          `<tr><td>${p.id}</td><td>${escapeHtml(p.day)}</td><td>${p.value.toFixed(m.digits)}</td>` +
          `<td>${p.comparable ? "" : "filmed differently"}</td></tr>`).join("")}</tbody></table>
      </details></figure>`).join("");
}

/* Share a swing (#44): a picture made on this device from what the page shows,
 * the frames at address, top and impact with the pose drawn and the words of
 * read.js `cardText`. Handed to the device's share sheet where it takes files,
 * otherwise downloaded; the page uploads nothing. */
const CARD = { width: 900, frame: 270, gap: 15, pad: 30 };

function swingCardLines() {
  const a = state.analysis;
  const m = (state.last && state.last.metrics) || a.metrics;
  return cardText({
    metrics: m, handedness: a.handedness,
    band: state.payload.calibration && state.payload.calibration.tempo,
    rules: state.payload.practice || null, userSet: [...a.userSet], insight: state.readInsight,
    date: localDay(new Date()),
  });
}

function drawSwingCard(lines) {
  const { width, frame, gap, pad } = CARD;
  const shots = [0, 3, 5].map((e) => state.frames && state.frames[e]).filter(Boolean);
  const scale = (c) => frame / c.canvas.width;
  const shotHeight = Math.max(...shots.map((c) => Math.round(c.canvas.height * scale(c))), 0);
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const font = (weight, size) => `${weight} ${size}px -apple-system, Segoe UI, Roboto, sans-serif`;
  // Every line is wrapped to the card's width and the card grows to fit, so a
  // caveat at the end of a line is never the part cut off (#71).
  const blocks = [];
  for (const [i, line] of [lines.tempo, lines.spread, lines.meaning, lines.priority].filter(Boolean)
    .entries()) {
    const style = i === 0 ? { font: font(700, 26), color: "#161a21", lead: 34 }
      : { font: font(400, 20), color: "#58616f", lead: 28 };
    g.font = style.font;
    blocks.push({ ...style, rows: wrapLines(g, line, width - 2 * pad), after: 6 });
  }
  g.font = font(400, 17);
  const foot = [lines.limitation, "Derived from this swing's positions; made with Stem on this device."]
    .flatMap((line) => wrapLines(g, line, width - 2 * pad));
  const textHeight = blocks.reduce((sum, b) => sum + b.rows.length * b.lead + b.after, 0);
  const height = pad + 40 + shotHeight + 30 + 30 + textHeight + 24 + foot.length * 24 + pad;
  canvas.width = width;
  canvas.height = height;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#161a21";
  g.font = font(600, 26);
  g.fillText(`Swing, ${lines.date}`, pad, pad + 26);
  shots.forEach((c, i) => {
    const x = pad + i * (frame + gap), y = pad + 40;
    g.drawImage(c.canvas, x, y, frame, Math.round(c.canvas.height * scale(c)));
    g.font = font(500, 18);
    g.fillStyle = "#58616f";
    g.fillText(c.label, x, y + shotHeight + 24);
  });
  let y = pad + 40 + shotHeight + 30 + 30;
  for (const block of blocks) {
    g.fillStyle = block.color;
    g.font = block.font;
    for (const row of block.rows) {
      g.fillText(row, pad, y);
      y += block.lead;
    }
    y += block.after;
  }
  g.fillStyle = "#8b94a3";
  g.font = font(400, 17);
  y = height - pad - 6 - (foot.length - 1) * 24;
  for (const row of foot) {
    g.fillText(row, pad, y);
    y += 24;
  }
  return canvas;
}

/* `text` broken at spaces into rows no wider than `maxWidth` in `g`'s font. A
 * single word wider than that (none of the card's are) is shortened with an
 * ellipsis rather than spilling off the card. */
function wrapLines(g, text, maxWidth) {
  const rows = [];
  let row = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = row ? `${row} ${word}` : word;
    if (row && g.measureText(next).width > maxWidth) {
      rows.push(row);
      row = word;
    } else {
      row = next;
    }
  }
  if (row) rows.push(row);
  return rows.map((r) => {
    let fit = r;
    while (fit.length > 4 && g.measureText(fit).width > maxWidth) fit = `${fit.slice(0, -2)}…`;
    return fit;
  });
}

async function shareSwing() {
  if (!state.analysis || !state.frames) return;
  const lines = swingCardLines();
  const canvas = drawSwingCard(lines);
  // PNG keeps the text sharp; a photo-heavy card over 1 MB goes as JPEG instead.
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  let type = "image/png";
  if (blob && blob.size > 1e6) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    type = "image/jpeg";
  }
  if (!blob) return;
  const name = `swing-${lines.date}.${type === "image/png" ? "png" : "jpg"}`;
  const url = URL.createObjectURL(blob);
  el("share-preview").src = url;
  el("share-preview").alt = [lines.tempo, lines.spread, lines.meaning].filter(Boolean).join(". ");
  el("share-caption").textContent = [lines.tempo, lines.spread, lines.meaning, lines.priority,
    lines.limitation].filter(Boolean).join("\n");
  el("share-card").hidden = false;
  el("share-card").dataset.bytes = String(blob.size);
  const file = new File([blob], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "My swing" });
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}
