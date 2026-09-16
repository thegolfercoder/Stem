import type { Finding } from "@/types/compatibility";
import type { TireDimensions, TirePartSpec, WheelPartSpec } from "@/types/part";
import type { Provenance } from "@/types/provenance";
import type { Axle } from "@/types/vehicle";
import type { CompatibilityRule, RuleContext } from "../types";

/**
 * Tires against the wheel they are going on.
 *
 * The wheel in question is whatever is in the build, falling back to the car's
 * stock wheel — so choosing a tire before a wheel checks against stock, and
 * changing the wheel afterwards re-evaluates the tire. That is the behaviour
 * that catches the classic mistake of buying 19 inch tires and 18 inch wheels.
 */

const MM_PER_INCH = 25.4;

/**
 * The rim width range a tire section is estimated to be mountable on.
 *
 * Tire makers publish a measuring rim and an approved range per size. This
 * approximates that range from the section width and is labelled estimated
 * wherever it appears.
 */
const RIM_WIDTH_MIN_OFFSET_IN = 1.9;
const RIM_WIDTH_MAX_OFFSET_IN = 0.3;

const RIM_RANGE_ESTIMATE: Provenance = {
  source: "Derived from tire section width",
  verification: "estimated",
  note:
    "Approved rim width range approximated from the tire's section width. " +
    "Tire manufacturers publish an exact range per size — check it before " +
    "mounting.",
};

export function estimateRimWidthRangeIn(
  sectionWidthMm: number,
): readonly [number, number] {
  const sectionIn = sectionWidthMm / MM_PER_INCH;
  const round = (n: number) => Math.round(n * 2) / 2; // wheels come in half inches
  return [
    round(sectionIn - RIM_WIDTH_MIN_OFFSET_IN),
    round(sectionIn - RIM_WIDTH_MAX_OFFSET_IN),
  ];
}

interface TargetWheel {
  readonly diameterIn: number;
  readonly widthIn: number;
  readonly description: string;
}

function targetWheel(context: RuleContext, axle: Axle): TargetWheel {
  const selected = context.selected.find((p) => p.category === "wheels");
  const spec = selected?.spec as WheelPartSpec | undefined;

  if (spec?.kind === "wheels" && selected) {
    const dims = axle === "front" ? spec.front : spec.rear;
    return {
      diameterIn: dims.diameterIn,
      widthIn: dims.widthIn,
      description: `the ${selected.brand} ${selected.name} in this build`,
    };
  }

  const stock = context.vehicle.wheels[axle];
  return {
    diameterIn: stock.diameterIn,
    widthIn: stock.widthIn,
    description: "the car's stock wheel",
  };
}

export const tireDiameterRule: CompatibilityRule = {
  key: "tire.rim_diameter",
  description: "A tire's rim diameter must match the wheel exactly.",
  appliesTo: ["tires"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as TirePartSpec;
    if (spec?.kind !== "tires") return [];

    const findings: Finding[] = [];
    const axles: readonly Axle[] = ["front", "rear"];

    for (const axle of axles) {
      const tire: TireDimensions = axle === "front" ? spec.front : spec.rear;
      const wheel = targetWheel(context, axle);
      const evidence = {
        tireRimDiameterIn: tire.diameterIn,
        wheelDiameterIn: wheel.diameterIn,
      };

      if (tire.diameterIn === wheel.diameterIn) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Rim diameter matches (${axle})`,
          detail: `A ${tire.diameterIn} inch tire on a ${tire.diameterIn} inch wheel.`,
          axle,
          evidence,
        });
      } else {
        findings.push({
          ruleKey: this.key,
          status: "incompatible",
          title: `Rim diameter does not match (${axle})`,
          detail:
            `This is a ${tire.diameterIn} inch tire and ${wheel.description} is ` +
            `${wheel.diameterIn} inches on the ${axle} axle. A tire cannot be ` +
            `mounted on a wheel of a different diameter.`,
          axle,
          evidence,
        });
      }
    }

    return findings;
  },
};

export const tireRimWidthRule: CompatibilityRule = {
  key: "tire.rim_width",
  description:
    "A tire's section width must be within the estimated approved rim width range for the wheel.",
  appliesTo: ["tires"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as TirePartSpec;
    if (spec?.kind !== "tires") return [];

    const findings: Finding[] = [];
    const axles: readonly Axle[] = ["front", "rear"];

    for (const axle of axles) {
      const tire: TireDimensions = axle === "front" ? spec.front : spec.rear;
      const wheel = targetWheel(context, axle);
      const [minRim, maxRim] = estimateRimWidthRangeIn(tire.widthMm);

      const evidence = {
        tireWidthMm: tire.widthMm,
        wheelWidthIn: wheel.widthIn,
        estimatedRimRange: `${minRim}–${maxRim} in`,
      };

      if (wheel.widthIn >= minRim && wheel.widthIn <= maxRim) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Rim width suits the tire (${axle})`,
          detail:
            `A ${tire.widthMm}mm tire is estimated to want a ${minRim}–${maxRim} inch ` +
            `rim, and ${wheel.description} is ${wheel.widthIn} inches.`,
          axle,
          evidence,
          provenance: RIM_RANGE_ESTIMATE,
        });
        continue;
      }

      const tooNarrow = wheel.widthIn < minRim;

      findings.push({
        ruleKey: this.key,
        status: "requires_modification",
        title: `Rim width outside the tire's range (${axle})`,
        detail: tooNarrow
          ? `A ${tire.widthMm}mm tire on a ${wheel.widthIn} inch rim is below the ` +
            `estimated ${minRim} inch minimum. It will mount, but the tread crowns ` +
            `and the sidewall bulges — grip and wear both suffer.`
          : `A ${tire.widthMm}mm tire on a ${wheel.widthIn} inch rim is above the ` +
            `estimated ${maxRim} inch maximum. It will stretch, which exposes the ` +
            `rim lip to kerb damage and is not accepted at some technical inspections.`,
        axle,
        evidence,
        provenance: RIM_RANGE_ESTIMATE,
      });
    }

    return findings;
  },
};

export const tireCompoundAdvisoryRule: CompatibilityRule = {
  key: "tire.compound_advisory",
  description: "Warns where a tire compound has a temperature or usage restriction.",
  appliesTo: ["tires"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as TirePartSpec;
    if (spec?.kind !== "tires") return [];

    if (spec.compound === "semi_slick" || spec.compound === "track") {
      return [
        {
          ruleKey: this.key,
          status: "compatible",
          advisory: true,
          title: "Cold weather warning",
          detail:
            "This is a track-oriented compound. Grip falls away sharply below " +
            "about 7°C and these tires are not safe in standing water or snow. " +
            "It fits — it is just not a year-round tire.",
          evidence: { compound: spec.compound, treadwear: spec.treadwear ?? "unknown" },
        },
      ];
    }

    return [];
  },
};

export const TIRE_RULES: readonly CompatibilityRule[] = [
  tireDiameterRule,
  tireRimWidthRule,
  tireCompoundAdvisoryRule,
];
