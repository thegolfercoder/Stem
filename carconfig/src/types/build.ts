import type { Appearance } from "@/lib/build/appearance";

/**
 * A build: a vehicle plus the parts chosen for it.
 *
 * Deliberately small and free of derived values. Cost, compatibility and
 * performance are all computed from this, never stored on it — a build that
 * carries its own totals will eventually disagree with them. The only thing
 * saved alongside a part is the price at the time of saving, and that is a
 * record of history rather than a cache.
 */

export interface BuildPart {
  readonly partId: string;
  readonly quantity: number;
  /**
   * What the part cost when it was added. Set when a build is saved so that
   * re-opening it a year later does not silently show a different total.
   */
  readonly priceCentsAtSave?: number;
  readonly installCostCentsAtSave?: number;
}

export interface Build {
  readonly id: string;
  /** Short URL-safe code. Non-sequential so builds cannot be enumerated. */
  readonly shareCode: string;
  readonly name: string;
  readonly vehicleId: string;
  readonly parts: readonly BuildPart[];
  /** Overrides the vehicle's default paint. Set by a paint part or directly. */
  readonly paintHex?: string;
  /** Visual choices made directly: paint, wheels, stance, stripes, body pieces. */
  readonly appearance?: Appearance;
  /** ISO timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Null until accounts exist. The column is already in the schema. */
  readonly ownerId?: string | null;
}

/**
 * The wire format for a build in a share URL.
 *
 * Deliberately terse — this gets base64url-encoded into a link, so the field
 * names are one character each. Versioned so that a link made today still
 * opens after the format changes.
 */
export interface EncodedBuild {
  /** Format version. */
  readonly v: 1;
  /** Vehicle slug. */
  readonly c: string;
  /** Build name. */
  readonly n: string;
  /** Part slugs, with quantity only when it is not 1. */
  readonly p: readonly (string | readonly [string, number])[];
  /** Paint hex without the leading #. */
  readonly h?: string;
  /** Appearance choices; absent when there are none. */
  readonly a?: Appearance;
}
