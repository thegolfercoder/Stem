// Finding the parts of a car a buyer would configure: paint, glass, lamps,
// the four wheels and what they are made of, calipers, trim, carbon, mirror
// caps, spoiler and exhaust. Everything is detected from the model itself;
// anything not found with confidence is reported missing, and the option is
// not offered.
import * as THREE from "three";
import {
  kindOf, label, nodeLabel, nameWords, materialsOf, paintNameSays,
  LAMP_RE, REAR_LAMP_RE, LAMP_EXCLUDE_RE, WHEEL_RE, WHEEL_EXCLUDE_RE, INTERIOR_RE, PART,
} from "./names.js";
import { survey, slotKey } from "./visibility.js";

const box3 = (o) => new THREE.Box3().setFromObject(o);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ------------------------------------------------------------------ paint

/**
 * Area, height and length of every material, measured in world space. Large
 * models are sampled, so this stays fast on a million triangles.
 */
export function materialStats(root) {
  root.updateMatrixWorld(true);
  const box = box3(root);
  const size = box.getSize(new THREE.Vector3());
  const acc = new Map();
  let triangles = 0;
  root.traverse((o) => {
    if (o.isMesh) triangles += (o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3;
  });
  const step = Math.max(1, Math.floor(triangles / 150000));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry, pos = g.attributes.position;
    if (!pos) return;
    const index = g.index, count = index ? index.count : pos.count, mats = materialsOf(o);
    const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0];
      if (!m) continue;
      let e = acc.get(m);
      if (!e) acc.set(m, (e = { area: 0, h: 0, lo: Infinity, hi: -Infinity }));
      const end = Math.min(grp.start + grp.count, count);
      for (let i = grp.start; i + 2 < end; i += 3 * step) {
        a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
        const area = 0.5 * ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * step;
        e.area += area;
        e.h += (area * ((a.y + b.y + c.y) / 3 - box.min.y)) / (size.y || 1);
        e.lo = Math.min(e.lo, a.z, b.z, c.z);
        e.hi = Math.max(e.hi, a.z, b.z, c.z);
      }
    }
  });
  const materials = [...acc.keys()];
  const stats = materials.map((m, id) => {
    const e = acc.get(m);
    return {
      id,
      name: m.name,
      kind: kindOf(m.name),
      rgb: m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1],
      opacity: m.transparent ? m.opacity : 1,
      hasMap: Boolean(m.map),
      area: e.area,
      span: e.area > 0 ? (e.hi - e.lo) / (size.z || 1) : 0,
      height: e.area > 0 ? e.h / e.area : 0,
    };
  });
  return { materials, stats };
}

/**
 * Which materials are the body paint: those named as paint, or else the
 * surface that makes up most of the outside of the car and runs most of its
 * length at body height, plus any plain materials of exactly the same colour.
 * "Most of the outside" is the share of what the views see (`vis`) when the
 * car has been surveyed, and the share of area otherwise. Materials marked
 * `window` fill the window line, and are never paint.
 */
export function choosePaint(stats) {
  const total = stats.reduce((s, m) => s + m.area, 0);
  if (total <= 0) return { how: "none", ids: [] };
  const share = (m) => m.area / total;
  const seen = (m) => m.vis ?? share(m);
  const visible = (m, least) => m.vis === undefined || m.vis >= least;
  const usable = (m) => m.kind === null && !m.window;
  const named = stats.filter((m) => usable(m) && paintNameSays(m.name) === "paint" && share(m) > 0.02 && (lum(m.rgb) > 0.04 || share(m) > 0.08) && visible(m, 0.01));
  if (named.length) return { how: "named", ids: named.map((m) => m.id) };
  const surfaces = stats.filter((m) => usable(m) && paintNameSays(m.name) !== "other" && m.opacity >= 0.95 && m.height >= 0.25 && m.height <= 0.8);
  const panels = surfaces.filter((m) => m.span >= 0.55);
  if (!panels.length) return { how: "none", ids: [] };
  const best = panels.reduce((x, y) => (seen(y) > seen(x) ? y : x));
  if (seen(best) < 0.12 || share(best) > 0.85) return { how: "none", ids: [] };
  if (best.hasMap && /\b(atlas|baked?)\b/.test(nameWords(best.name))) return { how: "none", ids: [] };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const isDefault = (c) => [1, 0.8].some((v) => c.every((x) => Math.abs(x - v) < 1e-3));
  // Plain materials of the same colour are the same paint. A strongly coloured
  // body is sometimes split into many shades of one hue (exports that bake
  // shading into colours); those count too.
  const hsl = (c) => new THREE.Color(c[0], c[1], c[2]).getHSL({});
  const b = hsl(best.rgb);
  const hueGap = (x, y) => Math.min(Math.abs(x - y), 1 - Math.abs(x - y));
  const sameHue = (m) => {
    if (b.s < 0.3) return false;
    const c = hsl(m.rgb);
    return c.s > 0.25 && hueGap(c.h, b.h) < 0.035 && Math.abs(c.l - b.l) < 0.25;
  };
  const siblings = best.hasMap || isDefault(best.rgb) ? [] : surfaces.filter((m) => m !== best && !m.hasMap && visible(m, 0.002) && (m.span >= 0.15 || share(m) > 0.01) && (dist(m.rgb, best.rgb) < 0.03 || sameHue(m)));
  return { how: "largest", ids: [best.id, ...siblings.map((m) => m.id)] };
}

