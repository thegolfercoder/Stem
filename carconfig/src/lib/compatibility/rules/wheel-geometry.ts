import type { Finding } from "@/types/compatibility";
import type { WheelDimensions, WheelPartSpec } from "@/types/part";
import type { Axle, VehicleProfile, WheelSpec } from "@/types/vehicle";
import { boltPatternLabel, wheelSizeLabel } from "@/types/vehicle";
import type { CompatibilityRule, RuleContext } from "../types";

/**
 * Wheel fitment: the checks that are pure geometry.
 *
 * These are the rules that can reach a confident "compatible" without anybody
 * having tested the combination, because they compare two measurements rather
 * than relying on somebody's say-so. Everything softer than that lives in
 * application-record.ts and returns "unknown".
 */

const AXLES: readonly Axle[] = ["front", "rear"];

function wheelSpec(part: { spec: unknown }): WheelPartSpec | null {
  const spec = part.spec as WheelPartSpec;
  return spec?.kind === "wheels" ? spec : null;
}

function dimsFor(spec: WheelPartSpec, axle: Axle): WheelDimensions {
  return axle === "front" ? spec.front : spec.rear;
}

function vehicleWheel(profile: VehicleProfile, axle: Axle): WheelSpec {
  return profile.wheels[axle];
}

/**
 * The car's measurements, or null when nobody has recorded any for it.
 *
 * Every geometric rule starts here and returns nothing when it comes back
 * null. Saying "the bolt pattern does not match" about a car whose bolt
 * pattern we have never recorded would be a fabrication, so the rules stay
 * quiet and fitment.no_vehicle_profile reports the gap once.
 */
function profileOf(context: RuleContext): VehicleProfile | null {
  return context.vehicle.profile;
}

/**
 * The stamp for a rule that reasoned about the clearance envelope rather than
 * about a published dimension. Falls back to the spec's own provenance where
 * no envelope was recorded.
 */
function envelopeProvenance(spec: WheelSpec) {
  return spec.envelopeProvenance ?? spec.provenance;
}

/** Both axles carry the same bolt pattern on every car this product covers. */
export const boltPatternRule: CompatibilityRule = {
  key: "wheel.bolt_pattern",
  description:
    "The wheel's bolt count and bolt circle diameter must match the car's hub exactly.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = wheelSpec(context.part);
    const profile = profileOf(context);
    if (!spec || !profile) return [];

    const hub = vehicleWheel(profile, "front");
    const wheelPattern = `${spec.boltCount}x${spec.boltCircleMm}`;
    const carPattern = boltPatternLabel(hub);

    const matches =
      spec.boltCount === hub.boltCount &&
      Math.abs(spec.boltCircleMm - hub.boltCircleMm) < 0.05;

    if (matches) {
      return [
        {
          ruleKey: this.key,
          status: "compatible",
          title: "Bolt pattern matches",
          detail: `Both the wheel and the car are ${carPattern}.`,
          evidence: { wheel: wheelPattern, vehicle: carPattern },
          provenance: hub.provenance,
        },
      ];
    }

    return [
      {
        ruleKey: this.key,
        status: "incompatible",
        title: "Bolt pattern does not match",
        detail:
          `The wheel is ${wheelPattern} and this car is ${carPattern}. ` +
          `The wheel will not bolt to the hub. Adaptors exist but change the ` +
          `effective offset and are not treated as a fit here.`,
        evidence: { wheel: wheelPattern, vehicle: carPattern },
        provenance: hub.provenance,
      },
    ];
  },
};

export const centerBoreRule: CompatibilityRule = {
  key: "wheel.center_bore",
  description:
    "The wheel's centre bore must be at least as large as the car's hub; a larger bore needs centring rings.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = wheelSpec(context.part);
    const profile = profileOf(context);
    if (!spec || !profile) return [];

    const hub = vehicleWheel(profile, "front");
    const evidence = {
      wheelBoreMm: spec.centerBoreMm,
      vehicleHubMm: hub.centerBoreMm,
    };

    if (spec.centerBoreMm < hub.centerBoreMm - 0.05) {
      return [
        {
          ruleKey: this.key,
          status: "incompatible",
          title: "Centre bore too small",
          detail:
            `The wheel's centre bore is ${spec.centerBoreMm}mm and the car's hub ` +
            `is ${hub.centerBoreMm}mm. The wheel will not go onto the hub. ` +
            `Machining the bore is possible but is not a fitment.`,
          evidence,
          provenance: hub.provenance,
        },
      ];
    }

    if (spec.centerBoreMm > hub.centerBoreMm + 0.05) {
      return [
        {
          ruleKey: this.key,
          status: "requires_modification",
          title: "Hub-centric rings needed",
          detail:
            `The wheel's bore is ${spec.centerBoreMm}mm against a ${hub.centerBoreMm}mm ` +
            `hub. It will mount, but the wheel is lug-centric until you fit ` +
            `${spec.centerBoreMm}→${hub.centerBoreMm}mm centring rings. Expect vibration without them.`,
          evidence,
          provenance: hub.provenance,
        },
      ];
    }

    return [
      {
        ruleKey: this.key,
        status: "compatible",
        title: "Centre bore matches",
        detail: `The wheel is bored to ${spec.centerBoreMm}mm, the same as the car's hub.`,
        evidence,
        provenance: hub.provenance,
      },
    ];
  },
};

