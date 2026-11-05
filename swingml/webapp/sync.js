/* Two swings in step (#35): a time in one swing, and the moment in the other that
 * corresponds to it, warped piecewise-linearly between their eight detected
 * positions so address, the top and impact land together however long each part
 * took. Before address and after the finish the other swing runs at the whole
 * swing's relative pace.
 *
 * Times are each clip's own, so a slow-motion clip's positions (already on its
 * own timeline) sync the same way. The ghost places one golfer's skeleton over
 * the other's frame, the hips at address on the hips at address and scaled by
 * torso length: a picture to compare shapes with, not a measurement.
 *
 * Pure, so node can test it; the page only draws what it returns.
 */

import { L } from "./engine.js";

/* The time in swing B matching time `t` in swing A, given each swing's eight
 * position times in order. */
export function syncTime(eventsA, eventsB, t) {
  const n = Math.min(eventsA.length, eventsB.length);
  const last = n - 1;
  const span = (e) => e[last] - e[0];
  const pace = span(eventsA) > 1e-9 ? span(eventsB) / span(eventsA) : 1;
  if (t <= eventsA[0]) return eventsB[0] + (t - eventsA[0]) * pace;
  if (t >= eventsA[last]) return eventsB[last] + (t - eventsA[last]) * pace;
  let k = 0;
  while (k < last - 1 && t > eventsA[k + 1]) k++;
  const a0 = eventsA[k], a1 = eventsA[k + 1], b0 = eventsB[k], b1 = eventsB[k + 1];
  return a1 - a0 > 1e-9 ? b0 + ((t - a0) / (a1 - a0)) * (b1 - b0) : b0;
}

/* The index of the frame whose time is nearest `t` in sorted `times`. */
export function nearestIndex(times, t) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t) ? lo - 1 : lo;
}

const mid = (p, a, b) => [(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2];

/* How to carry swing B's points (in B's pixels) onto swing A's frame (in A's
 * pixels): `xy` are each swing's address landmarks as fractions, `size` its
 * frame [width, height]. Null when either torso was not seen. */
export function ghostTransform(xyA, sizeA, xyB, sizeB) {
  const px = (p, [w, h]) => p.map(([x, y]) => [x * w, y * h]);
  const a = px(xyA, sizeA), b = px(xyB, sizeB);
  const hipA = mid(a, L.LEFT_HIP, L.RIGHT_HIP), hipB = mid(b, L.LEFT_HIP, L.RIGHT_HIP);
  const torso = (p, hip) => {
    const s = mid(p, L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
    return Math.hypot(s[0] - hip[0], s[1] - hip[1]);
  };
  const ta = torso(a, hipA), tb = torso(b, hipB);
  if (!(ta > 1e-6) || !(tb > 1e-6)) return null;
  const scale = ta / tb;
  return { scale, dx: hipA[0] - hipB[0] * scale, dy: hipA[1] - hipB[1] * scale };
}

/* Swing B's landmarks on one frame, as fractions of A's frame, through `t`. */
export function ghostPoints(xyB, sizeB, sizeA, t) {
  return xyB.map(([x, y]) => [(x * sizeB[0] * t.scale + t.dx) / sizeA[0],
                              (y * sizeB[1] * t.scale + t.dy) / sizeA[1]]);
}
