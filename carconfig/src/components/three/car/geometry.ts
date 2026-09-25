import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BodyShape, Vec3 } from "@/lib/three/body-shape";

/**
 * Turning the body math into meshes.
 *
 * Everything here is a pure function from numbers to a BufferGeometry, built
 * once per configuration and memoised by the components. The only rule that
 * matters for how it looks: one continuous surface per part, so three.js can
 * smooth the normals across it. A car built from separate panels shows every
 * seam as a hard line under studio lighting.
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Lofting
// ---------------------------------------------------------------------------

/**
 * Join a list of rings into one surface.
 *
 * Every ring has the same number of points and they wrap around, so the
 * surface is closed in that direction. Faces are sorted into material groups
 * by `groupOf`, which receives the ring index and the point index.
 */
function loft(
  rings: readonly Vec3[][],
  groupOf: (ring: number, point: number) => number,
  groupCount: number,
): THREE.BufferGeometry {
  const m = rings[0]!.length;
  const positions = new Float32Array(rings.length * m * 3);
  let o = 0;
  for (const ring of rings) {
    for (const p of ring) {
      positions[o++] = p[0];
      positions[o++] = p[1];
      positions[o++] = p[2];
    }
  }

  const buckets: number[][] = Array.from({ length: groupCount }, () => []);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = r * m + j;
      const b = r * m + j2;
      const c = (r + 1) * m + j;
      const d = (r + 1) * m + j2;
      // Winding chosen so the normal points out of the body.
      buckets[groupOf(r, j)]!.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const index: number[] = [];
  let start = 0;
  buckets.forEach((bucket, g) => {
    index.push(...bucket);
    geometry.addGroup(start, bucket.length, g);
    start += bucket.length;
  });
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const thetas = (m: number) => Array.from({ length: m }, (_, j) => (j / m) * TAU);

/** Fractions for the domed caps, rim to apex. */
const CAP_RINGS = [0.985, 0.95, 0.9, 0.82, 0.72, 0.6, 0.46, 0.31, 0.16, 0.0];

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/** Material slots on the tub. */
export const TUB = { paint: 0, underbody: 1 } as const;
/** Material slots on the greenhouse. */
export const CABIN = { glass: 0, roof: 1, pillar: 2 } as const;

/**
 * The lower body: bonnet, flanks, arches, deck, bumpers, and the domed nose
 * and tail, as one closed surface.
 *
 * The lowest band of every section goes into the underbody slot. That is what
 * turns the inside of each wheel arch black and gives the sills a dark rocker
 * line, without cutting anything.
 */
export function buildTubGeometry(shape: BodyShape, m = 72): THREE.BufferGeometry {
  const ts = thetas(m);
  const rings: Vec3[][] = [];
  // How far each ring is from the centre of its end face: 1 along the body,
  // shrinking toward the tip of each cap.
  const fOf: number[] = [];
  const zOf: number[] = [];

  for (let k = CAP_RINGS.length - 1; k >= 1; k--) {
    const f = CAP_RINGS[k]!;
    rings.push(ts.map((t) => shape.capPoint("rear", f, t)));
    fOf.push(f);
    zOf.push(shape.zRear);
  }
  for (const z of shape.tubStations()) {
    rings.push(ts.map((t) => shape.tubPoint(z, t)));
    fOf.push(1);
    zOf.push(z);
  }
  for (let k = 1; k < CAP_RINGS.length; k++) {
    const f = CAP_RINGS[k]!;
    rings.push(ts.map((t) => shape.capPoint("front", f, t)));
    fOf.push(f);
    zOf.push(shape.zFront);
  }

  const S = shape.style;
  const unit = ts.map((t) => shape.unitSection(t + Math.PI / m, S.roundTop, S.roundBottom));
  const vOf = unit.map((p) => p.v);
  // The dark band is the underside. On the caps a point's real height on the
  // face is v·f, so the band ends in a clean lip along the bottom of each
  // bumper instead of converging on the middle of the face.
  //
  // The top of the tub under the greenhouse is the cabin floor as seen
  // through the glass, so it is dark trim too rather than painted metal.
  return loft(
    rings,
    (r, j) => {
      const f = Math.max(fOf[r]!, fOf[r + 1]!);
      if (vOf[j]! * f < -0.72) return TUB.underbody;
      const z = (zOf[r]! + zOf[r + 1]!) / 2;
      const underGlass = z > shape.zBacklight + 0.02 && z < shape.zCowl - 0.02;
      if (underGlass && vOf[j]! > 0.9 && Math.abs(unit[j]!.u) < 0.8) return TUB.underbody;
      return TUB.paint;
    },
    2,
  );
}

/**
 * The greenhouse: windshield, side glass, backlight and roof as one surface.
 *
 * The roof is the top band of the sections between the pillars; everything
 * else is glass. That produces the "floating roof" read most modern cars have,
 * and it is also why there are no separate pillars to line up.
 */
export function buildCabinGeometry(shape: BodyShape, m = 64): THREE.BufferGeometry {
  const ts = thetas(m);
  const zs = shape.cabinStations();
  const rings = zs.map((z) => ts.map((t) => shape.cabinPoint(z, t)));

  const S = shape.style;
  const unit = ts.map((t) => shape.unitSection(t + Math.PI / m, S.cabinRound, 10));
  const roofFrom = shape.zRoofRear + 0.05;
  const roofTo = shape.zRoofFront - 0.06;

  // The A-pillar is one segment wide, at the corner of the section on each
  // side (where it turns from facing forward to facing sideways). A range of
  // |u| looked like it should do the same, but on a rounded section that
  // range covers a broad sweep of the windshield.
  const mids = ts.map((t) => t + Math.PI / m);
  const nearest = (target: number) =>
    mids.reduce((best, a, j) => (Math.abs(a - target) < Math.abs(mids[best]! - target) ? j : best), 0);
  const aPillars = new Set([nearest(Math.PI / 4), nearest((3 * Math.PI) / 4)]);

  // Pillars are what stop a greenhouse reading as a glass bubble. The A-pillar
  // runs up the corner between windshield and side glass; the C-pillar is the
  // broad sail panel beside the rear window. Both come from where a face sits
  // around the section (|u|: 0 on the centreline, 1 on the side) and which
  // stretch of the greenhouse it is in.
  return loft(
    rings,
    (r, j) => {
      const z = (zs[r]! + zs[r + 1]!) / 2;
      const { u, v } = unit[j]!;
      const side = Math.abs(u);
      if (v > 0.58 && z > roofFrom && z < roofTo) return CABIN.roof;
      if (z > shape.zRoofFront - 0.02 && aPillars.has(j)) return CABIN.pillar;
      if (z < shape.zRoofRear + 0.02 && side > 0.45 && v > -0.7) return CABIN.roof;
      return CABIN.glass;
    },
    3,
  );
}

// ---------------------------------------------------------------------------
// Wheels
//
// Built with the axle along +x and the outer face pointing +x. The left-hand
// wheels are mirrored by their parent, not rebuilt.
// ---------------------------------------------------------------------------

/** Lathe profiles revolve around y; this turns that axis into x. */
function axleToX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.rotateZ(-Math.PI / 2);
  return g;
}

