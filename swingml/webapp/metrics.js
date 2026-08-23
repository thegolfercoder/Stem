/* The measurements, in the browser.
 *
 * A deliberately smaller set than the Python side computes. Everything here is
 * either a duration read straight off the frame times, or a length in units of
 * the golfer's own body - both of which survive an uncalibrated camera. The
 * angles that depend on the pose estimator's inferred depth are left out rather
 * than shipped with a caveat nobody reads, because on real footage that output
 * was measured failing badly enough to be refused outright.
 */

import { L, SWING_LANDMARKS, normalisePose, bodyScale, bodyAxisAngle } from "./engine.js";

const mid = (frame, a, b) => [
  0.5 * (frame[a][0] + frame[b][0]),
  0.5 * (frame[a][1] + frame[b][1]),
];

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

function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/* How far a body line has turned away from square to the camera, from how short
 * it looks. A line of fixed length seen from an angle shortens by the cosine of
 * that angle, which needs no focal length, no distance and no calibration.
 *
 * Two honest limits, both surfaced in the interface. The sign is not recoverable:
 * turning towards the camera and away from it shorten the line identically. And
 * the reference is the widest the line appeared in this clip, so it assumes the
 * body was square to the camera at some point during it. */
function turnFromForeshortening(square, visibility, a, b, from, to, frame, minVisibility) {
  const widths = [];
  for (let i = from; i < to; i++) {
    if (Math.min(visibility[i][a], visibility[i][b]) < minVisibility) continue;
    widths.push(Math.hypot(square[i][a][0] - square[i][b][0], square[i][a][1] - square[i][b][1]));
  }
  if (widths.length < 5) return null;
  const reference = percentile(widths, 0.95);
  if (reference <= 1e-6) return null;
  if (Math.min(visibility[frame][a], visibility[frame][b]) < minVisibility) return null;
  const here = Math.hypot(
    square[frame][a][0] - square[frame][b][0],
    square[frame][a][1] - square[frame][b][1],
  );
  return (Math.acos(Math.min(1, Math.max(0, here / reference))) * 180) / Math.PI;
}

const ADDRESS = 0, TOP = 3, IMPACT = 5, FINISH = 7;

