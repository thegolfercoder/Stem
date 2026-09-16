import type { Part } from "@/types/part";
import type { VerificationLevel } from "@/types/provenance";
import { weakestVerification } from "@/types/provenance";

/**
 * Build costing.
 *
 * Everything is integer cents. Money in floating point accumulates error and
 * this is the number the user is going to compare against their savings, so
 * it gets to be exact.
 *
 * Part cost and installation cost are kept apart all the way through, because
 * they are different decisions: installation is the part of a build people
 * routinely forget, and rolling it into one number hides it.
 */

export interface LineItem {
  readonly part: Part;
  readonly quantity: number;
  readonly partCents: number;
  readonly installCents: number;
  readonly totalCents: number;
  /** True when this line has no price on record at all. */
  readonly priceMissing: boolean;
}

export interface BuildCost {
  readonly lines: readonly LineItem[];
  readonly partsCents: number;
  readonly installCents: number;
  readonly totalCents: number;
  /** Lines with no price. Their absence from the total is a known hole in it. */
  readonly missingPriceCount: number;
  /**
   * The weakest price verification in the build. With the seeded catalogue
   * this is always "demo", and the UI is required to say so next to the total.
   */
  readonly confidence: VerificationLevel;
}

export function priceLine(part: Part, quantity: number): LineItem {
  const partCents = (part.price?.cents ?? 0) * quantity;
  const installCents = (part.installCost?.cents ?? 0) * quantity;

  return {
    part,
    quantity,
    partCents,
    installCents,
    totalCents: partCents + installCents,
    priceMissing: part.price === undefined,
  };
}

export function calculateBuildCost(
  entries: readonly { part: Part; quantity: number }[],
): BuildCost {
  const lines = entries.map(({ part, quantity }) => priceLine(part, quantity));

  const partsCents = lines.reduce((sum, l) => sum + l.partCents, 0);
  const installCents = lines.reduce((sum, l) => sum + l.installCents, 0);

  const levels = lines.map((l) => l.part.priceProvenance.verification);

  return {
    lines,
    partsCents,
    installCents,
    totalCents: partsCents + installCents,
    missingPriceCount: lines.filter((l) => l.priceMissing).length,
    // An empty build has nothing unverified in it, but calling that "verified"
    // would be a strange thing to show, so an empty build is demo like the
    // catalogue it draws from.
    confidence: levels.length > 0 ? weakestVerification(levels) : "demo",
  };
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Whole dollars. Cents on a $5,400 brake kit are noise. */
export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}

export function formatCentsExact(cents: number): string {
  return USD_EXACT.format(cents / 100);
}
