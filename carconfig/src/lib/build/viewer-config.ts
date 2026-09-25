import type { BrakePartSpec, Part, TirePartSpec, WheelPartSpec } from "@/types/part";
import { bodyStyleFor } from "@/data/vehicles/model-styles";
import type { PaintFinish, StripeStyle } from "./appearance";
import { modelAssetFor, type ModelAsset } from "@/lib/three/model-assets";
import { modelShapeFor, type ModelShape } from "@/lib/three/model-shapes";
import { faceFamilyFor, type FaceFamily } from "@/lib/three/face-styles";
import type { BodyProfile, CatalogVehicle } from "@/types/vehicle";
import { STYLE_DEFAULTS } from "@/lib/three/body-styles";

/**
 * What the 3D viewer draws, derived from the vehicle and the build.
 *
 * Kept out of the viewer on purpose. Working out that a set of coilovers means
 * the body sits 30mm lower, or that ET15 on a car built for ET29 pushes the
 * wheel 14mm further out, is a question about parts and cars, not about
 * rendering — and doing it here means it can be tested without a canvas.
 *
 * Every number the viewer uses to place a wheel comes through here, and most
 * of them are the same numbers the compatibility engine checks. That is the
 * point: when the engine says a wheel pokes past the arch, the car should look
 * like it does.
 */

export interface WheelFit {
  readonly diameterIn: number;
  readonly widthIn: number;
  readonly offsetMm: number;
  readonly tireWidthMm: number;
  readonly tireAspect: number;
}

export interface AxleConfig {
  /** What the car came with — the arches are cut around this. */
  readonly stock: WheelFit;
  /** What is fitted in this build. */
  readonly fitted: WheelFit;
  readonly rotorMm: number;
  readonly caliperPistons: number;
}

export const SPOKE_STYLES = [
  "five_spoke",
  "twin_five_spoke",
  "split_spoke",
  "mesh",
  "ten_spoke",
  "y_spoke",
  "multi_spoke",
  "deep_dish",
] as const;
export type SpokeStyle = (typeof SPOKE_STYLES)[number];
export type Attachment = "spoiler" | "wing" | "splitter" | "diffuser" | "side_skirts";

export interface ViewerConfig {
  readonly style: BodyProfile;
  /** Metres. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly wheelbase: number;
  /** Published track widths in metres, or null to derive them from the body. */
  readonly trackFront: number | null;
  readonly trackRear: number | null;
  /**
   * "published" when these are the car's own dimensions, "typical" when they
   * are a stand-in for the body style. The viewer says which.
   */
  readonly dimensionSource: "published" | "typical";
  /** The make's face: grille, lamps and intakes. */
  readonly face: FaceFamily;
  /** A per-model shape and factory kit, for the few cars that have one. */
  readonly model: ModelShape | null;
  /** A real 3D model of the car, when one has been fetched. */
  readonly asset: ModelAsset | null;

  readonly paintHex: string;
  readonly paintFinish: PaintFinish;
  /**
   * Whether the paint, wheels and calipers were chosen (by a part in the
   * build or in the customiser). A real 3D model keeps its own until they
   * are; the generated car always draws them from here.
   */
  readonly paintChosen: boolean;
  readonly wheelsChosen: boolean;
  readonly caliperChosen: boolean;
  /** Stripes over the body, and their colour. */
  readonly stripe: StripeStyle;
  readonly stripeHex: string;

  readonly wheelStyle: SpokeStyle;
  readonly wheelFinishHex: string;
  readonly boltCount: number;
  readonly boltCircleMm: number;

  readonly front: AxleConfig;
  readonly rear: AxleConfig;

