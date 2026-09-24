import type {
  Axle,
  BodyProfile,
  BrakeSpec,
  Drivetrain,
  Engine,
  VehicleProfile,
  VehicleTrait,
  WheelSpec,
} from "@/types/vehicle";
import { FITMENT_ENVELOPE_ESTIMATE, OEM_BRAKES, OEM_PUBLISHED } from "./provenance";

/**
 * A terser input shape for writing seed vehicles by hand, expanded into the
 * full VehicleProfile read model (the curated fitment data).
 *
 * The point is that the provenance stamps get attached in one place. Hand-
 * writing them on every corner spec would mean that the day somebody forgets,
 * a row of invented numbers appears in the UI with no label on it.
 */

interface CornerInput {
  /** [diameter, width, offset] */
  readonly wheel: readonly [number, number, number];
  /** [tireWidth, aspect] — rim diameter is taken from the wheel. */
  readonly tire: readonly [number, number];
  /** [minOffset, maxOffset] — omit when no sensible estimate can be made. */
  readonly offsetRange?: readonly [number, number];
  /** Widest wheel estimated to clear. Omit when unknown. */
  readonly maxWidthIn?: number;
  /** [minDiameter, maxDiameter] the arch and brakes are estimated to allow. */
  readonly diameterRange?: readonly [number, number];
  /** [rotorDiameterMm, pistons?, description?] */
  readonly brake: readonly [number, number?, string?];
}

export interface VehicleInput {
  readonly slug: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly generationCode: string;
  readonly generationName: string;
  readonly years: readonly [number, number | null];
  readonly year: number;
  readonly trim: string;
  readonly engine: Engine;
  readonly drivetrain: Drivetrain;
  readonly powerHp: number;
  readonly torqueNm: number;
  readonly weightKg: number;
  readonly boltCount: number;
  readonly boltCircleMm: number;
  readonly centerBoreMm: number;
  readonly front: CornerInput;
  /** Omit for a square fitment: the front spec is used for both axles. */
  readonly rear?: CornerInput;
  readonly traits?: readonly VehicleTrait[];
  readonly bodyProfile: BodyProfile;
  readonly paintHex: string;
}

function toWheelSpec(
  input: VehicleInput,
  corner: CornerInput,
): WheelSpec {
  const [diameterIn, widthIn, offsetMm] = corner.wheel;
  const [tireWidthMm, tireAspect] = corner.tire;

  return {
    boltCount: input.boltCount,
    boltCircleMm: input.boltCircleMm,
    centerBoreMm: input.centerBoreMm,
    diameterIn,
    widthIn,
    offsetMm,
    minOffsetMm: corner.offsetRange?.[0],
    maxOffsetMm: corner.offsetRange?.[1],
    maxWidthIn: corner.maxWidthIn,
    minDiameterIn: corner.diameterRange?.[0],
    maxDiameterIn: corner.diameterRange?.[1],
    tire: { widthMm: tireWidthMm, aspect: tireAspect, diameterIn },
    // The dimensions are OEM-published; the envelope around them is an
    // estimate. They are stamped separately so a rule can cite the one it
    // actually used.
    provenance: OEM_PUBLISHED,
    envelopeProvenance: corner.offsetRange ? FITMENT_ENVELOPE_ESTIMATE : undefined,
  };
}

function toBrakeSpec(corner: CornerInput): BrakeSpec {
  const [rotorDiameterMm, caliperPistons, caliperDescription] = corner.brake;
  return {
    rotorDiameterMm,
    caliperPistons,
    caliperDescription,
    provenance: OEM_BRAKES,
  };
}

export function defineVehicle(input: VehicleInput): VehicleProfile {
  const rear = input.rear ?? input.front;
  const wheels: Record<Axle, WheelSpec> = {
    front: toWheelSpec(input, input.front),
    rear: toWheelSpec(input, rear),
  };
  const brakes: Record<Axle, BrakeSpec> = {
    front: toBrakeSpec(input.front),
    rear: toBrakeSpec(rear),
  };

  const staggered =
    input.rear !== undefined &&
    (input.rear.wheel[0] !== input.front.wheel[0] ||
      input.rear.wheel[1] !== input.front.wheel[1]);

  const traits = staggered
    ? [...(input.traits ?? []), "staggered_stock_fitment" as VehicleTrait]
    : (input.traits ?? []);

  return {
    id: `veh_${input.slug}`,
    slug: input.slug,
    manufacturer: input.manufacturer,
    manufacturerSlug: input.manufacturer.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    model: input.model,
    generationCode: input.generationCode,
    generationName: input.generationName,
    yearStart: input.years[0],
    yearEnd: input.years[1],
    year: input.year,
    trim: input.trim,
    engine: input.engine,
    drivetrain: input.drivetrain,
    stockPowerHp: input.powerHp,
    stockTorqueNm: input.torqueNm,
    stockWeightKg: input.weightKg,
    wheels,
    brakes,
    traits,
    bodyProfile: input.bodyProfile,
    defaultPaintHex: input.paintHex,
    provenance: OEM_PUBLISHED,
  };
}
