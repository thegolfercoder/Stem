"use client";

/**
 * Residuals against x — the plot that shows whether a model is *right*, as
 * opposed to merely close.
 *
 * R² tells you how much variance is explained; it cannot tell you that the
 * error is systematic. A quadratic fitted to a cubic can post a high R² while
 * its residuals trace a clear arc, and that arc is visible here immediately.
 * Structure in this panel means the wrong family was chosen, however good the
 * headline number looks.
 *
 * Drawn on a canvas rather than with a charting library: it is a scatter, two
 * axes and a zero line, and it has to match the workspace's visual language
 * exactly.
 */

import { useEffect, useRef } from "react";

interface ResidualPlotProps {
  x: number[];
  residuals: number[];
  colour: string;
  height?: number;
}

export function ResidualPlot({ x, residuals, colour, height = 96 }: ResidualPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      context.clearRect(0, 0, width, height);

      const count = Math.min(x.length, residuals.length);
      if (count === 0) return;

      let minX = Infinity;
      let maxX = -Infinity;
      let extreme = 0;
      for (let index = 0; index < count; index += 1) {
        const xi = x[index]!;
        const ri = residuals[index]!;
        if (!Number.isFinite(xi) || !Number.isFinite(ri)) continue;
        if (xi < minX) minX = xi;
        if (xi > maxX) maxX = xi;
        if (Math.abs(ri) > extreme) extreme = Math.abs(ri);
      }
      if (!Number.isFinite(minX) || extreme === 0) extreme = 1;

      const padding = { left: 8, right: 8, top: 10, bottom: 10 };
      const plotWidth = Math.max(1, width - padding.left - padding.right);
      const plotHeight = Math.max(1, height - padding.top - padding.bottom);
      const spanX = Math.max(maxX - minX, 1e-12);
      // A symmetric y range keeps the zero line centred, so bias reads as
      // "the cloud sits above the line" rather than needing arithmetic.
      const scaleY = plotHeight / 2 / (extreme * 1.15);

      const toScreenX = (value: number) =>
        padding.left + ((value - minX) / spanX) * plotWidth;
      const toScreenY = (value: number) => padding.top + plotHeight / 2 - value * scaleY;

      // Zero line.
      context.strokeStyle = "#33363f";
      context.lineWidth = 1;
      context.beginPath();
      const zero = Math.round(toScreenY(0)) + 0.5;
      context.moveTo(padding.left, zero);
      context.lineTo(width - padding.right, zero);
      context.stroke();

      // Envelope at ±1 RMSE, for a sense of the typical error.
      let sumSquares = 0;
      for (let index = 0; index < count; index += 1) sumSquares += residuals[index]! ** 2;
      const rmse = Math.sqrt(sumSquares / count);
      context.strokeStyle = "#26282f";
      context.setLineDash([2, 3]);
      context.beginPath();
      for (const sign of [1, -1]) {
        const py = Math.round(toScreenY(sign * rmse)) + 0.5;
        context.moveTo(padding.left, py);
        context.lineTo(width - padding.right, py);
      }
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = colour;
      const radius = count > 300 ? 1 : 1.8;
      for (let index = 0; index < count; index += 1) {
        const xi = x[index]!;
        const ri = residuals[index]!;
        if (!Number.isFinite(xi) || !Number.isFinite(ri)) continue;
        context.beginPath();
        context.arc(toScreenX(xi), toScreenY(ri), radius, 0, Math.PI * 2);
        context.fill();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [x, residuals, colour, height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
      aria-label="Residual plot. Structure in this plot indicates the wrong model family."
      role="img"
    />
  );
}
