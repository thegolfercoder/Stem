/**
 * Which of a downloaded model's materials is its paint.
 *
 * Only about a third of the free models name their paint anything
 * recognisable in English. The rest say "material_2", "color_10592673",
 * "Carrozzeria" or "Livrea", or name the paint after the car. What the paint
 * always is, though, is the largest opaque surface that runs the length of the
 * car at body height: the panels. Glass, tyres, trim, the interior and the
 * underbody are all smaller, shorter, lower or see-through.
 *
 * When a model is drawn with one material for everything (a single texture
 * atlas), the paint cannot be separated from the rest, and nothing is chosen:
 * repainting would paint the tyres and windows too.
 *
 * No three.js here, so the rule can be tested and run offline over the whole
 * model library.
 */

/** "WheelFrontLRim1" → "wheel front l rim 1". */
export function nameWords(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_.\-:]+/g, " ")
    .toLowerCase();
}

// Words for paint and for everything that is not paint, in the languages
// model authors most often name things in.
const PAINT =
  /\b(paint\w*|car ?paint|body ?colou?r|body|bodywork|exterior|shell|coat|clear ?coat|livery|carrozzeria|carroceria|carrocera|carrosserie|karosserie|lack|vernice|pintura|peinture|livrea|verniz)\b/;
const OTHER = new RegExp(
  "\\b(" +
    [
      // glass and lights
      "glass\\w*", "windows?", "windshield", "windscreen", "lights?", "lamps?", "lens", "vetro", "vidrio", "verre", "glas", "vitre",
      "phares?", "feux", "faro", "luce", "luz", "licht", "scheinwerfer",
      // wheels and tyres
      "tires?", "tyres?", "rubber", "rims?", "wheels?", "brakes?", "calipers?", "discs?", "rotors?", "gomma", "goma", "pneu\\w*",
      "reifen", "cerchi\\w*", "llantas?", "jantes?", "felgen?", "ruota", "rueda", "roues?", "rad", "neumatico\\w*",
      // cabin
      "interior", "interni", "interieur", "innen\\w*", "inside", "inner", "inter", "int", "seats?", "chair", "sedile", "asiento",
      "siege", "sitz", "dash\\w*", "screen", "steering", "volante", "lenkrad", "leather", "fabric", "cloth", "carpet", "headliner",
      "cockpit", "cabin", "console", "gauges?", "pedals?", "belts?",
      // trim and parts
      "chrome", "chromo", "cromo", "cromato", "chrom", "mirrors?", "logo", "badges?", "emblem", "plates?", "licen[cs]e",
      "targa", "placa", "plaque", "kennzeichen", "grill", "grille", "carbon", "plastic", "plastica", "plastique", "kunststoff",
      "wipers?", "engine", "motor", "exhaust", "gasket",
      // underneath and around
      "under\\w*", "chassis", "floor", "bottom", "dessous", "suelo", "boden", "ground", "shadow", "backdrop", "stage", "platform",
    ].join("|") +
    ")\\b",
);
/** Words that usually mean trim, but can be the paint's own name ("Black_metallic"). */
const WEAK_OTHER = /\b(trim|black|matte|metal)\b/;

export type NameSays = "paint" | "other" | "trim" | null;

/** What a material's name says about whether it is the paint. */
export function paintNameSays(name: string): NameSays {
  const w = nameWords(name);
  if (OTHER.test(w)) return "other";
  if (PAINT.test(w)) return "paint";
  if (WEAK_OTHER.test(w)) return "trim";
  return null;
}

export interface MaterialStats {
  /** The caller's handle for the material. */
  readonly id: number;
  readonly name: string;
  /** The material classifier's verdict, if any: "glass", "tyre", "chrome"… */
  readonly kind: string | null;
  /** Base colour, linear RGB 0–1. */
  readonly rgb: readonly [number, number, number];
  readonly opacity: number;
  readonly hasMap: boolean;
  /** Surface area drawn with it, square metres. */
  readonly area: number;
  /** How much of the car's length its surface covers, 0–1. */
  readonly span: number;
  /** Area-weighted mean height of its surface, as a share of the car's height. */
  readonly height: number;
}

export type PaintChoice =
  | { readonly how: "named" | "largest"; readonly ids: readonly number[] }
  | { readonly how: "none"; readonly ids: readonly [] };

const luminance = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const colourDistance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
/** Colours a material has when its author never set one. */
const isDefaultColour = (c: readonly number[]) =>
  [1, 0.8, 0.800000011920929].some((v) => c.every((x) => Math.abs(x - v) < 1e-4));

export function choosePaint(materials: readonly MaterialStats[]): PaintChoice {
  const total = materials.reduce((s, m) => s + m.area, 0);
  if (total <= 0) return { how: "none", ids: [] };
  const share = (m: MaterialStats) => m.area / total;

  // A name that says paint is believed, as long as the material is a real
  // surface of the car: not a tiny swatch, and not a black placeholder
  // unless it covers enough of the car to be black paint.
  const named = materials.filter(
    (m) =>
      m.kind === null &&
      paintNameSays(m.name) === "paint" &&
      share(m) > 0.02 &&
      (luminance(m.rgb) > 0.04 || share(m) > 0.08),
  );
  if (named.length) return { how: "named", ids: named.map((m) => m.id) };

  // Opaque surfaces at body height that are not named as anything else;
  // panels are the ones that run most of the car's length.
  const surfaces = materials.filter(
    (m) =>
      m.kind === null &&
      paintNameSays(m.name) !== "other" &&
      m.opacity >= 0.95 &&
      m.height >= 0.25 &&
      m.height <= 0.8,
  );
  const panels = surfaces.filter((m) => m.span >= 0.55);
  if (!panels.length) return { how: "none", ids: [] };
  const best = panels.reduce((a, b) => (b.area > a.area ? b : a));
  // Too small to be the bodywork, or so large it is everything at once.
  if (share(best) < 0.12 || share(best) > 0.85) return { how: "none", ids: [] };
  // A texture atlas paints many parts from one image; its pieces are not panels.
  if (best.hasMap && /\b(atlas|baked?)\b/.test(nameWords(best.name))) return { how: "none", ids: [] };

  // Bodies are often split into several materials of one colour (doors,
  // bumpers, bonnet); they are all the paint. Only when the colour is one
  // the author chose: an untouched default white says nothing.
  const siblings =
    best.hasMap || isDefaultColour(best.rgb)
      ? []
      : surfaces.filter(
          (m) => m !== best && !m.hasMap && m.span >= 0.15 && colourDistance(m.rgb, best.rgb) < 0.03,
        );
  return { how: "largest", ids: [best.id, ...siblings.map((m) => m.id)] };
}
