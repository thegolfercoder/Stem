import type { Provenance } from "./provenance";

/**
 * The read model for a vehicle.
 *
 * db/schema.sql normalizes this across manufacturers / models / generations /
 * trims / engines / vehicles, which is right for writing. Reading it back
 * joined into one object is what every screen in the app actually wants, so
 * the catalog layer presents this shape and the adapter does the joining. The
 * seed adapter has it easy; a Postgres adapter will do it in one query.
 */

export type Drivetrain = "fwd" | "rwd" | "awd";
export type Axle = "front" | "rear";

export const DRIVETRAIN_LABELS: Record<Drivetrain, string> = {
  fwd: "Front-wheel drive",
  rwd: "Rear-wheel drive",
  awd: "All-wheel drive",
};

export interface Engine {
  readonly code: string;
  readonly displayName: string;
  readonly displacementCc: number;
  readonly cylinders: number;
  readonly aspiration: "naturally_aspirated" | "turbocharged" | "supercharged";
  readonly fuel: "petrol" | "diesel" | "electric" | "hybrid";
}

/**
 * The wheel and tire fitment for one axle.
 *
 * Front and rear are separate because staggered setups are normal on these
 * cars. A single per-car wheel spec cannot describe an M3 without lying about
 * one end of it.
 */
export interface WheelSpec {
  readonly boltCount: number;
  /** Bolt circle diameter in mm — the 112 in 5x112. */
  readonly boltCircleMm: number;
  readonly centerBoreMm: number;
  readonly diameterIn: number;
  readonly widthIn: number;
  readonly offsetMm: number;

  /**
   * The envelope an aftermarket wheel must fit inside. Optional because it is
   * frequently unknown — and when it is unknown the compatibility engine must
   * return "unknown", not assume the wheel fits.
   */
  readonly minOffsetMm?: number;
  readonly maxOffsetMm?: number;
  readonly maxWidthIn?: number;
  readonly minDiameterIn?: number;
  readonly maxDiameterIn?: number;

  readonly tire: TireSpec;
  /**
   * Covers the measured dimensions above — bolt pattern, bore, stock size.
   * These come from the manufacturer.
   */
  readonly provenance: Provenance;
  /**
   * Covers the min/max envelope only, which is an estimate rather than a
   * published figure.
   *
   * Two stamps rather than one because they are two different claims: that
   * this car is 5x112 is a fact somebody published, and that it will clear a
   * 10 inch wheel is somebody's estimate. A rule cites whichever it actually
   * relied on, so a bolt-pattern verdict is not dragged down to "estimated"
   * by a clearance figure it never looked at.
   */
  readonly envelopeProvenance?: Provenance;
}

export interface TireSpec {
  readonly widthMm: number;
  readonly aspect: number;
  readonly diameterIn: number;
}

export interface BrakeSpec {
  readonly rotorDiameterMm: number;
  readonly rotorThicknessMm?: number;
  readonly caliperPistons?: number;
  readonly caliperDescription?: string;
  readonly provenance: Provenance;
}

/**
 * Platform traits a compatibility rule may need to reason about but which are
 * not a single measurement. Kept as string flags so adding one does not mean
 * changing every vehicle record.
 */
export type VehicleTrait =
  | "strut_front"
  | "double_wishbone_front"
  | "multilink_rear"
  | "electronic_dampers"
  | "staggered_stock_fitment"
  | "carbon_ceramic_available"
  | "hatch_body"
  | "mid_engine";

/** Which placeholder body the 3D viewer draws. Swappable for real assets. */
export type BodyProfile = "coupe" | "sedan" | "hatch" | "wagon" | "suv" | "roadster";

export interface Vehicle {
  readonly id: string;
  readonly slug: string;

  readonly manufacturer: string;
  readonly manufacturerSlug: string;
  readonly model: string;
  readonly generationCode: string;
  readonly generationName: string;
  readonly yearStart: number;
  readonly yearEnd: number | null;
  readonly year: number;
  readonly trim: string;

  readonly engine: Engine;
  readonly drivetrain: Drivetrain;

  readonly stockPowerHp: number;
  readonly stockTorqueNm: number;
  readonly stockWeightKg: number;

  readonly wheels: Readonly<Record<Axle, WheelSpec>>;
  readonly brakes: Readonly<Record<Axle, BrakeSpec>>;
  readonly traits: readonly VehicleTrait[];

  readonly bodyProfile: BodyProfile;
  /** Hex colour the viewer uses before the user picks a paint. */
  readonly defaultPaintHex: string;

  readonly provenance: Provenance;
}

/** "2023 BMW M3 Competition xDrive" */
export function vehicleFullName(vehicle: Vehicle): string {
  return `${vehicle.year} ${vehicle.manufacturer} ${vehicle.model} ${vehicle.trim}`;
}

/** "BMW M3 (G80)" */
export function vehicleShortName(vehicle: Vehicle): string {
  return `${vehicle.manufacturer} ${vehicle.model} (${vehicle.generationCode})`;
}

/** "5x112" */
export function boltPatternLabel(spec: WheelSpec): string {
  return `${spec.boltCount}x${spec.boltCircleMm}`;
}

/** "19x9.5 ET29" */
export function wheelSizeLabel(spec: {
  diameterIn: number;
  widthIn: number;
  offsetMm: number;
}): string {
  return `${spec.diameterIn}x${spec.widthIn} ET${spec.offsetMm}`;
}

/** "275/35R19" */
export function tireSizeLabel(tire: TireSpec): string {
  return `${tire.widthMm}/${tire.aspect}R${tire.diameterIn}`;
}
