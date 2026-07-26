/**
 * Turning a freehand stroke into something worth fitting.
 *
 * A raw pointer trace is unusable as-is: samples arrive at whatever rate the
 * device reports, bunching up wherever the hand slowed down, and carry
 * high-frequency tremor that a flexible model will happily fit.
 *
 * The ordering — smooth, *then* resample — matters more than it looks. A
 * moving average over unevenly spaced points shifts a curve by an amount that
 * depends on the local spacing, so running it after a thinning pass warps the
 * shape differently along its length. The result is a curve that is no longer
 * the thing that was drawn: sketching a parabola this way produces something a
 * cosine fits better than a quadratic. Smoothing the raw, near-uniform samples
 * first keeps the filter unbiased, and resampling afterwards is a pure
 * resampling of an already-clean curve.
 */

import type { Point } from "./types";

/**
 * Ramer–Douglas–Peucker: drop points that lie within `tolerance` of the line
 * between their neighbours. This removes redundancy where the hand paused
 * without touching the stroke's shape.
 *
 * Implemented iteratively; a deeply recursive version blows the stack on the
 * few-thousand-point strokes a fast stylus produces.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    const start = points[first]!;
    const end = points[last]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    let worstIndex = -1;
    let worstDistance = 0;

    for (let index = first + 1; index < last; index += 1) {
      const point = points[index]!;
      let distanceSquared: number;

      if (lengthSquared === 0) {
        const ex = point.x - start.x;
        const ey = point.y - start.y;
        distanceSquared = ex * ex + ey * ey;
      } else {
        // Perpendicular distance to the segment, via the projection parameter.
        const t =
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        const projectedX = start.x + clamped * dx;
        const projectedY = start.y + clamped * dy;
        const ex = point.x - projectedX;
        const ey = point.y - projectedY;
        distanceSquared = ex * ex + ey * ey;
      }

      if (distanceSquared > worstDistance) {
        worstDistance = distanceSquared;
        worstIndex = index;
      }
    }

    if (worstDistance > toleranceSquared && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const result: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) result.push(points[index]!);
  }
  return result;
}

/**
 * Centred moving average over a window of `radius` points either side.
 *
 * Endpoints are averaged over whatever window is available rather than being
 * held fixed, so a stroke does not develop a hook at each end.
 */
export function smooth(points: readonly Point[], radius = 2): Point[] {
  if (points.length <= 2 || radius < 1) return [...points];

  const result: Point[] = new Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const from = Math.max(0, index - radius);
    const to = Math.min(points.length - 1, index + radius);
    let sumX = 0;
    let sumY = 0;
    for (let j = from; j <= to; j += 1) {
      sumX += points[j]!.x;
      sumY += points[j]!.y;
    }
    const count = to - from + 1;
    result[index] = { x: sumX / count, y: sumY / count };
  }
  return result;
}

/**
 * Resample to `count` points spaced evenly along the stroke's arc length.
 *
 * This is what stops a slowly drawn section from dominating the regression:
 * after resampling, every part of the curve contributes in proportion to its
 * length rather than to how long the user spent drawing it.
 */
export function resampleByArcLength(points: readonly Point[], count: number): Point[] {
  if (points.length <= 1 || count < 2) return [...points];

  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    cumulative.push(cumulative[index - 1]! + Math.hypot(dx, dy));
  }

  const total = cumulative[cumulative.length - 1]!;
  if (total <= 0) return [points[0]!];

  const result: Point[] = [];
  let cursor = 0;
  for (let step = 0; step < count; step += 1) {
    const target = (total * step) / (count - 1);
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1]! < target) {
      cursor += 1;
    }
    const spanStart = cumulative[cursor]!;
    const spanEnd = cumulative[cursor + 1]!;
    const span = spanEnd - spanStart;
    const t = span > 0 ? (target - spanStart) / span : 0;
    const a = points[cursor]!;
    const b = points[cursor + 1] ?? a;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

export interface StrokeOptions {
  /** Simplification tolerance, in world units. */
  tolerance: number;
  /** Moving-average radius, in points. */
  smoothing: number;
  /** How many evenly spaced points to hand to the fitter. */
  samples: number;
}

export const DEFAULT_STROKE_OPTIONS: StrokeOptions = {
  tolerance: 0.01,
  smoothing: 2,
  samples: 220,
};

/**
 * The full stroke pipeline: smooth the raw trace, then resample it evenly.
 *
 * `simplify` is applied only as a guard on pathologically long strokes, before
 * smoothing, where the point count would otherwise make the filter slow. Its
 * tolerance is far below the smoothing scale, so it removes only genuinely
 * redundant samples and cannot introduce the spacing bias described above.
 */
export function processStroke(
  points: readonly Point[],
  options: StrokeOptions = DEFAULT_STROKE_OPTIONS,
): Point[] {
  if (points.length < 2) return [...points];

  const trimmed =
    points.length > 4000 ? simplify(points, options.tolerance / 8) : points;
  const smoothed = smooth(trimmed, options.smoothing);
  return resampleByArcLength(
    smoothed,
    Math.min(options.samples, Math.max(smoothed.length, 2)),
  );
}

/**
 * Whether a stroke doubles back on itself in x.
 *
 * A stroke that does is not the graph of a function, and the fitter can only
 * report on `y = f(x)`. Detecting it here lets the UI say so immediately
 * rather than after a round-trip.
 */
export function isSingleValued(points: readonly Point[]): boolean {
  if (points.length < 3) return true;
  let forward = 0;
  let backward = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index]!.x - points[index - 1]!.x;
    if (delta > 0) forward += 1;
    else if (delta < 0) backward += 1;
  }
  const total = forward + backward;
  if (total === 0) return false;
  return Math.max(forward, backward) / total >= 0.9;
}
