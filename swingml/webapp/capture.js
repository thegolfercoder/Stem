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

/* A range session (#56): the camera stays live and each swing is recorded by
 * itself. The page samples the estimator a few times a second and hands each
 * sample here; this decides when to start and stop recording.
 *
 * Motion is how fast the visible body moves between samples: the mean
 * displacement of the landmarks seen in both, over the time between them, in body
 * heights per second. The wrists alone will not do: they are hidden behind the
 * body at the finish, where a face-on estimator gives them visibility under 0.1.
 *
 *   start  the golfer has been framed and still for `addressSeconds`: at address.
 *          0.8 s, not 1: the fixture's golfer holds address about a second, and
 *          sampled 3 times a second a 1 s rule started after the takeaway.
 *   swing  motion reaches the swing threshold after the start. Samples further
 *          apart average the swing's speed down toward a setup's, so the threshold
 *          falls with the gap: `swingSpeed` at `denseGap` or closer, down to
 *          `sparseSwingSpeed` at `sparseGap`. On the fixture, the swing's fastest
 *          sample over every sampling phase reads at least 0.79 at 5 Hz, 0.49 at
 *          3 Hz and 0.42 at 2 Hz, against a setup's or a walk's 0.37, 0.31 and 0.28.
 *   stop   `settleSeconds` after the last swing-speed sample (the finish has
 *          settled), or `capSeconds` after the start. A stop with no swing seen is
 *          reported as such, so the page can say so rather than analyse nothing.
 *   cancel before any swing, `setupSeconds` of motion that never reaches swing
 *          speed: the golfer stood still and then walked or set up, which is not
 *          a takeaway (one reaches swing speed within about 0.3 s). The clip is
 *          discarded and the watcher waits for the real address, so a long
 *          pre-shot routine cannot use up the cap before the swing. Only on
 *          samples at most `cancelGap` apart (about 3 a second): sparser, the
 *          swing's fastest sample can come after a second of takeaway, and a
 *          missed swing costs more than a long clip.
 *
 * A stop at the cap says `swing: false` only when the samples were close enough
 * to have seen one (gaps up to `sparseGap`); otherwise `swing: null`, unknown, and
 * the page keeps the clip for the analysis to judge. A busy phone, analysing the
 * last clip while this one is recorded, samples less often.
 *
 * After a stop the golfer must move again before a new address counts, so holding
 * the finish, or standing still between balls, does not start an empty clip.
 *
 * The thresholds are judgement, set on the phone fixture (real_swing_01) sampled
 * at 5 Hz: address reads 0.03-0.06, the swing 0.26-1.6, the settled finish under
 * 0.07, walking off 0.3 (tests/test_browser_session.py). The analysis's own
 * refusals remain the test of each clip. */
export const SESSION = {
  stillSpeed: 0.10,
  swingSpeed: 0.5,
  sparseSwingSpeed: 0.36,
  denseGap: 0.2,
  sparseGap: 0.5,
  cancelGap: 0.35,
  addressSeconds: 0.8,
  setupSeconds: 1.0,
  settleSeconds: 1.5,
  capSeconds: 8,
  minVisibility: 0.5,
  minShared: 8,
  minGap: 0.05,
};

export class SwingWatcher {
  constructor(rules = SESSION) {
    this.rules = rules;
    this.state = "waiting";   // "waiting" | "recording" | "rearming"
    this.previous = null;     // { t, landmarks }
    this.heights = [];
    this.stillSince = null;
    this.startedAt = null;
    this.lastSwingAt = null;
    this.movingSince = null;
    this.widestGap = 0;
  }

  /* One live sample at time `t` (seconds): the estimator's landmarks or null, and
   * whether the framing check passes. Returns null, or { type: "start", t }, or
   * { type: "stop", t, swing, capped }, or { type: "cancel", t }. */
  push(t, landmarks, framed = true) {
    const r = this.rules;
    const motion = this.motion(t, landmarks);
    if (motion === undefined) return null;   // too soon after the last sample
    if (this.state === "recording") {
      const gap = t - this.previousT;
      this.widestGap = Math.max(this.widestGap, gap);
      if (motion !== null && motion >= this.swingThreshold(gap)) this.lastSwingAt = t;
      if (this.lastSwingAt === null) {
        const moving = motion !== null && motion >= r.stillSpeed;
        if (!moving) this.movingSince = null;
        else if (this.movingSince === null) this.movingSince = this.previousT;
        if (gap > r.cancelGap) this.movingSince = null;
        if (this.movingSince !== null && t - this.movingSince >= r.setupSeconds) {
          this.state = "waiting";
          this.stillSince = null;
          this.startedAt = null;
          this.movingSince = null;
          return { type: "cancel", t };
        }
      }
      const capped = t - this.startedAt >= r.capSeconds;
      const settled = this.lastSwingAt !== null && t - this.lastSwingAt >= r.settleSeconds;
      if (!capped && !settled) return null;
      const seen = this.lastSwingAt !== null;
      const event = { type: "stop", t, capped: capped && !settled,
                      swing: seen ? true : this.widestGap > r.sparseGap ? null : false };
      this.state = "rearming";
      this.stillSince = null;
      this.startedAt = null;
      this.lastSwingAt = null;
      this.movingSince = null;
      return event;
    }
    const still = motion !== null && motion < r.stillSpeed && framed;
    if (this.state === "rearming") {
      if (motion !== null && motion >= r.stillSpeed) this.state = "waiting";
      return null;
    }
    if (!still) { this.stillSince = null; return null; }
    if (this.stillSince === null) this.stillSince = this.previousT;
    if (t - this.stillSince < r.addressSeconds) return null;
    this.state = "recording";
    this.startedAt = t;
    this.widestGap = 0;
    this.lastSwingAt = null;
    return { type: "start", t };
  }

  /* The swing threshold for samples `gap` seconds apart (see SESSION above). */
  swingThreshold(gap) {
    const r = this.rules;
    const f = Math.min(1, Math.max(0, (gap - r.denseGap) / (r.sparseGap - r.denseGap)));
    return r.swingSpeed + f * (r.sparseSwingSpeed - r.swingSpeed);
  }

  /* Body heights per second since the last sample; null when it cannot be read,
   * undefined when this sample is too soon to use. */
  motion(t, landmarks) {
    const r = this.rules;
    const previous = this.previous;
    if (previous && t - previous.t < r.minGap) return undefined;
    this.previousT = previous ? previous.t : t;
    this.previous = { t, landmarks };
    const seen = (p) => p && (p.visibility ?? 1) >= r.minVisibility;
    if (!landmarks || landmarks.length < 33) return null;
    const ys = landmarks.filter(seen).map((p) => p.y);
    if (ys.length >= r.minShared) {
      this.heights.push(Math.max(...ys) - Math.min(...ys));
      if (this.heights.length > 9) this.heights.shift();
    }
    if (!previous || !previous.landmarks || previous.landmarks.length < 33 || !this.heights.length) return null;
    // A median body height: one sample with the feet lost must not double the motion.
    const height = [...this.heights].sort((a, b) => a - b)[Math.floor(this.heights.length / 2)];
    let sum = 0, n = 0;
    for (let i = 0; i < 33; i++) {
      const a = previous.landmarks[i], b = landmarks[i];
      if (!seen(a) || !seen(b)) continue;
      sum += Math.hypot(b.x - a.x, b.y - a.y);
      n += 1;
    }
    if (n < r.minShared || !(height > 0)) return null;
    return sum / n / (t - previous.t) / height;
  }
}
