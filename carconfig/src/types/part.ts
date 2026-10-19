import type { Provenance } from "./provenance";
import type { Axle, VehicleTrait } from "./vehicle";

/**
 * Parts.
 *
 * A part has a small set of fields every part has (name, brand, price) and a
 * `spec` whose shape depends on the category. The spec is a discriminated
 * union keyed on the category slug, so adding a category means adding one
 * member here and one entry to PART_CATEGORIES — the configurator UI and the
 * compatibility engine both iterate over the registry rather than naming
 * categories individually.
 */

export type PartCategorySlug =
  | "wheels"
  | "tires"
  | "suspension"
  | "brakes"
  | "exhaust"
  | "intake"
  | "engine"
  | "aero"
  | "paint"
  | "interior";

export interface PartCategory {
  readonly slug: PartCategorySlug;
  readonly name: string;
  readonly description: string;
  /** Picking a part replaces the previous pick rather than adding to it. */
  readonly singleSelect: boolean;
  readonly sortOrder: number;
  /**
   * False for categories that are modelled but have no seed parts yet. The UI
   * shows them as coming soon rather than as an empty list, which is the
   * honest thing to show.
   */
  readonly seeded: boolean;
}

/**
 * Ordered as the configurator presents them: the six MVP categories first,
 * then the modelled-but-unseeded ones.
 */
export const PART_CATEGORIES: readonly PartCategory[] = [
  {
    slug: "wheels",
    name: "Wheels",
    description: "Diameter, width, offset and bolt pattern must all agree with the car.",
    singleSelect: true,
    sortOrder: 1,
    seeded: true,
  },
  {
    slug: "tires",
    name: "Tires",
    description: "Sized to the wheel, and to the arch they have to turn inside.",
    singleSelect: true,
    sortOrder: 2,
    seeded: true,
  },
  {
    slug: "suspension",
    name: "Suspension",
    description: "Ride height and damping. Changes what wheel fitment will clear.",
    singleSelect: true,
    sortOrder: 3,
    seeded: true,
  },
  {
    slug: "brakes",
    name: "Brakes",
    description: "Bigger rotors need bigger wheels to cover them.",
    singleSelect: true,
    sortOrder: 4,
    seeded: true,
  },
  {
    slug: "exhaust",
    name: "Exhaust",
    description: "From an axle-back to a full turbo-back system.",
    singleSelect: true,
    sortOrder: 5,
    seeded: true,
  },
  {
    slug: "aero",
    name: "Exterior & aero",
    description: "Spoilers, splitters, diffusers and body kits.",
    singleSelect: false,
    sortOrder: 6,
    seeded: true,
  },
  {
    slug: "paint",
    name: "Paint & wrap",
    description: "Finish colour, applied in the viewer.",
    singleSelect: true,
    sortOrder: 7,
    seeded: true,
  },
  {
    slug: "intake",
    name: "Intake",
    description: "Induction. Usually wants a tune to be worth anything.",
    singleSelect: true,
    sortOrder: 8,
    seeded: true,
  },
  {
    slug: "engine",
    name: "Engine",
    description: "Tunes and supporting hardware.",
    singleSelect: false,
    sortOrder: 9,
    seeded: true,
  },
  {
    slug: "interior",
    name: "Interior",
    description: "Seats, wheels, cages. Modelled, not yet populated.",
    singleSelect: false,
    sortOrder: 10,
    seeded: false,
  },
];

export function partCategory(slug: PartCategorySlug): PartCategory {
  const found = PART_CATEGORIES.find((c) => c.slug === slug);
  if (!found) throw new Error(`Unknown part category: ${slug}`);
  return found;
}

// ---------------------------------------------------------------------------
// Category-specific specifications
// ---------------------------------------------------------------------------

/** One corner's worth of wheel dimensions. */
export interface WheelDimensions {
  readonly diameterIn: number;
  readonly widthIn: number;
  readonly offsetMm: number;
}

export interface WheelPartSpec {
  readonly kind: "wheels";
  readonly boltCount: number;
  readonly boltCircleMm: number;
  readonly centerBoreMm: number;
  /**
   * A wheel is sold as a set. Staggered sets have different rear dimensions;
   * for a square set `rear` repeats `front` rather than being omitted, so
   * every rule can read both axles without a special case.
   */
  readonly front: WheelDimensions;
  readonly rear: WheelDimensions;
  readonly construction: "cast" | "flow_formed" | "forged";
  readonly weightPerWheelKg?: number;
}

export interface TireDimensions {
  readonly widthMm: number;
  readonly aspect: number;
  readonly diameterIn: number;
}

export interface TirePartSpec {
  readonly kind: "tires";
  readonly front: TireDimensions;
  readonly rear: TireDimensions;
  readonly compound: "summer" | "all_season" | "winter" | "track" | "semi_slick";
  readonly treadwear?: number;
}

export interface SuspensionPartSpec {
  readonly kind: "suspension";
  readonly type: "coilovers" | "lowering_springs" | "air_suspension" | "dampers";
  /** Drop range in mm, [min, max]. A fixed-drop spring has min === max. */
  readonly dropFrontMm: readonly [number, number];
  readonly dropRearMm: readonly [number, number];
  readonly heightAdjustable: boolean;
  readonly damperAdjustable: boolean;
  /**
   * Traits on the car that this part cannot work with unmodified — fitting
   * passive coilovers to a car with electronic dampers throws a fault unless
   * cancellers are fitted.
   */
  readonly conflictsWithTraits?: readonly VehicleTrait[];
}