/**
 * How far outside the estimated envelope an offset can sit before it stops
 * being a spacer-and-fender-roll job and starts being a no.
 */
const OFFSET_MODIFICATION_TOLERANCE_MM = 8;

export const offsetRule: CompatibilityRule = {
  key: "wheel.offset",
  description:
    "The wheel's offset must sit inside the car's estimated clearance envelope, per axle.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = wheelSpec(context.part);
    const profile = profileOf(context);
    if (!spec || !profile) return [];

    const findings: Finding[] = [];

    for (const axle of AXLES) {
      const dims = dimsFor(spec, axle);
      const car = vehicleWheel(profile, axle);
      const { minOffsetMm, maxOffsetMm } = car;

      if (minOffsetMm === undefined || maxOffsetMm === undefined) {
        findings.push({
          ruleKey: this.key,
          status: "unknown",
          title: "No offset range on record",
          detail:
            `There is no clearance envelope recorded for the ${axle} of this car, ` +
            `so whether ET${dims.offsetMm} clears cannot be determined. The stock ` +
            `wheel is ${wheelSizeLabel(car)}. Measure the car or check a fitment guide.`,
          axle,
          evidence: { wheelOffsetMm: dims.offsetMm, stockOffsetMm: car.offsetMm },
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const evidence = {
        wheelOffsetMm: dims.offsetMm,
        minOffsetMm,
        maxOffsetMm,
        stockOffsetMm: car.offsetMm,
      };

      if (dims.offsetMm >= minOffsetMm && dims.offsetMm <= maxOffsetMm) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Offset within range (${axle})`,
          detail:
            `ET${dims.offsetMm} sits inside the estimated ET${minOffsetMm}–ET${maxOffsetMm} ` +
            `range for the ${axle} axle. Stock is ET${car.offsetMm}.`,
          axle,
          evidence,
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const outsideBy =
        dims.offsetMm < minOffsetMm
          ? minOffsetMm - dims.offsetMm
          : dims.offsetMm - maxOffsetMm;

      const direction =
        dims.offsetMm < minOffsetMm
          ? "further out of the arch than the estimated range allows"
          : "further into the arch than the estimated range allows";

      const consequence =
        dims.offsetMm < minOffsetMm
          ? "Expect the tire to sit proud of the fender, and to rub on compression."
          : "Expect interference with the strut, spring or brake caliper.";

      if (outsideBy <= OFFSET_MODIFICATION_TOLERANCE_MM) {
        findings.push({
          ruleKey: this.key,
          status: "requires_modification",
          title: `Offset marginal (${axle})`,
          detail:
            `ET${dims.offsetMm} is ${outsideBy}mm ${direction} (ET${minOffsetMm}–ET${maxOffsetMm}). ` +
            `${consequence} Usually solvable with fender work or camber adjustment.`,
          axle,
          evidence,
          provenance: envelopeProvenance(car),
        });
      } else {
        findings.push({
          ruleKey: this.key,
          status: "incompatible",
          title: `Offset outside range (${axle})`,
          detail:
            `ET${dims.offsetMm} is ${outsideBy}mm ${direction} (ET${minOffsetMm}–ET${maxOffsetMm}). ` +
            `${consequence} This is beyond what fender work will recover.`,
          axle,
          evidence,
          provenance: envelopeProvenance(car),
        });
      }
    }

    return findings;
  },
};

const WIDTH_MODIFICATION_TOLERANCE_IN = 0.5;

export const widthRule: CompatibilityRule = {
  key: "wheel.width",
  description: "The wheel's width must sit inside the car's estimated maximum, per axle.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = wheelSpec(context.part);
    const profile = profileOf(context);
    if (!spec || !profile) return [];

    const findings: Finding[] = [];

    for (const axle of AXLES) {
      const dims = dimsFor(spec, axle);
      const car = vehicleWheel(profile, axle);

      if (car.maxWidthIn === undefined) {
        findings.push({
          ruleKey: this.key,
          status: "unknown",
          title: `No width limit on record (${axle})`,
          detail:
            `No maximum wheel width is recorded for the ${axle} of this car. ` +
            `The stock wheel is ${car.widthIn} inches wide; this one is ${dims.widthIn}.`,
          axle,
          evidence: { wheelWidthIn: dims.widthIn, stockWidthIn: car.widthIn },
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const evidence = {
        wheelWidthIn: dims.widthIn,
        maxWidthIn: car.maxWidthIn,
        stockWidthIn: car.widthIn,
      };

      if (dims.widthIn <= car.maxWidthIn) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Width within range (${axle})`,
          detail:
            `${dims.widthIn} inches is within the estimated ${car.maxWidthIn} inch ` +
            `maximum for the ${axle} axle.`,
          axle,
          evidence,
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const over = Math.round((dims.widthIn - car.maxWidthIn) * 10) / 10;
      const status =
        over <= WIDTH_MODIFICATION_TOLERANCE_IN ? "requires_modification" : "incompatible";

      findings.push({
        ruleKey: this.key,
        status,
        title:
          status === "requires_modification"
            ? `Width marginal (${axle})`
            : `Width exceeds supported range (${axle})`,
        detail:
          `The selected wheel is ${dims.widthIn} inches wide on the ${axle} axle, ` +
          `${over} inches over the estimated ${car.maxWidthIn} inch maximum. ` +
          (status === "requires_modification"
            ? "Fender rolling and added camber will usually make this work."
            : "This needs arch modification or a wide-body conversion, not a spacer."),
        axle,
        evidence,
        provenance: envelopeProvenance(car),
      });
    }

    return findings;
  },
};

export const diameterRule: CompatibilityRule = {
  key: "wheel.diameter",
  description:
    "The wheel's diameter must sit inside the car's estimated arch and brake-clearance range.",
  appliesTo: ["wheels"],
  evaluate(context: RuleContext): readonly Finding[] {
    const spec = wheelSpec(context.part);
    const profile = profileOf(context);
    if (!spec || !profile) return [];

    const findings: Finding[] = [];

    for (const axle of AXLES) {
      const dims = dimsFor(spec, axle);
      const car = vehicleWheel(profile, axle);
      const { minDiameterIn, maxDiameterIn } = car;

      if (minDiameterIn === undefined || maxDiameterIn === undefined) {
        findings.push({
          ruleKey: this.key,
          status: "unknown",
          title: `No diameter range on record (${axle})`,
          detail:
            `No diameter range is recorded for the ${axle} of this car. Stock is ` +
            `${car.diameterIn} inches; this wheel is ${dims.diameterIn}.`,
          axle,
          evidence: { wheelDiameterIn: dims.diameterIn, stockDiameterIn: car.diameterIn },
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const evidence = {
        wheelDiameterIn: dims.diameterIn,
        minDiameterIn,
        maxDiameterIn,
      };

      if (dims.diameterIn >= minDiameterIn && dims.diameterIn <= maxDiameterIn) {
        findings.push({
          ruleKey: this.key,
          status: "compatible",
          title: `Diameter within range (${axle})`,
          detail:
            `${dims.diameterIn} inches is inside the estimated ${minDiameterIn}–${maxDiameterIn} ` +
            `inch range for the ${axle} axle.`,
          axle,
          evidence,
          provenance: envelopeProvenance(car),
        });
        continue;
      }

      const tooSmall = dims.diameterIn < minDiameterIn;

      findings.push({
        ruleKey: this.key,
        // Diameter is not something a spacer or a fender roll can recover.
        status: "incompatible",
        title: tooSmall
          ? `Diameter below minimum (${axle})`
          : `Diameter above maximum (${axle})`,
        detail: tooSmall
          ? `A ${dims.diameterIn} inch wheel is below the estimated ${minDiameterIn} inch ` +
            `minimum for the ${axle} axle, which is set by brake clearance. The wheel ` +
            `will not go over the caliper.`
          : `A ${dims.diameterIn} inch wheel is above the estimated ${maxDiameterIn} inch ` +
            `maximum for the ${axle} axle. Expect the tire to foul the arch liner.`,
        axle,
        evidence,
        provenance: envelopeProvenance(car),
      });
    }

    return findings;
  },
};

export const WHEEL_GEOMETRY_RULES: readonly CompatibilityRule[] = [
  boltPatternRule,
  centerBoreRule,
  offsetRule,
  widthRule,
  diameterRule,
];
