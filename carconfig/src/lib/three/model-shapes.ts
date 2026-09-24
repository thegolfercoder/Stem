import type { SpokeStyle } from "@/lib/build/viewer-config";
import type { StylePreset } from "./body-styles";
import type { FaceFamily } from "./face-styles";

/**
 * Per-model shapes for cars that deserve better than their body style.
 *
 * A body style gets any coupe roughly right. Some cars are their silhouette —
 * nobody mistakes a 911 for a generic coupe — and for those a model shape
 * adjusts the style's proportions, picks a face, and adds what the car wears
 * from the factory: a GT3 RS without its wing is not a GT3 RS.
 *
 * Keyed by vehicle profile slug, so it only applies where the car has been
 * measured. The proportions are still drawn to the published length, width,
 * height and wheelbase; these only say how that volume is shaped.
 */

export type FactoryFeature =
  /** A two-element wing hung from swan-neck mounts above the engine lid. */
  | "swan_neck_wing"
  /** Radiator outlets in the front of the bonnet. */
  | "hood_vents"
  /** Open louvres on top of the front wings, over the wheels. */
  | "fender_louvres"
  /** Louvred grille on the engine lid. */
  | "engine_grille"
  | "diffuser"
  | "splitter";

export interface ModelShape {
  readonly overrides: Partial<StylePreset>;
  readonly face?: FaceFamily;
  readonly factory: readonly FactoryFeature[];
  /** Stock exhaust, drawn when no exhaust part is fitted. */
  readonly stockExhaust?: { readonly tips: number; readonly centre: boolean };
  /** Stock caliper colour, when no brake kit is fitted. */
  readonly stockCaliperHex?: string;
  /** Stock wheel look, drawn when no wheel part is fitted. */
  readonly stockWheel?: { readonly style: SpokeStyle; readonly finishHex: string };
}

export const MODEL_SHAPES: Readonly<Record<string, ModelShape>> = {
  "porsche-911-gt3-rs-992-2023": {
    overrides: {
      // Engine behind the rear axle: a long tail and a short, low nose.
      frontOverhangShare: 0.44,
      // The cabin sits well back from the front axle, and the roof runs
      // straight into a long fastback that becomes the engine lid.
      // Sums to put the base of the rear glass ~0.3m behind the rear axle,
      // leaving a proper engine lid between it and the tail.
      cowl: 0.3,
      windshieldRun: 0.85,
      roof: 0.2,
      backlightRun: 0.68,
      belt: 0.64,
      nose: 0.38,
      deck: 0.66,
      tail: 0.5,
      clearance: 0.1,
      liftFront: 0.05,
      liftRear: 0.08,
      roundTop: 4.2,
      roundBottom: 6.5,
      cabinRound: 3.3,
      shoulder: 0.12,
      tumblehome: 0.24,
      // Wide rear haunches: the body is widest over the rear wheels.
      hips: 0.085,
      flareFront: 0.05,
      noseRatio: 0.8,
      taperFront: 0.55,
      tailRatio: 0.9,
      taperRear: 0.3,
      // A long, sloping nose with the lamps on it, and a rounded tail.
      capFront: 0.16,
      leanFront: 0.16,
      capRear: 0.12,
      leanRear: 0.12,
      fenderPeakFront: 0.1,
      fenderPeakRear: 0.045,
      doors: 1,
    },
    face: "porsche_911",
    factory: ["swan_neck_wing", "hood_vents", "fender_louvres", "engine_grille", "diffuser", "splitter"],
    stockExhaust: { tips: 2, centre: true },
    stockWheel: { style: "twin_five_spoke", finishHex: "#2a2c30" },
    stockCaliperHex: "#b3151b",
  },
};

export function modelShapeFor(profileSlug: string | undefined): ModelShape | null {
  return profileSlug ? (MODEL_SHAPES[profileSlug] ?? null) : null;
}
