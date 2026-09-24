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
import { SwingEventNet, decodeEvents, errorBand } from "./model.js";
import { computeMetrics, implausible } from "./metrics.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";

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
const reports = { db: null, chain: Promise.resolve() };
function connectReports() {
  const claude = window.claude;
  if (!claude || typeof claude.use !== "function") return;
  reports.db = claude.use("db").catch(() => null);
}

/* A coach's read from Claude, where the page is viewed inside Claude and the
 * viewer allows it. It costs the viewer's own usage, so it runs only when they
 * press the button, and it is labelled everywhere as Claude's opinion from the
 * pictures - never mixed in with the measurements. */
const coach = { sample: null, images: false, ctl: null };

function connectCoach() {
  const claude = window.claude;
  if (!claude || typeof claude.use !== "function") return;
  claude.use("sample").then(async (sample) => {
    if (!sample) return;
    const caps = await sample.limits().catch(() => null);
    coach.images = Boolean(caps && caps.images && caps.images.maxCount >= 1 &&
                           caps.images.mediaTypes.includes("image/jpeg"));
    coach.sample = sample;
    if (state.analysis) resetCoach();
  }).catch(() => {});
}

function hideCoach() {
  coach.sample = null;
  show("coach-section", false);
}

/* Back to the button, for a new clip or a moved position: a read of other
 * numbers would be a read of a different swing. */
function resetCoach() {
  if (coach.ctl) coach.ctl.abort();
  coach.ctl = null;
  if (!coach.sample) return;
  show("coach-section", true);
  el("coach-ask").hidden = false;
  el("coach-ask").disabled = false;
  el("coach-stop").hidden = true;
  el("coach-text").textContent = "";
  el("coach-status").textContent = coach.images
    ? "Claude looks at the eight frames above and the measurements on this page."
    : "Pictures cannot be sent from here, so Claude reads the measurements only.";
}

/* The eight frames on one sheet, four across, labelled - one image instead of
 * eight, well inside what a call can carry. */
async function contactSheet() {
  const frames = state.frames || [];
  if (frames.length !== 8) return null;
  // As large as the platform keeps (it downsizes to about 1.2 megapixels), and no
  // larger than the frames were stored.
  const aspect = frames[0].canvas.width / frames[0].canvas.height;
  const cellH = Math.round(Math.min(frames[0].canvas.height, Math.sqrt(1.15e6 / (8 * aspect))));
  const cellW = Math.round(cellH * aspect);
  const sheet = document.createElement("canvas");
  sheet.width = cellW * 4;
  sheet.height = cellH * 2;
  const g = sheet.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, sheet.width, sheet.height);
  frames.forEach((f, i) => {
    const x = (i % 4) * cellW, y = Math.floor(i / 4) * cellH;
    g.drawImage(f.canvas, x, y, cellW, cellH);
    const label = `${i + 1} ${f.label}`;
    let size = Math.max(12, Math.round(cellH / 20));
    g.font = `600 ${size}px system-ui, sans-serif`;
    // Shrunk to fit a narrow portrait cell rather than cut off.
    const room = cellW - 8 - size;
    const natural = g.measureText(label).width;
    if (natural > room) {
      size = Math.max(9, Math.floor(size * room / natural));
      g.font = `600 ${size}px system-ui, sans-serif`;
    }
    const w = g.measureText(label).width + size;
    g.fillStyle = "rgba(0,0,0,.7)";
    g.fillRect(x + 4, y + 4, w, size * 1.5);
    g.fillStyle = "#fff";
    g.fillText(label, x + 4 + size / 2, y + 4 + size * 1.1);
  });
  return new Promise((resolve) => sheet.toBlob(resolve, "image/jpeg", 0.85));
}

