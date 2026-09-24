import type { Finding } from "@/types/compatibility";
import type { BrakePartSpec, Part, WheelPartSpec } from "@/types/part";
import type { Provenance } from "@/types/provenance";
import type { Axle } from "@/types/vehicle";
import type { CompatibilityRule, RuleContext } from "../types";

/**
 * Wheels against brakes, in both directions.
 *
 * This is the interaction that makes a compatibility engine worth building
 * rather than a lookup table: whether a wheel fits depends on what else is in
 * the build. The same 18 inch wheel is fine on a stock car and useless once
 * there is a 380mm kit behind it, and nobody finds this out until the wheels
 * have arrived.
 */

/**
 * Clearance needed between rotor diameter and wheel diameter, in inches.
 *
 * A heuristic, and labelled as one everywhere it surfaces. It is calibrated
 * against the kits in the seed catalogue — a 355mm rotor wanting an 18 inch
 * wheel and a 380mm rotor wanting a 19 — and it is not a substitute for the
 * caliper clearance template that every brake manufacturer ships.
 */
const ROTOR_TO_WHEEL_CLEARANCE_IN = 3.5;
const MM_PER_INCH = 25.4;

const CLEARANCE_ESTIMATE: Provenance = {
  source: "Derived from rotor diameter",
  verification: "estimated",
  note:
    `Minimum wheel diameter estimated as rotor diameter plus ` +
    `${ROTOR_TO_WHEEL_CLEARANCE_IN} inches for caliper clearance. A rule of ` +
    `thumb, not a measurement. Use the brake maker's clearance template before ` +
    `ordering wheels.`,
};

/** The smallest wheel a rotor of this size is estimated to fit inside. */
export function estimateMinWheelDiameterIn(rotorDiameterMm: number): number {
  const rotorIn = rotorDiameterMm / MM_PER_INCH;
  // Wheels are sold in whole inches, so round up to one.
  return Math.ceil(rotorIn + ROTOR_TO_WHEEL_CLEARANCE_IN);
}

function brakeSpec(part: Part): BrakePartSpec | null {
  const spec = part.spec as BrakePartSpec;
  return spec?.kind === "brakes" ? spec : null;
}

function selectedBigBrakeKit(context: RuleContext): Part | undefined {
  return context.selected.find((p) => {
    const spec = brakeSpec(p);
    return spec?.type === "big_brake_kit";
  });
}

/**
 * Evaluating a wheel: does it clear what is behind it — the big brake kit in
 * the build if there is one, otherwise the car's own brakes?
 */
