import type { FitmentRecord, Part, PartCategorySlug } from "@/types/part";
import type { Finding } from "@/types/compatibility";
import type { Vehicle } from "@/types/vehicle";

/**
 * Everything a rule is allowed to look at.
 *
 * Rules are pure functions of this context. No I/O, no clock, no randomness —
 * the same context must always produce the same findings, because a rule that
 * cannot be reproduced cannot be tested and a compatibility verdict that
 * cannot be tested is an opinion.
 */
export interface RuleContext {
  readonly vehicle: Vehicle;
  /** The part being evaluated. */
  readonly part: Part;
  /**
   * Other parts already in the build. Rules use this for the questions that
   * only make sense in combination: a wheel that clears the stock brakes but
   * not the big brake kit two rows above it in the same build.
   */
  readonly selected: readonly Part[];
  /** An explicit fitment claim for this vehicle and part, if one exists. */
  readonly fitment?: FitmentRecord;
}

export interface CompatibilityRule {
  readonly key: string;
  /** What this rule checks, in one line. Shown in the rules reference. */
  readonly description: string;
  /** Categories this rule runs for. "all" runs it for every part. */
  readonly appliesTo: readonly PartCategorySlug[] | "all";
  evaluate(context: RuleContext): readonly Finding[];
}

export function ruleApplies(
  rule: CompatibilityRule,
  category: PartCategorySlug,
): boolean {
  return rule.appliesTo === "all" || rule.appliesTo.includes(category);
}

/** Convenience for rules that need the selected part in a given category. */
export function selectedInCategory(
  context: RuleContext,
  category: PartCategorySlug,
): Part | undefined {
  return context.selected.find((p) => p.category === category);
}
