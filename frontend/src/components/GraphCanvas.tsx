"use client";

/**
 * The infinite coordinate plane: grid, axes, input points and fitted curves.
 *
 * Everything is drawn to a single canvas from a `requestAnimationFrame` loop
 * that only runs when something has changed. React is used to mount the canvas
 * and to receive events — it is never asked to re-render during a pan, a zoom
 * or a slider drag. Those paths read the store imperatively through
 * `getState()` and set a dirty flag, so dragging costs one canvas repaint
 * rather than a reconciliation of the whole panel tree.
 */

import { useCallback, useEffect, useRef } from "react";

import { compileModel } from "@/lib/expression";
import type { Candidate, Layer, Point } from "@/lib/types";
import { processStroke } from "@/lib/stroke";
import {
  formatTick,
  gridStep,
  pan,
  screenToWorldX,
  screenToWorldY,
  snap,
  visibleBounds,
  worldToScreenX,
  worldToScreenY,
  zoomAt,
  type Size,
  type Viewport,
} from "@/lib/viewport";
import { effectiveParameters, selectedCandidate, useWorkspace } from "@/state/workspace";

/** Curves are sampled once per screen pixel; finer buys nothing visible. */
const PIXELS_PER_SAMPLE = 1;

/**
 * A jump larger than this fraction of the canvas height between adjacent
 * samples is treated as a discontinuity — a pole — and the path is broken
 * rather than drawn as a near-vertical spike across the viewport.
 */
const DISCONTINUITY_FRACTION = 1.4;

const COLOURS = {
  grid: "#1a1c22",
  gridStrong: "#24262e",
  axis: "#3d414c",
  axisText: "#6f7481",
  point: "#6f7481",
} as const;

interface DragState {
  mode: "pan" | "draw";
  lastX: number;
  lastY: number;
  points: Point[];
}

