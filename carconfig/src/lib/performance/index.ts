import type { Part } from "@/types/part";
import type { Vehicle } from "@/types/vehicle";

/**
 * Performance estimation.
 *
 * Read this before believing any number that comes out of here.
 *
 * What this does is add up the manufacturers' claims. That is all it does. It
 * is not a model of an engine, it does not know about your fuel, your climate,
 * your gearbox or the state of your car, and the claims it is adding were each
 * made on somebody's own demonstrator with a commercial interest in the
 * number. Stacking three of them does not produce a fourth, better number.
 *
 * Two specific ways it is wrong, both left visible on purpose:
 *
 *  - Power modifications do not add. An intake claiming +12 and a tune
 *    claiming +95 do not make +107, because the tune's figure was very likely
 *    measured with an intake already fitted. Real builds show diminishing
 *    returns, and this function does not model them.
 *  - A part whose prerequisites are missing will not make its claimed power at
 *    all. Downpipes without a calibration make approximately nothing.
 *
 * The second one is handled — claims are discounted when the part's stated
 * requirements are not met. The first is not, and the UI says so. The shape of
 * this module is what matters: a single place where a better model can be
 * introduced without touching anything that calls it.
 */

export interface PerformanceEstimate {
  readonly stockPowerHp: number;
  readonly stockTorqueNm: number;
  readonly stockWeightKg: number;

  readonly estimatedPowerHp: number;
  readonly estimatedTorqueNm: number;
  readonly estimatedWeightKg: number;

  readonly powerDeltaHp: number;
  readonly torqueDeltaNm: number;
  readonly weightDeltaKg: number;

  /** Horsepower per tonne, stock and estimated. */
  readonly stockPowerToWeight: number;
  readonly estimatedPowerToWeight: number;

  /** Parts whose power claim was discounted, and why. */
  readonly discounted: readonly DiscountedClaim[];
  /** True when any part in the build claims power. */
  readonly hasPowerClaims: boolean;
}

export interface DiscountedClaim {
  readonly part: Part;
  readonly claimedHp: number;
  readonly reason: string;
}

function requiredCategories(part: Part): readonly string[] {
  const spec = part.spec as { requiresCategories?: readonly string[] };
  return spec.requiresCategories ?? [];
}

export function estimatePerformance(
  vehicle: Vehicle,
  parts: readonly Part[],
): PerformanceEstimate {
  const categoriesPresent = new Set(parts.map((p) => p.category));

  let powerDeltaHp = 0;
  let torqueDeltaNm = 0;
  let weightDeltaKg = 0;
  const discounted: DiscountedClaim[] = [];
  let hasPowerClaims = false;

  for (const part of parts) {
    // Weight is the one figure here that is straightforwardly additive: a
    // titanium exhaust that is nine kilos lighter is nine kilos lighter
    // whatever else is fitted.
    weightDeltaKg += part.weightDeltaKg ?? 0;

    const claimedHp = part.powerDeltaHp ?? 0;
    const claimedNm = part.torqueDeltaNm ?? 0;
    if (claimedHp !== 0) hasPowerClaims = true;

    const missing = requiredCategories(part).filter(
      (category) => !categoriesPresent.has(category as Part["category"]),
    );

    if (missing.length > 0 && claimedHp > 0) {
      discounted.push({
        part,
        claimedHp,
        reason:
          `Claims +${claimedHp}hp, but that figure assumes a ` +
          `${missing.join(" and ")} part is fitted and this build has none. ` +
          `Not counted.`,
      });
      continue;
    }

    powerDeltaHp += claimedHp;
    torqueDeltaNm += claimedNm;
  }

  const estimatedPowerHp = Math.round(vehicle.stockPowerHp + powerDeltaHp);
  const estimatedTorqueNm = Math.round(vehicle.stockTorqueNm + torqueDeltaNm);
  const estimatedWeightKg = Math.round(vehicle.stockWeightKg + weightDeltaKg);

  const perTonne = (hp: number, kg: number) =>
    Math.round((hp / (kg / 1000)) * 10) / 10;

  return {
    stockPowerHp: vehicle.stockPowerHp,
    stockTorqueNm: vehicle.stockTorqueNm,
    stockWeightKg: vehicle.stockWeightKg,
    estimatedPowerHp,
    estimatedTorqueNm,
    estimatedWeightKg,
    powerDeltaHp: Math.round(powerDeltaHp),
    torqueDeltaNm: Math.round(torqueDeltaNm),
    weightDeltaKg: Math.round(weightDeltaKg * 10) / 10,
    stockPowerToWeight: perTonne(vehicle.stockPowerHp, vehicle.stockWeightKg),
    estimatedPowerToWeight: perTonne(estimatedPowerHp, estimatedWeightKg),
    discounted,
    hasPowerClaims,
  };
}

/** The disclaimer the performance panel is required to carry. */
export const PERFORMANCE_DISCLAIMER =
  "Estimated by adding up manufacturers' own claims. Claims are not " +
  "measurements, and power modifications do not add up in reality — the true " +
  "figure for a build like this is normally lower. Treat this as a rough " +
  "indication, not a prediction.";
