/**
 * Workspace state: layers, viewport, tool selection and history.
 *
 * The viewport is deliberately *excluded* from undo history. Panning is a
 * navigation act, not an edit, and folding it into the same stack means an
 * accidental scroll costs the user their real undo steps.
 */

import { create } from "zustand";

import * as api from "@/lib/api";
import type { Candidate, Layer, LayerSource, Point } from "@/lib/types";
import { DEFAULT_VIEWPORT, type Viewport } from "@/lib/viewport";

export type Tool = "draw" | "pan" | "select";

/** Layer colours, cycled in order. Chosen to stay distinguishable together. */
const PALETTE = [
  "#4f8ff7",
  "#e8833a",
  "#38b48b",
  "#c264d4",
  "#e05d6f",
  "#5bc0d4",
] as const;

const MAX_HISTORY = 60;

/** The part of the state that undo/redo restores. */
interface Snapshot {
  layers: Layer[];
  activeLayerId: string | null;
}

interface WorkspaceState extends Snapshot {
  viewport: Viewport;
  tool: Tool;
  snapToGrid: boolean;
  showResiduals: boolean;
  past: Snapshot[];
  future: Snapshot[];

  setViewport: (viewport: Viewport) => void;
  setTool: (tool: Tool) => void;
  toggleSnap: () => void;
  toggleResiduals: () => void;

  addLayer: (source: LayerSource, points: Point[], name?: string) => string;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  renameLayer: (id: string, name: string) => void;
  toggleLayerVisibility: (id: string) => void;

  selectCandidate: (layerId: string, kind: string) => void;
  setParameter: (layerId: string, kind: string, index: number, value: number) => void;
  resetParameters: (layerId: string, kind: string) => void;

  runFit: (layerId: string, kinds?: string[]) => Promise<void>;

  undo: () => void;
  redo: () => void;
  clear: () => void;
}

let layerCounter = 0;
function nextLayerId(): string {
  layerCounter += 1;
  return `layer-${layerCounter}`;
}

/** In-flight fits, so a re-fit cancels the request it supersedes. */
const pendingFits = new Map<string, AbortController>();