// ---------------------------------------------------------------- windows

/**
 * Window-line figures (see visibility.js) of the windows. From the side: most
 * of the part lies in the window line, fills a good part of its height where
 * it appears (trim strips and pillars do not), runs along much of the car,
 * and makes up a real share of the line. From the front or back, the same
 * for the windscreen and rear window, which span the car's width.
 */
export const WINDOW = { inBand: 0.7, reach: 0.3, bandShare: 0.1, cover: 0.28 };
export const WINDOW_ENDS = { inBand: 0.6, reach: 0.6, bandShare: 0.15, cover: 0.35 };
/** A single part or piece, judged without the rest of its material, has to fill a line more clearly. */
export const WINDOW_PART = { inBand: 0.85, reach: 0.2, bandShare: 0.03, cover: 0.4 };
export const WINDOW_ENDS_PART = { inBand: 0.75, reach: 0.5, bandShare: 0.08, cover: 0.35 };

/** Windows meet the roof and lean out from it; what is seen through an empty window frame sits behind it. */
export const ROOF_GAP = 0.08;

export const fillsWindowLine = (band, t = WINDOW) =>
  Boolean(band) && band.inBand >= t.inBand && band.reach >= t.reach && band.bandShare >= t.bandShare && band.cover >= t.cover && band.behind <= ROOF_GAP;

/** A part (or piece) that is a window on its own: it fills a window line and lies above the doors. */
const windowOnItsOwn = (x, low, H) =>
  low >= 0.35 * H && (fillsWindowLine(x.band, WINDOW_PART) || fillsWindowLine(x.ends, WINDOW_ENDS_PART));

/**
 * The windows. Parts named as glass come first; when they do not fill the
 * window line (lamp glass only, or nothing named at all), the window lines
 * themselves are read: a whole material whose parts fill a line, with the
 * other windows that share it; or single parts that fill a line on their own
 * and lie above the doors.
 */
export function findGlass(root, sv, { inWheel, both }) {
  const named = slotsWhere(root, (m) => kindOf(m.name) === "glass");
  const bandOf = (slots) => slots.reduce((s, x) => s + (sv.slot(x.mesh, x.index)?.band?.band ?? 0), 0) / (sv.bandTotal || 1);
  if (bandOf(named) >= WINDOW.bandShare) return named.map((s) => ({ ...s, how: "named" }));

  const { box } = sv;
  const H = box.max.y - box.min.y, W = box.max.x - box.min.x;
  const boxes = new Map();
  const boxOf = (mesh) => boxes.get(mesh) ?? boxes.set(mesh, box3(mesh)).get(mesh);
  const usable = (m, mesh) => {
    if (inWheel(mesh) || kindOf(m.name) !== null || paintNameSays(m.name) === "paint") return false;
    const l = both(m, mesh);
    return !LAMP_RE.test(l) && !INTERIOR_RE.test(l);
  };
  const chosen = new Map(named.map((s) => [slotKey(s.mesh, s.index), { ...s, how: "named" }]));
  const add = (s, how) => chosen.has(slotKey(s.mesh, s.index)) || chosen.set(slotKey(s.mesh, s.index), { ...s, how });

  // A part of a window material is a window when it is in a window line, or
  // spans the car high up (a glass roof).
  const windowPlace = (mesh, index) => {
    const b = boxOf(mesh), x = sv.slot(mesh, index);
    if (b.max.y - box.min.y < 0.5 * H) return false;
    const inLine = (band, reach) => band && band.inBand >= 0.5 && band.reach >= reach && band.cover >= 0.25 && band.behind <= ROOF_GAP;
    if (inLine(x?.band, 0.1) || inLine(x?.ends, 0.3)) return true;
    const across = b.min.x < -0.25 * W && b.max.x > 0.25 * W;
    return across && b.min.y - box.min.y >= 0.35 * H && b.max.y - box.min.y >= 0.75 * H;
  };
  for (const [m, x] of sv.materials) {
    if (!fillsWindowLine(x.band, WINDOW) && !fillsWindowLine(x.ends, WINDOW_ENDS)) continue;
    for (const s of slotsWhere(root, (mm, mesh, index) => mm === m && usable(mm, mesh) && windowPlace(mesh, index))) add(s, "window line");
  }
  for (const s of sv.slots.values()) {
    if (!usable(s.material, s.mesh) || !windowOnItsOwn(s, boxOf(s.mesh).min.y - box.min.y, H)) continue;
    add({ mesh: s.mesh, index: s.index, original: s.material }, "window part");
  }
  return [...chosen.values()];
}

/**
 * The material that makes up most of the outside, when paint could not be
 * chosen by material: a clay model, or a body material also used for the
 * cabin, wheels or windows. Its parts are then read piece by piece.
 */
