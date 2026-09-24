"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { VIEWS, type ViewName } from "./CameraRig";

/**
 * The viewer's entry point, and its controls.
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
      Setting up the studio…
    </div>
  ),
});

export function ViewerPanel({ config }: { config: ViewerConfig }) {
  const [view, setView] = useState<ViewName>("hero");
  const [nonce, setNonce] = useState(0);

  const caption =
    config.dimensionSource === "published"
      ? "Proportions from the car's published dimensions. Wheels, tires, offsets and brakes drawn to scale from the build; bodywork is stylised."
      : "No dimensions on record for this car, so the body is a typical one for its type. Wheels and tires are drawn to scale; the rest is a stand-in.";

  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-[var(--color-line)] bg-[#0b0e11]">
      <VehicleViewer config={config} view={view} viewNonce={nonce} />

      <div className="absolute left-3 top-3 flex flex-wrap gap-1" role="group" aria-label="Camera views">
        {VIEWS.map((v) => (
          <button
            key={v.name}
            type="button"
            onClick={() => {
              setView(v.name);
              setNonce((n) => n + 1);
            }}
            aria-pressed={view === v.name}
            className={`rounded border px-2 py-1 text-[11px] font-medium backdrop-blur transition-colors ${
              view === v.name
                ? "border-[var(--color-accent)]/60 bg-[var(--color-accent-dim)]/70 text-[var(--color-ink)]"
                : "border-white/10 bg-black/30 text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 p-3">
        <p className="max-w-[62%] text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{caption}</p>
        <p className="shrink-0 text-[10.5px] text-[var(--color-ink-faint)]">
          Drag to orbit · scroll to zoom · right-drag to pan
        </p>
      </div>
    </div>
  );
}
