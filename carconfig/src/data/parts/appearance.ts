import type { Part } from "@/types/part";
import { definePart } from "./define";

export const AERO_PARTS: readonly Part[] = [
  definePart({
    slug: "carbon-ducktail-spoiler",
    brand: "Vorsteiner",
    name: "Carbon ducktail spoiler",
    description: "Pre-preg carbon boot lid spoiler. Adhesive and bracket fit.",
    priceUsd: 1450,
    installUsd: 300,
    spec: { kind: "aero", type: "spoiler", material: "carbon_fibre" },
    visual: { attachment: "spoiler", attachmentHex: "#15171a" },
    weightDeltaKg: 1.5,
  }),
  definePart({
    slug: "apr-gtc-300-wing",
    brand: "APR Performance",
    name: "GTC-300 adjustable wing",
    description:
      "Two-metre adjustable wing on aluminium uprights. Makes real downforce " +
      "and makes the car look like it goes to track days.",
    priceUsd: 1890,
    installUsd: 400,
    spec: { kind: "aero", type: "wing", material: "carbon_fibre" },
    visual: { attachment: "wing", attachmentHex: "#15171a" },
    weightDeltaKg: 7,
  }),
  definePart({
    slug: "front-splitter-carbon",
    brand: "Vorsteiner",
    name: "Carbon front splitter",
    description: "Bolt-on splitter extending the front lip.",
    priceUsd: 980,
    installUsd: 280,
    spec: { kind: "aero", type: "splitter", material: "carbon_fibre" },
    visual: { attachment: "splitter", attachmentHex: "#15171a" },
    weightDeltaKg: 2.5,
  }),
  definePart({
    slug: "rear-diffuser-carbon",
    brand: "Vorsteiner",
    name: "Carbon rear diffuser",
    description: "Replaces the lower rear valance.",
    priceUsd: 1150,
    installUsd: 300,
    spec: { kind: "aero", type: "diffuser", material: "carbon_fibre" },
    visual: { attachment: "diffuser", attachmentHex: "#15171a" },
    weightDeltaKg: 2,
  }),
  definePart({
    slug: "side-skirt-extensions",
    brand: "Maxton Design",
    name: "Side skirt extensions",
    description: "ABS skirt extensions, gloss black.",
    priceUsd: 420,
    installUsd: 220,
    spec: { kind: "aero", type: "side_skirts", material: "abs" },
    visual: { attachment: "side_skirts", attachmentHex: "#15171a" },
    weightDeltaKg: 3,
  }),
];

/**
 * Paint and wrap.
 *
 * These are the one category where the part genuinely is the visual change,
 * so the spec colour and the viewer colour are the same value.
 */
const paint = (
  slug: string,
  name: string,
  hex: string,
  finish: "gloss" | "satin" | "matte" | "metallic",
  priceUsd: number,
  type: "respray" | "vinyl_wrap",
): Part =>
  definePart({
    slug,
    brand: type === "vinyl_wrap" ? "3M" : "Refinish",
    name,
    description:
      type === "vinyl_wrap"
        ? "Full vehicle vinyl wrap. Reversible, and protects what is underneath."
        : "Full respray in a single stage over prepared panels.",
    priceUsd,
    installUsd: type === "vinyl_wrap" ? 2800 : 0,
    spec: { kind: "paint", type, colorHex: hex, finish },
    visual: { paintHex: hex, paintFinish: finish },
  });

export const PAINT_PARTS: readonly Part[] = [
  paint("wrap-satin-black", "Satin black wrap", "#1a1c1e", "satin", 900, "vinyl_wrap"),
  paint("wrap-nardo-grey", "Nardo grey wrap", "#8d9196", "gloss", 900, "vinyl_wrap"),
  paint("wrap-signal-green", "Signal green wrap", "#3f8f4a", "gloss", 950, "vinyl_wrap"),
  paint("respray-laguna-blue", "Laguna blue respray", "#1f5fa8", "metallic", 6500, "respray"),
  paint("respray-guards-red", "Guards red respray", "#c3261f", "gloss", 6200, "respray"),
  paint("wrap-frozen-white", "Frozen white wrap", "#dfe2e6", "matte", 950, "vinyl_wrap"),
];
