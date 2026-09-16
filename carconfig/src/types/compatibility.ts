import type { Provenance, VerificationLevel } from "./provenance";
import type { Axle } from "./vehicle";

export const COMPATIBILITY_STATUSES = [
  "compatible",
  "requires_modification",
  "unknown",
  "incompatible",
] as const;

export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];

/**
 * Severity ordering. The overall status of a part is the worst status any rule
 * returned for it.
 *
 * `unknown` outranks `requires_modification` deliberately. Both mean "not a
 * clean yes", and between them the more conservative headline is the one that
 * admits the gap: a part we know needs a spacer is better understood than a
 * part whose fitment nobody has established. The full finding list is shown
 * either way, so nothing actionable is hidden by this choice.
 */
const SEVERITY: Record<CompatibilityStatus, number> = {
  compatible: 0,
  requires_modification: 1,
  unknown: 2,
  incompatible: 3,
};

export function worstStatus(
  statuses: readonly CompatibilityStatus[],
): CompatibilityStatus {
  let worst: CompatibilityStatus = "compatible";
  for (const status of statuses) {
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}

export function isBlocking(status: CompatibilityStatus): boolean {
  return status === "incompatible";
}

export const STATUS_LABELS: Record<CompatibilityStatus, string> = {
  compatible: "Compatible",
  requires_modification: "Requires modification",
  unknown: "Unknown fitment",
  incompatible: "Not compatible",
};

/**
 * One rule's verdict on one part, with the numbers it used.
 *
 * `detail` must say *why*, in terms the user can check against the two specs
 * in front of them. "Not compatible" on its own is not an acceptable finding.
 */
export interface Finding {
  readonly ruleKey: string;
  readonly status: CompatibilityStatus;
  /** Short enough for a list row: "Bolt pattern does not match". */
  readonly title: string;
  /** The reasoning: "The wheel is 5x120. This car is 5x112." */
  readonly detail: string;
  readonly axle?: Axle;
  /**
   * Something the buyer needs to know that is not a question of whether the
   * part physically fits — road legality, tire temperature range, fuel
   * requirements.
   *
   * Advisories are excluded from the status calculation on purpose. A catless
   * downpipe fits perfectly and is illegal on the road in most of the world;
   * calling that "incompatible" would be wrong, and hiding it would be worse.
   * The UI shows advisories alongside the verdict rather than inside it.
   */
  readonly advisory?: boolean;
  /** The values the rule compared, for display and for debugging. */
  readonly evidence?: Readonly<Record<string, string | number>>;
  /** How trustworthy the data behind this finding was. */
  readonly provenance?: Provenance;
}

export interface CompatibilityResult {
  readonly status: CompatibilityStatus;
  readonly findings: readonly Finding[];
  /**
   * The weakest verification level among the data this verdict relied on. A
   * "compatible" built from demo data is still demo data.
   */
  readonly confidence: VerificationLevel;
}

export const EMPTY_RESULT: CompatibilityResult = {
  status: "unknown",
  findings: [],
  confidence: "demo",
};
