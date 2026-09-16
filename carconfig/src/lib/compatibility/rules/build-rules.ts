import type { Finding } from "@/types/compatibility";
import type {
  EnginePartSpec,
  ExhaustPartSpec,
  IntakePartSpec,
  PartCategorySlug,
  SuspensionPartSpec,
} from "@/types/part";
import { partCategory } from "@/types/part";
import type { CompatibilityRule, RuleContext } from "../types";

/**
 * Rules about the rest of the build and about the car's platform, rather than
 * about a single measurement.
 */

function specWithRequirements(
  spec: unknown,
): { requiresCategories?: readonly PartCategorySlug[] } | null {
  const candidate = spec as ExhaustPartSpec | IntakePartSpec | EnginePartSpec;
  if (!candidate || typeof candidate !== "object") return null;
  return "requiresCategories" in candidate ? candidate : null;
}

/**
 * Parts that need another part to be worth fitting.
 *
 * Catless downpipes without a matching calibration are not an upgrade; they
 * are a check engine light and, on some cars, a limp mode. The part fits
 * perfectly, which is why this returns "requires modification" rather than
 * "incompatible" — and why it says what the missing piece is.
 */
export const partDependencyRule: CompatibilityRule = {
  key: "build.requires_supporting_part",
  description:
    "Flags parts that need a supporting part from another category to work properly.",
  appliesTo: ["exhaust", "intake", "engine"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = specWithRequirements(context.part.spec);
    const required = spec?.requiresCategories;
    if (!required || required.length === 0) return [];

    const findings: Finding[] = [];

    for (const category of required) {
      const present = context.selected.some((p) => p.category === category);
      const label = partCategory(category).name.toLowerCase();

      if (present) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Supporting ${label} present`,
          detail: `This part needs a ${label} part alongside it, and this build has one.`,
          evidence: { requiredCategory: category, satisfied: "yes" },
        });
      } else {
        findings.push({
          ruleKey: this.key,
          status: "requires_modification",
          title: `Needs a supporting ${label} part`,
          detail:
            `${context.part.brand} ${context.part.name} is specified to be fitted ` +
            `alongside a ${label} part, and this build does not have one. It will ` +
            `physically fit; it will not do what it claims, and on a turbocharged ` +
            `car it may run badly. Add a ${label} part to resolve this.`,
          evidence: { requiredCategory: category, satisfied: "no" },
          provenance: context.part.provenance,
        });
      }
    }

    return findings;
  },
};

/**
 * Engine-specific parts: a tune written for one engine is not a tune for
 * another, and this is not something to be approximate about.
 */
export const engineApplicationRule: CompatibilityRule = {
  key: "engine.application",
  description: "An engine part only applies to the engine codes it was written for.",
  appliesTo: ["engine"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as EnginePartSpec;
    if (spec?.kind !== "engine") return [];
    if (!spec.engineCodes || spec.engineCodes.length === 0) return [];

    const carEngine = context.vehicle.engine.code;
    const supported = spec.engineCodes.includes(carEngine);
    const evidence = {
      vehicleEngine: carEngine,
      supportedEngines: spec.engineCodes.join(", "),
    };

    if (supported) {
      return [
        {
          ruleKey: this.key,
          status: "compatible",
          title: "Written for this engine",
          detail: `This car runs the ${carEngine}, which is on the supported list.`,
          evidence,
          provenance: context.part.provenance,
        },
      ];
    }

    return [
      {
        ruleKey: this.key,
        status: "incompatible",
        title: "Not written for this engine",
        detail:
          `This car runs the ${carEngine}. This part is for the ` +
          `${spec.engineCodes.join(", ")}. A calibration for a different engine ` +
          `is not a calibration for this one.`,
        evidence,
        provenance: context.part.provenance,
      },
    ];
  },
};

export const highOctaneAdvisoryRule: CompatibilityRule = {
  key: "engine.fuel_requirement",
  description: "Warns where a tune requires high-octane fuel.",
  appliesTo: ["engine"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as EnginePartSpec;
    if (spec?.kind !== "engine" || !spec.requiresHighOctane) return [];

    return [
      {
        ruleKey: this.key,
        status: "compatible",
        advisory: true,
        title: "Requires high-octane fuel",
        detail:
          "This calibration assumes high-octane fuel on every fill. Running it " +
          "on lower octane means either pulled timing and none of the claimed " +
          "power, or detonation. Budget for the fuel as well as the tune.",
        evidence: { requiresHighOctane: "yes" },
      },
    ];
  },
};

/**
 * Suspension against the car's own electronics.
 *
 * Passive coilovers on a car with electronically controlled dampers is the
 * most common version of "it bolts on and the dashboard lights up".
 */
export const suspensionTraitRule: CompatibilityRule = {
  key: "suspension.platform_conflict",
  description:
    "Flags suspension that conflicts with a platform feature such as electronic dampers.",
  appliesTo: ["suspension"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as SuspensionPartSpec;
    if (spec?.kind !== "suspension") return [];
    if (!spec.conflictsWithTraits || spec.conflictsWithTraits.length === 0) return [];

    const conflicts = spec.conflictsWithTraits.filter((t) =>
      context.vehicle.traits.includes(t),
    );
    if (conflicts.length === 0) return [];

    if (conflicts.includes("electronic_dampers")) {
      return [
        {
          ruleKey: this.key,
          status: "requires_modification",
          title: "Car has electronic dampers",
          detail:
            "This car controls its dampers electronically, and this part replaces " +
            "the dampers with passive units. The car will detect the missing " +
            "dampers and log a fault. Fitting damper cancellers, or choosing a " +
            "part that keeps the original dampers, resolves it.",
          evidence: { conflictingTrait: "electronic_dampers" },
          provenance: context.part.provenance,
        },
      ];
    }

    return [
      {
        ruleKey: this.key,
        status: "requires_modification",
        title: "Conflicts with a platform feature",
        detail:
          `This part conflicts with: ${conflicts.join(", ")}. Check what it needs ` +
          `before fitting.`,
        evidence: { conflictingTraits: conflicts.join(", ") },
        provenance: context.part.provenance,
      },
    ];
  },
};

export const emissionsAdvisoryRule: CompatibilityRule = {
  key: "legal.emissions",
  description: "Warns where a part removes or alters emissions equipment.",
  appliesTo: ["exhaust", "intake", "engine"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as ExhaustPartSpec | IntakePartSpec;
    if (!("emissionsAffecting" in spec) || !spec.emissionsAffecting) return [];

    return [
      {
        ruleKey: this.key,
        status: "compatible",
        advisory: true,
        title: "Affects emissions equipment",
        detail:
          "This part removes or alters emissions equipment. In most of the " +
          "world that makes the car illegal to use on the road and will fail " +
          "an inspection. It is a competition part. This does not affect " +
          "whether it fits — it affects whether you can drive it.",
        evidence: { emissionsAffecting: "yes" },
      },
    ];
  },
};

export const BUILD_RULES: readonly CompatibilityRule[] = [
  partDependencyRule,
  engineApplicationRule,
  highOctaneAdvisoryRule,
  suspensionTraitRule,
  emissionsAdvisoryRule,
];
