import type { Part } from "@/types/part";
import { definePart, MANUFACTURER_CLAIM } from "./define";

/**
 * Exhaust, intake and engine parts.
 *
 * Power figures here are the maker's claim and are labelled as such. They are
 * fed into the performance panel, which labels the result an estimate — a
 * claim passed through an addition is still a claim.
 */

export const EXHAUST_PARTS: readonly Part[] = [
  definePart({
    slug: "akrapovic-slip-on-titanium",
    brand: "Akrapovič",
    name: "Slip-On titanium axle-back",
    description: "Titanium rear section. Sound, and about nine kilos, not power.",
    priceUsd: 4200,
    installUsd: 350,
    spec: {
      kind: "exhaust",
      type: "axle_back",
      material: "titanium",
      emissionsAffecting: false,
    },
    visual: { exhaustTips: 4 },
    powerDeltaHp: 3,
    weightDeltaKg: -9,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "remus-cat-back-stainless",
    brand: "Remus",
    name: "Sport cat-back system",
    description: "Full stainless cat-back with valved rear silencer.",
    priceUsd: 2600,
    installUsd: 450,
    spec: {
      kind: "exhaust",
      type: "cat_back",
      pipeDiameterMm: 76,
      material: "stainless_304",
      emissionsAffecting: false,
    },
    visual: { exhaustTips: 4 },
    powerDeltaHp: 8,
    torqueDeltaNm: 12,
    weightDeltaKg: -6,
    provenance: MANUFACTURER_CLAIM,
  }),
  // The interesting one: needs a tune to be worth anything, and is not road
  // legal in most places. The engine flags both rather than quietly adding
  // the power to the total.
  definePart({
    slug: "vrsf-catless-downpipes",
    brand: "VRSF",
    name: "Catless downpipes",
    description:
      "Removes the primary catalysts. Competition use only, and worthless " +
      "without a matching ECU calibration.",
    priceUsd: 780,
    installUsd: 650,
    spec: {
      kind: "exhaust",
      type: "downpipe",
      pipeDiameterMm: 76,
      material: "stainless_304",
      emissionsAffecting: true,
      requiresCategories: ["engine"],
    },
    powerDeltaHp: 35,
    torqueDeltaNm: 50,
    weightDeltaKg: -4,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "borla-atak-axle-back",
    brand: "Borla",
    name: "ATAK axle-back",
    description: "409 stainless, loud, and the cheapest way to change the noise.",
    priceUsd: 1100,
    installUsd: 300,
    spec: {
      kind: "exhaust",
      type: "axle_back",
      material: "stainless_409",
      emissionsAffecting: false,
    },
    visual: { exhaustTips: 2 },
    powerDeltaHp: 2,
    weightDeltaKg: -3,
    provenance: MANUFACTURER_CLAIM,
  }),
];

export const INTAKE_PARTS: readonly Part[] = [
  definePart({
    slug: "eventuri-carbon-intake",
    brand: "Eventuri",
    name: "Carbon fibre intake system",
    description: "Full carbon housings with a proper velocity stack.",
    priceUsd: 1950,
    installUsd: 220,
    spec: { kind: "intake", type: "full_induction", emissionsAffecting: false },
    powerDeltaHp: 12,
    torqueDeltaNm: 15,
    weightDeltaKg: -2,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "kn-drop-in-filter",
    brand: "K&N",
    name: "Drop-in panel filter",
    description: "Reusable panel filter in the original airbox. Effect is small.",
    priceUsd: 85,
    installUsd: 0,
    spec: { kind: "intake", type: "drop_in_filter", emissionsAffecting: false },
    powerDeltaHp: 2,
    provenance: MANUFACTURER_CLAIM,
  }),
];

export const ENGINE_PARTS: readonly Part[] = [
  definePart({
    slug: "bootmod3-stage-2-tune",
    brand: "bootmod3",
    name: "Stage 2 ECU calibration",
    description:
      "Flash tune for the S58 and B58. Stage 2 assumes downpipes are already " +
      "fitted; running it on a stock exhaust is not the same map.",
    priceUsd: 1100,
    installUsd: 250,
    spec: {
      kind: "engine",
      type: "ecu_tune",
      engineCodes: ["S58B30T0", "B58B30"],
      requiresCategories: ["exhaust"],
      requiresHighOctane: true,
    },
    powerDeltaHp: 95,
    torqueDeltaNm: 120,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "cobb-accessport-stage-1",
    brand: "COBB",
    name: "Accessport Stage 1",
    description:
      "Handheld flash tuner with off-the-shelf maps for the FA24 and EA888. " +
      "Stage 1 runs on an otherwise stock car.",
    priceUsd: 750,
    installUsd: 0,
    spec: {
      kind: "engine",
      type: "ecu_tune",
      engineCodes: ["FA24F", "EA888 evo4", "4B11T"],
      requiresHighOctane: true,
    },
    powerDeltaHp: 40,
    torqueDeltaNm: 60,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "wagner-competition-intercooler",
    brand: "Wagner Tuning",
    name: "Competition intercooler",
    description:
      "Larger core to keep intake temperatures down on repeated pulls. Adds " +
      "weight, which is the trade.",
    priceUsd: 1250,
    installUsd: 480,
    spec: { kind: "engine", type: "intercooler" },
    powerDeltaHp: 10,
    torqueDeltaNm: 15,
    weightDeltaKg: 6,
    provenance: MANUFACTURER_CLAIM,
  }),
];