export function GraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const dirtyRef = useRef(true);
  const frameRef = useRef(0);

  /** Compiled model evaluators, keyed by template so they survive re-fits. */
  const compiledRef = useRef(new Map<string, ReturnType<typeof compileModel>>());

  const requestDraw = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const evaluatorFor = useCallback((candidate: Candidate) => {
    const key = `${candidate.template}::${candidate.params.map((p) => p.name).join(",")}`;
    const cache = compiledRef.current;
    let compiled = cache.get(key);
    if (!compiled) {
      try {
        compiled = compileModel(
          candidate.template,
          candidate.params.map((p) => p.name),
        );
      } catch {
        // An expression we cannot compile is simply not drawn; the equation
        // text and metrics are still perfectly usable.
        return null;
      }
      cache.set(key, compiled);
    }
    return compiled;
  }, []);

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const { viewport, layers, activeLayerId } = useWorkspace.getState();
    const size = sizeRef.current;
    if (size.width === 0 || size.height === 0) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#0b0c0e";
    context.fillRect(0, 0, size.width, size.height);

    drawGrid(context, viewport, size);

    for (const layer of layers) {
      if (!layer.visible) continue;
      drawLayerPoints(context, layer, viewport, size);

      const candidate = selectedCandidate(layer);
      if (!candidate) continue;
      const evaluate = evaluatorFor(candidate);
      if (!evaluate) continue;

      drawCurve(
        context,
        evaluate,
        effectiveParameters(layer, candidate),
        candidate,
        viewport,
        size,
        layer.colour,
        layer.id === activeLayerId,
      );
    }

    // The stroke in progress is drawn last so it sits above everything.
    const drag = dragRef.current;
    if (drag?.mode === "draw" && drag.points.length > 1) {
      drawPolyline(context, drag.points, viewport, size, "#f2f3f5", 1.75);
    }
  }, [evaluatorFor]);

  // A single RAF loop for the lifetime of the canvas: it repaints only when
  // the dirty flag is set, so an idle workspace costs nothing.
  useEffect(() => {
    const tick = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        render();
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [render]);

  // Any store change marks the canvas dirty. Subscribing outside React means a
  // slider drag repaints the canvas without re-rendering this component.
  useEffect(() => useWorkspace.subscribe(requestDraw), [requestDraw]);

  // Track the element's size and the device pixel ratio, so the canvas stays
  // crisp on a retina display and after a window move between monitors.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const context = canvas.getContext("2d");
      context?.scale(ratio, ratio);
      requestDraw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [requestDraw]);

  // -----------------------------------------------------------------------
  // Interaction
  // -----------------------------------------------------------------------

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool, viewport, snapToGrid } = useWorkspace.getState();
    const { x, y } = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    // Middle mouse and space-drag always pan, whatever the active tool — the
    // universal convention in canvas tools, and worth honouring.
    const wantsPan = tool === "pan" || event.button === 1 || event.shiftKey;
    if (wantsPan) {
      dragRef.current = { mode: "pan", lastX: x, lastY: y, points: [] };
      return;
    }
    if (tool !== "draw" || event.button !== 0) return;

    const step = gridStep(viewport.scale);
    const worldX = screenToWorldX(viewport, sizeRef.current, x);
    const worldY = screenToWorldY(viewport, sizeRef.current, y);
    dragRef.current = {
      mode: "draw",
      lastX: x,
      lastY: y,
      points: [
        snapToGrid
          ? { x: snap(worldX, step), y: snap(worldY, step) }
          : { x: worldX, y: worldY },
      ],
    };
    requestDraw();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const { x, y } = pointerPosition(event);
    const state = useWorkspace.getState();

    if (drag.mode === "pan") {
      state.setViewport(pan(state.viewport, x - drag.lastX, y - drag.lastY));
      drag.lastX = x;
      drag.lastY = y;
      return;
    }

    const step = gridStep(state.viewport.scale);
    const worldX = screenToWorldX(state.viewport, sizeRef.current, x);
    const worldY = screenToWorldY(state.viewport, sizeRef.current, y);
    const point = state.snapToGrid
      ? { x: snap(worldX, step), y: snap(worldY, step) }
      : { x: worldX, y: worldY };

    // Snapping produces long runs of identical points; storing them would
    // bloat the stroke and skew the arc-length resampling.
    const previous = drag.points[drag.points.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      drag.points.push(point);
    }
    drag.lastX = x;
    drag.lastY = y;
    requestDraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag.mode !== "draw") return;

    // A tap is not a stroke.
    if (drag.points.length < 4) {
      requestDraw();
      return;
    }

    const state = useWorkspace.getState();
    const processed = processStroke(drag.points, {
      // Simplification happens in world units, so the tolerance has to be
      // expressed relative to the current zoom to stay a constant on-screen
      // distance — otherwise a zoomed-out stroke is destroyed and a zoomed-in
      // one keeps every tremor.
      tolerance: 1.2 / state.viewport.scale,
      smoothing: 2,
      samples: 220,
    });

    const layerId = state.addLayer("drawing", processed);
    void state.runFit(layerId);
    requestDraw();
  };

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const state = useWorkspace.getState();

      // Trackpad pinch arrives as ctrl+wheel; a plain wheel is also treated as
      // zoom here because this is a graphing surface, not a document.
      const factor = Math.exp(-event.deltaY * 0.0015);
      state.setViewport(
        zoomAt(
          state.viewport,
          sizeRef.current,
          event.clientX - rect.left,
          event.clientY - rect.top,
          factor,
        ),
      );
    },
    [],
  );

  // Registered natively rather than via React's onWheel, because React
  // attaches wheel listeners as passive and `preventDefault` is required to
  // stop the page scrolling behind the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none select-none"
      style={{ cursor: "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label="Graph canvas. Draw a curve to fit an equation to it."
      role="application"
    />
  );
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function drawGrid(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  size: Size,
): void {
  const step = gridStep(viewport.scale);
  const bounds = visibleBounds(viewport, size);

  // Minor lines at the chosen step, major every fifth — the same rhythm as
  // engineering paper, which is what makes the scale readable at a glance.
  context.lineWidth = 1;
  for (const [multiple, colour] of [
    [1, COLOURS.grid],
    [5, COLOURS.gridStrong],
  ] as const) {
    const spacing = step * multiple;
    context.strokeStyle = colour;
    context.beginPath();

    const firstX = Math.ceil(bounds.minX / spacing) * spacing;
    for (let x = firstX; x <= bounds.maxX; x += spacing) {
      // The half-pixel offset puts the 1px line on a device pixel boundary
      // instead of straddling two, which is what makes it look grey and soft.
      const px = Math.round(worldToScreenX(viewport, size, x)) + 0.5;
      context.moveTo(px, 0);
      context.lineTo(px, size.height);
    }

    const firstY = Math.ceil(bounds.minY / spacing) * spacing;
    for (let y = firstY; y <= bounds.maxY; y += spacing) {
      const py = Math.round(worldToScreenY(viewport, size, y)) + 0.5;
      context.moveTo(0, py);
      context.lineTo(size.width, py);
    }
    context.stroke();
  }

  // Axes, pinned to the edge of the viewport when the origin is off-screen so
  // the labels never scroll away entirely.
  const axisX = Math.round(clampToRange(worldToScreenX(viewport, size, 0), 0, size.width)) + 0.5;
  const axisY = Math.round(clampToRange(worldToScreenY(viewport, size, 0), 0, size.height)) + 0.5;

  context.strokeStyle = COLOURS.axis;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, axisY);
  context.lineTo(size.width, axisY);
  context.moveTo(axisX, 0);
  context.lineTo(axisX, size.height);
  context.stroke();

  drawTicks(context, viewport, size, step, axisX, axisY);
}

