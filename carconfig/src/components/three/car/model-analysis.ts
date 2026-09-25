import * as THREE from "three";
import type { MaterialStats } from "@/lib/three/model-paint";
import { nameWords } from "@/lib/three/model-paint";
import { classifyMaterial } from "./model-materials";

/**
 * Measuring a downloaded model: what its surfaces are, where its wheels are,
 * and what is not the car at all.
 *
 * All of it works on the model after it has been turned to face +z, scaled
 * to the car and stood on the floor, so sizes are metres and heights are
 * above the ground.
 */

export function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

const FLOOR_NAME = /\b(ground|floor|backdrop|stage|platform|podium|turntable|studio|suelo|boden|pavimento|sol)\b/;

/**
 * Remove whatever the author stood the car on: a floor, shadow catcher,
 * backdrop or display base. Three tells:
 *   - flat and as big as the scene (a ground plane);
 *   - named for what it is ("Ground", "Suelo") and as long as the scene;
 *   - a base: wider and longer than everything else, with its top below the
 *     bottom fifth of the rest.
 */
export function dropFloor(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const meshes: { o: THREE.Mesh; box: THREE.Box3 }[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push({ o, box: new THREE.Box3().setFromObject(o) });
  });
  const whole = new THREE.Box3().setFromObject(model);
  const span = whole.getSize(new THREE.Vector3());
  const largest = Math.max(span.x, span.y, span.z);

  const floors = new Set<THREE.Mesh>();
  for (const { o, box } of meshes) {
    const s = box.getSize(new THREE.Vector3());
    const thinnest = Math.min(s.x, s.y, s.z);
    const widest = Math.max(s.x, s.y, s.z);
    if (thinnest < widest * 0.01 && widest > largest * 0.5) floors.add(o);
    else if (FLOOR_NAME.test(nameWords(o.name)) && widest > largest * 0.8) floors.add(o);
  }
  // A base is judged against everything else, so find the rest's extent.
  for (const { o, box } of meshes) {
    if (floors.has(o)) continue;
    const rest = new THREE.Box3();
    for (const m of meshes) if (m.o !== o && !floors.has(m.o)) rest.union(m.box);
    if (rest.isEmpty()) continue;
    const r = rest.getSize(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const wider = s.x > r.x * 1.1 && s.z > r.z * 1.1;
    const below = box.max.y < rest.min.y + r.y * 0.2;
    if (wider && below) floors.add(o);
  }
  for (const o of floors) o.removeFromParent();
}

/** Per-material surface statistics, for telling the paint from everything else. */
export function materialStats(root: THREE.Object3D): { materials: THREE.Material[]; stats: MaterialStats[] } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const acc = new Map<THREE.Material, { area: number; h: number; lo: number; hi: number }>();

  // Big models are sampled: the shares come out the same from a fifth of the
  // triangles, in a fifth of the time.
  let triangles = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry;
    triangles += (g.getIndex()?.count ?? g.getAttribute("position")?.count ?? 0) / 3;
  });
  const step = Math.max(1, Math.floor(triangles / 150_000));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute("position");
    if (!pos) return;
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const mats = materialsOf(o);
    const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0];
      if (!m) continue;
      let e = acc.get(m);
      if (!e) {
        e = { area: 0, h: 0, lo: Infinity, hi: -Infinity };
        acc.set(m, e);
      }
      const end = Math.min(grp.start + grp.count, count);
      for (let i = grp.start; i + 2 < end; i += 3 * step) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
        const area = 0.5 * ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * step;
        e.area += area;
        e.h += (area * ((a.y + b.y + c.y) / 3 - box.min.y)) / (size.y || 1);
        e.lo = Math.min(e.lo, a.z, b.z, c.z);
        e.hi = Math.max(e.hi, a.z, b.z, c.z);
      }
    }
  });

  const materials = [...acc.keys()];
  const stats = materials.map((m, id): MaterialStats => {
    const e = acc.get(m)!;
    const std = m as THREE.MeshStandardMaterial;
    return {
      id,
      name: m.name,
      kind: classifyMaterial(m.name),
      rgb: std.color ? [std.color.r, std.color.g, std.color.b] : [1, 1, 1],
      opacity: m.transparent ? m.opacity : 1,
      hasMap: Boolean(std.map),
      area: e.area,
      span: e.area > 0 ? (e.hi - e.lo) / (size.z || 1) : 0,
      height: e.area > 0 ? e.h / e.area : 0,
    };
  });
  return { materials, stats };
}

