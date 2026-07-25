/**
 * The mapping between world (graph) coordinates and screen pixels.
 *
 * The viewport is stored as a world-space centre plus a zoom factor in pixels
 * per world unit, rather than as a visible rectangle. That way a resize changes
 * how much is visible without shifting what is under the cursor, and zooming is
 * a single scalar rather than four interdependent edges.
 */

export interface Viewport {
  /** World coordinate at the centre of the canvas. */
  centreX: number;
  centreY: number;
  /** Screen pixels per world unit. Uniform, so circles stay circular. */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORT: Viewport = { centreX: 0, centreY: 0, scale: 48 };

const MIN_SCALE = 1e-3;
const MAX_SCALE = 1e6;

export function worldToScreenX(viewport: Viewport, size: Size, x: number): number {
  return size.width / 2 + (x - viewport.centreX) * viewport.scale;
}

export function worldToScreenY(viewport: Viewport, size: Size, y: number): number {
  // Screen y grows downwards; world y grows upwards.
  return size.height / 2 - (y - viewport.centreY) * viewport.scale;
}

export function screenToWorldX(viewport: Viewport, size: Size, px: number): number {
  return viewport.centreX + (px - size.width / 2) / viewport.scale;
}

export function screenToWorldY(viewport: Viewport, size: Size, py: number): number {
  return viewport.centreY - (py - size.height / 2) / viewport.scale;
}

/** Pan by a screen-space delta, in pixels. */
export function pan(viewport: Viewport, dx: number, dy: number): Viewport {
  return {
    ...viewport,
    centreX: viewport.centreX - dx / viewport.scale,
    centreY: viewport.centreY + dy / viewport.scale,
  };
}

/**
 * Zoom about a fixed screen point, keeping the world coordinate under the
 * cursor exactly where it was — the behaviour that makes scroll-zoom feel
 * anchored rather than sliding.
 */
export function zoomAt(
  viewport: Viewport,
  size: Size,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const scale = clamp(viewport.scale * factor, MIN_SCALE, MAX_SCALE);
  if (scale === viewport.scale) return viewport;

  const anchorX = screenToWorldX(viewport, size, screenX);
  const anchorY = screenToWorldY(viewport, size, screenY);

  // Re-centre so the anchor maps back to the same pixel.
  return {
    scale,
    centreX: anchorX - (screenX - size.width / 2) / scale,
    centreY: anchorY + (screenY - size.height / 2) / scale,
  };
}

/** Fit a set of points into view with a margin, for "zoom to selection". */
export function fitToPoints(
  points: readonly { x: number; y: number }[],
  size: Size,
  margin = 0.12,
): Viewport {
  if (points.length === 0) return DEFAULT_VIEWPORT;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return DEFAULT_VIEWPORT;

  // A perfectly flat or vertical set has zero extent in one axis; give it one
  // unit so the zoom calculation stays finite.
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const usableWidth = size.width * (1 - 2 * margin);
  const usableHeight = size.height * (1 - 2 * margin);

  return {
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    scale: clamp(
      Math.min(usableWidth / spanX, usableHeight / spanY),
      MIN_SCALE,
      MAX_SCALE,
    ),
  };
}

/** The world-space rectangle currently visible. */
export function visibleBounds(viewport: Viewport, size: Size) {
  const halfWidth = size.width / 2 / viewport.scale;
  const halfHeight = size.height / 2 / viewport.scale;
  return {
    minX: viewport.centreX - halfWidth,
    maxX: viewport.centreX + halfWidth,
    minY: viewport.centreY - halfHeight,
    maxY: viewport.centreY + halfHeight,
  };
}

/**
 * Choose a grid step that keeps gridlines roughly `targetPixels` apart, snapped
 * to a 1-2-5 sequence so labels stay readable at every zoom level.
 */
export function gridStep(scale: number, targetPixels = 72): number {
  const raw = targetPixels / scale;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = normalised < 1.5 ? 1 : normalised < 3.5 ? 2 : normalised < 7.5 ? 5 : 10;
  return step * magnitude;
}

/** Snap a world coordinate to the nearest grid intersection. */
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Format an axis label without floating-point dust: at a grid step of 0.1 we
 * want "0.3", not "0.30000000000000004".
 */
export function formatTick(value: number, step: number): string {
  if (Math.abs(value) < step / 1e6) return "0";
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  if (Math.abs(value) >= 1e5 || (Math.abs(value) < 1e-3 && value !== 0)) {
    return value.toExponential(1);
  }
  return value.toFixed(Math.min(decimals, 6));
}