function drawTicks(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  size: Size,
  step: number,
  axisX: number,
  axisY: number,
): void {
  const bounds = visibleBounds(viewport, size);
  const spacing = step * 5;

  context.fillStyle = COLOURS.axisText;
  context.font =
    '10px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
  context.textAlign = "center";
  context.textBaseline = "top";

  const firstX = Math.ceil(bounds.minX / spacing) * spacing;
  for (let x = firstX; x <= bounds.maxX; x += spacing) {
    if (Math.abs(x) < spacing / 1e6) continue;
    const px = worldToScreenX(viewport, size, x);
    context.fillText(formatTick(x, step), px, clampToRange(axisY + 6, 6, size.height - 16));
  }

  context.textAlign = "right";
  context.textBaseline = "middle";
  const firstY = Math.ceil(bounds.minY / spacing) * spacing;
  for (let y = firstY; y <= bounds.maxY; y += spacing) {
    if (Math.abs(y) < spacing / 1e6) continue;
    const py = worldToScreenY(viewport, size, y);
    context.fillText(formatTick(y, step), clampToRange(axisX - 8, 32, size.width - 4), py);
  }
}

function drawLayerPoints(
  context: CanvasRenderingContext2D,
  layer: Layer,
  viewport: Viewport,
  size: Size,
): void {
  if (layer.points.length === 0) return;

  // A drawn stroke reads as a line; imported data reads as a scatter. Showing
  // a dataset as a connected polyline would imply an ordering the data may not
  // have.
  if (layer.source === "drawing") {
    drawPolyline(context, layer.points, viewport, size, COLOURS.point, 1.25);
    return;
  }

  context.fillStyle = layer.colour;
  const radius = layer.points.length > 400 ? 1.1 : 2;
  for (const point of layer.points) {
    const px = worldToScreenX(viewport, size, point.x);
    const py = worldToScreenY(viewport, size, point.y);
    if (px < -8 || px > size.width + 8 || py < -8 || py > size.height + 8) continue;
    context.beginPath();
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  viewport: Viewport,
  size: Size,
  colour: string,
  width: number,
): void {
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const px = worldToScreenX(viewport, size, point.x);
    const py = worldToScreenY(viewport, size, point.y);
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.stroke();
}

function drawCurve(
  context: CanvasRenderingContext2D,
  evaluate: (x: number, values: readonly number[]) => number,
  values: readonly number[],
  candidate: Candidate,
  viewport: Viewport,
  size: Size,
  colour: string,
  isActive: boolean,
): void {
  context.strokeStyle = colour;
  context.lineWidth = isActive ? 2 : 1.5;
  context.globalAlpha = isActive ? 1 : 0.65;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  const breakThreshold = size.height * DISCONTINUITY_FRACTION;
  let previousY: number | null = null;
  let penDown = false;

  for (let px = 0; px <= size.width; px += PIXELS_PER_SAMPLE) {
    const worldX = screenToWorldX(viewport, size, px);
    const worldY = evaluate(worldX, values);

    if (!Number.isFinite(worldY)) {
      penDown = false;
      previousY = null;
      continue;
    }

    const py = worldToScreenY(viewport, size, worldY);

    // Lift the pen across a pole. Without this the two branches of a
    // hyperbola are joined by a vertical line straight through the asymptote.
    const jumped = previousY !== null && Math.abs(py - previousY) > breakThreshold;
    if (jumped) penDown = false;

    if (!penDown) {
      context.moveTo(px, py);
      penDown = true;
    } else {
      context.lineTo(px, py);
    }
    previousY = py;
  }

  context.stroke();
  context.globalAlpha = 1;

  if (isActive) drawAsymptotes(context, candidate, viewport, size, colour);
}

function drawAsymptotes(
  context: CanvasRenderingContext2D,
  candidate: Candidate,
  viewport: Viewport,
  size: Size,
  colour: string,
): void {
  if (candidate.singularities.length === 0) return;

  context.save();
  context.strokeStyle = colour;
  context.globalAlpha = 0.32;
  context.lineWidth = 1;
  context.setLineDash([3, 4]);
  context.beginPath();
  for (const pole of candidate.singularities) {
    const px = Math.round(worldToScreenX(viewport, size, pole)) + 0.5;
    if (px < 0 || px > size.width) continue;
    context.moveTo(px, 0);
    context.lineTo(px, size.height);
  }
  context.stroke();
  context.restore();
}

function clampToRange(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