export function shellMaterial(sv) {
  let best = null;
  for (const [m, x] of sv.materials) {
    const kind = kindOf(m.name);
    // A tyre material cannot make up most of a car's outside: such a name is wrong.
    if (kind && !(kind === "tyre" && x.vis > 0.5)) continue;
    if (!best || x.vis > best.vis) best = { material: m, vis: x.vis };
  }
  if (!best || best.vis < 0.3) return { material: null, reason: "no material makes up the outside" };
  // A texture that colours the whole car (an atlas, a scan) holds the lamps,
  // grille and badges too: painting over it would wipe them out.
  if (best.material.map) return { material: null, reason: "the body colour comes from a texture" };
  return { material: best.material, reason: null };
}

/**
 * Boxes around the tyres among the given pieces: round, upright, standing on
 * the ground at the car's sides. Used to keep tyres (and the rims inside
 * them) out of the paint when the wheels were not found as parts.
 */
export function tyreZones(pieces, box) {
  const W = box.max.x - box.min.x, H = box.max.y - box.min.y;
  const zones = [];
  for (const p of pieces) {
    const s = p.box.getSize(new THREE.Vector3()), c = p.box.getCenter(new THREE.Vector3());
    const round = s.y > 0.42 && s.y < 1.3 && Math.abs(s.z - s.y) / s.y < 0.22 && s.x > 0.06 && s.x < s.y * 0.7;
    if (!round || p.box.min.y - box.min.y > Math.max(0.08, 0.05 * H) || Math.abs(c.x) < W * 0.2) continue;
    const zone = p.box.clone();
    zone.min.x -= 0.12;
    zone.max.x += 0.12;
    zones.push(zone.expandByScalar(0.03));
  }
  return zones;
}

/** What a piece of a mesh becomes when the mesh is split. */
export const PIECE = { rest: 0, paint: 1, glass: 2, fl: 3, fr: 4, rl: 5, rr: 6 };
const PIECE_CORNERS = ["fl", "fr", "rl", "rr"];

/**
 * Decides, piece by piece, what parts of mixed slots are: `role` is "paint"
 * (a body material whose meshes also hold the rims), "glass" (a window
 * material whose meshes also hold trim) or "shell" (anything: the body, the
 * windows, the rims and the cabin in one material). Pieces inside a wheel
 * belong to that wheel (inside a tyre found among the pieces, when the wheels
 * were not found, they are left alone); windows fill a window line on their
 * own; the rest of a shell is paint where it is seen from outside.
 */
export function classifyPieces(pieces, roleOf, { wheels, box }) {
  const H = box.max.y - box.min.y;
  const zones = wheels
    ? wheels.map((w) => ({ cls: PIECE[w.corner], box: w.box.clone().expandByScalar(0.03) }))
    : tyreZones(pieces, box).map((z) => ({ cls: PIECE.rest, box: z }));
  const out = new Int8Array(pieces.length);
  for (const p of pieces) {
    const role = roleOf(p);
    const zone = zones.find((z) => z.box.containsBox(p.box));
    const isWindow = windowOnItsOwn(p, p.box.min.y - box.min.y, H);
    let c = PIECE.rest;
    if (role === "paint") c = zone ? zone.cls : PIECE.paint;
    else if (role === "glass") c = isWindow ? PIECE.glass : PIECE.rest;
    else if (role === "shell") c = zone ? zone.cls : isWindow ? PIECE.glass : p.vis > 0 ? PIECE.paint : PIECE.rest;
    out[p.id] = c;
  }
  return out;
}

/**
 * Splits a mesh into one mesh per class of its triangles (`classes[k]` for
 * its k-th triangle), copying each triangle's raw attribute values. The new
 * meshes take the old one's place, transform and materials, and keep the
 * groups of a multi-material mesh. Returns the new meshes by class, or null
 * when the mesh is all one class or cannot be split.
 */
