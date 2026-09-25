import type { SpokeStyle } from "@/lib/build/viewer-config";
import type { TracedSide } from "./body-shape";
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
  /** Open vents in the wing behind each front wheel. */
  | "arch_vents"
  /** Air intakes in the rear quarters, ahead of the rear wheels. */
  | "side_intakes"
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
  /** The real side view, traced from a photograph; overrides the proportions above. */
  readonly traced?: TracedSide;
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
      // Shallow end caps: the traced silhouette already carries the sloping
      // nose and the tail, and a deep dome would round them off.
      capFront: 0.05,
      leanFront: 0.04,
      capRear: 0.05,
      leanRear: 0.03,
      fenderPeakFront: 0.1,
      fenderPeakRear: 0.045,
      doors: 1,
    },
    face: "porsche_911",
    factory: [
      "swan_neck_wing",
      "hood_vents",
      "fender_louvres",
      "engine_grille",
      "arch_vents",
      "side_intakes",
      "diffuser",
      "splitter",
    ],
    stockExhaust: { tips: 2, centre: true },
    // Forged centre-lock wheels with ten thin spokes.
    stockWheel: { style: "ten_spoke", finishHex: "#2a2c30" },
    stockCaliperHex: "#b3151b",
    // Traced from Porsche's own studio side view of the 992 GT3 RS
    // (newsroom.porsche.com, "direct_side", 2022 world premiere), measured on
    // a grid. Scaled to the published length and height, and corrected for
    // perspective by pinning the nose, both hubs and the tail to the published
    // length, wheelbase and the photo's own 49/51 overhang split. The wing
    // is not part of the body line.
    traced: {
      frontAxle: 0.2264,
      cowl: 0.3205,
      roofFront: 0.5043,
      roofRear: 0.6665,
      backlight: 0.825,
      top: [[0.0, 0.3676], [0.0049, 0.4269], [0.0208, 0.498], [0.0392, 0.5375], [0.0636, 0.5771], [0.1004, 0.6166], [0.153, 0.6522], [0.2068, 0.664], [0.2805, 0.6838], [0.3205, 0.6996], [0.3529, 0.7549], [0.3962, 0.834], [0.4394, 0.9091], [0.4719, 0.9526], [0.5043, 0.9842], [0.5475, 0.996], [0.6016, 1.0], [0.6557, 0.9921], [0.6849, 0.9407], [0.7206, 0.9012], [0.7562, 0.8538], [0.7968, 0.8024], [0.825, 0.7628], [0.8776, 0.7233], [0.9192, 0.6996], [0.9596, 0.6917], [0.978, 0.664], [0.9902, 0.5929], [1.0, 0.5257]],
      belt: [[0.3205, 0.6996], [0.3962, 0.6957], [0.5043, 0.6996], [0.6124, 0.7075], [0.7206, 0.7312], [0.753, 0.7431], [0.825, 0.7549]],
      bottom: [[0.0, 0.2292], [0.0049, 0.1423], [0.1004, 0.1383], [0.2264, 0.1304], [0.3497, 0.1186], [0.5043, 0.1225], [0.6665, 0.1265], [0.7638, 0.1383], [0.9192, 0.1976], [0.9719, 0.2885], [1.0, 0.3557]],
    },
  },
};

export function modelShapeFor(profileSlug: string | undefined): ModelShape | null {
  return profileSlug ? (MODEL_SHAPES[profileSlug] ?? null) : null;
}