export interface WheelGroup {
  readonly box: THREE.Box3;
  readonly meshes: THREE.Mesh[];
}
export type Corners4 = { fl: WheelGroup; fr: WheelGroup; rl: WheelGroup; rr: WheelGroup };

const cornerKey = (c: THREE.Vector3) => `${c.z > 0 ? "f" : "r"}${c.x > 0 ? "r" : "l"}` as keyof Corners4;

/** Four round, wheel-sized groups, one per corner, or null. */
function sane(groups: Map<string, WheelGroup>): Corners4 | null {
  const found = (["fl", "fr", "rl", "rr"] as const).map((k) => groups.get(k));
  const ok = found.every((g) => {
    if (!g) return false;
    const s = g.box.getSize(new THREE.Vector3());
    const r = s.y / 2;
    return r > 0.2 && r < 0.52 && Math.abs(s.z - s.y) / s.y < 0.3;
  });
  if (!ok) return null;
  const [fl, fr, rl, rr] = found as WheelGroup[];
  return { fl: fl!, fr: fr!, rl: rl!, rr: rr! };
}

// Words starting this way: "Tireside" and "Rim 1" match, "Trim" does not.
const WHEEL_RE = /\b(wheel|rim|tyre|tire|brake|caliper|disc|rotor|lug|hub|spoke|rueda|roue|ruota|llanta|jante|felge|reifen|gomma|pneu)/i;

/**
 * Split a mesh holding all four wheels' worth of one part (every rim in one
 * mesh, say) into one mesh per corner, by which corner each triangle is in.
 * Many models are built this way: merged by material, not by wheel.
 */
function splitAcrossCorners(mesh: THREE.Mesh): THREE.Mesh[] | null {
  if (Array.isArray(mesh.material) || !mesh.parent) return null;
  const source = mesh.geometry as THREE.BufferGeometry;
  const g = source.index ? source.toNonIndexed() : source;
  const pos = g.getAttribute("position");
  if (!pos) return null;
  const triangles = Math.floor(pos.count / 3);
  const corner = new Uint8Array(triangles);
  const counts = [0, 0, 0, 0];
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let t = 0; t < triangles; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, t * 3 + k).applyMatrix4(mesh.matrixWorld));
    const key = (c.x > 0 ? 1 : 0) | (c.z > 0 ? 2 : 0);
    corner[t] = key;
    counts[key]! += 1;
  }
  if (counts.some((n) => n === 0)) return null;

  const pieces: THREE.Mesh[] = [];
  for (let key = 0; key < 4; key++) {
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      // Raw stored values, copied as stored: quantised attributes keep their
      // integer encoding and normalised flag.
      const a = attr as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      const size = a.itemSize;
      const interleaved = a instanceof THREE.InterleavedBufferAttribute;
      const src = interleaved ? a.data.array : a.array;
      const stride = interleaved ? a.data.stride : size;
      const offset = interleaved ? a.offset : 0;
      const Ctor = src.constructor as new (n: number) => THREE.TypedArray;
      const out = new Ctor(counts[key]! * 3 * size);
      let w = 0;
      for (let t = 0; t < triangles; t++) {
        if (corner[t] !== key) continue;
        for (let k = 0; k < 3; k++) {
          const base = (t * 3 + k) * stride + offset;
          for (let i = 0; i < size; i++) out[w++] = src[base + i]!;
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const piece = new THREE.Mesh(geo, mesh.material);
    piece.name = `${mesh.name} ${["rl", "rr", "fl", "fr"][key]}`;
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    piece.castShadow = mesh.castShadow;
    piece.receiveShadow = mesh.receiveShadow;
    mesh.parent.add(piece);
    pieces.push(piece);
  }
  mesh.removeFromParent();
  return pieces;
}

/** Wheels found by what the parts are called. */
export function wheelsByName(root: THREE.Object3D, carLength: number, label: (o: THREE.Mesh) => string): Corners4 | null {
  // Parts that hold all four wheels at once are split by corner first.
  const merged: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const l = label(o);
    if (!WHEEL_RE.test(l) || /steering|spare|light|lamp|arch|well/i.test(l)) return;
    const b = new THREE.Box3().setFromObject(o);
    const bs = b.getSize(new THREE.Vector3());
    const bc = b.getCenter(new THREE.Vector3());
    if (bs.y <= 0.95 && bc.y <= 0.6 && bs.x > 0.6 && bs.z > carLength * 0.4) merged.push(o);
  });
  for (const m of merged) splitAcrossCorners(m);
  root.updateMatrixWorld(true);

  const groups = new Map<string, WheelGroup>();
  let tangled = false;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const l = label(o);
    if (!WHEEL_RE.test(l) || /steering|spare|light|lamp|arch|well/i.test(l)) return;
    const b = new THREE.Box3().setFromObject(o);
    const bs = b.getSize(new THREE.Vector3());
    const bc = b.getCenter(new THREE.Vector3());
    // A wheel part sits low and outboard, and is no taller than a big wheel.
    if (bs.y > 0.95 || bc.y > 0.6) return;
    // Still spanning both sides or both axles after splitting: wheels tangled
    // up with something else; nothing sensible can be swapped out of that.
    if (b.min.x < 0 && b.max.x > 0 && bs.x > 0.6) tangled = true;
    if (b.min.z < 0 && b.max.z > 0 && bs.z > carLength * 0.4) tangled = true;
    if (Math.abs(bc.x) < 0.15) return;
    const key = cornerKey(bc);
    const g = groups.get(key);
    if (g) {
      g.box.union(b);
      g.meshes.push(o);
    } else groups.set(key, { box: b, meshes: [o] });
  });
  return tangled ? null : sane(groups);
}