export function splitMesh(mesh, classes, nameOf = (c) => `${mesh.name} ${c}`) {
  const src = mesh.geometry;
  if (!mesh.parent || mesh.isSkinnedMesh || Object.keys(src.morphAttributes).length) return null;
  const tris = classes.length;
  const byClass = new Map();
  for (let k = 0; k < tris; k++) {
    let list = byClass.get(classes[k]);
    if (!list) byClass.set(classes[k], (list = []));
    list.push(k);
  }
  if (byClass.size < 2) return null;
  const multi = Array.isArray(mesh.material) && src.groups.length > 0;
  const materialOf = new Int32Array(tris);
  if (multi) for (const grp of src.groups) for (let k = grp.start / 3; k < Math.min(tris, (grp.start + grp.count) / 3); k++) materialOf[k] = grp.materialIndex ?? 0;
  const g = src.index ? src.toNonIndexed() : src;
  const out = new Map();
  for (const [c, list] of byClass) {
    if (multi) list.sort((a, b) => materialOf[a] - materialOf[b] || a - b);
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const inter = attr.isInterleavedBufferAttribute, from = inter ? attr.data.array : attr.array;
      const stride = inter ? attr.data.stride : attr.itemSize, offset = inter ? attr.offset : 0, size = attr.itemSize;
      const to = new from.constructor(list.length * 3 * size);
      let w = 0;
      for (const k of list) {
        for (let v = 0; v < 3; v++) {
          const base = (k * 3 + v) * stride + offset;
          for (let i = 0; i < size; i++) to[w++] = from[base + i];
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(to, size, attr.normalized));
    }
    if (multi) {
      let start = 0;
      for (let i = 1; i <= list.length; i++) {
        if (i < list.length && materialOf[list[i]] === materialOf[list[start]]) continue;
        geo.addGroup(start * 3, (i - start) * 3, materialOf[list[start]]);
        start = i;
      }
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const piece = new THREE.Mesh(geo, mesh.material);
    piece.name = nameOf(c);
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    piece.visible = mesh.visible;
    mesh.parent.add(piece);
    out.set(c, piece);
  }
  mesh.removeFromParent();
  if (g !== src) g.dispose();
  src.dispose();
  return out;
}

// ----------------------------------------------------------------- wheels

const CORNERS = ["fl", "fr", "rl", "rr"];
/** Corner of a point: the car's nose is +z and its left side is +x. */
const cornerKey = (c) => `${c.z > 0 ? "f" : "r"}${c.x > 0 ? "l" : "r"}`;
/** Quadrant index (x > 0 is left, z > 0 is front) to corner. */
const QUADRANT = ["rr", "rl", "fr", "fl"];
const quadrantOf = (x, z) => (x > 0 ? 1 : 0) | (z > 0 ? 2 : 0);

/**
 * Materials too common to be the tyres or rims, whatever they are called. A
 * model whose whole body uses a material named "tire" must not be read as
 * all wheel.
 */
export function dominantMaterials(root, limit = 0.35) {
  const { materials, stats } = materialStats(root);
  const total = stats.reduce((s, m) => s + m.area, 0) || 1;
  return new Set(materials.filter((m, i) => stats[i].area / total > limit));
}

/**
 * Checks that four wheel boxes are a believable set: one per corner, round,
 * on two axles, symmetric left to right, alike in size, and far enough apart.
 */
export function wheelSetIsSane(boxes, carLength, carWidth, { sizeRatio = 1.3 } = {}) {
  if (!boxes.every(Boolean)) return false;
  const s = boxes.map((b) => b.getSize(new THREE.Vector3()));
  const c = boxes.map((b) => b.getCenter(new THREE.Vector3()));
  const [fl, fr, rl, rr] = c;
  const round = s.every((x) => x.y / 2 > 0.2 && x.y / 2 < 0.65 && Math.abs(x.z - x.y) / x.y < 0.32);
  const corners = fl.x > 0 && fl.z > 0 && fr.x < 0 && fr.z > 0 && rl.x > 0 && rl.z < 0 && rr.x < 0 && rr.z < 0;
  const axles = Math.abs(fl.z - fr.z) < 0.08 * carLength && Math.abs(rl.z - rr.z) < 0.08 * carLength;
  const wheelbase = (fl.z + fr.z) / 2 - (rl.z + rr.z) / 2 > 0.4 * carLength;
  const symmetric = Math.abs(fl.x + fr.x) < 0.12 * carWidth && Math.abs(rl.x + rr.x) < 0.12 * carWidth;
  const d = s.map((x) => x.y);
  const alike = Math.max(...d) / Math.min(...d) < sizeRatio;
  return round && corners && axles && wheelbase && symmetric && alike;
}

function sane(groups, carLength, carWidth, options) {
  const found = CORNERS.map((k) => groups.get(k));
  if (!found.every(Boolean)) return null;
  return wheelSetIsSane(found.map((g) => g.box), carLength, carWidth, options) ? found.map((g, i) => ({ ...g, corner: CORNERS[i] })) : null;
}

/** Which quadrant each triangle of a mesh sits in, by its centre in world space. */
function triangleQuadrants(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  if (!pos) return null;
  const index = g.index;
  const tris = Math.floor((index ? index.count : pos.count) / 3);
  const quad = new Uint8Array(tris);
  const boxes = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
  const counts = [0, 0, 0, 0];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let t = 0; t < tris; t++) {
    const i = t * 3;
    a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    const q = quadrantOf((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
    quad[t] = q;
    counts[q]++;
    boxes[q].expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  return { quad, boxes, counts, tris };
}

/**
 * Splits a mesh that holds the wheels of two or more corners into one mesh per
 * corner. Returns the pieces by corner, or null when the mesh is already in
 * one corner.
 */
export function splitAcrossCorners(mesh, known = triangleQuadrants(mesh)) {
  if (Array.isArray(mesh.material) || !known) return null;
  const pieces = splitMesh(mesh, known.quad, (q) => `${mesh.name} ${QUADRANT[q]}`);
  return pieces && new Map([...pieces].map(([q, piece]) => [QUADRANT[q], piece]));
}

const isWheelPart = (o, dominant) => {
  const named = `${nodeLabel(o)} ${materialsOf(o).filter((m) => m && !dominant.has(m)).map((m) => nameWords(m.name)).join(" ")}`;
  return WHEEL_RE.test(named) && !WHEEL_EXCLUDE_RE.test(label(o));
};

function meshesOf(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}

/** The four wheels from their names, splitting meshes that hold more than one. */
export function wheelsByName(root, carLength, dominant = new Set()) {
  const whole = box3(root);
  const width = whole.max.x - whole.min.x;
  for (const o of meshesOf(root)) {
    if (!isWheelPart(o, dominant)) continue;
    const b = box3(o), bs = b.getSize(new THREE.Vector3()), bc = b.getCenter(new THREE.Vector3());
    if (bs.y > 1.3 || bc.y > 0.75) continue;
    const acrossX = b.min.x < 0 && b.max.x > 0 && bs.x > 0.6;
    const acrossZ = b.min.z < 0 && b.max.z > 0 && bs.z > carLength * 0.4;
    if (acrossX || acrossZ) splitAcrossCorners(o);
  }
  root.updateMatrixWorld(true);
  const groups = new Map();
  let tangled = false;
  for (const o of meshesOf(root)) {
    if (!isWheelPart(o, dominant)) continue;
    const b = box3(o), bs = b.getSize(new THREE.Vector3()), bc = b.getCenter(new THREE.Vector3());
    if (bs.y > 1.3 || bc.y > 0.75) continue;
    if ((b.min.x < 0 && b.max.x > 0 && bs.x > 0.6) || (b.min.z < 0 && b.max.z > 0 && bs.z > carLength * 0.4)) tangled = true;
    if (Math.abs(bc.x) < 0.15) continue;
    const key = cornerKey(bc), g = groups.get(key);
    if (g) {
      g.box.union(b);
      g.meshes.push(o);
    } else groups.set(key, { box: b, meshes: [o] });
  }
  return tangled ? null : sane(absorbInside(root, groups), carLength, width, { sizeRatio: 1.5 });
}

/**
 * Adds unnamed parts that sit wholly inside a wheel (a rim called "Object_12",
 * a hub cap) to that wheel, so the wheel moves and is finished as one piece.
 * Parts that hold pieces of several wheels at once (four rims in one mesh) are
 * split first, when every piece lies inside its own wheel.
 */
function absorbInside(root, groups, margin = 0.01) {
  const taken = new Set([...groups.values()].flatMap((g) => g.meshes));
  const zones = new Map([...groups].map(([k, g]) => [k, g.box.clone().expandByScalar(margin)]));
  for (const o of meshesOf(root)) {
    if (taken.has(o)) continue;
    const b = box3(o);
    const corner = [...zones].find(([, zone]) => zone.containsBox(b))?.[0];
    if (corner) {
      groups.get(corner).meshes.push(o);
      taken.add(o);
      continue;
    }
    // A mesh reaching into two or more wheels and nowhere else.
    if (Array.isArray(o.material) || ![...zones.values()].some((z) => z.intersectsBox(b))) continue;
    const known = triangleQuadrants(o);
    if (!known) continue;
    const used = known.counts.map((n, q) => (n ? q : -1)).filter((q) => q >= 0);
    if (used.length < 2 || !used.every((q) => zones.get(QUADRANT[q])?.containsBox(known.boxes[q]))) continue;
    const pieces = splitAcrossCorners(o, known);
    for (const [corner, piece] of pieces ?? []) {
      groups.get(corner).meshes.push(piece);
      taken.add(piece);
    }
  }
  return groups;
}

/**
 * The four wheels from their shape: a round, upright part at each corner that
 * touches the ground. Meshes holding several wheels (an axle's two tyres, or
 * all four) are examined corner by corner and split when that finds them.
 */
export function wheelsByShape(root) {
  root.updateMatrixWorld(true);
  const whole = box3(root);
  const W = whole.max.x - whole.min.x, L = whole.max.z - whole.min.z, H = whole.max.y - whole.min.y;
  const ground = whole.min.y;
  const tyreLike = (b) => {
    const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    return (
      s.y > 0.42 && s.y < 1.3 &&
      Math.abs(s.z - s.y) / s.y < 0.22 &&
      s.x < s.y * 0.7 && s.x > 0.06 &&
      b.min.y - ground < Math.max(0.08, 0.05 * H) &&
      Math.abs(c.x) > W * 0.2
    );
  };
  const best = new Map();
  const consider = (corner, mesh, box, known) => {
    const prev = best.get(corner);
    const h = box.max.y - box.min.y;
    if (!prev || h > prev.box.max.y - prev.box.min.y) best.set(corner, { mesh, box, known });
  };
  for (const o of meshesOf(root)) {
    const b = box3(o);
    if (b.min.y - ground > Math.max(0.08, 0.05 * H) || b.max.y - ground > 0.8 * H) continue;
    if (tyreLike(b)) {
      consider(cornerKey(b.getCenter(new THREE.Vector3())), o, b, null);
      continue;
    }
    // Wide or long low meshes may hold several tyres.
    if (Array.isArray(o.material) || (b.max.x - b.min.x < 0.6 && b.max.z - b.min.z < 0.4 * L)) continue;
    const known = triangleQuadrants(o);
    if (!known) continue;
    known.boxes.forEach((qb, q) => {
      if (known.counts[q] && tyreLike(qb)) consider(QUADRANT[q], o, qb, known);
    });
  }
  if (CORNERS.some((k) => !best.has(k))) return null;
  if (!wheelSetIsSane(CORNERS.map((k) => best.get(k).box), L, W)) return null;

  // Split the meshes the tyres were found in, and collect each wheel.
  const groups = new Map();
  const split = new Map();
  for (const corner of CORNERS) {
    const { mesh, box, known } = best.get(corner);
    let tyre = mesh;
    if (known) {
      if (!split.has(mesh)) split.set(mesh, splitAcrossCorners(mesh, known));
      tyre = split.get(mesh)?.get(corner);
      if (!tyre) return null;
    }
    const zone = box.clone();
    zone.min.x -= 0.12;
    zone.max.x += 0.12;
    groups.set(corner, { box: zone, meshes: [tyre], tyreMesh: tyre, tyreBox: box });
  }
  root.updateMatrixWorld(true);
  absorbInside(root, groups);
  for (const g of groups.values()) {
    g.box = new THREE.Box3();
    g.meshes.forEach((m) => g.box.expandByObject(m));
  }
  return sane(groups, L, W);
}

// ------------------------------------------------------------------ slots

/** One place a material is used: a mesh, and which of its materials. */
function slotsWhere(root, test) {
  const slots = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    materialsOf(o).forEach((m, i) => {
      const index = Array.isArray(o.material) ? i : null;
      if (m && test(m, o, index)) slots.push({ mesh: o, index, original: m });
    });
  });
  return slots;
}

const centreOf = (o) => box3(o).getCenter(new THREE.Vector3());

/** Triangles of a mesh's own material groups that were not read piece by piece. */
const UNTOUCHED = 7;
const CLASS_NAMES = ["rest", "paint", "glass", ...PIECE_CORNERS, "kept"];

/**
 * Splits the meshes of the given slots by the classes of their pieces.
 * Returns the new meshes by old mesh and class; `uniform` holds, for meshes
 * left whole because they are all one class, that class.
 */
function splitByPieces(slots, pieceOf, classes) {
  const perMesh = new Map();
  for (const s of slots) {
    for (const part of s.parts) {
      let cls = perMesh.get(part.mesh);
      if (!cls) {
        const g = part.mesh.geometry;
        cls = new Int8Array(Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3)).fill(UNTOUCHED);
        perMesh.set(part.mesh, cls);
      }
      for (let k = 0; k < part.count; k++) cls[part.local + k] = classes[pieceOf[part.first + k]];
    }
  }
  const moved = new Map();
  moved.uniform = new Map();
  for (const [mesh, cls] of perMesh) {
    const out = splitMesh(mesh, cls, (c) => `${mesh.name} ${CLASS_NAMES[c]}`);
    if (out) moved.set(mesh, out);
    else moved.uniform.set(mesh, cls[0]);
  }
  return moved;
}

