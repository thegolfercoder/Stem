import type { Part, WheelDimensions } from "@/types/part";
import { definePart } from "./define";

/**
 * Wheels.
 *
 * The selection is chosen to exercise the compatibility engine rather than to
 * flatter it: there are wheels here that fit nothing in the catalogue, wheels
 * that fit only with spacers, and wheels wide enough to fail a clearance check
 * on cars whose bolt pattern they match. A catalogue where everything fits
 * everything would not prove anything.
 */

const square = (
  diameterIn: number,
  widthIn: number,
  offsetMm: number,
): { front: WheelDimensions; rear: WheelDimensions } => {
  const dims = { diameterIn, widthIn, offsetMm };
  return { front: dims, rear: dims };
};

export const WHEEL_PARTS: readonly Part[] = [
  definePart({
    slug: "bbs-ch-r-19x95-et35-5x112",
    brand: "BBS",
    name: "CH-R 19x9.5 ET35",
    description:
      "Flow-formed one-piece in satin black. A conservative offset that clears " +
      "most big brake kits on the 5x112 platforms.",
    priceUsd: 3150,
    installUsd: 180,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 112,
      centerBoreMm: 66.6,
      construction: "flow_formed",
      weightPerWheelKg: 11.2,
      ...square(19, 9.5, 35),
    },
    visual: { wheelStyle: "mesh", wheelFinishHex: "#2a2c2f" },
    weightDeltaKg: -6,
  }),

  definePart({
    slug: "titan7-ts5-19x105-et40-5x112",
    brand: "Titan 7",
    name: "T-S5 19x10.5 ET40",
    description: "Forged monoblock, staggered rear application, bronze finish.",
    priceUsd: 3800,
    installUsd: 180,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 112,
      centerBoreMm: 66.6,
      construction: "forged",
      weightPerWheelKg: 10.4,
      front: { diameterIn: 19, widthIn: 9.5, offsetMm: 35 },
      rear: { diameterIn: 19, widthIn: 10.5, offsetMm: 40 },
    },
    visual: { wheelStyle: "split_spoke", wheelFinishHex: "#8a6a3a" },
    weightDeltaKg: -9,
  }),

  // Deliberately aggressive. Matches 5x112 on paper and fails the width and
  // offset envelope on every 5x112 car in the catalogue.
  definePart({
    slug: "titan7-tr10-19x11-et15-5x112",
    brand: "Titan 7",
    name: "T-R10 19x11 ET15",
    description:
      "Forged, very wide, very low offset. A track fitment that assumes arch " +
      "work has already been done.",
    priceUsd: 4200,
    installUsd: 180,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 112,
      centerBoreMm: 66.6,
      construction: "forged",
      weightPerWheelKg: 11.8,
      ...square(19, 11, 15),
    },
    visual: { wheelStyle: "five_spoke", wheelFinishHex: "#3d4043" },
    weightDeltaKg: -4,
  }),

  definePart({
    slug: "apex-arc8-18x95-et40-5x120",
    brand: "APEX",
    name: "ARC-8 18x9.5 ET40",
    description: "Cast flow-formed track wheel, satin anthracite.",
    priceUsd: 1560,
    installUsd: 160,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 120,
      centerBoreMm: 64.1,
      construction: "flow_formed",
      weightPerWheelKg: 10.0,
      ...square(18, 9.5, 40),
    },
    visual: { wheelStyle: "five_spoke", wheelFinishHex: "#44474b" },
    weightDeltaKg: -8,
  }),

  definePart({
    slug: "enkei-rpf1-17x9-et45-5x100",
    brand: "Enkei",
    name: "RPF1 17x9 ET45",
    description:
      "MAT-forged, the long-standing lightweight choice on the 5x100 platforms.",
    priceUsd: 1180,
    installUsd: 150,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 100,
      centerBoreMm: 56.1,
      construction: "flow_formed",
      weightPerWheelKg: 7.9,
      ...square(17, 9, 45),
    },
    visual: { wheelStyle: "five_spoke", wheelFinishHex: "#c9ccd0" },
    weightDeltaKg: -10,
  }),

  definePart({
    slug: "volk-te37-18x95-et38-5x1143",
    brand: "Volk Racing",
    name: "TE37 Saga SL 18x9.5 ET38",
    description: "Forged six-spoke in bronze. 5x114.3.",
    priceUsd: 3600,
    installUsd: 170,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 114.3,
      centerBoreMm: 73,
      construction: "forged",
      weightPerWheelKg: 9.3,
      ...square(18, 9.5, 38),
    },
    visual: { wheelStyle: "five_spoke", wheelFinishHex: "#96702f" },
    weightDeltaKg: -11,
  }),

  definePart({
    slug: "fifteen52-integrale-18x85-et45-5x112",
    brand: "fifteen52",
    name: "Integrale 18x8.5 ET45",
    description: "Cast monoblock, asphalt black, 5x112.",
    priceUsd: 1320,
    installUsd: 160,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 112,
      centerBoreMm: 66.6,
      construction: "cast",
      weightPerWheelKg: 11.9,
      ...square(18, 8.5, 45),
    },
    visual: { wheelStyle: "twin_five_spoke", wheelFinishHex: "#25272a" },
    weightDeltaKg: -2,
  }),

  definePart({
    slug: "forgestar-f14-20x10-et40-5x120",
    brand: "Forgestar",
    name: "F14 20x11 ET40",
    description: "Flow-formed staggered application for wide-body platforms.",
    priceUsd: 2450,
    installUsd: 180,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 120,
      centerBoreMm: 66.9,
      construction: "flow_formed",
      weightPerWheelKg: 12.6,
      front: { diameterIn: 20, widthIn: 10, offsetMm: 35 },
      rear: { diameterIn: 20, widthIn: 11, offsetMm: 40 },
    },
    visual: { wheelStyle: "split_spoke", wheelFinishHex: "#5a5d61" },
    weightDeltaKg: -3,
  }),

  definePart({
    slug: "oz-ultraleggera-17x75-et48-5x100",
    brand: "OZ Racing",
    name: "Ultraleggera 17x7.5 ET48",
    description: "Cast lightweight ten-spoke, matte black, 5x100.",
    priceUsd: 1040,
    installUsd: 150,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 100,
      centerBoreMm: 56.1,
      construction: "cast",
      weightPerWheelKg: 8.2,
      ...square(17, 7.5, 48),
    },
    visual: { wheelStyle: "twin_five_spoke", wheelFinishHex: "#1f2124" },
    weightDeltaKg: -6,
  }),

  // Small diameter on purpose: fails the brake-clearance floor on cars with
  // large stock rotors, which is the check most people find out about the
  // expensive way.
  definePart({
    slug: "konig-hypergram-17x8-et45-5x1143",
    brand: "Konig",
    name: "Hypergram 17x8 ET45",
    description: "Cast lightweight, matte bronze, 5x114.3.",
    priceUsd: 880,
    installUsd: 150,
    spec: {
      kind: "wheels",
      boltCount: 5,
      boltCircleMm: 114.3,
      centerBoreMm: 73,
      construction: "cast",
      weightPerWheelKg: 8.6,
      ...square(17, 8, 45),
    },
    visual: { wheelStyle: "five_spoke", wheelFinishHex: "#7d6238" },
    weightDeltaKg: -7,
  }),
];