function snapshotOf(state: Snapshot): Snapshot {
  // Layers are replaced wholesale on every edit, so a shallow copy of the array
  // is enough to freeze this point in time.
  return { layers: [...state.layers], activeLayerId: state.activeLayerId };
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  /** Apply an edit, recording the pre-edit state for undo. */
  function commit(mutate: (state: WorkspaceState) => Partial<Snapshot>): void {
    set((state) => {
      const before = snapshotOf(state);
      const changes = mutate(state);
      return {
        ...changes,
        past: [...state.past, before].slice(-MAX_HISTORY),
        // Any new edit invalidates the redo branch.
        future: [],
      };
    });
  }

  return {
    layers: [],
    activeLayerId: null,
    viewport: DEFAULT_VIEWPORT,
    tool: "draw",
    snapToGrid: false,
    showResiduals: false,
    past: [],
    future: [],

    setViewport: (viewport) => set({ viewport }),
    setTool: (tool) => set({ tool }),
    toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
    toggleResiduals: () => set((state) => ({ showResiduals: !state.showResiduals })),

    addLayer: (source, points, name) => {
      const id = nextLayerId();
      commit((state) => {
        const layer: Layer = {
          id,
          name: name ?? `${sourceLabel(source)} ${state.layers.length + 1}`,
          source,
          colour: PALETTE[state.layers.length % PALETTE.length]!,
          visible: true,
          points,
          candidates: [],
          selectedKind: null,
          overrides: {},
          status: "idle",
          error: null,
        };
        return { layers: [...state.layers, layer], activeLayerId: id };
      });
      return id;
    },

    removeLayer: (id) => {
      pendingFits.get(id)?.abort();
      pendingFits.delete(id);
      commit((state) => {
        const layers = state.layers.filter((layer) => layer.id !== id);
        return {
          layers,
          activeLayerId:
            state.activeLayerId === id ? (layers[0]?.id ?? null) : state.activeLayerId,
        };
      });
    },

    setActiveLayer: (id) => set({ activeLayerId: id }),

    renameLayer: (id, name) =>
      commit((state) => ({
        layers: state.layers.map((layer) =>
          layer.id === id ? { ...layer, name } : layer,
        ),
      })),

    toggleLayerVisibility: (id) =>
      commit((state) => ({
        layers: state.layers.map((layer) =>
          layer.id === id ? { ...layer, visible: !layer.visible } : layer,
        ),
      })),

    selectCandidate: (layerId, kind) =>
      commit((state) => ({
        layers: state.layers.map((layer) =>
          layer.id === layerId ? { ...layer, selectedKind: kind } : layer,
        ),
      })),

    setParameter: (layerId, kind, index, value) => {
      // Slider drags fire continuously. Recording each one would bury the
      // user's real edits under hundreds of history entries, so this writes
      // through without touching the undo stack.
      set((state) => ({
        layers: state.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const candidate = layer.candidates.find((item) => item.kind === kind);
          if (!candidate) return layer;

          const current =
            layer.overrides[kind] ?? candidate.params.map((param) => param.value);
          const updated = [...current];
          updated[index] = value;
          return { ...layer, overrides: { ...layer.overrides, [kind]: updated } };
        }),
      }));
    },

    resetParameters: (layerId, kind) =>
      commit((state) => ({
        layers: state.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          const overrides = { ...layer.overrides };
          delete overrides[kind];
          return { ...layer, overrides };
        }),
      })),

    runFit: async (layerId, kinds) => {
      const layer = get().layers.find((item) => item.id === layerId);
      if (!layer || layer.points.length < 2) return;

      pendingFits.get(layerId)?.abort();
      const controller = new AbortController();
      pendingFits.set(layerId, controller);

      set((state) => ({
        layers: state.layers.map((item) =>
          item.id === layerId ? { ...item, status: "fitting", error: null } : item,
        ),
      }));

      try {
        const result = await api.fit(layer.points, {
          kinds,
          signal: controller.signal,
        });
        applyFitResult(set, layerId, result.candidates);
      } catch (error) {
        if (controller.signal.aborted) return;
        set((state) => ({
          layers: state.layers.map((item) =>
            item.id === layerId
              ? {
                  ...item,
                  status: "error",
                  error: error instanceof Error ? error.message : "Fit failed",
                }
              : item,
          ),
        }));
      } finally {
        if (pendingFits.get(layerId) === controller) pendingFits.delete(layerId);
      }
    },

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        return {
          ...previous,
          past: state.past.slice(0, -1),
          future: [snapshotOf(state), ...state.future].slice(0, MAX_HISTORY),
        };
      }),

    redo: () =>
      set((state) => {
        const next = state.future[0];
        if (!next) return state;
        return {
          ...next,
          past: [...state.past, snapshotOf(state)].slice(-MAX_HISTORY),
          future: state.future.slice(1),
        };
      }),

    clear: () => {
      for (const controller of pendingFits.values()) controller.abort();
      pendingFits.clear();
      commit(() => ({ layers: [], activeLayerId: null }));
    },
  };
});

function applyFitResult(
  set: (updater: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  layerId: string,
  candidates: Candidate[],
): void {
  set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            candidates,
            // Default to the top-ranked candidate, discarding any slider edits
            // that belonged to the previous fit.
            selectedKind: candidates[0]?.kind ?? null,
            overrides: {},
            status: "ready",
            error: null,
          }
        : layer,
    ),
  }));
}

function sourceLabel(source: LayerSource): string {
  switch (source) {
    case "drawing":
      return "Sketch";
    case "screenshot":
      return "Screenshot";
    case "data":
      return "Dataset";
  }
}

/** The parameter values to render for a candidate: overrides, else the fit. */
export function effectiveParameters(layer: Layer, candidate: Candidate): number[] {
  return layer.overrides[candidate.kind] ?? candidate.params.map((p) => p.value);
}

/** The currently selected candidate of a layer, if any. */
export function selectedCandidate(layer: Layer): Candidate | null {
  if (!layer.selectedKind) return null;
  return layer.candidates.find((item) => item.kind === layer.selectedKind) ?? null;
}
