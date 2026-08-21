/* The analyser, in the browser.
 *
 * This is a port of the Python pipeline, not a reimplementation of the idea. Every
 * step below mirrors a specific function on the other side, and where the two
 * disagree the Python is right - it is the one with the tests. A verification
 * script runs the same clip through both and compares, because a port that is
 * almost the same is worse than no port: it produces plausible numbers that
 * quietly differ from the ones the model was validated against.
 */

// ---------------------------------------------------------------- landmarks

export const L = {
  NOSE: 0, LEFT_EAR: 7, RIGHT_EAR: 8,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

/* The subset the features are built from, in the order Python uses. Getting this
 * order wrong would not throw; it would silently shuffle the input channels. */
export const SWING_LANDMARKS = [
  L.NOSE, L.LEFT_EAR, L.RIGHT_EAR,
  L.LEFT_SHOULDER, L.RIGHT_SHOULDER,
  L.LEFT_ELBOW, L.RIGHT_ELBOW,
  L.LEFT_WRIST, L.RIGHT_WRIST,
  L.LEFT_INDEX, L.RIGHT_INDEX,
  L.LEFT_HIP, L.RIGHT_HIP,
  L.LEFT_KNEE, L.RIGHT_KNEE,
  L.LEFT_ANKLE, L.RIGHT_ANKLE,
  L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX,
];

export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
  [0, 7], [0, 8],
];

export const EVENT_NAMES = [
  "Address", "Toe Up", "Mid Backswing", "Top",
  "Mid Downswing", "Impact", "Mid Follow Through", "Finish",
];
export const CLUB_DEFINED = new Set([1, 6]);

// ---------------------------------------------------------------- maths

function median(values) {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/* Matches numpy.gradient: central differences inside, one-sided at the ends, and
 * spacing taken from the sample positions rather than assumed uniform. */
function gradient(values, positions) {
  const n = values.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  out[0] = (values[1] - values[0]) / (positions[1] - positions[0]);
  out[n - 1] = (values[n - 1] - values[n - 2]) / (positions[n - 1] - positions[n - 2]);
  for (let i = 1; i < n - 1; i++) {
    const back = positions[i] - positions[i - 1];
    const forward = positions[i + 1] - positions[i];
    out[i] =
      (back * back * values[i + 1] +
        (forward * forward - back * back) * values[i] -
        forward * forward * values[i - 1]) /
      (back * forward * (back + forward));
  }
  return out;
}

// ---------------------------------------------------------------- pose

/* Landmarks for a clip. xy is image-normalised exactly as the estimator reports,
 * so x and y are not in the same units unless the frame is square. */
export class PoseSequence {
  constructor(xy, visibility, world, detected, times, width, height) {
    this.xy = xy;                 // [frame][33][2]
    this.visibility = visibility; // [frame][33]
    this.world = world;           // [frame][33][3]
    this.detected = detected;     // [frame]
    this.times = times;           // seconds
    this.width = width;
    this.height = height;
  }
  get n() { return this.times.length; }
  get aspect() { return this.width / this.height; }

  /* Square units, so an angle taken from these means something. Skipping this
   * distorts every angle by the aspect ratio - 1.78 on a phone clip, which is
   * large enough to be wrong and small enough to look fine. */
  squareXY() {
    return this.xy.map((frame) => frame.map(([x, y]) => [x * this.aspect, y]));
  }
}

/* Resample onto a uniform grid using the real frame times. Linear, not smooth: a
 * higher-order interpolant overshoots at the top of the backswing and at impact,
 * which are the two instants being looked for. */
export function resamplePose(sequence, rateHz) {
  const source = sequence.times;
  if (source.length < 2) return { sequence, grid: source.slice() };

  const duration = source[source.length - 1] - source[0];
  const count = Math.max(2, Math.round(duration * rateHz) + 1);
  const grid = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    grid[i] = Math.min(source[0] + i / rateHz, source[source.length - 1]);
  }

  const xy = [], visibility = [], world = [], detected = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const t = grid[i];
    while (cursor < source.length - 2 && source[cursor + 1] < t) cursor++;
    const t0 = source[cursor], t1 = source[cursor + 1];
    const blend = t1 > t0 ? (t - t0) / (t1 - t0) : 0;

    const a = sequence.xy[cursor], b = sequence.xy[cursor + 1];
    const av = sequence.visibility[cursor], bv = sequence.visibility[cursor + 1];
    const aw = sequence.world[cursor], bw = sequence.world[cursor + 1];

    xy.push(a.map((p, k) => [p[0] + (b[k][0] - p[0]) * blend, p[1] + (b[k][1] - p[1]) * blend]));
    visibility.push(av.map((v, k) => v + (bv[k] - v) * blend));
    world.push(aw.map((p, k) => [
      p[0] + (bw[k][0] - p[0]) * blend,
      p[1] + (bw[k][1] - p[1]) * blend,
      p[2] + (bw[k][2] - p[2]) * blend,
    ]));
    // Nearest neighbour, so a gap cannot be filled in by averaging across it.
    detected.push(sequence.detected[blend < 0.5 ? cursor : cursor + 1]);
  }

  return {
    sequence: new PoseSequence(xy, visibility, world, detected, Array.from(grid),
                               sequence.width, sequence.height),
    grid,
  };
}