export interface WheelDims {
  /** Rolling radius, metres. */
  readonly outerRadius: number;
  /** Rim (bead seat) radius, metres. */
  readonly rimRadius: number;
  /** Tire section width, metres. */
  readonly tireWidth: number;
  /** Rim width, metres. */
  readonly rimWidth: number;
}

/**
 * A tire, turned on a lathe: bead, bulging sidewall, rounded shoulder, and a
 * tread with four circumferential grooves. The grooves are real geometry, so
 * they catch the studio light the way tread does.
 */
export function buildTireGeometry(d: WheelDims): THREE.BufferGeometry {
  const R = d.outerRadius;
  const r = d.rimRadius;
  const w = d.tireWidth / 2;
  const side = R - r;

  const pts: THREE.Vector2[] = [];
  const add = (radius: number, axial: number) => pts.push(new THREE.Vector2(radius, axial));

  // Inboard bead up the sidewall.
  add(r + 0.004, -w * 0.86);
  add(r + side * 0.18, -w * 0.97);
  add(r + side * 0.45, -w * 1.0);
  add(r + side * 0.75, -w * 0.97);
  add(R - 0.014, -w * 0.9);
  add(R - 0.004, -w * 0.8);

  // Tread, with grooves at ±0.52 and ±0.18 of the half-width.
  const groove = 0.007;
  const tread: [number, number][] = [
    [-0.74, 0], [-0.58, 0], [-0.56, groove], [-0.48, groove], [-0.46, 0],
    [-0.24, 0], [-0.22, groove], [-0.14, groove], [-0.12, 0],
    [0.12, 0], [0.14, groove], [0.22, groove], [0.24, 0],
    [0.46, 0], [0.48, groove], [0.56, groove], [0.58, 0], [0.74, 0],
  ];
  for (const [ax, dip] of tread) {
    // A slight crown: the centre of the tread stands proud of the edges.
    const crown = 0.004 * (1 - ax * ax);
    add(R - dip + crown, ax * w);
  }

  add(R - 0.004, w * 0.8);
  add(R - 0.014, w * 0.9);
  add(r + side * 0.75, w * 0.97);
  add(r + side * 0.45, w * 1.0);
  add(r + side * 0.18, w * 0.97);
  add(r + 0.004, w * 0.86);

  return axleToX(new THREE.LatheGeometry(pts, 96));
}