export function computeMetrics(sequence, events, handedness, config) {
  const times = sequence.times;
  const frames = events.subframe.map((position, index) => {
    // Times are interpolated between frames where the decoder refined the event,
    // because at sixty frames a second half a frame is three percent of a
    // downswing and tempo is one duration divided by another.
    const lower = Math.max(0, Math.min(times.length - 1, Math.floor(position)));
    const upper = Math.min(times.length - 1, lower + 1);
    return times[lower] + (position - lower) * (times[upper] - times[lower]);
  });

  const backswing = frames[TOP] - frames[ADDRESS];
  const downswing = frames[IMPACT] - frames[TOP];
  const whole = frames[FINISH] - frames[ADDRESS];

  const coords = normalisePose(sequence, config);
  const square = sequence.squareXY();
  const scale = bodyScale(square, sequence.visibility, config.min_visibility);
  const roll = config.normalise_roll
    ? bodyAxisAngle(square, sequence.visibility, config.min_visibility)
    : 0;

  const address = events.frames[ADDRESS], top = events.frames[TOP];
  const impact = events.frames[IMPACT], finish = events.frames[FINISH];

  // Hand speed through the downswing, for when the hands were fastest.
  const handsX = Float64Array.from(coords, (f) => 0.5 * (f[L.LEFT_WRIST][0] + f[L.RIGHT_WRIST][0]));
  const handsY = Float64Array.from(coords, (f) => 0.5 * (f[L.LEFT_WRIST][1] + f[L.RIGHT_WRIST][1]));
  const vx = gradient(handsX, times), vy = gradient(handsY, times);
  let peakFrame = top, peakSpeed = -1;
  for (let i = top; i <= impact; i++) {
    const speed = Math.hypot(vx[i], vy[i]);
    if (speed > peakSpeed) { peakSpeed = speed; peakFrame = i; }
  }

  // Movement is measured against the ground, not the pelvis, or a golfer who
  // swayed would appear perfectly still because everything moved with them.
  const cos = Math.cos(-roll), sin = Math.sin(-roll);
  const grounded = [];
  let feetSeen = 0;
  for (let i = 0; i < square.length; i++) {
    if (Math.min(sequence.visibility[i][L.LEFT_ANKLE], sequence.visibility[i][L.RIGHT_ANKLE])
        >= config.min_visibility) feetSeen++;
    const ankles = mid(square[i], L.LEFT_ANKLE, L.RIGHT_ANKLE);
    grounded.push(square[i].map(([x, y]) => {
      const gx = (x - ankles[0]) / scale, gy = (y - ankles[1]) / scale;
      return roll === 0 ? [gx, gy] : [gx * cos - gy * sin, gx * sin + gy * cos];
    }));
  }
  const haveFeet = feetSeen >= Math.max(3, 0.25 * square.length);

  let headMovement = null, sway = null, lift = null;
  if (haveFeet) {
    const headA = mid(grounded[address], L.LEFT_EAR, L.RIGHT_EAR);
    const headI = mid(grounded[impact], L.LEFT_EAR, L.RIGHT_EAR);
    const pelvisA = mid(grounded[address], L.LEFT_HIP, L.RIGHT_HIP);
    const pelvisI = mid(grounded[impact], L.LEFT_HIP, L.RIGHT_HIP);
    headMovement = Math.hypot(headI[0] - headA[0], headI[1] - headA[1]);
    sway = Math.abs(pelvisI[0] - pelvisA[0]);
    lift = Math.abs(pelvisI[1] - pelvisA[1]);
  }

  const shoulderTurn = turnFromForeshortening(
    square, sequence.visibility, L.LEFT_SHOULDER, L.RIGHT_SHOULDER,
    address, Math.min(finish + 1, square.length), top, config.min_visibility);
  const hipTurn = turnFromForeshortening(
    square, sequence.visibility, L.LEFT_HIP, L.RIGHT_HIP,
    address, Math.min(finish + 1, square.length), top, config.min_visibility);

  return {
    eventTimes: frames,
    tempoRatio: downswing > 0 ? backswing / downswing : null,
    backswingMs: backswing * 1000,
    downswingMs: downswing * 1000,
    wholeMs: whole * 1000,
    peakHandSpeedMs: (times[peakFrame] - times[impact]) * 1000,
    shoulderTurnDeg: shoulderTurn,
    hipTurnDeg: hipTurn,
    headMovement,
    pelvisSway: sway,
    pelvisLift: lift,
    feetInShot: haveFeet,
  };
}

/* Whether what was found is shaped like a golf swing at all.
 *
 * The decoder always returns eight frames in order because it is built to, so
 * ordering alone proves nothing about a clip of somebody standing still. How long
 * the halves lasted does. Nineteen milliseconds is not a backswing however
 * confident the model was, and both of those came back from clips containing no
 * swing before this existed. */
export function implausible(metrics, thresholds) {
  const back = metrics.backswingMs / 1000, down = metrics.downswingMs / 1000;
  const [backLow, backHigh] = thresholds.plausible_backswing_s;
  const [downLow, downHigh] = thresholds.plausible_downswing_s;
  const [tempoLow, tempoHigh] = thresholds.plausible_tempo;

  if (!(back >= backLow && back <= backHigh)) {
    return `the backswing would have lasted ${Math.round(back * 1000)} ms, outside the ` +
      `${Math.round(backLow * 1000)} to ${Math.round(backHigh * 1000)} ms a golf swing takes. ` +
      `Whatever is in this clip, it is not a swing being made`;
  }
  if (!(down >= downLow && down <= downHigh)) {
    return `the downswing would have lasted ${Math.round(down * 1000)} ms, outside the ` +
      `${Math.round(downLow * 1000)} to ${Math.round(downHigh * 1000)} ms a golf swing takes`;
  }
  const tempo = metrics.tempoRatio;
  if (tempo === null || !(tempo >= tempoLow && tempo <= tempoHigh)) {
    return `the two halves imply a tempo of ${tempo === null ? "infinity" : tempo.toFixed(1)} ` +
      `to one, outside the ${tempoLow.toFixed(1)} to ${tempoHigh.toFixed(1)} a golf swing produces`;
  }
  return null;
}
