"use client";

import dynamic from "next/dynamic";
import type { ViewerConfig } from "@/lib/build/viewer-config";

/**
 * The viewer's entry point.
 *
 * Three.js touches `window` on import, so the canvas cannot be server
 * rendered. Isolating the dynamic import here means the rest of the
 * configurator is ordinary React and the WebGL bundle is only fetched by pages
 * that actually show a car.
 */

const VehicleViewer = dynamic(() => import("./VehicleViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-ink-faint)]">
      Loading viewer…
    </div>
  ),
});

export function ViewerPanel({
  config,
  caption,
}: {
  config: ViewerConfig;
  caption?: string;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-[var(--color-line)] bg-[#0d1013]">
      <VehicleViewer config={config} />

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 p-3">
        <p className="max-w-[60%] text-[11px] leading-snug text-[var(--color-ink-faint)]">
          {caption ??
            "Placeholder geometry — proportions are generic, not this car's. Wheel and tire sizes are drawn to scale from the selected fitment."}
        </p>
        <p className="shrink-0 text-[11px] text-[var(--color-ink-faint)]">
          Drag to rotate · scroll to zoom · right-drag to pan
        </p>
      </div>
    </div>
  );
}
