import { z } from "zod";
import type { Attachment, SpokeStyle, ViewerConfig } from "./viewer-config";

/**
 * How the car looks, chosen directly.
 *
 * Parts change the car too — a wheel part brings its own style, coilovers
 * lower it — but a configurator should not make you find a catalogue entry to
 * see your car in a different colour. Appearance is the set of choices that
 * are purely visual: paint, wheel look, caliper colour, stance, stripes and
 * body pieces. It is applied on top of whatever the parts produced, and every
 * field is optional, so an empty appearance changes nothing.
 *
 * It travels in share links and saved builds, so it is validated like any
 * other untrusted input: hex colours are hex colours, and numbers are clamped
 * to what the viewer can draw.
 */

export type PaintFinish = "gloss" | "metallic" | "pearl" | "satin" | "matte" | "chrome";
export type StripeStyle = "none" | "twin" | "single" | "side";

export interface Appearance {
  readonly paintHex?: string;
  readonly paintFinish?: PaintFinish;
  readonly wheelStyle?: SpokeStyle;
  readonly wheelFinishHex?: string;
  readonly caliperHex?: string;
  /** Added to whatever the suspension parts do. Millimetres, negative is lower. */
  readonly rideHeightMm?: number;
  /** Body pieces shown whether or not a part is in the build. */
  readonly aero?: readonly Attachment[];
  readonly stripe?: StripeStyle;
  readonly stripeHex?: string;
}

export const RIDE_HEIGHT_RANGE = [-80, 50] as const;

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const appearanceSchema = z
  .object({
    paintHex: HEX,
    paintFinish: z.enum(["gloss", "metallic", "pearl", "satin", "matte", "chrome"]),
    wheelStyle: z.enum(["mesh", "split_spoke", "five_spoke", "twin_five_spoke"]),
    wheelFinishHex: HEX,
    caliperHex: HEX,
    rideHeightMm: z.number().int().min(RIDE_HEIGHT_RANGE[0]).max(RIDE_HEIGHT_RANGE[1]),
    aero: z.array(z.enum(["spoiler", "wing", "splitter", "diffuser", "side_skirts"])).max(5),
    stripe: z.enum(["none", "twin", "single", "side"]),
    stripeHex: HEX,
  })
  .partial()
  .strict();

/** Apply appearance choices on top of the configuration the parts produced. */
export function applyAppearance(config: ViewerConfig, a: Appearance | undefined): ViewerConfig {
  if (!a) return config;
  return {
    ...config,
    paintHex: a.paintHex ?? config.paintHex,
    paintFinish: a.paintFinish ?? config.paintFinish,
    wheelStyle: a.wheelStyle ?? config.wheelStyle,
    wheelFinishHex: a.wheelFinishHex ?? config.wheelFinishHex,
    caliperHex: a.caliperHex ?? config.caliperHex,
    rearCaliperHex: a.caliperHex ?? config.rearCaliperHex,
    rideHeightDeltaMm: config.rideHeightDeltaMm + (a.rideHeightMm ?? 0),
    attachments: [...new Set([...config.attachments, ...(a.aero ?? [])])],
    stripe: a.stripe ?? config.stripe,
    stripeHex: a.stripeHex ?? config.stripeHex,
  };
}

/** True when the appearance changes nothing, so it can be left out of a link. */
export function isEmptyAppearance(a: Appearance | undefined): boolean {
  return !a || Object.values(a).every((v) => v === undefined || (Array.isArray(v) && v.length === 0));
}

// --- presets ------------------------------------------------------------------

export interface PaintPreset {
  readonly name: string;
  readonly hex: string;
  readonly finish: PaintFinish;
}

/**
 * A palette people recognise. The names describe the colour and are in common
 * use; the values are our approximations for a screen, not paint codes.
 */
export const PAINT_PRESETS: readonly PaintPreset[] = [
  { name: "Obsidian", hex: "#15171a", finish: "gloss" },
  { name: "Chalk", hex: "#d9d6cc", finish: "gloss" },
  { name: "Arctic silver", hex: "#c8ccd0", finish: "metallic" },
  { name: "Nardo grey", hex: "#7d8184", finish: "gloss" },
  { name: "Gunmetal", hex: "#3d4247", finish: "metallic" },
  { name: "Guards red", hex: "#c1121c", finish: "gloss" },
  { name: "Rosso", hex: "#b3111f", finish: "pearl" },
  { name: "Lava orange", hex: "#e2531b", finish: "gloss" },
  { name: "Racing yellow", hex: "#f2c418", finish: "gloss" },
  { name: "Python green", hex: "#6fae3c", finish: "gloss" },
  { name: "British racing green", hex: "#1d3b2a", finish: "metallic" },
  { name: "Miami blue", hex: "#1aa4d9", finish: "gloss" },
  { name: "Shark blue", hex: "#1f5fb4", finish: "gloss" },
  { name: "Midnight blue", hex: "#15223f", finish: "metallic" },
  { name: "Ultraviolet", hex: "#4b2a8a", finish: "pearl" },
  { name: "Frozen white", hex: "#eceeef", finish: "matte" },
  { name: "Frozen black", hex: "#1d1f22", finish: "matte" },
  { name: "Liquid silver", hex: "#dfe3e8", finish: "chrome" },
];

export const WHEEL_FINISHES: readonly { name: string; hex: string }[] = [
  { name: "Silver", hex: "#9aa1a8" },
  { name: "Gunmetal", hex: "#4a4f55" },
  { name: "Gloss black", hex: "#1a1c1f" },
  { name: "Bronze", hex: "#8a6a3d" },
  { name: "Gold", hex: "#c9a34a" },
  { name: "White", hex: "#e6e7e8" },
];

export const CALIPER_COLOURS: readonly { name: string; hex: string }[] = [
  { name: "Black", hex: "#1c1d20" },
  { name: "Red", hex: "#c0191f" },
  { name: "Yellow", hex: "#d4a019" },
  { name: "Blue", hex: "#1f58b8" },
  { name: "Green", hex: "#3f8f4a" },
  { name: "Silver", hex: "#a9aeb3" },
];