export interface BrakePartSpec {
  readonly kind: "brakes";
  readonly type: "big_brake_kit" | "pads" | "rotors" | "lines" | "fluid";
  readonly axle: Axle | "both";
  readonly rotorDiameterMm?: number;
  readonly caliperPistons?: number;
  /**
   * The smallest wheel this will fit behind. The single most common reason a
   * big brake kit does not work on a car it was otherwise sold for.
   */
  readonly minWheelDiameterIn?: number;
}

export interface ExhaustPartSpec {
  readonly kind: "exhaust";
  readonly type: "axle_back" | "cat_back" | "downpipe" | "headers" | "turbo_back";
  readonly pipeDiameterMm?: number;
  readonly material: "stainless_304" | "stainless_409" | "titanium" | "inconel";
  /**
   * Removes or replaces emissions equipment. Off-road / competition use only
   * in most of the world, and the engine flags it rather than hiding it.
   */
  readonly emissionsAffecting: boolean;
  /** Category slugs of parts this needs alongside it to run correctly. */
  readonly requiresCategories?: readonly PartCategorySlug[];
}

export interface IntakePartSpec {
  readonly kind: "intake";
  readonly type: "drop_in_filter" | "cold_air" | "full_induction";
  readonly emissionsAffecting: boolean;
  readonly requiresCategories?: readonly PartCategorySlug[];
}

export interface EnginePartSpec {
  readonly kind: "engine";
  readonly type: "ecu_tune" | "intercooler" | "charge_pipes" | "turbo" | "fuelling";
  readonly requiresCategories?: readonly PartCategorySlug[];
  /** Only works on these engine codes. Empty means unrestricted. */
  readonly engineCodes?: readonly string[];
  readonly requiresHighOctane?: boolean;
}

export interface AeroPartSpec {
  readonly kind: "aero";
  readonly type: "spoiler" | "wing" | "splitter" | "diffuser" | "side_skirts" | "body_kit";
  readonly material: "abs" | "fibreglass" | "carbon_fibre" | "polyurethane";
}

export interface PaintPartSpec {
  readonly kind: "paint";
  readonly type: "respray" | "vinyl_wrap" | "ppf";
  readonly colorHex: string;
  readonly finish: "gloss" | "satin" | "matte" | "metallic";
}

export interface InteriorPartSpec {
  readonly kind: "interior";
  readonly type: "seats" | "steering_wheel" | "harness" | "roll_cage" | "shift_knob";
}

export type PartSpec =
  | WheelPartSpec
  | TirePartSpec
  | SuspensionPartSpec
  | BrakePartSpec
  | ExhaustPartSpec
  | IntakePartSpec
  | EnginePartSpec
  | AeroPartSpec
  | PaintPartSpec
  | InteriorPartSpec;

// ---------------------------------------------------------------------------
// Visual effect in the 3D viewer
// ---------------------------------------------------------------------------

export interface PartVisual {
  /** Wheel face style the viewer draws. */
  readonly wheelStyle?: "mesh" | "split_spoke" | "five_spoke" | "twin_five_spoke";
  readonly wheelFinishHex?: string;
  /** Ride-height change applied to the body, in mm. Negative lowers it. */
  readonly rideHeightDeltaMm?: number;
  /** Body attachments the viewer shows. */
  readonly attachment?: "spoiler" | "wing" | "splitter" | "diffuser" | "side_skirts";
  readonly attachmentHex?: string;
  readonly paintHex?: string;
  readonly paintFinish?: "gloss" | "satin" | "matte" | "metallic";
  /** Draws visible exhaust tips at the rear. */
  readonly exhaustTips?: number;
  /** Finish of those tips. Titanium gets the heat-blued tint it is known for. */
  readonly tipFinish?: "polished" | "titanium" | "black";
  /**
   * Caliper colour for a brake kit. A cosmetic choice — most kits are sold
   * in several — so this is how the viewer draws it, not a claim about the
   * part number.
   */
  readonly caliperHex?: string;
}

// ---------------------------------------------------------------------------
// Parts and fitment
// ---------------------------------------------------------------------------

export interface Money {
  /** Minor units. Integer cents, never a float. */
  readonly cents: number;
  readonly currency: "USD";
}

export interface Part {
  readonly id: string;
  readonly slug: string;
  readonly category: PartCategorySlug;
  readonly brand: string;
  readonly name: string;
  readonly partNumber?: string;
  readonly description: string;

  readonly price?: Money;
  readonly installCost?: Money;
  /**
   * Prices go stale faster than anything else in this database, so they carry
   * a verification level separate from the part's specification. Every price
   * in the seed data is "demo" and the UI says so.
   */
  readonly priceProvenance: Provenance;

  readonly spec: PartSpec;
  readonly visual?: PartVisual;

  /** Maker's claim about the effect on the car's numbers, not a measurement. */
  readonly powerDeltaHp?: number;
  readonly torqueDeltaNm?: number;
  readonly weightDeltaKg?: number;

  readonly provenance: Provenance;
}

/**
 * An explicit claim that a part does or does not fit a vehicle.
 *
 * The absence of a record is not evidence of anything, and the compatibility
 * engine treats it as such.
 */
export interface FitmentRecord {
  readonly vehicleId: string;
  readonly partId: string;
  readonly status: "compatible" | "incompatible" | "requires_modification";
  readonly note?: string;
  readonly provenance: Provenance;
}

export function partFullName(part: Part): string {
  return `${part.brand} ${part.name}`;
}
