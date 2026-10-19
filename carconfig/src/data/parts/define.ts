import type { Money, Part, PartSpec, PartVisual } from "@/types/part";
import type { Provenance } from "@/types/provenance";

/**
 * Provenance for the seeded parts catalogue.
 *
 * The parts are real products from real manufacturers, described from publicly
 * advertised specifications. The prices are not real. Every price in this
 * directory is invented for development, carries `demo`, and is rendered by
 * the UI with a label saying so — a configurator that quotes a made-up total
 * with a straight face is worse than one that quotes nothing.
 */

export const PART_SPEC_SOURCE: Provenance = {
  source: "Manufacturer product listings",
  verification: "unverified",
  note:
    "Specifications as generally advertised by the manufacturer. Not confirmed " +
    "against a primary source, and part numbers vary by application.",
};

export const DEMO_PRICE: Provenance = {
  source: "Development placeholder",
  verification: "demo",
  note:
    "Invented for development. Not a quote, not a market price, and not " +
    "connected to any retailer. Real pricing needs a retailer integration.",
};

/** Maker's advertised power claim — a claim, not a measurement. */
export const MANUFACTURER_CLAIM: Provenance = {
  source: "Manufacturer marketing claim",
  verification: "unverified",
  note:
    "Power and weight changes are as claimed by the part maker. Claims are " +
    "made on the maker's own car, on their own dyno, and are not measurements " +
    "of your car.",
};

export interface PartInput {
  readonly slug: string;
  readonly brand: string;
  readonly name: string;
  readonly partNumber?: string;
  readonly description: string;
  /** Whole dollars. Converted to cents here so no float ever reaches a total. */
  readonly priceUsd?: number;
  readonly installUsd?: number;
  readonly spec: PartSpec;
  readonly visual?: PartVisual;
  readonly powerDeltaHp?: number;
  readonly torqueDeltaNm?: number;
  readonly weightDeltaKg?: number;
  readonly provenance?: Provenance;
}

function money(usd: number | undefined): Money | undefined {
  if (usd === undefined) return undefined;
  return { cents: Math.round(usd * 100), currency: "USD" };
}

export function definePart(input: PartInput): Part {
  return {
    id: `part_${input.slug}`,
    slug: input.slug,
    category: input.spec.kind,
    brand: input.brand,
    name: input.name,
    partNumber: input.partNumber,
    description: input.description,
    price: money(input.priceUsd),
    installCost: money(input.installUsd),
    priceProvenance: DEMO_PRICE,
    spec: input.spec,
    visual: input.visual,
    powerDeltaHp: input.powerDeltaHp,
    torqueDeltaNm: input.torqueDeltaNm,
    weightDeltaKg: input.weightDeltaKg,
    provenance: input.provenance ?? PART_SPEC_SOURCE,
  };
}
