import manifest from "@/data/vehicles/model-assets.json";

/**
 * Real 3D models, where we have one.
 *
 * Fetched by scripts/fetch-model.mjs, which checks the licence and records
 * who made it; this module only reads that record. A car with a model here is
 * drawn with it, and everything else falls back to the generated body.
 *
 * The credit travels with the model into the viewer, because every licence
 * the fetch script accepts (bar CC0) requires the author to be named where
 * the model is shown.
 */

export interface ModelCredit {
  readonly name: string;
  readonly author: string;
  readonly authorUrl: string | null;
  readonly licenseLabel: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  /** Built for this site (tools/blender) rather than downloaded; sourceUrl is its build script. */
  readonly own: boolean;
}

export interface ModelAsset {
  readonly file: string;
  readonly credit: ModelCredit;
  readonly tuning: ModelTuning;
}

/**
 * Per-model corrections, for when the automatic handling guesses wrong. Every
 * model is authored differently: some face +z, some −x; some name their paint
 * "Body", some "Material.004".
 */
export interface ModelTuning {
  /** Extra turn about the vertical axis, degrees, applied after auto-orientation. */
  readonly yawDeg?: number;
  /** Material names to repaint. Overrides the name-based guess. */
  readonly paintMaterials?: readonly string[];
  /** "model" keeps the model's own wheels; "auto" swaps in fitted ones when all four are found. */
  readonly wheels?: "auto" | "model";
}

const TUNING: Readonly<Record<string, ModelTuning>> = {};

interface ManifestEntry {
  readonly file: string;
  readonly name: string;
  readonly author: string;
  readonly authorUrl: string | null;
  readonly licenseLabel: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  readonly own?: boolean;
}

const ENTRIES = manifest as Readonly<Record<string, ManifestEntry>>;

/**
 * The model for a model line ("porsche/911"), shared by every year of it. A
 * line spans generations, so the model is representative rather than exact;
 * the credit names the model, year and all, so nobody mistakes which one it is.
 */
export function modelAssetFor(makeSlug: string, modelSlug: string): ModelAsset | null {
  const key = `${makeSlug}/${modelSlug}`;
  const e = ENTRIES[key];
  if (!e) return null;
  return {
    file: e.file,
    credit: {
      name: e.name,
      author: e.author,
      authorUrl: e.authorUrl,
      licenseLabel: e.licenseLabel,
      licenseUrl: e.licenseUrl,
      sourceUrl: e.sourceUrl,
      own: e.own === true,
    },
    tuning: TUNING[key] ?? {},
  };
}
