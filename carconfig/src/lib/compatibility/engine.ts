import type { CompatibilityResult, Finding } from "@/types/compatibility";
import { worstStatus } from "@/types/compatibility";
import type { VerificationLevel } from "@/types/provenance";
import { weakestVerification } from "@/types/provenance";
import { APPLICATION_RULES } from "./rules/application-record";
import { BRAKE_CLEARANCE_RULES } from "./rules/brake-clearance";
import { BUILD_RULES } from "./rules/build-rules";
import { TIRE_RULES } from "./rules/tire-fitment";
import { WHEEL_GEOMETRY_RULES } from "./rules/wheel-geometry";
import type { CompatibilityRule, RuleContext } from "./types";
import { ruleApplies } from "./types";

/**
 * The compatibility engine.
 *
 * Everything it does is: pick the rules that apply to this part's category,
 * run them, and combine what comes back. It holds no knowledge about any
 * specific part or car — all of that is in the rules, and the rules are pure
 * functions, which is what makes the whole thing testable.
 */

export const DEFAULT_RULES: readonly CompatibilityRule[] = [
  ...APPLICATION_RULES,
  ...WHEEL_GEOMETRY_RULES,
  ...BRAKE_CLEARANCE_RULES,
  ...TIRE_RULES,
  ...BUILD_RULES,
];

/**
 * When an explicit fitment record says a part fits, the geometric rules can
 * still veto it.
 *
 * A record saying "fits" is somebody's claim; a bolt pattern mismatch is
 * arithmetic. Arithmetic wins. These are the rule keys allowed to overrule a
 * positive fitment record.
 */
const HARD_PHYSICAL_RULES: ReadonlySet<string> = new Set([
  "wheel.bolt_pattern",
  "wheel.center_bore",
  "wheel.diameter",
  "wheel.brake_clearance",
  "tire.rim_diameter",
  "engine.application",
]);

export interface EvaluateOptions {
  /** Override the rule set. Used by tests to isolate a single rule. */
  readonly rules?: readonly CompatibilityRule[];
}

export function evaluateCompatibility(
  context: RuleContext,
  options: EvaluateOptions = {},
): CompatibilityResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!ruleApplies(rule, context.part.category)) continue;
    findings.push(...rule.evaluate(context));
  }

  return summarize(findings);
}

/**
 * Combine findings into a verdict.
 *
 * Advisories are excluded from the status: whether a part is road legal is not
 * whether it fits. They are still returned, and the UI shows them.
 */
export function summarize(findings: readonly Finding[]): CompatibilityResult {
  const fitmentFindings = findings.filter((f) => !f.advisory);

  if (fitmentFindings.length === 0) {
    // No rule had anything to say. That is not a pass — it means nothing was
    // checked, and the honest answer for an unchecked part is "unknown".
    return {
      status: "unknown",
      findings,
      confidence: "unverified",
    };
  }

  const explicit = fitmentFindings.find(
    (f) => f.ruleKey === "fitment.explicit_record",
  );

  let relevant = fitmentFindings;

  if (explicit && explicit.status === "compatible") {
    // A positive record settles the soft questions, but not the hard physical
    // ones — keep those, drop the rest.
    relevant = fitmentFindings.filter(
      (f) => f === explicit || HARD_PHYSICAL_RULES.has(f.ruleKey),
    );
  }

  const status = worstStatus(relevant.map((f) => f.status));

  const levels: VerificationLevel[] = relevant
    .map((f) => f.provenance?.verification)
    .filter((v): v is VerificationLevel => v !== undefined);

  return {
    status,
    findings,
    confidence: levels.length > 0 ? weakestVerification(levels) : "unverified",
  };
}

/**
 * The findings worth putting in front of the user first: anything that is not
 * a clean pass, then advisories, then the passes.
 */
export function rankFindings(findings: readonly Finding[]): readonly Finding[] {
  const weight = (f: Finding): number => {
    if (f.advisory) return 1;
    switch (f.status) {
      case "incompatible":
        return 0;
      case "unknown":
        return 0;
      case "requires_modification":
        return 0;
      case "compatible":
        return 2;
    }
  };
  return [...findings].sort((a, b) => weight(a) - weight(b));
}

export type { CompatibilityRule, RuleContext } from "./types";