  /** Negative lowers the body. Millimetres. */
  readonly rideHeightDeltaMm: number;
  readonly attachments: readonly Attachment[];
  readonly exhaustTips: number;
  readonly tipFinish: "polished" | "titanium" | "black";
  /** Tips grouped in the middle of the tail rather than at its corners. */
  readonly exhaustCentre: boolean;
  readonly caliperHex: string;
  /** The rear keeps its stock caliper when a kit only covers the front. */
  readonly rearCaliperHex: string;
  /** True when a big brake kit is in the build. */
  readonly brakeKit: boolean;
}

/** Rolling radius in metres: half the rim, plus one sidewall. */
export function rollingRadiusM(w: Pick<WheelFit, "diameterIn" | "tireWidthMm" | "tireAspect">): number {
  const rim = (w.diameterIn * 25.4) / 2000;
  const sidewall = (w.tireWidthMm * w.tireAspect) / 100 / 1000;
  return rim + sidewall;
}

export function rimRadiusM(w: Pick<WheelFit, "diameterIn">): number {
  return (w.diameterIn * 25.4) / 2000;
}

/**
 * How much further out (positive) the fitted wheel's outer face sits than the
 * stock one did, in metres.
 *
 * Lower offset moves the whole wheel outward by the difference; a wider wheel
 * adds half its extra width to the outside. This is the poke you see when a
 * fitment is too aggressive, and it is the same arithmetic the offset and
 * width rules reason about.
 */
export function pokeM(axle: Pick<AxleConfig, "stock" | "fitted">): number {
  const offsetShift = (axle.stock.offsetMm - axle.fitted.offsetMm) / 1000;
  const widthShift = ((axle.fitted.widthIn - axle.stock.widthIn) * 25.4) / 2000;
  return offsetShift + widthShift;
}

const STOCK_CALIPER = "#2b2e33";

