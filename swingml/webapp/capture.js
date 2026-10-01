/* Recording a swing in the page: the parts that decide, kept apart from the camera.
 *
 * The camera, the recorder and the overlay live in app.js. What they need to know
 * (which constraints to ask for, which container to record, whether the golfer is
 * framed, whether the phone is level, whether the frame rate is enough) is decided
 * here, by plain functions that a test can call without a camera (#34).
 *
 * Nothing here sends anything anywhere. A recording becomes a File and goes down
 * the same path as a clip the golfer picked.
 */

/* Rear camera, as fast as it will go up to 60 fps, at no more than 1080 lines. What
 * the device grants is read back from the track afterwards, never assumed. */
export function cameraConstraints() {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      frameRate: { ideal: 60 },
      height: { ideal: 1080 },
    },
  };
}

/* A container this browser can record and this page can read back: MP4 where the
 * browser offers it (Safari), else WebM. `isTypeSupported` is MediaRecorder's. */
export function recordingType(isTypeSupported) {
  const candidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const type of candidates) {
    try { if (isTypeSupported(type)) return type; } catch { /* not this one */ }
  }
  return "";
}

export function extensionFor(type) {
  return type.startsWith("video/mp4") ? "mp4" : "webm";
}

/* The 30 fps caution from the known limitations, shown when the camera grants less
 * than 50 frames a second. A warning, not a block: tempo still reads at 30. */
export const LOW_RATE_HZ = 50;
export function frameRateNote(grantedHz) {
  if (!(grantedHz > 0)) return { low: false, text: "Frame rate not reported by this camera." };
  const rate = Math.round(grantedHz);
  if (grantedHz >= LOW_RATE_HZ) return { low: false, text: `Recording at ${rate} fps.` };
  return {
    low: true,
    text: `Recording at ${rate} fps. At 30 fps the hands can be lost through impact, which ` +
      "moves impact and the tempo. If your phone's camera app offers 60 fps or more, " +
      "recording there and choosing the clip gives a better reading.",
  };
}

/* Where the golfer should be. The band is the share of the frame's height the body
 * should fill, head to feet: far enough to keep the feet and the club's arc in
 * shot, near enough for the estimator to see the hands. Judgement, stated as such;
 * the analysis's own refusals remain the real test. */
export const FRAMING = {
  minHeight: 0.45,
  maxHeight: 0.85,
  edge: 0.03,
  minCentre: 0.25,
  maxCentre: 0.75,
  minVisibility: 0.5,
};

// MediaPipe Pose: nose, eyes and ears for the top; ankles, heels and toes for the feet.
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const FEET = [27, 28, 29, 30, 31, 32];

/* One live frame's landmarks ({x, y, visibility}, image-normalised) to what the
 * golfer should do. `ok` is true only when nothing needs to change. */
export function framingVerdict(landmarks, rules = FRAMING) {
  if (!landmarks || landmarks.length < 33) {
    return { ok: false, message: "Step into the frame so your whole body is seen", height: null };
  }
  const seen = (i) => (landmarks[i].visibility ?? 1) >= rules.minVisibility;
  const visible = landmarks.filter((_, i) => seen(i));
  if (visible.length < 8) {
    return { ok: false, message: "Step into the frame so your whole body is seen", height: null };
  }
  const feetSeen = FEET.filter(seen);
  const headSeen = HEAD.filter(seen);
  const ys = visible.map((p) => p.y);
  const xs = visible.map((p) => p.x);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const height = bottom - top;
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  if (feetSeen.length < 2 || bottom > 1 - rules.edge) {
    return { ok: false, message: "Step back: your feet need to be in the frame", height };
  }
  if (headSeen.length === 0 || top < rules.edge) {
    return { ok: false, message: "Step back: your head needs to be in the frame", height };
  }
  if (height > rules.maxHeight) {
    return { ok: false, message: "Step back a little: leave room for the club above you", height };
  }
  if (height < rules.minHeight) {
    return { ok: false, message: "Move closer: you are small in the frame", height };
  }
  if (centre < rules.minCentre || centre > rules.maxCentre) {
    return { ok: false, message: "Move to the middle of the frame", height };
  }
  return { ok: true, message: "Whole body in frame", height };
}

/* The phone's roll from DeviceOrientationEvent, for a phone held upright in
 * portrait (gamma) or on its side in landscape (beta). Null where the browser
 * gives no reading. Within `tolerance` degrees counts as level. */
export function levelVerdict(beta, gamma, landscape, tolerance = 3) {
  const roll = landscape ? beta : gamma;
  if (roll === null || roll === undefined || !Number.isFinite(roll)) return null;
  const degrees = Math.round(Math.abs(roll));
  if (degrees <= tolerance) return { level: true, text: "Phone level" };
  return { level: false, text: `Tilted ${degrees}°: straighten the phone` };
}
