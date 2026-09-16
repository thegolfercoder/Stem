import type { Part, TirePartSpec, WheelPartSpec } from "@/types/part";
import type { BodyProfile, Vehicle } from "@/types/vehicle";

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

export function deriveViewerConfig(
  vehicle: Vehicle,
  parts: readonly Part[],
  paintOverrideHex?: string,
): ViewerConfig {
  const wheelPart = parts.find((p) => p.category === "wheels");
  const wheelSpec = wheelPart?.spec as WheelPartSpec | undefined;
  const tirePart = parts.find((p) => p.category === "tires");
  const tireSpec = tirePart?.spec as TirePartSpec | undefined;

  const front: ViewerWheel = {
    diameterIn: wheelSpec?.front.diameterIn ?? vehicle.wheels.front.diameterIn,
    widthIn: wheelSpec?.front.widthIn ?? vehicle.wheels.front.widthIn,
    tireWidthMm: tireSpec?.front.widthMm ?? vehicle.wheels.front.tire.widthMm,
    tireAspect: tireSpec?.front.aspect ?? vehicle.wheels.front.tire.aspect,
  };

  const rear: ViewerWheel = {
    diameterIn: wheelSpec?.rear.diameterIn ?? vehicle.wheels.rear.diameterIn,
    widthIn: wheelSpec?.rear.widthIn ?? vehicle.wheels.rear.widthIn,
    tireWidthMm: tireSpec?.rear.widthMm ?? vehicle.wheels.rear.tire.widthMm,
    tireAspect: tireSpec?.rear.aspect ?? vehicle.wheels.rear.tire.aspect,
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
    bodyProfile: vehicle.bodyProfile,
    paintHex:
      paintOverrideHex ?? paintPart?.visual?.paintHex ?? vehicle.defaultPaintHex,
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