/**
 * Looks at a normalised car (nose +z, on y = 0) and reports what it has.
 * `wheels` is the result of wheelsByName / wheelsByShape, already found.
 */
export function detectParts(root, wheels) {
  const { materials, stats } = materialStats(root);
  const area = new Map(materials.map((m, i) => [m, stats[i].area]));
  const wheelMeshes = new Set(wheels ? wheels.flatMap((w) => w.meshes) : []);
  const inWheel = (mesh) => wheelMeshes.has(mesh);
  const words = (m) => nameWords(m.name);
  const both = (m, mesh) => `${nodeLabel(mesh)} ${words(m)}`;

  // What is seen from outside, and what fills the window lines.
  const sv = survey(root);
  const H = sv.box.max.y - sv.box.min.y;
  const boxes = new Map();
  const boxOf = (mesh) => boxes.get(mesh) ?? boxes.set(mesh, box3(mesh)).get(mesh);
  let glass = findGlass(root, sv, { inWheel, both });
  const keyOf = (s) => slotKey(s.mesh, s.index);
  const glassKeys = new Set(glass.map(keyOf));
  let inside = null;
  const insideOnly = (mesh, index) => (inside ??= sv.throughGlass(glassKeys)).has(slotKey(mesh, index));

  materials.forEach((m, i) => {
    const x = sv.material(m);
    stats[i].vis = x?.vis ?? 0;
    stats[i].window = fillsWindowLine(x?.band) || fillsWindowLine(x?.ends, WINDOW_ENDS);
  });
  const choice = choosePaint(stats);
  const paintMats = new Set(choice.ids.map((i) => materials[i]));
  let paintHow = choice.how;
  let paintNote = null;
  let paint = slotsWhere(root, (m, mesh, index) => paintMats.has(m) && !inWheel(mesh) && !glassKeys.has(slotKey(mesh, index)) && !insideOnly(mesh, index));

  // Mixed parts are read piece by piece: paint meshes that also hold the rims,
  // window meshes that also hold trim and, when no material is the paint on
  // its own, every part of the material that makes up the outside.
  const roles = new Map();
  const wheelBoxes = (wheels ?? []).map((w) => w.box);
  const nearGround = (mesh) => boxOf(mesh).min.y - sv.box.min.y < Math.max(0.08, 0.05 * H);
  for (const s of paint) if (wheels ? wheelBoxes.some((b) => b.intersectsBox(boxOf(s.mesh))) : nearGround(s.mesh)) roles.set(keyOf(s), "paint");
  for (const s of glass) if (s.how !== "named" && boxOf(s.mesh).min.y - sv.box.min.y < 0.35 * H) roles.set(keyOf(s), "glass");
  const found = paint.length ? null : shellMaterial(sv);
  const shell = found?.material;
  if (shell) for (const s of sv.slots.values()) if (s.material === shell && !inWheel(s.mesh) && !glassKeys.has(s.key)) roles.set(s.key, "shell");
  if (found) paintNote = found.reason;
  if (roles.size) {
    let chosen = [...roles.keys()].map((k) => sv.slots.get(k)).filter(Boolean);
    const { pieceOf, pieces } = sv.pieces(chosen);
    const classes = classifyPieces(pieces, (p) => roles.get(p.slotKey), { wheels, box: sv.box });
    if (shell) {
      // The shell is only paint when its windows are parts of their own, its
      // outer parts are a real share of the car, and they leave the window line.
      const own = pieces.filter((p) => roles.get(p.slotKey) === "shell");
      const outer = own.filter((p) => classes[p.id] === PIECE.paint);
      const seen = outer.reduce((n, p) => n + p.vis, 0);
      const band = outer.reduce((n, p) => n + (p.band?.band ?? 0), 0) / (sv.bandTotal || 1);
      const windows = glass.length + own.filter((p) => classes[p.id] === PIECE.glass).length;
      paintNote = !windows ? "windows not separate" : seen < 0.25 ? "outer parts too small" : band > 0.8 ? "windows part of the body" : null;
      if (paintNote) {
        for (const [k, role] of roles) if (role === "shell") roles.delete(k);
        chosen = chosen.filter((s) => roles.has(s.key));
      }
    }
    const moved = splitByPieces(chosen, pieceOf, classes);
    const placed = (cls) => {
      const out = [];
      for (const s of chosen) for (const part of s.parts) {
        const split = moved.get(part.mesh);
        const mesh = split ? split.get(cls) : moved.uniform.get(part.mesh) === cls ? part.mesh : null;
        if (mesh && !out.some((x) => x.mesh === mesh && x.index === part.index)) out.push({ mesh, index: part.index, original: part.material });
      }
      return out;
    };
    // Slots outside the pieces keep their roles, on whatever mesh now holds them.
    const kept = (s) => {
      if (roles.has(keyOf(s))) return [];
      const split = moved.get(s.mesh);
      if (!split) return [s];
      const mesh = split.get(UNTOUCHED);
      return mesh ? [{ ...s, mesh }] : [];
    };
    glass = [...glass.flatMap(kept), ...placed(PIECE.glass).map((s) => ({ ...s, how: "piece" }))];
    paint = [...paint.flatMap(kept), ...placed(PIECE.paint)];
    if (shell && !paintNote && paint.length) paintHow = "shell";
    for (const w of wheels ?? []) for (const s of placed(PIECE[w.corner])) if (!w.meshes.includes(s.mesh)) w.meshes.push(s.mesh);
  }
  if (!paint.length) paintHow = "none";
  else paintNote = null;
  wheelMeshes.clear();
  for (const w of wheels ?? []) for (const m of w.meshes) wheelMeshes.add(m);
  const finalGlass = new Set(glass.map(keyOf));
  const paintKeys = new Set(paint.map(keyOf));
  const isPaint = (mesh, index) => paintKeys.has(slotKey(mesh, index));
  const isGlass = (mesh, index) => finalGlass.has(slotKey(mesh, index));
  const lenses = slotsWhere(root, (m) => kindOf(m.name) === "lens");

  // Lamps: anything named as a light that is not paint, interior, or a switch.
  const lamps = slotsWhere(root, (m, mesh, index) => {
    if (isPaint(mesh, index) || inWheel(mesh)) return false;
    const l = both(m, mesh);
    return LAMP_RE.test(l) && !LAMP_EXCLUDE_RE.test(l);
  }).map((s) => {
    const c = centreOf(s.mesh);
    const rear = c.z < 0 || REAR_LAMP_RE.test(both(s.original, s.mesh));
    return { ...s, rear, centre: c };
  });

  // Wheels, part by part.
  const tyres = [], rims = [], calipers = [], discs = [];
  if (wheels) {
    for (const w of wheels) {
      const here = slotsWhere({ traverse: (fn) => w.meshes.forEach(fn) }, () => true);
      const named = { tyre: [], rim: [], caliper: [], disc: [], other: [] };
      for (const s of here) {
        const l = both(s.original, s.mesh);
        const kind = kindOf(s.original.name);
        if (kind === "glass" || kind === "lens") named.other.push(s);
        else if (PART.caliper.test(l)) named.caliper.push(s);
        else if (PART.disc.test(l)) named.disc.push(s);
        else if (kind === "tyre" || PART.tyre.test(words(s.original))) named.tyre.push(s);
        else if (PART.lug.test(words(s.original))) named.other.push(s);
        else if (PART.rim.test(l)) named.rim.push(s);
        else named.other.push(s);
      }
      // A tyre found by shape: the round outer part, if its material is dark.
      if (!named.tyre.length && w.tyreMesh) {
        const t = here.filter((s) => s.mesh === w.tyreMesh && s.original.color && lum([s.original.color.r, s.original.color.g, s.original.color.b]) < 0.08);
        named.tyre.push(...t);
        named.rim = named.rim.filter((s) => !t.includes(s));
        named.other = named.other.filter((s) => !t.includes(s));
      }
      // Rims are only offered when they are separate from the tyre.
      const tyreMats = new Set(named.tyre.map((s) => s.original));
      let rimSlots = named.rim.filter((s) => !tyreMats.has(s.original));
      if (!rimSlots.length && named.tyre.length) {
        // Unnamed rim: the largest remaining metal-looking material in the wheel.
        const rest = named.other.filter((s) => !tyreMats.has(s.original) && (s.original.metalness ?? 0) >= 0.3);
        const biggest = rest.reduce((best, s) => ((area.get(s.original) ?? 0) > (area.get(best?.original) ?? -1) ? s : best), null);
        if (biggest) rimSlots = rest.filter((s) => s.original === biggest.original);
      }
      if (!named.tyre.length) rimSlots = [];
      tyres.push(...named.tyre);
      rims.push(...rimSlots.map((s) => ({ ...s, corner: w.corner })));
      calipers.push(...named.caliper.map((s) => ({ ...s, corner: w.corner })));
      discs.push(...named.disc);
    }
  }
  // Calipers are sometimes modelled apart from the wheels, attached to the body.
  const caliperSet = new Set(calipers.map((s) => s.mesh));
  calipers.push(...slotsWhere(root, (m, mesh, index) => !caliperSet.has(mesh) && !isPaint(mesh, index) && PART.caliper.test(both(m, mesh)) && centreOf(mesh).y < 0.75));

  const excluded = (m, mesh, index) => isPaint(mesh, index) || isGlass(mesh, index) || inWheel(mesh) || kindOf(m.name) === "glass" || kindOf(m.name) === "lens" || LAMP_RE.test(words(m));
  const carbon = slotsWhere(root, (m, mesh) => !inWheel(mesh) && kindOf(m.name) === "carbon");
  const trim = slotsWhere(root, (m, mesh, index) => !excluded(m, mesh, index) && !PART.mirrorGlass.test(both(m, mesh)) && (kindOf(m.name) === "chrome" || /\b(trim|window ?surround|beltline)\b/.test(words(m))));

  const mirrors = slotsWhere(root, (m, mesh, index) => {
    const l = nodeLabel(mesh);
    if (!PART.mirror.test(l) || PART.mirrorGlass.test(both(m, mesh)) || /\b(interior|inside|rear ?view|rearview)\b/.test(l)) return false;
    if (kindOf(m.name) === "glass" || kindOf(m.name) === "chrome" || (m.metalness >= 0.9 && m.roughness <= 0.1)) return false;
    return isPaint(mesh, index) || /\b(caps?|covers?|housing|shell|body)\b/.test(both(m, mesh));
  });

  const spoiler = slotsWhere(root, (m, mesh) => {
    const l = nodeLabel(mesh);
    if (!PART.spoiler.test(l) || PART.spoilerExclude.test(l)) return false;
    if (kindOf(m.name) === "glass" || kindOf(m.name) === "lens" || LAMP_RE.test(words(m))) return false;
    return centreOf(mesh).z < 0;
  });

  const exhaust = slotsWhere(root, (m, mesh, index) => PART.exhaust.test(both(m, mesh)) && centreOf(mesh).z < 0 && !isPaint(mesh, index) && !isGlass(mesh, index) && kindOf(m.name) !== "glass");

  const frontLamps = lamps.filter((l) => !l.rear);
  const rearLamps = lamps.filter((l) => l.rear);

  return {
    paintHow,
    paintNote,
    paint,
    glass,
    lenses,
    lamps,
    tyres,
    rims,
    calipers,
    discs,
    carbon,
    trim,
    mirrors,
    spoiler,
    exhaust,
    capabilities: {
      paint: paint.length > 0,
      wheels: Boolean(wheels),
      rims: rims.length > 0 && new Set(rims.map((r) => r.corner)).size >= 4,
      calipers: new Set(calipers.map((c) => c.mesh)).size >= 2,
      glass: glass.length > 0,
      lights: frontLamps.length > 0,
      rearLights: rearLamps.length > 0,
      ride: Boolean(wheels),
      trim: trim.length > 0,
      carbon: carbon.length > 0,
      mirrors: mirrors.length > 0,
      spoiler: spoiler.length > 0,
      exhaust: exhaust.length > 0,
    },
  };
}
