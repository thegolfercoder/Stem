import type { Finding } from "@/types/compatibility";
import type { PartCategorySlug } from "@/types/part";
import { partCategory } from "@/types/part";
import { catalogVehicleName } from "@/types/vehicle";
import type { CompatibilityRule, RuleContext } from "../types";

/**
 * The two rules that decide what happens when nobody has checked.
 *
 * This is the part of the engine that the product actually turns on. It is
 * easy to write a configurator that lets anything be added to anything and
 * shows a green tick; the reason to build a compatibility database at all is
 * to be able to say "we do not know" out loud.
 */

/**
 * An explicit fitment record beats any inference.
 *
 * If somebody has actually checked this combination, that is better evidence
 * than a rule reasoning from dimensions — including when the record says the
 * part does not fit for a reason no dimension would reveal, like the kit not
 * being manufactured for the car at all.
 */
export const explicitFitmentRule: CompatibilityRule = {
  key: "fitment.explicit_record",
  description:
    "Uses a recorded fitment claim for this exact vehicle and part when one exists.",
  appliesTo: "all",
  evaluate(context: RuleContext): readonly Finding[] {
    const record = context.fitment;
    if (!record) return [];

    const titles = {
      compatible: "Listed as fitting this car",
      incompatible: "Listed as not fitting this car",
      requires_modification: "Listed as fitting with modification",
    } as const;

    return [
      {
        ruleKey: this.key,
        status: record.status,
        title: titles[record.status],
        detail:
          record.note ??
          `A fitment record exists for this vehicle and part, recorded as ` +
            `"${record.status}".`,
        evidence: {
          recordedStatus: record.status,
          source: record.provenance.source ?? "unrecorded",
        },
        provenance: record.provenance,
      },
    ];
  },
};

/**
 * Categories where fitment is a property of the specific car, not of any
 * measurement we hold.
 *
 * A wheel can be checked against a hub with arithmetic. A body kit cannot be
 * checked against anything — it either was moulded for this car's bumpers or
 * it was not, and no amount of reasoning about the car's dimensions will tell
 * you which. Same for a damper, an exhaust, or an intake: they are made per
 * application and the only real evidence is an application list.
 */
const APPLICATION_SPECIFIC: readonly PartCategorySlug[] = [
  "suspension",
  "brakes",
  "exhaust",
  "intake",
  "engine",
  "aero",
  "interior",
];

/**
 * Where a part is application-specific and nothing has been recorded for this
 * car, the answer is "unknown" — never "compatible".
 *
 * This is the rule that keeps the whole product honest, and it is the reason
 * a lot of the seed catalogue shows amber rather than green. That is not a
 * gap in the demo; it is an accurate picture of how much of an aftermarket
 * catalogue is actually confirmed for any given car, and filling it in is the
 * work this database exists to do.
 */
export const applicationRecordRule: CompatibilityRule = {
  key: "fitment.no_application_record",
  description:
    "Application-specific parts with no recorded fitment for this car are reported as unknown.",
  appliesTo: APPLICATION_SPECIFIC,
  evaluate(context: RuleContext): readonly Finding[] {
    // An explicit record exists, so explicitFitmentRule has the answer and
    // this rule has nothing to add.
    if (context.fitment) return [];

    const label = partCategory(context.part.category).name.toLowerCase();

    return [
      {
        ruleKey: this.key,
        status: "unknown",
        title: "No fitment record for this car",
        detail:
          `${label.charAt(0).toUpperCase() + label.slice(1)} parts are made for ` +
          `specific vehicles, and there is no record confirming this one fits a ` +
          `${catalogVehicleName(context.vehicle)}. ` +
          `That is not the same as it not fitting — it means nobody has checked. ` +
          `Confirm against the manufacturer's application list before buying.`,
        evidence: {
          category: context.part.category,
          vehicle: context.vehicle.key,
        },
        provenance: {
          verification: "unverified",
          note: "No fitment record held for this combination.",
        },
      },
    ];
  },
};

/** Paint and wrap go on any car, so they need no application record. */
export const universalFitRule: CompatibilityRule = {
  key: "fitment.universal",
  description: "Finishes apply to any vehicle.",
  appliesTo: ["paint"],
  evaluate(context: RuleContext): readonly Finding[] {
    return [
      {
        ruleKey: this.key,
        status: "compatible",
        title: "Applies to any vehicle",
        detail:
          "A finish is quoted by panel area rather than by application, so " +
          "there is no fitment question. The price shown is a demo figure and " +
          "a real quote depends on the car's size and condition.",
        evidence: { vehicle: context.vehicle.key },
      },
    ];
  },
};

export const APPLICATION_RULES: readonly CompatibilityRule[] = [
  explicitFitmentRule,
  applicationRecordRule,
  universalFitRule,
];
