// Finding the parts of a car a buyer would configure: paint, glass, lamps,
// the four wheels and what they are made of, calipers, trim, carbon, mirror
// caps, spoiler and exhaust. Everything is detected from the model itself;
// anything not found with confidence is reported missing, and the option is
// not offered.
import * as THREE from "three";
import {
  kindOf, label, nodeLabel, nameWords, materialsOf, paintNameSays,
  LAMP_RE, REAR_LAMP_RE, LAMP_EXCLUDE_RE, WHEEL_RE, WHEEL_EXCLUDE_RE, PART,
} from "./names.js";

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
 * largest opaque surface that runs most of the car's length at body height,
 * plus any plain materials of exactly the same colour.
 */
export function choosePaint(stats) {
  const total = stats.reduce((s, m) => s + m.area, 0);
  if (total <= 0) return { how: "none", ids: [] };
  const share = (m) => m.area / total;
  const named = stats.filter((m) => m.kind === null && paintNameSays(m.name) === "paint" && share(m) > 0.02 && (lum(m.rgb) > 0.04 || share(m) > 0.08));
  if (named.length) return { how: "named", ids: named.map((m) => m.id) };
  const surfaces = stats.filter((m) => m.kind === null && paintNameSays(m.name) !== "other" && m.opacity >= 0.95 && m.height >= 0.25 && m.height <= 0.8);
  const panels = surfaces.filter((m) => m.span >= 0.55);
  if (!panels.length) return { how: "none", ids: [] };
  const best = panels.reduce((x, y) => (y.area > x.area ? y : x));
  if (share(best) < 0.12 || share(best) > 0.85) return { how: "none", ids: [] };
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
  const siblings = best.hasMap || isDefault(best.rgb) ? [] : surfaces.filter((m) => m !== best && !m.hasMap && (m.span >= 0.15 || share(m) > 0.01) && (dist(m.rgb, best.rgb) < 0.03 || sameHue(m)));
  return { how: "largest", ids: [best.id, ...siblings.map((m) => m.id)] };
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
 * corner, copying each triangle's raw attribute values (texture coordinates
 * and normals included) into the piece for the corner it sits in. Returns the
 * pieces by corner, or null when the mesh is already in one corner.
 */
export function splitAcrossCorners(mesh, known = triangleQuadrants(mesh)) {
  if (Array.isArray(mesh.material) || !mesh.parent || !known) return null;
  const { quad, counts, tris } = known;
  if (counts.filter((n) => n > 0).length < 2) return null;
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pieces = new Map();
  for (let q = 0; q < 4; q++) {
    if (!counts[q]) continue;
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const inter = attr.isInterleavedBufferAttribute, src = inter ? attr.data.array : attr.array;
      const stride = inter ? attr.data.stride : attr.itemSize, offset = inter ? attr.offset : 0, size = attr.itemSize;
      const out = new src.constructor(counts[q] * 3 * size);
      let w = 0;
      for (let t = 0; t < tris; t++) {
        if (quad[t] !== q) continue;
        for (let k = 0; k < 3; k++) {
          const base = (t * 3 + k) * stride + offset;
          for (let i = 0; i < size; i++) out[w++] = src[base + i];
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(out, size, attr.normalized));
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const piece = new THREE.Mesh(geo, mesh.material);
    piece.name = `${mesh.name} ${QUADRANT[q]}`;
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    mesh.parent.add(piece);
    pieces.set(QUADRANT[q], piece);
  }
  mesh.removeFromParent();
  if (g !== mesh.geometry) g.dispose();
  mesh.geometry.dispose();
  return pieces;
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
      if (m && test(m, o)) slots.push({ mesh: o, index: Array.isArray(o.material) ? i : null, original: m });
    });
  });
  return slots;
}

const centreOf = (o) => box3(o).getCenter(new THREE.Vector3());

/**
 * Looks at a normalised car (nose +z, on y = 0) and reports what it has.
 * `wheels` is the result of wheelsByName / wheelsByShape, already found.
 */
export function detectParts(root, wheels) {
  const { materials, stats } = materialStats(root);
  const area = new Map(materials.map((m, i) => [m, stats[i].area]));
  const choice = choosePaint(stats);
  const paintSet = new Set(choice.ids.map((i) => materials[i]));
  const wheelMeshes = new Set(wheels ? wheels.flatMap((w) => w.meshes) : []);
  const inWheel = (mesh) => wheelMeshes.has(mesh);
  const words = (m) => nameWords(m.name);
  const both = (m, mesh) => `${nodeLabel(mesh)} ${words(m)}`;

  const paint = slotsWhere(root, (m) => paintSet.has(m));
  const glass = slotsWhere(root, (m) => !paintSet.has(m) && kindOf(m.name) === "glass");
  const lenses = slotsWhere(root, (m) => kindOf(m.name) === "lens");

  // Lamps: anything named as a light that is not paint, interior, or a switch.
  const lamps = slotsWhere(root, (m, mesh) => {
    if (paintSet.has(m) || inWheel(mesh)) return false;
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
  calipers.push(...slotsWhere(root, (m, mesh) => !caliperSet.has(mesh) && !paintSet.has(m) && PART.caliper.test(both(m, mesh)) && centreOf(mesh).y < 0.75));

  const excluded = (m, mesh) => paintSet.has(m) || inWheel(mesh) || kindOf(m.name) === "glass" || kindOf(m.name) === "lens" || LAMP_RE.test(words(m));
  const carbon = slotsWhere(root, (m, mesh) => !inWheel(mesh) && kindOf(m.name) === "carbon");
  const trim = slotsWhere(root, (m, mesh) => !excluded(m, mesh) && !PART.mirrorGlass.test(both(m, mesh)) && (kindOf(m.name) === "chrome" || /\b(trim|window ?surround|beltline)\b/.test(words(m))));

  const mirrors = slotsWhere(root, (m, mesh) => {
    const l = nodeLabel(mesh);
    if (!PART.mirror.test(l) || PART.mirrorGlass.test(both(m, mesh)) || /\b(interior|inside|rear ?view|rearview)\b/.test(l)) return false;
    if (kindOf(m.name) === "glass" || kindOf(m.name) === "chrome" || (m.metalness >= 0.9 && m.roughness <= 0.1)) return false;
    return paintSet.has(m) || /\b(caps?|covers?|housing|shell|body)\b/.test(both(m, mesh));
  });

  const spoiler = slotsWhere(root, (m, mesh) => {
    const l = nodeLabel(mesh);
    if (!PART.spoiler.test(l) || PART.spoilerExclude.test(l)) return false;
    if (kindOf(m.name) === "glass" || kindOf(m.name) === "lens" || LAMP_RE.test(words(m))) return false;
    return centreOf(mesh).z < 0;
  });

  const exhaust = slotsWhere(root, (m, mesh) => PART.exhaust.test(both(m, mesh)) && centreOf(mesh).z < 0 && !paintSet.has(m) && kindOf(m.name) !== "glass");

  const frontLamps = lamps.filter((l) => !l.rear);
  const rearLamps = lamps.filter((l) => l.rear);

  return {
    paintHow: choice.how,
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