/** The rim's barrel and flange: the hoop the spokes are hung in. */
export function buildBarrelGeometry(d: WheelDims): THREE.BufferGeometry {
  const r = d.rimRadius;
  const hw = d.rimWidth / 2;
  const pts = [
    new THREE.Vector2(r + 0.012, -hw),
    new THREE.Vector2(r - 0.004, -hw + 0.01),
    new THREE.Vector2(r - 0.012, -hw + 0.03),
    new THREE.Vector2(r - 0.016, hw - 0.03),
    new THREE.Vector2(r - 0.004, hw - 0.012),
    new THREE.Vector2(r + 0.014, hw - 0.004),
    new THREE.Vector2(r + 0.016, hw + 0.004),
  ];
  return axleToX(new THREE.LatheGeometry(pts, 96));
}

/** The polished lip at the outer face. */
export function buildLipGeometry(d: WheelDims): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(d.rimRadius + 0.012, 0.0085, 12, 96);
  g.rotateY(Math.PI / 2);
  g.translate(d.rimWidth / 2 + 0.002, 0, 0);
  return g;
}

export type { SpokeStyle } from "@/lib/build/viewer-config";
import type { SpokeStyle } from "@/lib/build/viewer-config";

/** One spoke from the hub at angle a0 to the rim at angle a1, as a 2D outline. */
function spokeShape(
  a0: number,
  a1: number,
  rHub: number,
  rRim: number,
  wHub: number,
  wRim: number,
): THREE.Shape {
  const p = (radius: number, angle: number) =>
    new THREE.Vector2(radius * Math.cos(angle), radius * Math.sin(angle));
  const dh = wHub / 2 / rHub;
  const dr = wRim / 2 / rRim;
  const shape = new THREE.Shape();
  const h1 = p(rHub, a0 - dh);
  const h2 = p(rHub, a0 + dh);
  const r2 = p(rRim, a1 + dr);
  const r1 = p(rRim, a1 - dr);
  shape.moveTo(h1.x, h1.y);
  shape.lineTo(r1.x, r1.y);
  shape.lineTo(r2.x, r2.y);
  shape.lineTo(h2.x, h2.y);
  shape.closePath();
  return shape;
}

/**
 * The spoke face.
 *
 * Each style is a list of spokes described by hub angle, rim angle and width,
 * extruded with a bevel so the edges catch light. The mesh style crosses two
 * sets of angled spokes to get the lattice; the split style pairs arms that
 * meet at the hub.
 */