const mid = (frame, a, b) => [
  0.5 * (frame[a][0] + frame[b][0]),
  0.5 * (frame[a][1] + frame[b][1]),
];

/* A length taken from the golfer, so everything else can be dimensionless.
 * Shoulder centre to ankle centre changes least through a swing; the median over
 * the clip is used so the finish cannot drag it. Falls back to torso length when
 * the feet are out of shot, which is common in portrait video. */
export function bodyScale(square, visibility, minVisibility) {
  const heights = [], torsos = [];
  for (let i = 0; i < square.length; i++) {
    const shoulders = mid(square[i], L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
    const hips = mid(square[i], L.LEFT_HIP, L.RIGHT_HIP);
    const ankles = mid(square[i], L.LEFT_ANKLE, L.RIGHT_ANKLE);
    torsos.push(Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]));
    const seen = Math.min(visibility[i][L.LEFT_ANKLE], visibility[i][L.RIGHT_ANKLE]);
    if (seen >= minVisibility) {
      heights.push(Math.hypot(shoulders[0] - ankles[0], shoulders[1] - ankles[1]));
    }
  }
  if (heights.length >= Math.max(3, 0.25 * square.length)) {
    const scale = median(heights);
    if (scale > 1e-6) return scale;
  }
  return Math.max(median(torsos) * 3.0, 1e-6);
}

/* Median tilt of the golfer's long axis, taken to be the camera's roll. Over a
 * whole swing the golfer's own lean goes one way and then the other, so what is
 * left is the phone's. */