export const wheelClearsBrakesRule: CompatibilityRule = {
  key: "wheel.brake_clearance",
  description:
    "The wheel must be large enough to clear the brakes in the build, or the car's own brakes.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = context.part.spec as WheelPartSpec;
    const profile = context.vehicle.profile;
    if (spec?.kind !== "wheels" || !profile) return [];

    const kit = selectedBigBrakeKit(context);
    const kitSpec = kit ? brakeSpec(kit) : null;

    const findings: Finding[] = [];
    const axles: readonly Axle[] = ["front", "rear"];

    for (const axle of axles) {
      const wheelDiameter = axle === "front" ? spec.front.diameterIn : spec.rear.diameterIn;

      // A kit in the build takes precedence: it is what will actually be
      // behind this wheel, and the maker publishes a minimum for it.
      if (kit && kitSpec && kitSpec.minWheelDiameterIn !== undefined) {
        const kitAxle = kitSpec.axle;
        if (kitAxle !== "both" && kitAxle !== axle) continue;

        const required = kitSpec.minWheelDiameterIn;
        const evidence = {
          wheelDiameterIn: wheelDiameter,
          requiredDiameterIn: required,
          brakeKit: `${kit.brand} ${kit.name}`,
        };

        if (wheelDiameter >= required) {
          findings.push({
            ruleKey: this.key,
            status: "compatible",
            title: `Clears the selected brake kit (${axle})`,
            detail:
              `The ${kit.brand} ${kit.name} needs at least a ${required} inch wheel ` +
              `and this one is ${wheelDiameter}.`,
            axle,
            evidence,
            provenance: kit.provenance,
          });
        } else {
          findings.push({
            ruleKey: this.key,
            status: "incompatible",
            title: `Will not clear the selected brake kit (${axle})`,
            detail:
              `This build has the ${kit.brand} ${kit.name}, which needs at least a ` +
              `${required} inch wheel. This wheel is ${wheelDiameter} inches. The ` +
              `caliper will foul the spokes — remove the kit or choose a larger wheel.`,
            axle,
            evidence,
            provenance: kit.provenance,
          });
        }
        continue;
      }

      // No kit selected: check against the car's own rotors.
      const rotorMm = profile.brakes[axle].rotorDiameterMm;
      const required = estimateMinWheelDiameterIn(rotorMm);
      const evidence = {
        wheelDiameterIn: wheelDiameter,
        rotorDiameterMm: rotorMm,
        estimatedMinimumIn: required,
      };

      if (wheelDiameter >= required) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Clears the stock brakes (${axle})`,
          detail:
            `The ${axle} rotor is ${rotorMm}mm, needing an estimated ${required} inch ` +
            `wheel or larger. This wheel is ${wheelDiameter} inches.`,
          axle,
          evidence,
          provenance: CLEARANCE_ESTIMATE,
        });
      } else {
        findings.push({
          ruleKey: this.key,
          status: "incompatible",
          title: `Too small for the ${axle} brakes`,
          detail:
            `The ${axle} rotor is ${rotorMm}mm across, which needs an estimated ` +
            `${required} inch wheel to clear the caliper. This wheel is ` +
            `${wheelDiameter} inches and will not go over the brakes.`,
          axle,
          evidence,
          provenance: CLEARANCE_ESTIMATE,
        });
      }
    }

    return findings;
  },
};

/**
 * Evaluating a brake kit: is there a wheel in the build big enough for it —
 * and if not, is the car's stock wheel big enough?
 */
export const brakeKitNeedsWheelRule: CompatibilityRule = {
  key: "brakes.wheel_requirement",
  description:
    "A big brake kit needs a wheel at least as large as the kit's stated minimum.",
  appliesTo: ["brakes"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = brakeSpec(context.part);
    const profile = context.vehicle.profile;
    if (!spec || spec.type !== "big_brake_kit" || !profile) return [];
    if (spec.minWheelDiameterIn === undefined) return [];

    const required = spec.minWheelDiameterIn;
    const axle: Axle = spec.axle === "rear" ? "rear" : "front";

    const selectedWheel = context.selected.find((p) => p.category === "wheels");
    const wheelSpec = selectedWheel?.spec as WheelPartSpec | undefined;

    const current =
      wheelSpec?.kind === "wheels"
        ? (axle === "front" ? wheelSpec.front.diameterIn : wheelSpec.rear.diameterIn)
        : profile.wheels[axle].diameterIn;

    const source =
      wheelSpec?.kind === "wheels"
        ? `the ${selectedWheel?.brand} ${selectedWheel?.name} in this build`
        : "the car's stock wheel";

    const evidence = {
      requiredDiameterIn: required,
      currentDiameterIn: current,
      wheelSource: source,
    };

    if (current >= required) {
      return [
        {
          ruleKey: this.key,
          status: "compatible",
          title: "Wheel is large enough",
          detail:
            `This kit needs at least a ${required} inch wheel, and ${source} is ` +
            `${current} inches.`,
          axle,
          evidence,
          provenance: context.part.provenance,
        },
      ];
    }

    return [
      {
        ruleKey: this.key,
        status: "requires_modification",
        title: "Needs a larger wheel",
        detail:
          `This kit needs at least a ${required} inch wheel. ${source} is ` +
          `${current} inches, so the kit cannot be fitted until the wheels are ` +
          `changed. Add a ${required} inch or larger wheel to this build.`,
        axle,
        evidence,
        provenance: context.part.provenance,
      },
    ];
  },
};

export const BRAKE_CLEARANCE_RULES: readonly CompatibilityRule[] = [
  wheelClearsBrakesRule,
  brakeKitNeedsWheelRule,
];
