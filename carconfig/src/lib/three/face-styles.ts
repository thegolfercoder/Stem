import type { BodyProfile } from "@/types/vehicle";

/**
 * Faces.
 *
 * Proportions say what kind of car something is; the face says whose. A
 * kidney grille or seven vertical slots is how a person recognises a make
 * from across a car park, long before the silhouette. So each make maps to a
 * face family — the grille, the headlight shape and angle, the intakes and the
 * tail lamps — and the body underneath stays the same generated shape.
 *
 * These are stylised signatures, not reproductions: no logos, no trade dress
 * beyond the broad shape anyone would sketch. That keeps them honest (the
 * canvas already says the bodywork is stylised) and keeps them ours.
 *
 * Every patch is a rounded rectangle in normalised face coordinates: (cx, cy)
 * is its centre and (a, b) its half-size, with −1..1 spanning the end face.
 * `n` is how square it is (2 is an ellipse, 8 is nearly a rectangle) and
 * `rot` tilts it, in radians, on the right-hand side of the car; the mirrored
 * copy tilts the other way.
 */

export interface FaceSpec {
  readonly end: "front" | "rear";
  readonly cx: number;
  readonly cy: number;
  readonly a: number;
  readonly b: number;
  readonly n: number;
  readonly rot?: number;
  /** How far the patch stands off the surface, metres. Later layers stand further. */
  readonly lift?: number;
}

export type FaceFamily =
  | "kidney"
  | "singleframe"
  | "spindle"
  | "star"
  | "wide_mouth"
  | "slot"
  | "frunk"
  | "round_eye"
  | "seven_slot"
  | "pantheon"
  | "big_rect";

export interface FaceDesign {
  readonly headlights: readonly FaceSpec[];
  /** Daytime running lights: the bright signature line. */
  readonly drl: readonly FaceSpec[];
  /** Small lens elements inside the headlights. */
  readonly projectors: readonly FaceSpec[];
  /** Bright-finish surround drawn under the grille, if the make has one. */
  readonly surround: readonly FaceSpec[];
  readonly grille: readonly FaceSpec[];
  readonly intakes: readonly FaceSpec[];
  readonly taillights: readonly FaceSpec[];
  /** The thin lit bar across the tail, if there is one. */
  readonly lightBar: readonly FaceSpec[];
}

/** A patch and its mirror image across the centreline. */
const pair = (s: FaceSpec): FaceSpec[] => [s, { ...s, cx: -s.cx, rot: s.rot ? -s.rot : undefined }];

const F = (cx: number, cy: number, a: number, b: number, n: number, extra: Partial<FaceSpec> = {}): FaceSpec => ({
  end: "front",
  cx,
  cy,
  a,
  b,
  n,
  ...extra,
});
const R = (cx: number, cy: number, a: number, b: number, n: number, extra: Partial<FaceSpec> = {}): FaceSpec => ({
  end: "rear",
  cx,
  cy,
  a,
  b,
  n,
  ...extra,
});

// --- shared pieces ------------------------------------------------------------

/** The modern default: a slim lamp high on the corner, tilted up at its outer end. */
const slimHead = (cy = 0.4, a = 0.24, b = 0.085, rot = 0.1) => ({
  headlights: pair(F(0.66, cy, a, b, 4.5, { rot })),
  drl: pair(F(0.66, cy - b * 0.55, a * 0.86, 0.014, 8, { rot, lift: 0.005 })),
  projectors: [
    ...pair(F(0.6, cy + 0.01, 0.035, 0.035, 2, { lift: 0.005 })),
    ...pair(F(0.72, cy + 0.02, 0.035, 0.035, 2, { lift: 0.005 })),
  ],
});

const roundHead = (cx = 0.66, cy = 0.36, r = 0.15) => ({
  headlights: pair(F(cx, cy, r * 0.82, r, 2.2)),
  // A ring is drawn as a thin crescent under the lamp; enough to catch the eye.
  drl: pair(F(cx, cy - r * 0.62, r * 0.55, 0.012, 3, { lift: 0.005 })),
  projectors: pair(F(cx, cy + 0.02, r * 0.32, r * 0.38, 2, { lift: 0.005 })),
});