export function deriveViewerConfig(
  vehicle: CatalogVehicle,
  parts: readonly Part[],
  paintOverrideHex?: string,
): ViewerConfig {
  const profile = vehicle.profile;

  const style: BodyProfile = profile?.bodyProfile ?? bodyStyleFor(vehicle);
  const defaults = STYLE_DEFAULTS[style];

  const stockFor = (axle: "front" | "rear"): WheelFit => {
    const w = profile?.wheels[axle];
    if (!w) return defaults.wheel;
    return {
      diameterIn: w.diameterIn,
      widthIn: w.widthIn,
      offsetMm: w.offsetMm,
      tireWidthMm: w.tire.widthMm,
      tireAspect: w.tire.aspect,
    };
  };

  const wheelPart = parts.find((p) => p.category === "wheels");
  const wheelSpec = wheelPart?.spec as WheelPartSpec | undefined;
  const tirePart = parts.find((p) => p.category === "tires");
  const tireSpec = tirePart?.spec as TirePartSpec | undefined;
  const kitPart = parts.find(
    (p) => p.category === "brakes" && (p.spec as BrakePartSpec).type === "big_brake_kit",
  );
  const kitSpec = kitPart?.spec as BrakePartSpec | undefined;

  const fittedFor = (axle: "front" | "rear", stock: WheelFit): WheelFit => {
    const w = wheelSpec?.kind === "wheels" ? wheelSpec[axle] : undefined;
    const t = tireSpec?.kind === "tires" ? tireSpec[axle] : undefined;

    // A new wheel without a matching tire keeps the stock sidewall height, so
    // the rolling radius grows with the rim — which is what happens if you
    // stretch the old tire size onto a bigger wheel, and is visibly wrong in
    // the arch, which is the honest thing to show until a tire is chosen.
    return {
      diameterIn: w?.diameterIn ?? stock.diameterIn,
      widthIn: w?.widthIn ?? stock.widthIn,
      offsetMm: w?.offsetMm ?? stock.offsetMm,
      tireWidthMm: t?.widthMm ?? stock.tireWidthMm,
      tireAspect: t?.aspect ?? stock.tireAspect,
    };
  };

  const axle = (which: "front" | "rear"): AxleConfig => {
    const stock = stockFor(which);
    const stockRotor = profile?.brakes[which].rotorDiameterMm ?? defaults.rotorMm;
    const stockPistons = profile?.brakes[which].caliperPistons ?? 1;
    const kitHere = kitSpec && (kitSpec.axle === which || kitSpec.axle === "both");
    return {
      stock,
      fitted: fittedFor(which, stock),
      rotorMm: kitHere && kitSpec.rotorDiameterMm ? kitSpec.rotorDiameterMm : stockRotor,
      caliperPistons: kitHere && kitSpec.caliperPistons ? kitSpec.caliperPistons : stockPistons,
    };
  };

  const dims = profile?.dimensions;
  const model = modelShapeFor(profile?.slug);
  const paintPart = parts.find((p) => p.category === "paint");
  const exhaustPart = parts.find(
    (p) => p.category === "exhaust" && p.visual?.exhaustTips !== undefined,
  );
  const attachments = parts
    .map((p) => p.visual?.attachment)
    .filter((a): a is Attachment => a !== undefined);

  return {
    style,
    length: (dims?.lengthMm ?? defaults.lengthMm) / 1000,
    width: (dims?.widthMm ?? defaults.widthMm) / 1000,
    height: (dims?.heightMm ?? defaults.heightMm) / 1000,
    wheelbase: (dims?.wheelbaseMm ?? defaults.wheelbaseMm) / 1000,
    dimensionSource: dims ? "published" : "typical",
    trackFront: dims?.trackFrontMm ? dims.trackFrontMm / 1000 : null,
    trackRear: dims?.trackRearMm ? dims.trackRearMm / 1000 : null,
    face: model?.face ?? faceFamilyFor(vehicle.makeSlug, style),
    model,
    asset: modelAssetFor(vehicle.makeSlug, vehicle.modelSlug),

    paintHex:
      paintOverrideHex ??
      paintPart?.visual?.paintHex ??
      profile?.defaultPaintHex ??
      "#6e7377",
    paintFinish: paintPart?.visual?.paintFinish ?? "gloss",
    paintChosen: paintOverrideHex !== undefined || paintPart !== undefined,
    wheelsChosen: wheelPart !== undefined || kitPart !== undefined,
    caliperChosen: kitPart !== undefined,
    stripe: "none",
    stripeHex: "#f1f2f3",

    wheelStyle: wheelPart?.visual?.wheelStyle ?? model?.stockWheel?.style ?? "five_spoke",
    wheelFinishHex:
      wheelPart?.visual?.wheelFinishHex ?? model?.stockWheel?.finishHex ?? "#9aa1a8",
    boltCount: profile?.wheels.front.boltCount ?? defaults.boltCount,
    boltCircleMm: profile?.wheels.front.boltCircleMm ?? defaults.boltCircleMm,

    front: axle("front"),
    rear: axle("rear"),

    // Springs and coilovers both lower the car; nobody fits both, but the
    // arithmetic should not break if they somehow did.
    rideHeightDeltaMm: parts.reduce((sum, p) => sum + (p.visual?.rideHeightDeltaMm ?? 0), 0),
    attachments: [...new Set(attachments)],
    exhaustTips: exhaustPart?.visual?.exhaustTips ?? model?.stockExhaust?.tips ?? 2,
    tipFinish: exhaustPart?.visual?.tipFinish ?? "polished",
    // Where the pipes leave the body is the car's, whoever made the silencer.
    exhaustCentre: model?.stockExhaust?.centre ?? false,
    caliperHex: kitPart?.visual?.caliperHex ?? model?.stockCaliperHex ?? STOCK_CALIPER,
    rearCaliperHex:
      kitPart && kitSpec?.axle === "front"
        ? (model?.stockCaliperHex ?? STOCK_CALIPER)
        : (kitPart?.visual?.caliperHex ?? model?.stockCaliperHex ?? STOCK_CALIPER),
    brakeKit: kitPart !== undefined,
  };
}