function coachPrompt(withImage) {
  const a = state.analysis;
  const m = a.metrics;
  const band = state.payload.calibration && state.payload.calibration.tempo;
  const lines = [];
  lines.push(`Golfer: ${a.handedness}-handed (${state.handednessFrom === "detected" ? "detected from the pose" : state.handednessFrom === "assumed" ? "assumed" : "set by the user"}).`);
  lines.push(`Tempo, backswing time divided by downswing time: ${m.tempoRatio.toFixed(2)}` +
    (band ? ` (measured 80% error range about +/-${Math.round(100 * band.half_width_fraction)}%)` : "") + ".");
  lines.push(`Backswing ${Math.round(m.backswingMs)} ms, downswing ${Math.round(m.downswingMs)} ms, address to finish ${Math.round(m.wholeMs)} ms.`);
  lines.push(`Hands fastest ${Math.round(m.peakHandSpeedMs)} ms relative to impact (negative is before).`);
  if (m.shoulderTurnDeg !== null) lines.push(`Shoulder turn at the top, from 2D foreshortening only: about ${m.shoulderTurnDeg.toFixed(0)} degrees.`);
  if (m.hipTurnDeg !== null) lines.push(`Hip turn at the top, same method: about ${m.hipTurnDeg.toFixed(0)} degrees.`);
  if (m.feetInShot) {
    lines.push(`Address to impact, in body lengths: head moved ${m.headMovement.toFixed(3)}, pelvis swayed ${m.pelvisSway.toFixed(3)} side to side and moved ${m.pelvisLift.toFixed(3)} up or down.`);
  }
  if (a.userSet.size) {
    lines.push(`Positions the golfer placed by hand rather than the model: ${[...a.userSet].sort().map((e) => EVENT_NAMES[e]).join(", ")}.`);
  }
  const picture = withImage
    ? "The image is a contact sheet of eight frames from the video, numbered in order: " +
      "1 Address, 2 Toe Up, 3 Mid Backswing, 4 Top, 5 Mid Downswing, 6 Impact, " +
      "7 Mid Follow Through, 8 Finish. The coloured lines are the body tracker's " +
      "skeleton, not the club. Positions 2 and 7 are placed from the body's motion, " +
      "because the tracker does not see the club.\n\n"
    : "No pictures are available; work from the measurements only.\n\n";
  return "A golfer filmed one swing on a phone and an app measured it from a single camera.\n\n" +
    picture +
    "What the app measured:\n- " + lines.join("\n- ") + "\n\n" +
    "Write a short coaching read, speaking to the golfer as \"you\":\n" +
    "1. What stands out: two or three observations, each naming the frame or measurement it comes from.\n" +
    "2. The one thing to work on first, and one simple drill for it.\n" +
    "3. In one sentence, what this footage cannot tell you.\n\n" +
    "Rules: plain text with the three numbered parts, no tables, under 230 words. Do not " +
    "state or estimate club face angle, club path, attack angle, swing plane, spin, ball " +
    "flight, speed or distance: none of them can be seen or measured here. If a frame " +
    "does not show the position its label says, say so instead of coaching from it. If " +
    "the image is not a golf swing, say that and stop.";
}

const COACH_ERRORS = {
  rate_limited: "Claude is busy or your usage limit was reached. Try again in a little while.",
  session_expired: "Your Claude session has expired. Sign in again, then try again.",
  image_rejected: "The frames could not be sent. Try again after analysing the clip again.",
  refused: "Claude would not give a read of this. Try another clip.",
  empty_completion: "Claude returned nothing. Try again.",
  prompt_too_large: "Too much to send at once.",
};

