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

function status(text, detail) {
  el("status").textContent = text;
  el("status-detail").textContent = detail || "";
}
function progress(fraction) {
  el("bar").style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

async function ready() {
  if (state.landmarker) return;
  status("Loading the pose estimator", "about 30 MB, once - your browser will cache it");
  const vision = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
  state.landmarker = await vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/* Step the whole clip, one frame at a time, collecting landmarks and throwing the
 * pixels away. Only the frames the interface will actually show are kept. */
async function extractPose(file, wanted) {
  const video = el("scratch-video");
  video.src = URL.createObjectURL(file);
  video.muted = true;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error(
      "That video could not be decoded. iPhone clips are sometimes saved as HEVC, " +
      "which not every browser can read - Safari can, and Chrome usually can. " +
      "Recording in 'Most Compatible' rather than 'High Efficiency' avoids it."));
  });

  const canvas = el("scratch-canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const xy = [], visibility = [], world = [], detected = [], times = [];
  const duration = video.duration || 0;
  let lastMs = -1;

  await new Promise((resolve) => {
    const onFrame = (_now, meta) => {
      video.pause();
      const time = meta.mediaTime;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      let stamp = Math.round(time * 1000);
      if (stamp <= lastMs) stamp = lastMs + 1;
      lastMs = stamp;

      let result = null;
      try { result = state.landmarker.detectForVideo(canvas, stamp); } catch { result = null; }

      const marks = result && result.landmarks && result.landmarks[0];
      const found = Boolean(marks);
      const previous = xy.length ? xy[xy.length - 1] : null;

      // An undetected frame keeps the last known pose at zero confidence rather
      // than being dropped: dropping it would compress the time axis, and time is
      // what tempo is measured from.
      xy.push(found ? marks.map((m) => [m.x, m.y])
                    : (previous || Array.from({ length: 33 }, () => [0, 0])));
      visibility.push(found
        ? marks.map((m) => Math.min(m.visibility ?? 1, m.presence ?? 1))
        : new Array(33).fill(0));
      const w = result && result.worldLandmarks && result.worldLandmarks[0];
      world.push(w ? w.map((m) => [m.x, m.y, m.z]) : new Array(33).fill([0, 0, 0]));
      detected.push(found);
      times.push(time + times.length * 1e-9);

      if (wanted && wanted.has(times.length - 1)) {
        const keep = document.createElement("canvas");
        keep.width = canvas.width; keep.height = canvas.height;
        keep.getContext("2d").drawImage(canvas, 0, 0);
        wanted.set(times.length - 1, keep);
      }

      if (duration) progress(0.05 + 0.75 * (time / duration));
      status("Finding the body in each frame", `${times.length} frames`);

      if (video.ended || (duration && time >= duration - 1e-3)) { resolve(); return; }
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(() => resolve());
    };
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(() => resolve());
    video.onended = resolve;
  });

  URL.revokeObjectURL(video.src);
  if (!times.length) throw new Error("No frames could be read from that video.");
  return { sequence: new PoseSequence(xy, visibility, world, detected, times,
                                      video.videoWidth, video.videoHeight), video };
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
  el("results").hidden = true;
  el("refusal").hidden = true;
  el("working").hidden = false;
  progress(0.02);

  try {
    await ready();
    status("Reading the clip", file.name);

    const wanted = new Map();
    const { sequence } = await extractPose(file, wanted);

    progress(0.84);
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

    const handedness = el("handedness").value;
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
    status("Drawing the key frames", "");
    const coords = normalisePose(resampled, config);
    await renderFrames(file, sourceFrames, sequence, decoded, metrics, detectionRate);
    progress(1);
  } catch (error) {
    refuse(error.message || String(error), "");
  } finally {
    state.busy = false;
    el("working").hidden = true;
  }
}

function refuse(reason, advice) {
  el("results").hidden = true;
  el("refusal").hidden = false;
  el("refusal-reason").textContent = reason;
  el("refusal-advice").textContent = advice || "";
}

/* Fetch back only the frames worth looking at. The clip was streamed and thrown
 * away, which is what lets it be any length; eight seeks is cheap. */
async function renderFrames(file, sourceFrames, sequence, decoded, metrics, detectionRate) {
  const video = el("scratch-video");
  video.src = URL.createObjectURL(file);
  await new Promise((resolve) => { video.onloadeddata = resolve; });

  const strip = el("strip");
  strip.innerHTML = "";
  for (let e = 0; e < 8; e++) {
    const frameIndex = sourceFrames[e];
    const time = sequence.times[Math.min(frameIndex, sequence.times.length - 1)];
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = Math.min(time, video.duration - 1e-3);
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    drawPose(canvas, sequence.xy[frameIndex], sequence.visibility[frameIndex]);

    const figure = document.createElement("figure");
    figure.className = "frame";
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

  showBandNote(state.payload.calibration, decoded);
  showMetrics(metrics, decoded, detectionRate, sequence);
  el("results").hidden = false;
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
  note.hidden = !band;
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


const card = (label, value, unit, note, provenance) => `
  <div class="metric">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit">${unit || ""}</span></div>
    <div class="metric-foot"><span class="prov prov-${provenance}">${provenance.replace("_", " ")}</span>
      ${note ? `<span class="metric-hint">${note}</span>` : ""}</div>
  </div>`;

function showMetrics(m, decoded, detectionRate, sequence) {
  el("summary").textContent =
    `${sequence.width}×${sequence.height}, ${sequence.n} frames, ` +
    `body found in ${Math.round(detectionRate * 100)}% of them`;

  el("tempo-cards").innerHTML =
    card("Tempo ratio", m.tempoRatio.toFixed(2), "", "backswing ÷ downswing", "derived") +
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

export function boot(payload) {
  state.payload = payload;
  state.net = new SwingEventNet(payload);

  const input = el("file");
  el("browse").onclick = () => input.click();
  input.onchange = () => { if (input.files[0]) analyse(input.files[0]); input.value = ""; };

  const zone = el("drop");
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files[0]) analyse(e.dataTransfer.files[0]);
  });
}
