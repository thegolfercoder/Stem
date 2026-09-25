import type { BodyProfile } from "@/types/vehicle";
import { BODY_STYLES, type StylePreset } from "./body-styles";

/**
 * The parametric car body, as pure math.
 *
 * A body is a loft: a run of rounded cross-sections along the car's length,
 * joined into one smooth surface. Each cross-section is a superellipse — the
 * rounded-rectangle family that sits between an ellipse and a box — whose
 * width, floor and roof come from curves along the car. The wheel arches are
 * not cut out afterwards; the floor of the section simply rides up over each
 * wheel, which leaves a clean semicircular opening in side view for free.
 *
 * This file has no three.js in it on purpose. It answers "where is the body at
 * this point along the car" and nothing else, which is what makes the shape
 * testable: that the arches clear the tires, that the car is the length it
 * claims to be, that the cabin sits on the body rather than through it.
 *
 * Axes: x across the car (right is +), y up, z along it (front is +).
 * The body is centred on its own length, so z = 0 is half-way along.
 */

export type Vec3 = readonly [number, number, number];

export interface BodyShapeInput {
  readonly style: BodyProfile;
  /** Metres. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly wheelbase: number;
  /** Stock rolling radius at each axle, metres. The arches are cut around these. */
  readonly frontTireRadius: number;
  readonly rearTireRadius: number;
  /** Per-model adjustments to the style's proportions. */
  readonly overrides?: Partial<StylePreset>;
}

export interface Section {
  /** Half-width at the widest point of this section. */
  readonly hw: number;
  readonly yBottom: number;
  readonly yTop: number;
}

export interface Arch {
  readonly z: number;
  readonly y: number;
  readonly r: number;
}

export interface BodyShape {
  readonly input: BodyShapeInput;
  readonly style: StylePreset;

  readonly zFront: number;
  readonly zRear: number;
  readonly zFrontAxle: number;
  readonly zRearAxle: number;
  /** Where the lofted body ends and the domed caps begin. */
  readonly zBodyFront: number;
  readonly zBodyRear: number;

  /** Greenhouse landmarks: windshield base, roof front, roof rear, backlight base. */
  readonly zCowl: number;
  readonly zRoofFront: number;
  readonly zRoofRear: number;
  readonly zBacklight: number;

  readonly arches: readonly [Arch, Arch];

  tubSection(z: number): Section;
  /** A point on the body side at station z, angle theta around the section. */
  tubPoint(z: number, theta: number): Vec3;
  /** A point on a domed end cap: f = 1 at the cap's rim, 0 at its centre. */
  capPoint(end: "front" | "rear", f: number, theta: number): Vec3;
  /**
   * The point on an end face at normalised face coordinates: xn = −1..1
   * across the face, vn = −1..1 from its bottom to its top. The exact inverse
   * of capPoint, so a grille described as a rectangle lands on the surface
   * rather than floating in front of it.
   */
  facePoint(end: "front" | "rear", xn: number, vn: number): Vec3;

  cabinSection(z: number): { yBottom: number; yTop: number; hwBottom: number; hwTop: number };
  cabinPoint(z: number, theta: number): Vec3;

  /** Height of the body's top surface along the centreline — for mounting things on it. */
  topAt(z: number): number;
  /** Height of the roof along the centreline, or null outside the greenhouse. */
  roofAt(z: number): number | null;

  /** Station positions for the lofted tub, including a clean edge at each arch. */
  tubStations(step?: number): number[];
  cabinStations(step?: number): number[];

  /** The superellipse's unit coordinates for a section angle, split top/bottom. */
  unitSection(theta: number, nTop: number, nBottom: number): { u: number; v: number };
}

// ---------------------------------------------------------------------------
// Curve helpers
// ---------------------------------------------------------------------------

/**
 * Monotone piecewise-cubic interpolation (Fritsch–Carlson).
 *
 * Chosen over an ordinary spline because it never overshoots: a spline through
 * a hood that rises to a windshield will happily bulge above the windshield
 * base first, and a car with a dent in its bonnet is the kind of thing people
 * notice before they notice anything else.
 */
