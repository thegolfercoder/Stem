import type { Provenance } from "./provenance";

/**
 * Two different things are called a "vehicle" in this product, and keeping
 * them apart is what lets the catalogue hold every car without lying about
 * any of them.
 *
 *   VehicleIdentity  - this make sold this model in this year. Imported from
 *                      NHTSA vPIC, so there are tens of thousands of them and
 *                      the list is not hand-maintained.
 *
 *   VehicleProfile   - the measurements a compatibility rule can reason about:
 *                      bolt pattern, hub bore, clearance envelopes, rotor
 *                      sizes, power, weight. Hand-curated, expensive, and
 *                      therefore rare.
 *
 *   CatalogVehicle   - an identity plus its profile *if one exists*. Most cars
 *                      have no profile, and that is a fact the engine reports
 *                      as "unknown" rather than papering over.
 *
 * db/schema.sql normalizes the profile across manufacturers / models /
 * generations / trims / engines, which is right for writing. Reading it back
 * joined into one object is what every screen actually wants.
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
/** Which body the 3D viewer draws. Each is a parametric shape, not a model. */
export type BodyProfile =
  | "coupe"
  | "sedan"
  | "hatch"
  | "wagon"
  | "suv"
  | "roadster"
  | "truck";

/**
 * Exterior dimensions in millimetres, as the manufacturer publishes them.
 *
 * These drive the 3D body's proportions, which is why an M3 renders visibly
 * longer than a GR86. They are the least consequential numbers in the profile
 * — nothing in the compatibility engine reads them — but they are still a
 * claim, so they sit under the profile's provenance like everything else.
 */
export interface VehicleDimensions {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly wheelbaseMm: number;
}

export interface VehicleProfile {
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
  readonly dimensions: VehicleDimensions;
  /** Hex colour the viewer uses before the user picks a paint. */
  readonly defaultPaintHex: string;

  readonly provenance: Provenance;
}

/** "2023 BMW M3 Competition xDrive" */
export function vehicleFullName(vehicle: VehicleProfile): string {
  return `${vehicle.year} ${vehicle.manufacturer} ${vehicle.model} ${vehicle.trim}`;
}

/** "BMW M3 (G80)" */
export function vehicleShortName(vehicle: VehicleProfile): string {
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

// ---------------------------------------------------------------------------
// Identity: every car that exists
// ---------------------------------------------------------------------------

/** Passenger vehicle classes carried over from the vPIC import. */
export type BodyType = "car" | "mpv" | "truck";

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  car: "Car",
  mpv: "SUV / MPV",
  truck: "Truck",
};

/**
 * One model line as the importer found it: a make, a model, and the years it
 * was sold. Carries no measurements at all.
 */
export interface ModelLine {
  readonly makeSlug: string;
  readonly make: string;
  readonly modelSlug: string;
  readonly model: string;
  readonly years: readonly number[];
  readonly types: readonly BodyType[];
}

/** One buildable car: a model line narrowed to a single year. */
export interface VehicleIdentity {
  /** Stable URL key: "bmw/m3/2023". */
  readonly key: string;
  readonly makeSlug: string;
  readonly make: string;
  readonly modelSlug: string;
  readonly model: string;
  readonly year: number;
  readonly types: readonly BodyType[];
}

/**
 * What the configurator actually works with.
 *
 * `profile` is null for the overwhelming majority of cars, and that is the
 * honest state of the world rather than a gap to be filled with guesses. The
 * compatibility engine reports "unknown" for anything it cannot measure, so a
 * car with no profile still opens, still costs a build, and still refuses to
 * claim a part fits.
 */
export interface CatalogVehicle extends VehicleIdentity {
  readonly profile: VehicleProfile | null;
}

export function identityKey(
  makeSlug: string,
  modelSlug: string,
  year: number,
): string {
  return `${makeSlug}/${modelSlug}/${year}`;
}

/** "2023 BMW M3" — works with or without a profile. */
export function catalogVehicleName(v: VehicleIdentity): string {
  return `${v.year} ${v.make} ${v.model}`;
}

/**
 * Which identities a hand-curated profile speaks for.
 *
 * Stated explicitly rather than derived from the profile's own model name:
 * vPIC calls the car "M3" where the profile calls it "M3 Competition xDrive",
 * and guessing at that mapping is how a profile silently attaches to the wrong
 * car.
 */
export interface ProfileMatch {
  readonly makeSlug: string;
  readonly modelSlug: string;
  /** Inclusive. A null end means "still in production". */
  readonly years: readonly [number, number | null];
}

/** A manufacturer in the catalogue, with how many model lines it has. */
export interface MakeSummary {
  readonly slug: string;
  readonly name: string;
  readonly modelCount: number;
}

/** A search result: a model line, flagged with whether it has measurements. */
export interface ModelSearchHit extends ModelLine {
  readonly hasProfile: boolean;
}