const splitTails = (cy = 0.44, a = 0.24, b = 0.075, rot = -0.06): Pick<FaceDesign, "taillights" | "lightBar"> => ({
  taillights: pair(R(0.68, cy, a, b, 5, { rot })),
  lightBar: [],
});

const barTails = (cy = 0.46): Pick<FaceDesign, "taillights" | "lightBar"> => ({
  taillights: pair(R(0.7, cy, 0.2, 0.06, 6)),
  lightBar: [R(0, cy, 0.62, 0.016, 10, { lift: 0.004 })],
});

// Kept above vn ≈ −0.55: below that the face curls under into the chin and a
// patch there reads as a hole in the floor rather than an opening.
const lowerIntakes = (cy = -0.36, a = 0.5, b = 0.16): FaceSpec[] => [
  F(0, cy, a, b, 5),
  ...pair(F(0.8, cy + 0.06, 0.1, 0.16, 3.5)),
];

// --- families -----------------------------------------------------------------

const FACES: Record<FaceFamily, FaceDesign> = {
  // Two tall rounded kidneys between the lamps.
  kidney: {
    ...slimHead(0.38, 0.23, 0.07, 0.12),
    surround: pair(F(0.13, 0.1, 0.105, 0.3, 3.6, { lift: 0.003 })),
    grille: pair(F(0.13, 0.1, 0.088, 0.28, 3.6, { lift: 0.005 })),
    intakes: lowerIntakes(-0.4, 0.46, 0.12),
    ...splitTails(0.44, 0.24, 0.07, -0.1),
  },
  // One large octagon from the bonnet line into the bumper.
  singleframe: {
    ...slimHead(0.4, 0.25, 0.065, 0.14),
    surround: [F(0, 0.0, 0.35, 0.42, 2.8, { lift: 0.003 })],
    grille: [F(0, 0.0, 0.33, 0.4, 2.8, { lift: 0.005 })],
    intakes: pair(F(0.72, -0.36, 0.14, 0.17, 3)),
    ...barTails(0.44),
  },
  // An hourglass: narrow at the top, flaring into the bumper.
  spindle: {
    ...slimHead(0.4, 0.23, 0.07, 0.18),
    surround: [],
    grille: [F(0, 0.22, 0.2, 0.18, 3.5, { lift: 0.005 }), F(0, -0.24, 0.4, 0.34, 3, { lift: 0.005 })],
    intakes: pair(F(0.78, -0.4, 0.09, 0.14, 3)),
    ...barTails(0.46),
  },
  // A wide, shallow grille between the lamps.
  star: {
    ...slimHead(0.38, 0.24, 0.07, 0.08),
    surround: [F(0, 0.2, 0.36, 0.17, 5, { lift: 0.003 })],
    grille: [F(0, 0.2, 0.34, 0.15, 5, { lift: 0.005 })],
    intakes: lowerIntakes(-0.44, 0.48, 0.15),
    ...splitTails(0.44, 0.25, 0.08, -0.04),
  },
  // A big open mouth low in the nose: sports cars and Mazdas.
  wide_mouth: {
    ...slimHead(0.42, 0.24, 0.07, 0.16),
    surround: [],
    grille: [F(0, -0.12, 0.44, 0.3, 3.6, { lift: 0.005 })],
    intakes: pair(F(0.8, -0.34, 0.09, 0.16, 3)),
    ...splitTails(0.46, 0.22, 0.07, -0.08),
  },
  // The common modern face: a thin slot joining the lamps, the opening below.
  slot: {
    ...slimHead(0.4, 0.25, 0.075, 0.08),
    surround: [],
    grille: [F(0, 0.34, 0.36, 0.05, 8, { lift: 0.005 })],
    intakes: lowerIntakes(-0.36, 0.52, 0.2),
    ...splitTails(),
  },
  // No grille at all; the air goes in low. Rear-engined or electric.
  frunk: {
    ...slimHead(0.42, 0.22, 0.08, 0.06),
    surround: [],
    grille: [],
    intakes: [F(0, -0.46, 0.26, 0.12, 4), ...pair(F(0.66, -0.42, 0.18, 0.15, 3.5))],
    ...barTails(0.46),
  },
  // Round lamps and a hexagonal mouth.
  round_eye: {
    ...roundHead(0.64, 0.38, 0.16),
    surround: [],
    grille: [F(0, -0.1, 0.36, 0.26, 2.6, { lift: 0.005 })],
    intakes: pair(F(0.78, -0.42, 0.08, 0.1, 2.5)),
    ...splitTails(0.44, 0.18, 0.1, 0),
  },
  // Round lamps either side of seven tall slots.
  seven_slot: {
    ...roundHead(0.7, 0.3, 0.17),
    surround: [],
    grille: [-3, -2, -1, 0, 1, 2, 3].map((i) => F(i * 0.075, 0.26, 0.022, 0.2, 6, { lift: 0.005 })),
    intakes: lowerIntakes(-0.46, 0.42, 0.12),
    ...splitTails(0.4, 0.1, 0.16, 0),
  },
  // A tall, upright temple front.
  pantheon: {
    ...slimHead(0.4, 0.22, 0.08, 0.02),
    surround: [F(0, 0.14, 0.23, 0.36, 9, { lift: 0.003 })],
    grille: [F(0, 0.14, 0.2, 0.33, 9, { lift: 0.005 })],
    intakes: pair(F(0.72, -0.44, 0.16, 0.08, 6)),
    ...splitTails(0.42, 0.14, 0.16, 0),
  },
  // Trucks: a big rectangular grille filling the space between the lamps.
  big_rect: {
    ...slimHead(0.34, 0.2, 0.11, 0),
    surround: [F(0, 0.12, 0.46, 0.34, 7, { lift: 0.003 })],
    grille: [F(0, 0.12, 0.43, 0.31, 7, { lift: 0.005 })],
    intakes: [F(0, -0.52, 0.5, 0.09, 6)],
    ...splitTails(0.3, 0.1, 0.24, 0),
  },
};