async function askCoach() {
  if (!coach.sample || !state.analysis) return;
  const ctl = new AbortController();
  coach.ctl = ctl;
  el("coach-ask").disabled = true;
  el("coach-stop").hidden = false;
  el("coach-text").textContent = "";
  el("coach-status").textContent = "Thinking\u2026";
  const options = {
    signal: ctl.signal,
    onText: ({ text }) => {
      el("coach-status").textContent = "";
      el("coach-text").textContent = text;
    },
  };
  let withImage = false;
  if (coach.images) {
    const sheet = await contactSheet();
    if (sheet) { options.images = [sheet]; withImage = true; }
  }
  try {
    const { text, truncated } = await coach.sample(coachPrompt(withImage), options);
    el("coach-text").textContent = text;
    el("coach-status").textContent = truncated ? "The read was cut short." : "";
    el("coach-ask").hidden = true;
  } catch (error) {
    const code = error && error.code;
    if (code === "cancelled") {
      el("coach-status").textContent = "";
      el("coach-text").textContent = (error && error.text) || "";
    } else if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled",
                "capability_removed"].includes(code)) {
      hideCoach();
      return;
    } else if (code === "images_unavailable") {
      coach.images = false;
      resetCoach();
      el("coach-status").textContent = "Pictures cannot be sent from here. Ask again for a read of the measurements.";
      return;
    } else {
      if (code !== "refused") el("coach-text").textContent = (error && error.text) || "";
      el("coach-status").textContent = COACH_ERRORS[code] ||
        "The read was interrupted. Try again.";
    }
    el("coach-ask").disabled = false;
  } finally {
    if (coach.ctl === ctl) coach.ctl = null;
    el("coach-stop").hidden = true;
  }
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
  const buffer = LOCAL ? await deadline(loadChunks(LOCAL.model), 300000, NO_ESTIMATOR) : null;
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
  if (!(video.duration > 0) || !isFinite(video.duration)) {
    URL.revokeObjectURL(url);
    throw new Error(
      "That file has no readable duration, so it cannot be stepped through frame " +
      "by frame. Re-exporting it from Photos usually fixes it.");
  }
  return { video, url };
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
          handed.push(onFrame(t, frame, rotation));
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
  return { detect, width, height };
}

/* Find the swing in a long clip: the fastest the hands move, and the motion around it.
 *
 * Hand speed is measured in torso lengths a second, so it means the same thing
 * whether the golfer fills the frame or stands at the back of it. The window is the
 * stretch around the peak where the hands are still moving, padded so the model
 * sees the address before it and the held finish after it - it was trained on clips
 * with both - and never shorter than a normal swing needs, because a slow-motion
 * clip stretches all of it.
 */
async function scanForSwing(duration, tracker, frames) {
  const baseMs = state.clockMs + 1000;
  const samples = [];
  await frames(1 / SCAN_RATE_HZ, (t, source, rotation) => {
    const { result } = tracker.detect(t, baseMs, source, rotation, false);
    const marks = result && result.landmarks && result.landmarks[0];
    samples.push({ t, marks: marks || null });
    progress(0.05 + 0.2 * Math.min(1, t / duration));
    status("Looking for the swing", `${t.toFixed(0)} of ${duration.toFixed(0)} s`);
  });
  const w = tracker.width, h = tracker.height;
  const mid = (m, a, b) => [(m[a].x + m[b].x) * 0.5 * w, (m[a].y + m[b].y) * 0.5 * h];
  const speed = samples.map(() => 0);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].marks, b = samples[i].marks;
    if (!a || !b) continue;
    const [sx, sy] = mid(b, 11, 12), [hx, hy] = mid(b, 23, 24);
    const torso = Math.hypot(sx - hx, sy - hy);
    if (torso < 1) continue;
    const [ax, ay] = mid(a, 15, 16), [bx, by] = mid(b, 15, 16);
    speed[i] = Math.hypot(bx - ax, by - ay) / torso / Math.max(1e-3, samples[i].t - samples[i - 1].t);
  }
  const smooth = speed.map((_, i) =>
    (speed[Math.max(0, i - 1)] + 2 * speed[i] + speed[Math.min(speed.length - 1, i + 1)]) / 4);
  let peak = 0;
  for (let i = 1; i < smooth.length; i++) if (smooth[i] > smooth[peak]) peak = i;
  if (!(smooth[peak] > 0)) return null;
  const active = 0.25 * smooth[peak];
  let left = peak, right = peak;
  while (left > 0 && Math.max(smooth[left - 1], smooth[Math.max(0, left - 2)]) > active) left--;
  while (right < smooth.length - 1 &&
         Math.max(smooth[right + 1], smooth[Math.min(smooth.length - 1, right + 2)]) > active) right++;
  const tp = samples[peak].t;
  return {
    start: Math.max(0, Math.min(samples[left].t - 1.2, tp - 2.4)),
    end: Math.min(duration, Math.max(samples[right].t + 1.2, tp + 2.0)),
    peak: tp,
  };
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
    status("Finding the body in each frame", `${collected.times.length} frames`);
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
 * The watchdog is the point. If frames stop arriving - the decoder gives up, the tab
 * is backgrounded, the callback never fires - this returns with whatever it has
 * instead of waiting for an event that is not coming.
 */
