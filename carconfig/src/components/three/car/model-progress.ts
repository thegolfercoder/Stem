/**
 * How far the current 3D model's download has got.
 *
 * A linked model can be 20–30MB, so the viewer says how far it has got rather
 * than leaving the stand-in car up with no explanation. The loader reports
 * progress while React is still suspended, before anything has mounted, so the
 * state lives here rather than in a component.
 */

export interface ModelProgress {
  readonly url: string | null;
  readonly loaded: number;
  readonly total: number;
  readonly done: boolean;
  readonly failed: boolean;
}

let state: ModelProgress = { url: null, loaded: 0, total: 0, done: true, failed: false };
const listeners = new Set<() => void>();

export const modelProgress = {
  get: (): ModelProgress => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(next: Partial<ModelProgress>) {
    state = { ...state, ...next };
    for (const l of listeners) l();
  },
};