export function buildSpokeGeometry(style: SpokeStyle, d: WheelDims): THREE.BufferGeometry {
  const r = d.rimRadius;
  const k = r / 0.2413; // proportions tuned on a 19in wheel, scaled from there
  const rHub = 0.062 * k;
  const rRim = r - 0.006;

  const shapes: THREE.Shape[] = [];
  const step = TAU / 5;

  switch (style) {
    case "five_spoke":
      for (let i = 0; i < 5; i++) {
        shapes.push(spokeShape(i * step, i * step, rHub, rRim, 0.078 * k, 0.058 * k));
      }
      break;
    case "twin_five_spoke":
      for (let i = 0; i < 5; i++) {
        for (const e of [-1, 1]) {
          const a = i * step + e * 0.1;
          shapes.push(spokeShape(i * step + e * 0.2, a, rHub, rRim, 0.028 * k, 0.03 * k));
        }
      }
      break;
    case "split_spoke":
      for (let i = 0; i < 5; i++) {
        for (const e of [-1, 1]) {
          shapes.push(
            spokeShape(i * step + e * 0.06, i * step + e * 0.2, rHub, rRim, 0.036 * k, 0.03 * k),
          );
        }
      }
      break;
    case "ten_spoke":
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        shapes.push(spokeShape(a, a, rHub, rRim, 0.034 * k, 0.03 * k));
      }
      break;
    case "y_spoke": {
      // Five arms that fork two-thirds of the way out.
      const rFork = rHub + (rRim - rHub) * 0.55;
      for (let i = 0; i < 5; i++) {
        const a = i * step;
        shapes.push(spokeShape(a, a, rHub, rFork + 0.02, 0.07 * k, 0.056 * k));
        for (const e of [-1, 1]) {
          // Each fork starts inside the arm, so the two read as one casting.
          shapes.push(spokeShape(a + e * 0.02, a + e * 0.24, rFork - 0.02, rRim, 0.04 * k, 0.03 * k));
        }
      }
      break;
    }
    case "multi_spoke":
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU;
        shapes.push(spokeShape(a, a + 0.05, rHub, rRim, 0.014 * k, 0.018 * k));
      }
      break;
    case "deep_dish":
      // A broad flat dish round the outside, short spokes in the middle,
      // the whole face set back behind the lip.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        shapes.push(spokeShape(a, a, rHub, rRim * 0.72, 0.055 * k, 0.06 * k));
      }
      shapes.push(ringShape(rRim * 0.68, rRim));
      break;
    case "mesh":
    default:
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        for (const e of [-1, 1]) {
          shapes.push(spokeShape(a, a + e * 0.34, rHub, rRim, 0.018 * k, 0.016 * k));
        }
      }
      break;
  }

  const depth = 0.022;
  const parts = shapes.map((s) =>
    new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.0035,
      bevelSegments: 2,
      // Straight spoke edges ignore this; the dish ring needs it to stay round.
      curveSegments: 64,
    }),
  );

  // Hub disc the spokes grow out of.
  parts.push(
    new THREE.ExtrudeGeometry(
      (() => {
        const s = new THREE.Shape();
        s.absarc(0, 0, rHub + 0.01, 0, TAU, false);
        return s;
      })(),
      { depth: depth + 0.008, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 3, curveSegments: 40 },
    ),
  );

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();

  // Shape plane (x,y) becomes the wheel face; extrusion (z) becomes outboard.
  merged.rotateY(Math.PI / 2);

  // Concave: real spokes sweep inward from the rim to a hub set back behind
  // it. Pushing each point inboard by how far it is from the rim bends the
  // flat extrusion into that dish, which is most of what makes a wheel read
  // as a wheel rather than a cut-out.
  const { concave, setBack } = DISH[style] ?? DISH.five_spoke!;
  const pos = merged.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const radial = Math.hypot(pos.getY(i), pos.getZ(i));
    const t = 1 - Math.min(radial / rRim, 1);
    pos.setX(i, pos.getX(i) - concave * k * t ** 1.4);
  }
  pos.needsUpdate = true;

  merged.translate(d.rimWidth / 2 - depth - 0.028 - setBack, 0, 0);
  merged.computeVertexNormals();

  if (setBack > 0) {
    // The dish wall: a polished band from the lip down to the set-back face.
    const wall = new THREE.CylinderGeometry(rRim, rRim * 0.99, setBack + 0.012, 72, 1, true);
    wall.rotateZ(-Math.PI / 2);
    wall.translate(d.rimWidth / 2 - 0.028 - setBack / 2, 0, 0);
    const withWall = mergeGeometries([merged.toNonIndexed(), wall.toNonIndexed()], false);
    merged.dispose();
    wall.dispose();
    withWall.computeVertexNormals();
    return withWall;
  }
  return merged;
}

