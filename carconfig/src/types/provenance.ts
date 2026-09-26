/**
 * Where a piece of information came from and how much it can be trusted.
 *
 * This is a type rather than a naming convention on purpose. Automotive
 * fitment data is wrong often enough that "how do we know this" has to travel
 * with the value itself; if it lives in a comment it is lost the first time
 * somebody copies the object.
 */

export const VERIFICATION_LEVELS = [
  "verified",
  "unverified",
  "estimated",
  "demo",
] as const;

export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export interface Provenance {
  /** Human-readable origin: "BMW AG press specification", "Manufacturer catalogue". */
  readonly source?: string;
  readonly sourceUrl?: string;
  readonly verification: VerificationLevel;
  /** ISO date (YYYY-MM-DD) the claim was last checked. */
  readonly verifiedOn?: string;
  /** Anything a reader needs in order to not over-trust the value. */
  readonly note?: string;
}

/** A value carrying its own provenance. */
export interface Sourced<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

const TRUST_ORDER: Record<VerificationLevel, number> = {
  verified: 3,
  unverified: 2,
  estimated: 1,
  demo: 0,
};

/**
 * The trust level of a set of claims is the trust level of its weakest member.
 * A build total computed from one verified price and one demo price is demo
 * data, and saying otherwise is how a number nobody checked ends up being
 * quoted as fact.
 */
export function weakestVerification(
  levels: readonly VerificationLevel[],
): VerificationLevel {
  let weakest: VerificationLevel = "verified";
  for (const level of levels) {
    if (TRUST_ORDER[level] < TRUST_ORDER[weakest]) weakest = level;
  }
  return weakest;
}

export function isTrustworthy(level: VerificationLevel): boolean {
  return level === "verified";
}

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  verified: "Verified",
  unverified: "Unverified",
  estimated: "Estimated",
  demo: "Demo data",
};

export const VERIFICATION_DESCRIPTIONS: Record<VerificationLevel, string> = {
  verified: "Checked against a primary source.",
  unverified: "Sourced and plausible, but not confirmed against a primary source.",
  estimated: "Produced by a calculation or model, not observed.",
  demo: "Placeholder for development. Not a real-world figure.",
};
