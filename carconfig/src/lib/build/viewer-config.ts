import type { Part, TirePartSpec, WheelPartSpec } from "@/types/part";
import type { BodyProfile, CatalogVehicle } from "@/types/vehicle";

/**
 * What the 3D viewer needs to draw, derived from the vehicle and the build.
 *
 * Kept out of the viewer deliberately. The viewer's job is to turn this
 * structure into geometry; working out that a set of coilovers means the body
 * sits 30mm lower is a question about parts, not about rendering, and doing it
 * here means it can be tested without a canvas.
 *
 * It is also the seam where real assets arrive: a GLTF-based viewer consumes
 * exactly this and nothing else changes.
 */

export interface ViewerWheel {
  readonly diameterIn: number;
  readonly widthIn: number;
  readonly tireWidthMm: number;
  readonly tireAspect: number;
}

export interface ViewerConfig {
  readonly bodyProfile: BodyProfile;
  readonly paintHex: string;
  readonly paintFinish: "gloss" | "satin" | "matte" | "metallic";
  readonly wheelStyle: "mesh" | "split_spoke" | "five_spoke" | "twin_five_spoke";
  readonly wheelFinishHex: string;
  readonly front: ViewerWheel;
  readonly rear: ViewerWheel;
  /** Negative lowers the body. Millimetres. */
  readonly rideHeightDeltaMm: number;
  readonly attachments: readonly ("spoiler" | "wing" | "splitter" | "diffuser" | "side_skirts")[];
  readonly exhaustTips: number;
}

/**
 * Rolling radius in metres, from the wheel and tire.
 *
 * This is why a 20 inch wheel looks like a 20 inch wheel in the viewer and a
 * 17 doesn't: the geometry comes from the actual numbers rather than from a
 * fixed model. Sidewall height is section width times the aspect ratio, the
 * definition of the aspect ratio.
 */
export function rollingRadiusM(wheel: ViewerWheel): number {
  const rimM = (wheel.diameterIn * 25.4) / 1000;
  const sidewallM = ((wheel.tireWidthMm * wheel.tireAspect) / 100) / 1000;
  return rimM / 2 + sidewallM;
}

export function tireWidthM(wheel: ViewerWheel): number {
  // The tread is a little narrower than the section width, which is measured
  // at the widest point of the sidewall.
  return (wheel.tireWidthMm * 0.92) / 1000;
}

/**
 * What to draw for a car nobody has measured.
 *
 * A generic silhouette on generic 18s. The viewer already tells the user its
 * geometry is a placeholder; for an unprofiled car the wheel sizes are
 * placeholders too, and the configurator says so rather than implying these
 * are the car's real dimensions.
 */
const UNPROFILED_FALLBACK = {
  bodyProfile: "coupe" as BodyProfile,
  paintHex: "#6e7377",
  wheel: { diameterIn: 18, widthIn: 8, tireWidthMm: 235, tireAspect: 40 },
};

export function deriveViewerConfig(
  vehicle: CatalogVehicle,
  parts: readonly Part[],
  paintOverrideHex?: string,
): ViewerConfig {
  const profile = vehicle.profile;
  const wheelPart = parts.find((p) => p.category === "wheels");
  const wheelSpec = wheelPart?.spec as WheelPartSpec | undefined;
  const tirePart = parts.find((p) => p.category === "tires");
  const tireSpec = tirePart?.spec as TirePartSpec | undefined;

  const stockFront = profile?.wheels.front;
  const stockRear = profile?.wheels.rear;
  const fb = UNPROFILED_FALLBACK.wheel;

  const front: ViewerWheel = {
    diameterIn: wheelSpec?.front.diameterIn ?? stockFront?.diameterIn ?? fb.diameterIn,
    widthIn: wheelSpec?.front.widthIn ?? stockFront?.widthIn ?? fb.widthIn,
    tireWidthMm: tireSpec?.front.widthMm ?? stockFront?.tire.widthMm ?? fb.tireWidthMm,
    tireAspect: tireSpec?.front.aspect ?? stockFront?.tire.aspect ?? fb.tireAspect,
  };

  const rear: ViewerWheel = {
    diameterIn: wheelSpec?.rear.diameterIn ?? stockRear?.diameterIn ?? fb.diameterIn,
    widthIn: wheelSpec?.rear.widthIn ?? stockRear?.widthIn ?? fb.widthIn,
    tireWidthMm: tireSpec?.rear.widthMm ?? stockRear?.tire.widthMm ?? fb.tireWidthMm,
    tireAspect: tireSpec?.rear.aspect ?? stockRear?.tire.aspect ?? fb.tireAspect,
  };

  // Ride height stacks: springs and coilovers both lower the car, and fitting
  // both is not a thing anybody does, but the arithmetic should not break if
  // they somehow did.
  const rideHeightDeltaMm = parts.reduce(
    (sum, p) => sum + (p.visual?.rideHeightDeltaMm ?? 0),
    0,
  );

  const paintPart = parts.find((p) => p.category === "paint");

  const attachments = parts
    .map((p) => p.visual?.attachment)
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const exhaustPart = parts.find(
    (p) => p.category === "exhaust" && p.visual?.exhaustTips !== undefined,
  );

  return {
    bodyProfile: profile?.bodyProfile ?? UNPROFILED_FALLBACK.bodyProfile,
    paintHex:
      paintOverrideHex ??
      paintPart?.visual?.paintHex ??
      profile?.defaultPaintHex ??
      UNPROFILED_FALLBACK.paintHex,
    paintFinish: paintPart?.visual?.paintFinish ?? "gloss",
    wheelStyle: wheelPart?.visual?.wheelStyle ?? "five_spoke",
    wheelFinishHex: wheelPart?.visual?.wheelFinishHex ?? "#6e767d",
    front,
    rear,
    rideHeightDeltaMm,
    // Deduplicated: two parts that both add a splitter should not draw two.
    attachments: [...new Set(attachments)],
    exhaustTips: exhaustPart?.visual?.exhaustTips ?? 2,
  };
}