/**
 * Wheels found by shape, for models whose parts are called "Object_12": at
 * each corner, the largest mesh that is round from the side, narrow, wheel
 * sized and standing on the ground; with it, everything that fits inside it
 * (rim, nuts, disc, caliper).
 */
export function wheelsByShape(root: THREE.Object3D): Corners4 | null {
  root.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(root);
  const width = whole.getSize(new THREE.Vector3()).x;
  const meshes: { o: THREE.Mesh; box: THREE.Box3 }[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible) meshes.push({ o, box: new THREE.Box3().setFromObject(o) });
  });

  const tyres = new Map<string, { o: THREE.Mesh; box: THREE.Box3 }>();
  for (const m of meshes) {
    const s = m.box.getSize(new THREE.Vector3());
    const c = m.box.getCenter(new THREE.Vector3());
    const round = Math.abs(s.z - s.y) / s.y < 0.2;
    const sized = s.y > 0.45 && s.y < 1.0;
    const narrow = s.x < s.y * 0.6;
    const grounded = m.box.min.y - whole.min.y < 0.06;
    const outboard = Math.abs(c.x) > width * 0.2;
    if (!(round && sized && narrow && grounded && outboard)) continue;
    const key = cornerKey(c);
    const prev = tyres.get(key);
    if (!prev || s.y > prev.box.getSize(new THREE.Vector3()).y) tyres.set(key, m);
  }
  if (tyres.size !== 4) return null;

  const groups = new Map<string, WheelGroup>();
  for (const [key, tyre] of tyres) {
    // Inside the tyre, allowing for a disc and caliper set further in.
    const zone = tyre.box.clone();
    zone.min.x -= 0.12;
    zone.max.x += 0.12;
    zone.expandByScalar(0.01);
    const parts = meshes.filter((m) => m === tyre || zone.containsBox(m.box)).map((m) => m.o);
    const box = new THREE.Box3();
    for (const p of parts) box.expandByObject(p);
    groups.set(key, { box, meshes: parts });
  }
  return sane(groups);
}