export function bodyAxisAngle(square, visibility, minVisibility) {
  const angles = [], all = [];
  for (let i = 0; i < square.length; i++) {
    const shoulders = mid(square[i], L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
    const hips = mid(square[i], L.LEFT_HIP, L.RIGHT_HIP);
    const dx = shoulders[0] - hips[0], dy = shoulders[1] - hips[1];
    const angle = Math.atan2(dx, -dy); // image y runs down, so upright is negative
    all.push(angle);
    const seen = Math.min(visibility[i][L.LEFT_SHOULDER], visibility[i][L.RIGHT_SHOULDER]);
    if (seen >= minVisibility) angles.push(angle);
  }
  return median(angles.length ? angles : all);
}

export function normalisePose(sequence, config) {
  const square = sequence.squareXY();
  const scale = bodyScale(square, sequence.visibility, config.min_visibility);
  const roll = config.normalise_roll
    ? bodyAxisAngle(square, sequence.visibility, config.min_visibility)
    : 0;
  const cos = Math.cos(-roll), sin = Math.sin(-roll);

  return square.map((frame) => {
    const pelvis = mid(frame, L.LEFT_HIP, L.RIGHT_HIP);
    return frame.map(([x, y]) => {
      const cx = (x - pelvis[0]) / scale;
      const cy = (y - pelvis[1]) / scale;
      return roll === 0 ? [cx, cy] : [cx * cos - cy * sin, cx * sin + cy * cos];
    });
  });
}

const unit = (x, y) => {
  const n = Math.max(Math.hypot(x, y), 1e-6);
  return [x / n, y / n];
};

/* The feature matrix, in exactly the block order Python assembles it in. */
export function extractFeatures(sequence, handedness, config) {
  const coords = normalisePose(sequence, config);
  const times = sequence.times;
  const n = times.length;
  const K = SWING_LANDMARKS.length;
  const width = config.layout.total;
  const out = new Float32Array(n * width);

  const lead = handedness === "left"
    ? { shoulder: L.RIGHT_SHOULDER, wrist: L.RIGHT_WRIST }
    : { shoulder: L.LEFT_SHOULDER, wrist: L.LEFT_WRIST };
  const trail = handedness === "left"
    ? { shoulder: L.LEFT_SHOULDER, wrist: L.LEFT_WRIST }
    : { shoulder: L.RIGHT_SHOULDER, wrist: L.RIGHT_WRIST };

  // Velocities need the whole track per channel, so build columns first.
  const px = [], py = [];
  for (let k = 0; k < K; k++) {
    const index = SWING_LANDMARKS[k];
    px.push(Float64Array.from(coords, (frame) => frame[index][0]));
    py.push(Float64Array.from(coords, (frame) => frame[index][1]));
  }
  const vx = px.map((track) => gradient(track, times));
  const vy = py.map((track) => gradient(track, times));

  const handsX = Float64Array.from(coords, (f) => 0.5 * (f[L.LEFT_WRIST][0] + f[L.RIGHT_WRIST][0]));
  const handsY = Float64Array.from(coords, (f) => 0.5 * (f[L.LEFT_WRIST][1] + f[L.RIGHT_WRIST][1]));
  const handVX = gradient(handsX, times);
  const handVY = gradient(handsY, times);

  for (let i = 0; i < n; i++) {
    const row = i * width;
    const frame = coords[i];
    let c = 0;

    for (let k = 0; k < K; k++) { out[row + c++] = px[k][i]; out[row + c++] = py[k][i]; }
    for (let k = 0; k < K; k++) { out[row + c++] = vx[k][i]; out[row + c++] = vy[k][i]; }
    for (let k = 0; k < K; k++) out[row + c++] = Math.hypot(vx[k][i], vy[k][i]);
    for (let k = 0; k < K; k++) out[row + c++] = sequence.visibility[i][SWING_LANDMARKS[k]];

    const shoulderLine = [frame[L.LEFT_SHOULDER][0] - frame[L.RIGHT_SHOULDER][0],
                          frame[L.LEFT_SHOULDER][1] - frame[L.RIGHT_SHOULDER][1]];
    const hipLine = [frame[L.LEFT_HIP][0] - frame[L.RIGHT_HIP][0],
                     frame[L.LEFT_HIP][1] - frame[L.RIGHT_HIP][1]];
    const shoulderCentre = mid(frame, L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
    const hipCentre = mid(frame, L.LEFT_HIP, L.RIGHT_HIP);
    const spine = [shoulderCentre[0] - hipCentre[0], shoulderCentre[1] - hipCentre[1]];
    const leadArm = [frame[lead.wrist][0] - frame[lead.shoulder][0],
                     frame[lead.wrist][1] - frame[lead.shoulder][1]];
    const trailArm = [frame[trail.wrist][0] - frame[trail.shoulder][0],
                      frame[trail.wrist][1] - frame[trail.shoulder][1]];

    for (const v of [shoulderLine, hipLine, spine, leadArm, trailArm]) {
      const [ux, uy] = unit(v[0], v[1]);
      out[row + c++] = ux; out[row + c++] = uy;
    }

    out[row + c++] = handsX[i] - shoulderCentre[0];
    out[row + c++] = handsY[i] - shoulderCentre[1];
    out[row + c++] = handVX[i];
    out[row + c++] = handVY[i];
    out[row + c++] = Math.hypot(handVX[i], handVY[i]);
    out[row + c++] = Math.hypot(shoulderLine[0], shoulderLine[1]);
    out[row + c++] = Math.hypot(hipLine[0], hipLine[1]);
    out[row + c++] = Math.hypot(leadArm[0], leadArm[1]);
  }

  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
  return { features: out, n, width };
}