export function pchip(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0]!;

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    d.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }

  const m: number[] = new Array(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1]!;
    const b = d[i]!;
    if (a * b <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / a + w2 / b);
    }
  }

  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / h[i]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h[i]! * m[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h[i]! * m[i + 1]!
    );
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed power, the core of the superellipse. */
const spow = (x: number, p: number) => Math.sign(x) * Math.abs(x) ** p;

/** Strictly-increasing control points, dropping any that would fold back. */
function monotone(points: [number, number][]): [number[], number[]] {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of sorted) {
    if (xs.length && x - xs[xs.length - 1]! < 0.02) continue;
    xs.push(x);
    ys.push(y);
  }
  return [xs, ys];
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** Clearance between a stock tire and its arch, metres. */
export const ARCH_GAP = 0.035;

/** Depth of the shoulder line, as a fraction of half-width. */
const CREASE = 0.011;

/**
 * How far a leaned end cap reaches past its rim. The push is largest on the
 * face's vertical centreline — moving off it only takes a point nearer the
 * rim — so the maximum of √(1 − v²)·(depth − lean·v) over v is the answer.
 */
function capReach(depth: number, lean: number): number {
  let best = 0;
  for (let i = 0; i <= 400; i++) {
    const v = -1 + i / 200;
    best = Math.max(best, Math.sqrt(Math.max(0, 1 - v * v)) * Math.max(depth - lean * v, 0.005));
  }
  return best;
}