const MAKE_FACES: Readonly<Record<string, FaceFamily>> = {
  bmw: "kidney",
  audi: "singleframe",
  lexus: "spindle",
  "mercedes-benz": "star",
  genesis: "star",
  maserati: "star",
  mazda: "wide_mouth",
  ferrari: "wide_mouth",
  "aston-martin": "wide_mouth",
  lotus: "wide_mouth",
  mclaren: "wide_mouth",
  lamborghini: "wide_mouth",
  "alfa-romeo": "wide_mouth",
  porsche: "frunk",
  tesla: "frunk",
  polestar: "frunk",
  rivian: "round_eye",
  mini: "round_eye",
  fiat: "round_eye",
  smart: "round_eye",
  jeep: "seven_slot",
  "rolls-royce": "pantheon",
  bentley: "pantheon",
};

/** Makes whose trucks and big SUVs wear the big rectangular grille. */
const TRUCK_MAKES = new Set(["ford", "chevrolet", "gmc", "ram", "dodge", "toyota", "nissan", "hummer", "lincoln", "cadillac"]);

export function faceFamilyFor(makeSlug: string, style: BodyProfile): FaceFamily {
  const mapped = MAKE_FACES[makeSlug];
  if (mapped) return mapped;
  if (style === "truck" || (style === "suv" && TRUCK_MAKES.has(makeSlug))) return "big_rect";
  return "slot";
}

export function faceDesign(family: FaceFamily): FaceDesign {
  return FACES[family];
}

export const FACE_FAMILIES = Object.keys(FACES) as FaceFamily[];