/** How deep each design is dished, and how far a deep-dish face is set back. Metres at 19in. */
const DISH: Partial<Record<SpokeStyle, { concave: number; setBack: number }>> = {
  five_spoke: { concave: 0.034, setBack: 0 },
  twin_five_spoke: { concave: 0.03, setBack: 0 },
  split_spoke: { concave: 0.03, setBack: 0 },
  mesh: { concave: 0.018, setBack: 0 },
  ten_spoke: { concave: 0.03, setBack: 0 },
  y_spoke: { concave: 0.036, setBack: 0 },
  multi_spoke: { concave: 0.026, setBack: 0 },
  deep_dish: { concave: 0.006, setBack: 0.04 },
};

/** A flat ring, for the face of a dish. */
function ringShape(r0: number, r1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r0, 0, TAU, true);
  s.holes.push(hole);
  return s;
}

/**
 * Lug nuts on the car's actual bolt circle. A five-lug and a six-lug car look
 * different close up, and so does 5x100 against 5x130.
 */
export function buildLugGeometry(
  d: WheelDims,
  boltCount: number,
  boltCircleMm: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (boltCount === 1) {
    // Centre lock: one big twelve-sided nut over a raised boss.
    const boss = new THREE.CylinderGeometry(0.056, 0.06, 0.016, 48);
    boss.rotateZ(-Math.PI / 2);
    boss.translate(d.rimWidth / 2 - 0.02, 0, 0);
    const nut = new THREE.CylinderGeometry(0.044, 0.048, 0.034, 12);
    nut.rotateZ(-Math.PI / 2);
    nut.translate(d.rimWidth / 2 - 0.004, 0, 0);
    const merged = mergeGeometries([boss, nut], false);
    boss.dispose();
    nut.dispose();
    return merged;
  }
  const pcd = boltCircleMm / 2000;
  for (let i = 0; i < boltCount; i++) {
    const a = (i / boltCount) * TAU + Math.PI / 2;
    const g = new THREE.CylinderGeometry(0.0095, 0.0105, 0.022, 6);
    g.rotateZ(-Math.PI / 2);
    g.translate(d.rimWidth / 2 - 0.018, pcd * Math.sin(a), pcd * Math.cos(a));
    parts.push(g);
  }
  const cap = new THREE.CylinderGeometry(0.03, 0.032, 0.014, 32);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(d.rimWidth / 2 - 0.012, 0, 0);
  parts.push(cap);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** A brake disc with its hat, sat inboard of the spokes. */
export function buildDiscGeometry(rotorMm: number, d: WheelDims): THREE.BufferGeometry {
  const rr = rotorMm / 2000;
  const disc = new THREE.CylinderGeometry(rr, rr, 0.028, 64, 1);
  disc.rotateZ(-Math.PI / 2);
  const hat = new THREE.CylinderGeometry(rr * 0.52, rr * 0.52, 0.05, 48, 1);
  hat.rotateZ(-Math.PI / 2);
  hat.translate(0.02, 0, 0);
  const merged = mergeGeometries([disc, hat], false);
  disc.dispose();
  hat.dispose();
  merged.translate(d.rimWidth / 2 - 0.1, 0, 0);
  return merged;
}

/**
 * A caliper that wraps the disc edge, sized from the rotor and the piston
 * count. A six-piston kit is visibly longer than a single-piston stock
 * caliper, which is most of what makes a brake upgrade readable at a glance.
 */
export function buildCaliperGeometry(
  rotorMm: number,
  pistons: number,
  d: WheelDims,
): THREE.BufferGeometry {
  const rr = rotorMm / 2000;
  const span = 0.62 + 0.07 * Math.min(Math.max(pistons, 1), 6); // radians
  const inner = rr - 0.052;
  const outer = rr + 0.02;
  const centre = 0.25; // just above horizontal, toward the back of the car

  const s = new THREE.Shape();
  s.absarc(0, 0, outer, centre - span / 2, centre + span / 2, false);
  s.absarc(0, 0, inner, centre + span / 2, centre - span / 2, true);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.07 + 0.006 * pistons,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 3,
    curveSegments: 24,
  });
  g.rotateY(Math.PI / 2);
  g.translate(d.rimWidth / 2 - 0.135, 0, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Surface patches
// ---------------------------------------------------------------------------

/**
 * Walk from the flank round onto an end cap as one continuous parameter.
 *
 * s < 0 is on the body side, |s| metres back from where the cap starts;
 * s in [0, 1] runs across the cap from its rim (0) to its centre (1). That lets
 * one patch describe a headlight that starts on the wing and wraps round onto
 * the nose, which is how real headlights are shaped.
 */
export function endSurface(
  shape: BodyShape,
  end: "front" | "rear",
): (s: number, theta: number) => Vec3 {
  return (s, theta) => {
    if (s < 0) {
      const z = end === "front" ? shape.zBodyFront + s : shape.zBodyRear - s;
      return shape.tubPoint(z, theta);
    }
    return shape.capPoint(end, Math.max(0, 1 - s), theta);
  };
}

/**
 * A thin skin lying on a parametric surface, lifted a few millimetres along
 * its normal. Lights, grilles and trim are made this way, so they follow the
 * body exactly instead of floating in front of it.
 */
export function buildSurfacePatch(
  surface: (a: number, b: number) => Vec3,
  aRange: readonly [number, number],
  bRange: readonly [number, number],
  segments: readonly [number, number] = [18, 14],
  lift = 0.0025,
): THREE.BufferGeometry {
  const [na, nb] = segments;
  const positions: number[] = [];
  const uvs: number[] = [];

  const at = (a: number, b: number): Vec3 => {
    const p = surface(a, b);
    // Normal by finite differences; the sign is fixed by pointing away from
    // the car's centreline, which is always outward for a closed body.
    const e = 1e-3;
    const pa = surface(a + e, b);
    const pb = surface(a, b + e);
    let n: Vec3 = [
      (pa[1] - p[1]) * (pb[2] - p[2]) - (pa[2] - p[2]) * (pb[1] - p[1]),
      (pa[2] - p[2]) * (pb[0] - p[0]) - (pa[0] - p[0]) * (pb[2] - p[2]),
      (pa[0] - p[0]) * (pb[1] - p[1]) - (pa[1] - p[1]) * (pb[0] - p[0]),
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const out = n[0] * p[0] + n[1] * (p[1] - 0.5) + n[2] * p[2];
    const sgn = out < 0 ? -1 : 1;
    return [p[0] + n[0] * lift * sgn, p[1] + n[1] * lift * sgn, p[2] + n[2] * lift * sgn];
  };

  for (let i = 0; i <= na; i++) {
    const a = aRange[0] + ((aRange[1] - aRange[0]) * i) / na;
    for (let j = 0; j <= nb; j++) {
      const b = bRange[0] + ((bRange[1] - bRange[0]) * j) / nb;
      const p = at(a, b);
      positions.push(p[0], p[1], p[2]);
      uvs.push(i / na, j / nb);
    }
  }

  const index: number[] = [];
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const a = i * (nb + 1) + j;
      const b = a + 1;
      const c = a + (nb + 1);
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