export function createBodyShape(input: BodyShapeInput): BodyShape {
  const S: StylePreset = { ...BODY_STYLES[input.style], ...input.overrides };
  const L = input.length;
  const W = input.width;
  const H = input.height;
  const WB = Math.min(input.wheelbase, L * 0.8);

  const zFront = L / 2;
  const zRear = -L / 2;
  const overhang = L - WB;
  const zFrontAxle = zFront - overhang * S.frontOverhangShare;
  const zRearAxle = zFrontAxle - WB;

  // The cap's furthest point, so a leaned face still ends exactly at the
  // bumper: a chin that pushes out past the car's published length would
  // make it longer than it is.
  const zBodyFront = zFront - capReach(S.capFront, S.leanFront);
  const zBodyRear = zRear + capReach(S.capRear, S.leanRear);

  const arches: [Arch, Arch] = [
    { z: zFrontAxle, y: input.frontTireRadius, r: input.frontTireRadius + ARCH_GAP },
    { z: zRearAxle, y: input.rearTireRadius, r: input.rearTireRadius + ARCH_GAP },
  ];
  const archTop = Math.max(arches[0].y + arches[0].r, arches[1].y + arches[1].r);

  // --- greenhouse landmarks -------------------------------------------------
  const zCowl = zFrontAxle - S.cowl * WB;
  const zRoofFront = zCowl - S.windshieldRun;
  const zRoofRear = zRoofFront - S.roof * WB;
  const zBacklight = Math.max(zRoofRear - S.backlightRun, zBodyRear + 0.12);

  // --- heights --------------------------------------------------------------
  // Every height is kept above the arches: a hood that dips into its own wheel
  // well is the easiest way for a generated car to look wrong.
  const belt = Math.max(S.belt * H, archTop + 0.12);
  const nose = Math.max(S.nose * H, arches[0].y + arches[0].r + 0.09);
  const cowl = belt - 0.02;
  const hood = Math.max(lerp(nose, cowl, 0.55), arches[0].y + arches[0].r + 0.1);
  const deck = Math.max(S.deck * H, arches[1].y + arches[1].r + 0.1);
  const tail = Math.max(S.tail * H, arches[1].y + arches[1].r + 0.08);

  // --- tub top (bonnet, beltline, deck) --------------------------------------
  const topPoints: [number, number][] = [
    [zRear, tail - 0.03],
    [zBodyRear + 0.1, tail],
    [zBacklight, deck],
    [lerp(zBacklight, zCowl, 0.5), belt + 0.01],
    [zCowl, cowl],
    [zFrontAxle, hood],
    [zBodyFront - 0.22, nose + 0.005],
    [zBodyFront, nose - 0.03],
    [zFront, nose - 0.07],
  ];
  // A car with a real trunk has a deck behind the backlight; give it one.
  if (zBacklight - zBodyRear > 0.45) {
    topPoints.push([lerp(zBodyRear, zBacklight, 0.45), deck - 0.005]);
  }
  const [tx, ty] = monotone(topPoints);
  const topCurve = pchip(tx, ty);

  // How far the centreline sits below the wing tops at z. Nothing under the
  // greenhouse; it fades in ahead of the windshield and behind the backlight.
  const peakFront = S.fenderPeakFront ?? 0;
  const peakRear = S.fenderPeakRear ?? 0;
  const dipAt = (z: number) =>
    peakFront * smoothstep(zCowl, zCowl + 0.3, z) +
    peakRear * smoothstep(zBacklight, zBacklight - 0.3, z);

  // --- floor, lifting toward the ends ----------------------------------------
  const floorAt = (z: number) => {
    const frontLift = S.liftFront * smoothstep(arches[0].z + arches[0].r, zFront, z);
    const rearLift = S.liftRear * smoothstep(arches[1].z - arches[1].r, zRear, z);
    let y = S.clearance + frontLift + rearLift;

    // Over each wheel the floor rides up to the arch: a semicircle above the
    // axle, and straight down below it. That is what an arch looks like.
    for (const a of arches) {
      const dz = z - a.z;
      if (Math.abs(dz) < a.r) {
        y = Math.max(y, a.y + Math.sqrt(a.r * a.r - dz * dz));
      }
    }
    return y;
  };

  // --- plan view: haunches and rounded ends ----------------------------------
  const halfWidthAt = (z: number) => {
    // W is the car's widest point, which is the haunch with the shoulder
    // crease on top of it; the base width is what is left once both are added.
    const flare = S.flareFront ?? S.hips * 0.8;
    let hw = W / 2 / (1 + CREASE) - Math.max(S.hips, flare);
    hw += S.hips * Math.exp(-(((z - zRearAxle) / 0.6) ** 2));
    hw += flare * Math.exp(-(((z - zFrontAxle) / 0.55) ** 2));

    const frontStart = zBodyFront - S.taperFront;
    if (z > frontStart) {
      const t = clamp((z - frontStart) / S.taperFront, 0, 1);
      hw *= S.noseRatio + (1 - S.noseRatio) * (1 - t ** 3) ** (1 / 3);
    }
    const rearStart = zBodyRear + S.taperRear;
    if (z < rearStart) {
      const t = clamp((rearStart - z) / S.taperRear, 0, 1);
      hw *= S.tailRatio + (1 - S.tailRatio) * (1 - t ** 3) ** (1 / 3);
    }
    return hw;
  };

  const tubSection = (z: number): Section => {
    const yBottom = floorAt(z);
    const yTop = Math.max(topCurve(z), yBottom + 0.06);
    return { hw: halfWidthAt(z), yBottom, yTop };
  };

  const unitSection = (theta: number, nTop: number, nBottom: number) => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const n = s >= 0 ? nTop : nBottom;
    return { u: spow(c, 2 / n), v: spow(s, 2 / n) };
  };

  const tubPoint = (z: number, theta: number): Vec3 => {
    const sec = tubSection(z);
    const { u, v } = unitSection(theta, S.roundTop, S.roundBottom);
    const yc = (sec.yTop + sec.yBottom) / 2;
    const b = (sec.yTop - sec.yBottom) / 2;
    // The top of the section rolls in a little: shoulders, not a box.
    const roll = 1 - S.shoulderRoll * Math.max(v, 0) ** 2;
    // A shoulder line: a millimetre-scale ridge along the flank that catches
    // the studio's side strip as a single bright line. It is most of what
    // makes a smooth loft read as pressed metal.
    const crease = 1 + CREASE * Math.exp(-(((v - 0.4) / 0.06) ** 2));
    // Raised wings: the top of the section sags toward the middle, leaving
    // the outer edges as peaks. Zero at the sides, full depth on the centreline.
    const sag = v > 0 ? dipAt(z) * (1 - u * u) ** 2 * v * v : 0;
    return [sec.hw * u * roll * crease, yc + b * v - sag, z];
  };

  /**
   * The domed caps close each end of the loft. They continue the same
   * section inward toward its own centre while pushing forward, so the
   * surface flows from side to nose without a crease — which is also what
   * lets the body share one set of smooth normals end to end.
   */
  const capPoint = (end: "front" | "rear", f: number, theta: number): Vec3 => {
    const zEdge = end === "front" ? zBodyFront : zBodyRear;
    const [x, y] = tubPoint(zEdge, theta);
    const sec = tubSection(zEdge);
    const yc = (sec.yTop + sec.yBottom) / 2;
    const b = (sec.yTop - sec.yBottom) / 2;
    const yf = yc + (y - yc) * f;
    const push = capPush(end, f, (yf - yc) / (b || 1));
    return [x * f, yf, zEdge + (end === "front" ? push : -push)];
  };

  /**
   * How far forward (or back) of the cap's rim a point on the face sits.
   *
   * A dome, leaned: points high on the face push out less and points low push
   * out more, so the top recedes and the chin comes forward. Both terms go to
   * zero at the rim, which is what keeps the cap welded to the flank.
   */
  const capPush = (end: "front" | "rear", f: number, vn: number) => {
    const depth = end === "front" ? S.capFront : S.capRear;
    const lean = end === "front" ? S.leanFront : S.leanRear;
    return Math.sqrt(Math.max(0, 1 - f * f)) * Math.max(depth - lean * vn, 0.005);
  };

  /**
   * Each end cap is the edge section scaled toward its centre, so every point
   * on the face lies on a ray from the centre at some fraction f of the way to
   * the edge. Tabulating the edge's radius against polar angle turns "where on
   * the face is (x, y)" into a lookup.
   */
  const edgeTables = new Map<"front" | "rear", { phis: number[]; radii: number[]; yc: number; hw: number; b: number }>();
  const edgeTable = (end: "front" | "rear") => {
    const cached = edgeTables.get(end);
    if (cached) return cached;
    const zEdge = end === "front" ? zBodyFront : zBodyRear;
    const sec = tubSection(zEdge);
    const yc = (sec.yTop + sec.yBottom) / 2;
    const samples: [number, number][] = [];
    const n = 720;
    for (let i = 0; i < n; i++) {
      const [x, y] = tubPoint(zEdge, (i / n) * Math.PI * 2);
      samples.push([Math.atan2(y - yc, x), Math.hypot(x, y - yc)]);
    }
    samples.sort((a, b) => a[0] - b[0]);
    const table = {
      phis: samples.map((p) => p[0]),
      radii: samples.map((p) => p[1]),
      yc,
      hw: sec.hw,
      b: (sec.yTop - sec.yBottom) / 2,
    };
    edgeTables.set(end, table);
    return table;
  };

  const facePoint = (end: "front" | "rear", xn: number, vn: number): Vec3 => {
    const t = edgeTable(end);
    const x = xn * t.hw;
    const dy = vn * t.b;
    const phi = Math.atan2(dy, x);
    const r = Math.hypot(x, dy);

    // Edge radius at this angle, by interpolation in the sorted table.
    const { phis, radii } = t;
    let lo = 0;
    let hi = phis.length - 1;
    if (phi <= phis[0]! || phi >= phis[hi]!) {
      lo = hi;
      hi = 0;
    } else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (phis[mid]! <= phi) lo = mid;
        else hi = mid;
      }
    }
    const span = hi === 0 ? phis[0]! + Math.PI * 2 - phis[lo]! : phis[hi]! - phis[lo]!;
    const into = hi === 0 ? (phi < phis[0]! ? phi + Math.PI * 2 : phi) - phis[lo]! : phi - phis[lo]!;
    const k = span > 0 ? into / span : 0;
    const edge = radii[lo]! + (radii[hi]! - radii[lo]!) * k;

    const f = Math.min(r / (edge || 1), 1);
    const zEdge = end === "front" ? zBodyFront : zBodyRear;
    const push = capPush(end, f, vn);
    return [x, t.yc + dy, zEdge + (end === "front" ? push : -push)];
  };

  // --- greenhouse -------------------------------------------------------------
  const roofH = H;
  const cabinTopCurve = (() => {
    const baseRear = topCurve(zBacklight) - 0.03;
    const baseFront = topCurve(zCowl) - 0.03;
    const roofMid = lerp(zRoofRear, zRoofFront, 0.55);
    const [xs, ys] = monotone([
      [zBacklight, baseRear],
      [zRoofRear, roofH - 0.035],
      [roofMid, roofH],
      [zRoofFront, roofH - 0.02],
      [zCowl, baseFront],
    ]);
    return pchip(xs, ys);
  })();

  // An upright tailgate's pillars rise nearly flush from the body sides; a
  // raked rear window sits inside a broad shoulder all the way back. So the
  // greenhouse's inset from the body fades toward the rear by how upright the
  // rear glass is.
  const rake = clamp((S.backlightRun - 0.15) / 0.6, 0, 1);
  const shoulderAt = (z: number) =>
    S.shoulder * (1 - (1 - rake) * 0.6 * smoothstep(zRoofFront, zBacklight, z));

  const cabinSection = (z: number) => {
    const yBottom = topCurve(z) - 0.03;
    const yTop = Math.max(cabinTopCurve(z), yBottom);
    const hwBottom = Math.max(halfWidthAt(z) - shoulderAt(z), 0.2);
    return { yBottom, yTop, hwBottom, hwTop: hwBottom * (1 - S.tumblehome) };
  };

  const cabinPoint = (z: number, theta: number): Vec3 => {
    const sec = cabinSection(z);
    // Flat underneath — it sits on the body — and rounded over the top.
    const { u, v } = unitSection(theta, S.cabinRound, 10);
    const yc = (sec.yTop + sec.yBottom) / 2;
    const b = (sec.yTop - sec.yBottom) / 2;
    const hw = lerp(sec.hwBottom, sec.hwTop, (v + 1) / 2);
    return [hw * u, yc + b * v, z];
  };

  // --- stations ---------------------------------------------------------------
  const tubStations = (step = 0.03) => {
    const zs = new Set<number>();
    for (let z = zBodyRear; z < zBodyFront; z += step) zs.add(+z.toFixed(4));
    zs.add(zBodyFront);
    // Put stations right at each arch's edges, so the drop from arch to sill
    // is a crisp vertical edge rather than a slope between two samples.
    for (const a of arches) {
      for (const e of [-1, 1]) {
        zs.add(+(a.z + e * (a.r - 0.001)).toFixed(4));
        zs.add(+(a.z + e * (a.r + 0.001)).toFixed(4));
      }
      for (let k = -8; k <= 8; k++) zs.add(+(a.z + (k / 8) * a.r * 0.98).toFixed(4));
    }
    return [...zs].filter((z) => z >= zBodyRear && z <= zBodyFront).sort((a, b) => a - b);
  };

  const cabinStations = (step = 0.025) => {
    const zs: number[] = [];
    for (let z = zBacklight; z < zCowl; z += step) zs.push(z);
    zs.push(zCowl);
    return zs;
  };

  const topAt = (z: number) => {
    if (z >= zBacklight && z <= zCowl) return cabinTopCurve(z);
    return topCurve(z) - dipAt(z);
  };

  const roofAt = (z: number) =>
    z >= zBacklight && z <= zCowl ? cabinTopCurve(z) : null;

  return {
    input,
    style: S,
    zFront,
    zRear,
    zFrontAxle,
    zRearAxle,
    zBodyFront,
    zBodyRear,
    zCowl,
    zRoofFront,
    zRoofRear,
    zBacklight,
    arches,
    tubSection,
    tubPoint,
    capPoint,
    facePoint,
    cabinSection,
    cabinPoint,
    topAt,
    roofAt,
    tubStations,
    cabinStations,
    unitSection,
  };
}

/**
 * Surface normal by finite differences on a parametric surface.
 *
 * Used to orient things that sit on the body — lights, mirrors, badges — so
 * they face out of the surface they are stuck to rather than straight ahead.
 */
export function surfaceNormal(
  f: (a: number, b: number) => Vec3,
  a: number,
  b: number,
  eps = 1e-3,
): Vec3 {
  const p = f(a, b);
  const pa = f(a + eps, b);
  const pb = f(a, b + eps);
  const da: Vec3 = [pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]];
  const db: Vec3 = [pb[0] - p[0], pb[1] - p[1], pb[2] - p[2]];
  const n: Vec3 = [
    da[1] * db[2] - da[2] * db[1],
    da[2] * db[0] - da[0] * db[2],
    da[0] * db[1] - da[1] * db[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}
