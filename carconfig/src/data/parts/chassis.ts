import type { Part } from "@/types/part";
import { definePart, MANUFACTURER_CLAIM } from "./define";

export const SUSPENSION_PARTS: readonly Part[] = [
  definePart({
    slug: "kw-v3-coilovers",
    brand: "KW",
    name: "Variant 3 coilovers",
    description:
      "Height adjustable with independent compression and rebound damping. " +
      "Replaces the dampers entirely, which is what makes it a problem on a " +
      "car that expects to be able to talk to them.",
    priceUsd: 2900,
    installUsd: 850,
    spec: {
      kind: "suspension",
      type: "coilovers",
      dropFrontMm: [10, 45],
      dropRearMm: [10, 45],
      heightAdjustable: true,
      damperAdjustable: true,
      conflictsWithTraits: ["electronic_dampers"],
    },
    visual: { rideHeightDeltaMm: -30 },
    weightDeltaKg: -4,
  }),
  definePart({
    slug: "ohlins-road-track-coilovers",
    brand: "Öhlins",
    name: "Road & Track coilovers",
    description:
      "Single-adjustable DFV damping. Height adjustable within a narrower band " +
      "than a full race coilover.",
    priceUsd: 3400,
    installUsd: 850,
    spec: {
      kind: "suspension",
      type: "coilovers",
      dropFrontMm: [5, 35],
      dropRearMm: [5, 35],
      heightAdjustable: true,
      damperAdjustable: true,
      conflictsWithTraits: ["electronic_dampers"],
    },
    visual: { rideHeightDeltaMm: -25 },
    weightDeltaKg: -3,
  }),
  definePart({
    slug: "eibach-pro-kit-springs",
    brand: "Eibach",
    name: "Pro-Kit lowering springs",
    description:
      "Fixed-rate springs on the original dampers. Keeps electronic damping " +
      "working because it does not replace the dampers.",
    priceUsd: 380,
    installUsd: 420,
    spec: {
      kind: "suspension",
      type: "lowering_springs",
      dropFrontMm: [25, 25],
      dropRearMm: [20, 20],
      heightAdjustable: false,
      damperAdjustable: false,
    },
    visual: { rideHeightDeltaMm: -22 },
    weightDeltaKg: -2,
  }),
  definePart({
    slug: "bilstein-b14-coilovers",
    brand: "Bilstein",
    name: "B14 PSS coilovers",
    description: "Height adjustable, fixed damping. The value end of coilovers.",
    priceUsd: 1250,
    installUsd: 800,
    spec: {
      kind: "suspension",
      type: "coilovers",
      dropFrontMm: [20, 40],
      dropRearMm: [15, 40],
      heightAdjustable: true,
      damperAdjustable: false,
      conflictsWithTraits: ["electronic_dampers"],
    },
    visual: { rideHeightDeltaMm: -30 },
    weightDeltaKg: -3,
  }),
];

export const BRAKE_PARTS: readonly Part[] = [
  definePart({
    slug: "brembo-gt-380-6pot",
    brand: "Brembo",
    name: "GT 380mm six-piston front kit",
    description:
      "Two-piece 380mm rotors with six-piston monobloc calipers. Needs a 19 " +
      "inch wheel to cover it, and that is not negotiable.",
    priceUsd: 5400,
    installUsd: 900,
    spec: {
      kind: "brakes",
      type: "big_brake_kit",
      axle: "front",
      rotorDiameterMm: 380,
      caliperPistons: 6,
      minWheelDiameterIn: 19,
    },
    weightDeltaKg: -8,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "stoptech-st60-355",
    brand: "StopTech",
    name: "ST-60 355mm front kit",
    description:
      "355mm slotted rotors, six-piston calipers. Clears an 18 inch wheel on " +
      "most applications.",
    priceUsd: 3200,
    installUsd: 850,
    spec: {
      kind: "brakes",
      type: "big_brake_kit",
      axle: "front",
      rotorDiameterMm: 355,
      caliperPistons: 6,
      minWheelDiameterIn: 18,
    },
    weightDeltaKg: -5,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "ap-racing-radi-cal-372",
    brand: "AP Racing",
    name: "Radi-CAL 372mm competition kit",
    description: "Competition front kit. Assumes a 19 inch wheel and track pads.",
    priceUsd: 6800,
    installUsd: 950,
    spec: {
      kind: "brakes",
      type: "big_brake_kit",
      axle: "front",
      rotorDiameterMm: 372,
      caliperPistons: 6,
      minWheelDiameterIn: 19,
    },
    weightDeltaKg: -10,
    provenance: MANUFACTURER_CLAIM,
  }),
  definePart({
    slug: "ferodo-ds2500-pads",
    brand: "Ferodo",
    name: "DS2500 front pads",
    description:
      "Fast-road and light-track pad on the original calipers. No wheel " +
      "clearance implications at all.",
    priceUsd: 340,
    installUsd: 180,
    spec: { kind: "brakes", type: "pads", axle: "front" },
  }),
  definePart({
    slug: "goodridge-braided-lines",
    brand: "Goodridge",
    name: "Stainless braided brake lines",
    description: "Reduces pedal travel under heat. Four-line set.",
    priceUsd: 190,
    installUsd: 260,
    spec: { kind: "brakes", type: "lines", axle: "both" },
  }),
];
