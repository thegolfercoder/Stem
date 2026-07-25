/** Shared domain types, mirroring the FastAPI response schemas. */

export interface Point {
  x: number;
  y: number;
}

export interface Parameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  stderr: number | null;
}

export interface Metrics {
  n: number;
  n_effective: number;
  k: number;
  rss: number;
  r2: number;
  adjusted_r2: number;
  rmse: number;
  mae: number;
  max_error: number;
  aic: number;
  aicc: number;
  bic: number;
}

export interface Candidate {
  kind: string;
  label: string;
  family: string;
  latex: string;
  text: string;
  /** Infix form with parameter names intact, compiled for live editing. */
  template: string;
  expression: string;
  params: Parameter[];
  exact: boolean;
  complexity: number;
  smoothness_penalty: number;
  score: number;
  confidence: number;
  metrics: Metrics;
  residuals: number[];
  singularities: number[];
  domain: { x_min: number; x_max: number };
}

export interface FitResponse {
  candidates: Candidate[];
  sample: { x: number[]; y: number[]; n: number; is_function: boolean };
  notes: string[];
  considered: number;
}

export interface ExtractedCurve {
  x: number[];
  y: number[];
  pixel_count: number;
}

export interface ExtractResponse {
  axes: {
    origin_x: number;
    origin_y: number;
    pixels_per_cell_x: number;
    pixels_per_cell_y: number;
    units_per_cell: number;
    detected: boolean;
    x_gridlines: number[];
    y_gridlines: number[];
  };
  image: { width: number; height: number };
  curves: ExtractedCurve[];
  notes: string[];
}

/** Where a layer's points came from, which drives its icon and empty states. */
export type LayerSource = "drawing" | "screenshot" | "data";

export interface Layer {
  id: string;
  name: string;
  source: LayerSource;
  colour: string;
  visible: boolean;
  /** Raw input points, in world coordinates. */
  points: Point[];
  /** Ranked candidates, empty until a fit has been requested. */
  candidates: Candidate[];
  /** Which candidate is being shown; null while none is selected. */
  selectedKind: string | null;
  /**
   * Live parameter values, keyed by candidate kind. Sliders write here rather
   * than mutating the candidate, so the original fit is never lost and a
   * "reset" is always available.
   */
  overrides: Record<string, number[]>;
  status: "idle" | "fitting" | "ready" | "error";
  error: string | null;
}
