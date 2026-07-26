"use client";

/** The layer stack: what is on the canvas, and which layer the panel follows. */

import type { Layer, LayerSource } from "@/lib/types";
import { useWorkspace } from "@/state/workspace";

const SOURCE_GLYPH: Record<LayerSource, string> = {
  drawing: "✎",
  screenshot: "▣",
  data: "⁘",
};

export function LayerList() {
  const layers = useWorkspace((state) => state.layers);
  const activeLayerId = useWorkspace((state) => state.activeLayerId);
  const setActiveLayer = useWorkspace((state) => state.setActiveLayer);
  const toggleLayerVisibility = useWorkspace((state) => state.toggleLayerVisibility);
  const removeLayer = useWorkspace((state) => state.removeLayer);

  if (layers.length === 0) {
    return (
      <p className="px-4 py-3 text-ink-2">
        Draw on the canvas, or import data to begin.
      </p>
    );
  }

  return (
    <ul>
      {layers.map((layer) => (
        <li key={layer.id}>
          <div
            className={`group flex items-center gap-2 px-3 py-1.5 transition-colors ${
              layer.id === activeLayerId
                ? "bg-[--color-surface-3]"
                : "hover:bg-[--color-surface-2]"
            }`}
          >
            <button
              type="button"
              onClick={() => toggleLayerVisibility(layer.id)}
              aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
              className="h-3 w-3 shrink-0 rounded-full border transition-opacity"
              style={{
                backgroundColor: layer.visible ? layer.colour : "transparent",
                borderColor: layer.colour,
              }}
            />

            <button
              type="button"
              onClick={() => setActiveLayer(layer.id)}
              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
            >
              <span className="shrink-0 text-ink-3" aria-hidden>
                {SOURCE_GLYPH[layer.source]}
              </span>
              <span className="truncate text-ink-0">{layer.name}</span>
              <span className="numeric shrink-0 text-[11px] text-ink-3">
                {layer.points.length}
              </span>
            </button>

            <LayerStatus layer={layer} />

            <button
              type="button"
              onClick={() => removeLayer(layer.id)}
              aria-label={`Delete ${layer.name}`}
              // Revealed on hover to keep the row quiet, but always reachable
              // by keyboard.
              className="shrink-0 text-ink-3 opacity-0 transition-opacity hover:text-[--color-negative] focus-visible:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LayerStatus({ layer }: { layer: Layer }) {
  if (layer.status === "fitting") {
    return (
      <span className="shrink-0 text-[11px] text-ink-2" role="status">
        fitting…
      </span>
    );
  }
  if (layer.status === "error") {
    return (
      <span className="shrink-0 text-[11px] text-[--color-negative]" title={layer.error ?? ""}>
        failed
      </span>
    );
  }
  const top = layer.candidates[0];
  if (!top) return null;
  return (
    <span className="numeric shrink-0 text-[11px] text-ink-2">
      {Math.round(top.confidence * 100)}%
    </span>
  );
}
