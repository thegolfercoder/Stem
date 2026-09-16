import type { Part, TireDimensions } from "@/types/part";
import { definePart } from "./define";

const square = (
  widthMm: number,
  aspect: number,
  diameterIn: number,
): { front: TireDimensions; rear: TireDimensions } => {
  const dims = { widthMm, aspect, diameterIn };
  return { front: dims, rear: dims };
};

export const TIRE_PARTS: readonly Part[] = [
  definePart({
    slug: "michelin-ps4s-255-35-19",
    brand: "Michelin",
    name: "Pilot Sport 4S 255/35R19",
    description: "Ultra-high-performance summer tire. The default fast-road choice.",
    priceUsd: 1360,
    installUsd: 140,
    spec: { kind: "tires", compound: "summer", treadwear: 300, ...square(255, 35, 19) },
  }),
  definePart({
    slug: "michelin-cup2-275-35-19",
    brand: "Michelin",
    name: "Pilot Sport Cup 2 275/35R19",
    description: "Track-focused semi-slick. Road legal, and not a winter tire.",
    priceUsd: 1880,
    installUsd: 140,
    spec: { kind: "tires", compound: "semi_slick", treadwear: 180, ...square(275, 35, 19) },
    weightDeltaKg: -2,
  }),
  definePart({
    slug: "michelin-ps4s-285-30-20",
    brand: "Michelin",
    name: "Pilot Sport 4S 285/30R20",
    description: "Summer performance tire in a staggered rear size.",
    priceUsd: 1520,
    installUsd: 140,
    spec: { kind: "tires", compound: "summer", treadwear: 300, ...square(285, 30, 20) },
  }),
  definePart({
    slug: "bridgestone-re71rs-245-40-18",
    brand: "Bridgestone",
    name: "Potenza RE-71RS 245/40R18",
    description: "Extreme performance summer tire, autocross favourite.",
    priceUsd: 1120,
    installUsd: 130,
    spec: { kind: "tires", compound: "track", treadwear: 200, ...square(245, 40, 18) },
  }),
  definePart({
    slug: "falken-rt660-215-45-17",
    brand: "Falken",
    name: "Azenis RT660 215/45R17",
    description: "200 treadwear competition tire in a light-car size.",
    priceUsd: 760,
    installUsd: 120,
    spec: { kind: "tires", compound: "track", treadwear: 200, ...square(215, 45, 17) },
  }),
  definePart({
    slug: "continental-dws06-235-40-18",
    brand: "Continental",
    name: "ExtremeContact DWS06 Plus 235/40R18",
    description: "All-season with genuine dry grip. The year-round compromise.",
    priceUsd: 840,
    installUsd: 130,
    spec: { kind: "tires", compound: "all_season", treadwear: 560, ...square(235, 40, 18) },
  }),
  definePart({
    slug: "michelin-ps4s-265-30-19",
    brand: "Michelin",
    name: "Pilot Sport 4S 265/30R19",
    description: "Summer performance tire for wide front-drive fitments.",
    priceUsd: 1440,
    installUsd: 140,
    spec: { kind: "tires", compound: "summer", treadwear: 300, ...square(265, 30, 19) },
  }),
];