function playThrough(video, record, end, minGap = 1 / MAX_RATE_HZ) {
  const until = end === undefined ? video.duration : end;
  return new Promise((resolve) => {
    let last = performance.now();
    let kept = -Infinity;
    let finished = false;
    const stop = () => {
      if (!finished) { finished = true; clearInterval(watchdog); video.pause(); resolve(); }
    };
    const watchdog = setInterval(() => {
      if (performance.now() - last > 8000) stop();
    }, 1000);

    /* Pausing inside the frame callback is what stops frames being dropped while
     * the estimator thinks, and it rejects whichever play() is still outstanding
     * with an AbortError. That abort is this code's own doing and means nothing has
     * gone wrong; treating it as a failure ended the loop after one frame. */
    const resume = () => video.play().catch((error) => {
      if (error && error.name === "AbortError") return;
      stop();
    });

    const onFrame = (_now, meta) => {
      if (finished) return;
      last = performance.now();
      const time = meta.mediaTime;
      if (time > until + 1e-3) { stop(); return; }
      // Closer than the model will ever look: let the video run on without
      // stopping for it. This is what keeps a 240 fps clip at 60 fps of work.
      if (time - kept < minGap - 2e-3) {
        video.requestVideoFrameCallback(onFrame);
        return;
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

async function analyse(file) {
  if (state.busy) return;
  state.busy = true;
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

    // Find the swing in a long clip, then track it frame by frame.
    const read = async (frames, width, height) => {
      const tracker = makeTracker(width, height);
      let from = 0;
      let to = duration;
      if (duration > SCAN_ABOVE_S) {
        const found = await scanForSwing(duration, tracker, frames);
        if (found) ({ start: from, end: to } = found);
        run.note({ window: found ? [Number(from.toFixed(2)), Number(to.toFixed(2))] : "none" });
        run.stage("scanned");
      }
      return { ...(await trackRange(tracker, frames, from, to)), start: from, end: to };
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
        tracked = await read(elementFrames(video), video.videoWidth, video.videoHeight);
      }
    } else {
      tracked = await read(elementFrames(video), video.videoWidth, video.videoHeight);
    }
    const { sequence, images, start, end } = tracked;
    state.images = images;
    const how = state.how || "decoded";
    run.note({
      how,
      frames: sequence.n,
      trackedFps: Number((sequence.n / Math.max(end - start, 1e-3)).toFixed(1)),
    });
    run.stage("tracked");

    progress(0.87);
    stage(2);
    status("Finding the swing", "");
    await new Promise((r) => setTimeout(r, 30));

    const config = state.payload.features;
    const thresholds = state.payload.thresholds;
    const { sequence: resampled, grid } = resamplePose(sequence, config.canonical_rate_hz);

    const detectionRate = resampled.detected.reduce((a, b) => a + (b ? 1 : 0), 0) / resampled.n;
    run.note({ detection: Number(detectionRate.toFixed(3)) });
    if (detectionRate < thresholds.min_detection_rate) {
      return refuse(
        `a body was found in only ${Math.round(detectionRate * 100)} percent of frames, ` +
        `below the ${Math.round(thresholds.min_detection_rate * 100)} percent a swing needs`,
        "Make sure the golfer is fully in shot for the whole clip and reasonably well lit. " +
        "Standing further back so the whole body fits beats filling the frame and losing the feet.");
    }

    const model = (hand) => {
      const { features, n, width } = extractFeatures(resampled, hand, config);
      const logits = state.net.forward(features, n, width);
      return decodeEvents(logits, n, state.payload.architecture.classes,
                          thresholds.min_mean_confidence);
    };
    // Handedness only reaches a few of the model's inputs, so a first pass either
    // way finds the top well enough to ask the body which way round it is.
    let handedness = state.handedness === "left" ? "left" : "right";
    let decoded = model(handedness);
    let handednessFrom = "chosen";
    if (state.handedness === "auto" && decoded.ok) {
      const call = inferHandedness(resampled, decoded.frames[3]);
      if (call) {
        handednessFrom = "detected";
        run.note({ handedness: call.hand, handednessMargin: Number(call.margin.toFixed(3)) });
        if (call.hand !== handedness) {
          handedness = call.hand;
          decoded = model(handedness);
        }
      } else {
        handednessFrom = "assumed";
      }
    }
    state.handednessFrom = handednessFrom;
    run.stage("modelled");
    if (!decoded.ok) {
      return refuse(decoded.reason,
        "This is most often a clip that stops before the finish, or one filmed from " +
        "behind the golfer where the body hides itself. Face on, square to the target " +
        "line, is what it handles best.");
    }

    const metrics = computeMetrics(resampled, decoded, handedness, config);
    const problem = implausible(metrics, thresholds);
    if (problem) {
      return refuse(problem,
        "The clip probably does not contain a whole swing. Start recording before the " +
        "takeaway and keep going until the finish is held.");
    }

    state.analysis = { sequence, resampled, grid, decoded, metrics, detectionRate,
                       handedness, config, model: decoded, userSet: new Set() };
    progress(0.92);
    stage(3);
    status("Drawing the key frames", "");
    await renderFrames(sequence, decoded, metrics, detectionRate);
    run.end({
      outcome: "analysed",
      tempo: metrics.tempoRatio === null ? null : Number(metrics.tempoRatio.toFixed(3)),
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
  if (coach.ctl) coach.ctl.abort();
  show("coach-section", false);
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
  el("refusal").scrollIntoView({ behavior: "smooth", block: "nearest" });
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

/* A tracked frame, exactly as it was tracked, with its pose drawn on. */
async function frameCanvas(sequence, index) {
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
  drawPose(canvas, sequence.xy[index], sequence.visibility[index]);
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
        : bandMarkup(state.payload.calibration, e, decoded.confidence[e]) +
          `<span class="conf"><i style="width:${(decoded.confidence[e] * 100).toFixed(0)}%"></i></span>`);
    figure.appendChild(caption);
    strip.appendChild(figure);
    if (!quiet) progress(0.92 + 0.08 * ((e + 1) / 8));
  }
  state.frames = frames;

  showBandNote(state.payload.calibration, decoded);
  showMetrics(metrics, decoded, detectionRate, sequence);
  renderStory(metrics);
  resetCoach();
  show("results", true);
  if (!quiet) el("results").scrollIntoView({ behavior: "smooth", block: "start" });
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
  note.innerHTML =
    `The &plusmn; figures are measured, not assumed. This model was run over ` +
    `${band.measuredOn}, and the spread of its errors recorded. Each figure is the ` +
    `distance that contained ${Math.round(band.coverage * 100)}% of those errors at the ` +
    `confidence the model reported here, so a doubtful event gets a wider band than a ` +
    `certain one. A band appears only where enough held-out clips landed at that ` +
    `confidence to measure one, and none of this is a claim about footage of a real ` +
    `golfer on grass.`;
}


const card = (label, value, unit, note, provenance, range) => `
  <div class="metric">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit">${unit || ""}</span></div>
    ${range || ""}
    <div class="metric-foot"><span class="prov prov-${provenance}">${provenance.replace("_", " ")}</span>
      ${note ? `<span class="metric-hint">${note}</span>` : ""}</div>
  </div>`;

/* The measured spread on the tempo ratio, or nothing where none was measured.
 * Never a range of zero: absent and exact are not the same statement. */
function tempoRange(calibration, tempo) {
  const band = calibration && calibration.tempo;
  if (!band) return "";
  const spread = Math.abs(tempo) * band.half_width_fraction;
  const note = `+/-${Math.round(100 * band.half_width_fraction)}% for ` +
    `${Math.round(100 * band.coverage)}% of ${band.n_calibration} held-out swings on ` +
    band.measured_on;
  return `<div class="metric-range" title="${note}">measured spread ` +
    `${(tempo - spread).toFixed(2)} &ndash; ${(tempo + spread).toFixed(2)}</div>`;
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
  const follow = m.wholeMs - m.backswingMs - m.downswingMs;
  const ratio = m.tempoRatio;
  const tempoNote = ratio === null ? "" :
    ratio >= 2.7 && ratio <= 3.3 ? "which sits in the band tour players are usually quoted at, near 3 to 1" :
    ratio > 3.3 ? "a longer backswing relative to the downswing than the 3 to 1 tour players are usually quoted at" :
    "a quicker backswing relative to the downswing than the 3 to 1 tour players are usually quoted at";
  const beats = [];
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
    `The follow-through took <b>${s(follow)} s</b>, and the whole motion ` +
    `<b>${s(m.wholeMs)} s</b> from address to a held finish.`, "measured"]);

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

  el("tempo-cards").innerHTML =
    card("Tempo ratio", m.tempoRatio.toFixed(2), "", "backswing ÷ downswing", "derived",
         tempoRange(state.payload.calibration, m.tempoRatio)) +
    card("Backswing", Math.round(m.backswingMs), "ms", "address → top", "measured") +
    card("Downswing", Math.round(m.downswingMs), "ms", "top → impact", "measured") +
    card("Whole swing", Math.round(m.wholeMs), "ms", "address → finish", "measured") +
    card("Peak hand speed", Math.round(m.peakHandSpeedMs), "ms",
         "relative to impact; negative is before", "measured");

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
    // Downloads are refused where this build is served, so the numbers go to the
    // clipboard instead - and say so, rather than looking like nothing happened.
    el("download").textContent = "Copy the numbers as JSON";
    el("download").onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        el("download").textContent = "Copied";
      } catch {
        el("download").textContent = "Copy refused by this browser";
      }
      setTimeout(() => { el("download").textContent = "Copy the numbers as JSON"; }, 2000);
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
  const position = Math.max(0, Math.min(resampled.n - 1, (time - grid[0]) * rate));
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
  analysis.metrics = computeMetrics(analysis.resampled, next, analysis.handedness, analysis.config);
  const byModel = computeMetrics(analysis.resampled, analysis.model, analysis.handedness, analysis.config);
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


export function boot(payload) {
  state.payload = payload;
  connectReports();
  connectCoach();
  el("coach-ask").onclick = () => askCoach();
  el("coach-stop").onclick = () => { if (coach.ctl) coach.ctl.abort(); };
  state.net = new SwingEventNet(payload);
  state.handedness = "auto";
  wireLightbox();

  const input = el("file");
  const pick = () => input.click();
  el("browse").onclick = (e) => { e.stopPropagation(); pick(); };
  input.onchange = () => { if (input.files[0]) analyse(input.files[0]); input.value = ""; };

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
        analyse(new File([blob], pick.src.split("/").pop(), { type: pick.type }));
      } catch (error) {
        failed(new Error(`Could not load the sample swing.\n\n(${error.message})`));
      }
    };
    el("footer-note").textContent =
      "Runs entirely in your browser. The clip never leaves this device, and the pose " +
      "estimator is loaded from this page rather than from anyone else's servers. Each " +
      "run leaves a short technical note for the page's owner - browser, video format, " +
      "timings, any error, and how far any position you moved was from the model's - " +
      "never the video, a frame or its name - so failures can be fixed.";
  }

  for (const id of ["again", "again-bottom"]) {
    el(id).onclick = () => {
      el("drop").scrollIntoView({ behavior: "smooth", block: "center" });
      pick();
    };
  }
}
