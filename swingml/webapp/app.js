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
         BONES, EVENT_NAMES, CLUB_DEFINED } from "./engine.js";
import { SwingEventNet, decodeEvents, errorBand } from "./model.js";
import { computeMetrics, implausible } from "./metrics.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";

const el = (id) => document.getElementById(id);
const state = { net: null, landmarker: null, busy: false, last: null };

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

  const vision = await deadline(
    import(`${MEDIAPIPE}/vision_bundle.mjs`), 60000, NO_ESTIMATOR);
  const files = await deadline(
    vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`), 120000, NO_ESTIMATOR);

  // The GPU path is faster and is not everywhere: a machine without WebGL, or a
  // browser that has switched it off, fails here rather than falling back on its
  // own. Trying the processor afterwards costs one retry and turns a dead page
  // into a slow one.
  const options = {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    state.landmarker = await deadline(
      vision.PoseLandmarker.createFromOptions(files, options), 180000, NO_ESTIMATOR);
  } catch (error) {
    if (String(error.message).startsWith("Could not load")) throw error;
    status("Loading the pose estimator", "no graphics acceleration; using the processor");
    state.landmarker = await deadline(
      vision.PoseLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
      }), 180000, NO_ESTIMATOR);
  }
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
  "iPhones record in HEVC (H.265) by default, and most browsers on Windows and " +
  "Linux cannot decode it. Safari can, and Chrome on a Mac usually can.\n\n" +
  "Two ways round it: set the phone to Settings \u203a Camera \u203a Formats \u203a " +
  "Most Compatible before recording, or open this page in Safari.";

/* Step the whole clip, one frame at a time, collecting landmarks and throwing the
 * pixels away. Only the frames the interface will actually show are kept.
 *
 * Two ways of stepping, because the good one is not everywhere. Chrome and Safari
 * have requestVideoFrameCallback, which hands over each frame as it is decoded
 * along with the exact time it belongs to - that is the one to use, because the
 * time comes from the container rather than being assumed. Firefox does not have
 * it at all, and there are builds where it exists and never fires. Seeking frame
 * by frame works everywhere, so that is the fallback, and the page says which one
 * it used rather than quietly producing worse numbers.
 */
async function extractPose(file, wanted) {
  const video = el("scratch-video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();

  try {
    await waitFor(video, "loadedmetadata", { timeout: 20000, what: UNREADABLE });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  if (!video.videoWidth || !video.videoHeight) {
    URL.revokeObjectURL(url);
    throw new Error(UNREADABLE);
  }
  if (!(video.duration > 0) || !isFinite(video.duration)) {
    URL.revokeObjectURL(url);
    throw new Error(
      "That file has no readable duration, so it cannot be stepped through frame " +
      "by frame. Re-exporting it from Photos usually fixes it.");
  }

  const canvas = el("scratch-canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const collected = { xy: [], visibility: [], world: [], detected: [], times: [] };

  const record = (time) => {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    let stamp = Math.round(time * 1000);
    if (stamp <= collected.lastMs) stamp = collected.lastMs + 1;
    collected.lastMs = stamp;

    let result = null;
    try { result = state.landmarker.detectForVideo(canvas, stamp); } catch { result = null; }

    const marks = result && result.landmarks && result.landmarks[0];
    const found = Boolean(marks);
    const previous = collected.xy.length ? collected.xy[collected.xy.length - 1] : null;

    // An undetected frame keeps the last known pose at zero confidence rather
    // than being dropped: dropping it would compress the time axis, and time is
    // what tempo is measured from.
    collected.xy.push(found ? marks.map((m) => [m.x, m.y])
                            : (previous || Array.from({ length: 33 }, () => [0, 0])));
    collected.visibility.push(found
      ? marks.map((m) => Math.min(m.visibility ?? 1, m.presence ?? 1))
      : new Array(33).fill(0));
    const w = result && result.worldLandmarks && result.worldLandmarks[0];
    collected.world.push(w ? w.map((m) => [m.x, m.y, m.z]) : new Array(33).fill([0, 0, 0]));
    collected.detected.push(found);
    collected.times.push(time + collected.times.length * 1e-9);

    const index = collected.times.length - 1;
    if (wanted && wanted.has(index)) {
      const keep = document.createElement("canvas");
      keep.width = canvas.width; keep.height = canvas.height;
      keep.getContext("2d").drawImage(canvas, 0, 0);
      wanted.set(index, keep);
    }

    progress(0.05 + 0.75 * Math.min(1, time / video.duration));
    status("Finding the body in each frame", `${collected.times.length} frames`);
  };
  collected.lastMs = -1;

  const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let how = hasFrameCallback ? "played" : "stepped";
  if (hasFrameCallback) {
    await playThrough(video, record);
    // It exists and produced nothing, which happens. Seeking still might work.
    if (collected.times.length < 2) {
      how = "stepped";
      collected.xy.length = 0; collected.visibility.length = 0; collected.world.length = 0;
      collected.detected.length = 0; collected.times.length = 0; collected.lastMs = -1;
    }
  }
  if (how === "stepped") await seekThrough(video, record);

  URL.revokeObjectURL(url);
  if (collected.times.length < 2) {
    throw new Error(
      "The video opened but no frames could be read from it. That usually means the " +
      "browser can display it but cannot decode it fast enough to step through. " +
      "Safari handles iPhone clips best.");
  }
  return {
    sequence: new PoseSequence(collected.xy, collected.visibility, collected.world,
                               collected.detected, collected.times,
                               video.videoWidth, video.videoHeight),
    video,
    how,
  };
}

/* Play the clip and take each frame the decoder hands over.
 *
 * The watchdog is the point. If frames stop arriving - the decoder gives up
 * halfway, the tab is backgrounded, the callback simply never fires - this
 * returns with whatever it has instead of waiting for an event that is not
 * coming. Whatever it has is either enough to analyse or few enough that the
 * caller falls back to seeking.
 */
function playThrough(video, record) {
  return new Promise((resolve) => {
    let last = performance.now();
    let finished = false;
    const stop = () => { if (!finished) { finished = true; clearInterval(watchdog); resolve(); } };
    const watchdog = setInterval(() => {
      if (performance.now() - last > 8000) stop();
    }, 1000);

    /* Pausing inside the frame callback is the whole technique - it is what stops
     * frames being dropped while the estimator thinks - and it rejects whichever
     * play() is still outstanding with an AbortError. That abort is this code's
     * own doing and means nothing has gone wrong. Treating it as a failure ends
     * the loop after a single frame, and the clip then falls through to the slow
     * path and comes back with different numbers, which is how it was found. */
    const resume = () => video.play().catch((error) => {
      if (error && error.name === "AbortError") return;
      stop();
    });

    const onFrame = (_now, meta) => {
      if (finished) return;
      video.pause();
      last = performance.now();
      try {
        record(meta.mediaTime);
      } catch (error) {
        console.error(error);
        stop();
        return;
      }
      if (video.ended || meta.mediaTime >= video.duration - 1e-3) { stop(); return; }
      video.requestVideoFrameCallback(onFrame);
      resume();
    };

    video.onended = stop;
    video.onerror = stop;
    video.requestVideoFrameCallback(onFrame);
    resume();
  });
}

/* Walk the clip by seeking, for browsers with no frame callback.
 *
 * Nothing here can ask a video element what its frame rate is, so the clip is
 * sampled at a fixed sixty per second - fast enough not to miss a frame of
 * anything a phone records. A thirty-frame clip is therefore visited twice per
 * frame, and the second visit has to be thrown away rather than recorded.
 *
 * Thrown away by looking at the picture, because the obvious test does not work:
 * after a seek, currentTime reads back the time that was asked for rather than
 * the time of the frame actually being shown, so consecutive samples never look
 * like duplicates however duplicated they are. Recording them anyway held every
 * frame for two samples, which turned smooth motion into a staircase, put a
 * sawtooth through every velocity the model reads, and moved the tempo it
 * returned by a quarter. Comparing a sixteen-by-sixteen thumbnail of each frame
 * against the last one costs nothing and settles it on what is actually on
 * screen.
 */
async function seekThrough(video, record) {
  const step = 1 / 60;
  const limit = performance.now() + 180000;
  const thumb = document.createElement("canvas");
  thumb.width = 16;
  thumb.height = 16;
  const thumbContext = thumb.getContext("2d", { willReadFrequently: true });
  let previous = null;

  for (let t = 0; t < video.duration - 1e-3; t += step) {
    if (performance.now() > limit) break;
    const seeked = waitFor(video, "seeked", { timeout: 8000, what: "seek stalled" });
    video.currentTime = Math.min(t, video.duration - 1e-3);
    try {
      await seeked;
    } catch {
      break;
    }

    thumbContext.drawImage(video, 0, 0, thumb.width, thumb.height);
    const signature = thumbContext.getImageData(0, 0, thumb.width, thumb.height).data;
    if (previous && sameFrame(previous, signature)) continue;
    previous = signature.slice();
    record(t);
  }
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
  show("results", false);
  show("refusal", false);
  show("working", true);
  stage(0);
  // Confirm what was picked. Without it the panel looks identical whether the
  // file was taken or silently ignored, which is exactly the ambiguity that made
  // the last failure so hard to describe.
  el("drop-main").textContent = file.name;
  el("drop-sub").textContent =
    `${(file.size / 1e6).toFixed(1)} MB \u00b7 choose another to start again`;
  progress(0.02);

  try {
    await ready();
    stage(1);
    status("Reading the clip", file.name);

    const wanted = new Map();
    const { sequence, how } = await extractPose(file, wanted);
    state.how = how;

    progress(0.84);
    stage(2);
    status("Finding the swing", "");
    await new Promise((r) => setTimeout(r, 30));

    const config = state.payload.features;
    const thresholds = state.payload.thresholds;
    const { sequence: resampled, grid } = resamplePose(sequence, config.canonical_rate_hz);

    const detectionRate = resampled.detected.reduce((a, b) => a + (b ? 1 : 0), 0) / resampled.n;
    if (detectionRate < thresholds.min_detection_rate) {
      return refuse(
        `a body was found in only ${Math.round(detectionRate * 100)} percent of frames, ` +
        `below the ${Math.round(thresholds.min_detection_rate * 100)} percent a swing needs`,
        "Make sure the golfer is fully in shot for the whole clip and reasonably well lit. " +
        "Standing further back so the whole body fits beats filling the frame and losing the feet.");
    }

    const handedness = state.handedness;
    const { features, n, width } = extractFeatures(resampled, handedness, config);
    const logits = state.net.forward(features, n, width);
    const decoded = decodeEvents(logits, n, state.payload.architecture.classes,
                                 thresholds.min_mean_confidence);
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

    // Back onto the frames of the file the user actually gave us.
    const sourceFrames = metrics.eventTimes.map((t) => {
      let best = 0, gap = Infinity;
      for (let i = 0; i < sequence.times.length; i++) {
        const d = Math.abs(sequence.times[i] - t);
        if (d < gap) { gap = d; best = i; }
      }
      return best;
    });

    progress(0.92);
    stage(3);
    status("Drawing the key frames", "");
    const coords = normalisePose(resampled, config);
    await renderFrames(file, sourceFrames, sequence, decoded, metrics, detectionRate);
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
  const probe = document.createElement("video");
  const can = (type) => probe.canPlayType(type) || "no";
  const parts = [
    `frame callback: ${typeof probe.requestVideoFrameCallback === "function" ? "yes" : "no"}`,
    `h264: ${can('video/mp4; codecs="avc1.42E01E"')}`,
    `hevc: ${can('video/mp4; codecs="hvc1"')}`,
    `quicktime: ${can("video/quicktime")}`,
    navigator.userAgent,
  ];
  return parts.join(" \u00b7 ");
}

/* Fetch back only the frames worth looking at. The clip was streamed and thrown
 * away, which is what lets it be any length; eight seeks is cheap. */
async function renderFrames(file, sourceFrames, sequence, decoded, metrics, detectionRate) {
  const video = el("scratch-video");
  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();
  await waitFor(video, "loadeddata", { timeout: 20000, what: UNREADABLE });

  const strip = el("strip");
  strip.innerHTML = "";
  const frames = [];
  for (let e = 0; e < 8; e++) {
    const frameIndex = sourceFrames[e];
    const time = sequence.times[Math.min(frameIndex, sequence.times.length - 1)];
    const seeked = waitFor(video, "seeked", {
      timeout: 8000,
      what: "The clip stopped responding while its key frames were being fetched.",
    });
    video.currentTime = Math.min(time, video.duration - 1e-3);
    await seeked;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    drawPose(canvas, sequence.xy[frameIndex], sequence.visibility[frameIndex]);

    const figure = document.createElement("figure");
    figure.className = "frame";
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", `${EVENT_NAMES[e]}, see full size`);
    // The full-resolution canvas never goes into the strip - only a thumbnail
    // drawn from it does - so it is free to be handed to the lightbox and
    // costs nothing to keep.
    frames.push({ canvas, label: EVENT_NAMES[e], time: metrics.eventTimes[e] });
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
    caption.innerHTML =
      `<span class="frame-label">${EVENT_NAMES[e]}${CLUB_DEFINED.has(e) ? '<span class="ast">*</span>' : ""}</span>` +
      `<span class="frame-time">${metrics.eventTimes[e].toFixed(3)} s</span>` +
      bandMarkup(state.payload.calibration, e, decoded.confidence[e]) +
      `<span class="conf"><i style="width:${(decoded.confidence[e] * 100).toFixed(0)}%"></i></span>`;
    figure.appendChild(caption);
    strip.appendChild(figure);
    progress(0.92 + 0.08 * ((e + 1) / 8));
  }
  URL.revokeObjectURL(video.src);
  state.frames = frames;

  showBandNote(state.payload.calibration, decoded);
  showMetrics(metrics, decoded, detectionRate, sequence);
  show("results", true);
  el("results").scrollIntoView({ behavior: "smooth", block: "start" });
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

function showMetrics(m, decoded, detectionRate, sequence) {
  el("summary").textContent =
    `${sequence.width}×${sequence.height}, ${sequence.n} frames, ` +
    `body found in ${Math.round(detectionRate * 100)}% of them` +
    (state.how === "stepped"
      ? " \u00b7 read by seeking, because this browser has no frame callback"
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
  el("download").onclick = () => {
    const blob = new Blob([JSON.stringify({ metrics: m, events: decoded }, null, 2)],
                          { type: "application/json" });
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
  const item = frames[state.frameIndex];

  const holder = el("lb-canvas");
  holder.innerHTML = "";
  holder.appendChild(item.canvas);
  el("lb-label").textContent = item.label;
  el("lb-time").textContent = `${item.time.toFixed(3)} s`;
  show("lightbox", true);
  el("lb-close").focus();
}

function closeFrame() {
  show("lightbox", false);
  el("lb-canvas").innerHTML = "";
}

function wireLightbox() {
  el("lb-close").onclick = closeFrame;
  el("lb-prev").onclick = () => openFrame(state.frameIndex - 1);
  el("lb-next").onclick = () => openFrame(state.frameIndex + 1);
  el("lightbox").addEventListener("click", (event) => {
    if (event.target === el("lightbox")) closeFrame();
  });
  document.addEventListener("keydown", (event) => {
    if (el("lightbox").hidden) return;
    if (event.key === "Escape") closeFrame();
    if (event.key === "ArrowLeft") openFrame(state.frameIndex - 1);
    if (event.key === "ArrowRight") openFrame(state.frameIndex + 1);
  });
}


export function boot(payload) {
  state.payload = payload;
  state.net = new SwingEventNet(payload);
  state.handedness = "right";
  wireLightbox();

  const input = el("file");
  const pick = () => input.click();
  el("browse").onclick = (e) => { e.stopPropagation(); pick(); };
  input.onchange = () => { if (input.files[0]) analyse(input.files[0]); input.value = ""; };

  // Two choices, so two buttons rather than a dropdown: the state is visible
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

  for (const id of ["again", "again-bottom"]) {
    el(id).onclick = () => {
      el("drop").scrollIntoView({ behavior: "smooth", block: "center" });
      pick();
    };
  }
}
