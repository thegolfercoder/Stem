// What of a car can be seen from outside, and where.
//
// A tiny software rasteriser: the car is drawn from a ring of directions into
// small depth buffers that record, for every pixel, which part of which mesh
// is nearest. It needs no GPU and runs the same in the browser and in Node,
// so the detection rules built on it can be tested without a browser.
//
// It answers questions names cannot: which meshes form the outer body shell,
// which parts fill the window line when nothing is called "glass", and
// whether the windows are separate parts at all.
import * as THREE from "three";
import { materialsOf } from "./names.js";

const deg = THREE.MathUtils.degToRad;

/** Directions to look from: a low ring, a high ring, the top, and two exact side views. */
export const VIEWS = [
  ...Array.from({ length: 12 }, (_, i) => ({ az: i * 30, el: 8 })),
  ...Array.from({ length: 8 }, (_, i) => ({ az: i * 45 + 22.5, el: 40 })),
  { az: 0, el: 89.9 },
  { az: 90, el: 0, side: "left", size: 192 },
  { az: 270, el: 0, side: "right", size: 192 },
];

/**
 * The parts of a car as rasterisable slots: one per mesh and material. Slot
 * ids index `slots`; each slot names its mesh, material index and material.
 */
function collect(root) {
  root.updateMatrixWorld(true);
  const slots = [];
  const chunks = [];
  let vertexCount = 0, triangleCount = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry, pos = g.attributes.position;
    if (!pos) return;
    const mats = materialsOf(o);
    const index = g.index;
    const count = index ? index.count : pos.count;
    const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      world[i * 3] = v.x;
      world[i * 3 + 1] = v.y;
      world[i * 3 + 2] = v.z;
    }
    for (const grp of groups) {
      const material = mats[grp.materialIndex ?? 0];
      if (!material) continue;
      const id = slots.length;
      slots.push({ id, mesh: o, index: Array.isArray(o.material) ? grp.materialIndex ?? 0 : null, material });
      const end = Math.min(grp.start + grp.count, count);
      const tris = Math.max(0, Math.floor((end - grp.start) / 3));
      chunks.push({ world, index, start: grp.start, tris, base: vertexCount, id });
      triangleCount += tris;
    }
    vertexCount += pos.count;
  });

  // One flat vertex array and one flat triangle list for the whole car.
  const positions = new Float32Array(vertexCount * 3);
  const triangles = new Uint32Array(triangleCount * 3);
  const triangleSlot = new Int32Array(triangleCount);
  let t = 0;
  const written = new Set();
  for (const c of chunks) {
    if (!written.has(c.world)) {
      positions.set(c.world, c.base * 3);
      written.add(c.world);
    }
    for (let k = 0; k < c.tris; k++) {
      const i = c.start + k * 3;
      triangles[t * 3] = c.base + (c.index ? c.index.getX(i) : i);
      triangles[t * 3 + 1] = c.base + (c.index ? c.index.getX(i + 1) : i + 1);
      triangles[t * 3 + 2] = c.base + (c.index ? c.index.getX(i + 2) : i + 2);
      triangleSlot[t] = c.id;
      t++;
    }
  }
  return { slots, positions, triangles, triangleSlot };
}

/** Draws every triangle from one direction, keeping the nearest slot per pixel. */
function rasterise(scene, view, defaultSize) {
  const { positions, triangles, triangleSlot } = scene;
  const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - deg(view.el), deg(view.az));
  const forward = dir.clone().negate();
  const worldUp = Math.abs(forward.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const n = positions.length / 3;
  const X = new Float32Array(n), Y = new Float32Array(n), T = new Float32Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const x = px * right.x + py * right.y + pz * right.z;
    const y = px * up.x + py * up.y + pz * up.z;
    X[i] = x;
    Y[i] = y;
    T[i] = px * dir.x + py * dir.y + pz * dir.z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const size = view.size ?? defaultSize;
  const scale = size / Math.max(maxX - minX, maxY - minY, 1e-6);
  const width = Math.ceil((maxX - minX) * scale) + 1;
  const height = Math.ceil((maxY - minY) * scale) + 1;
  for (let i = 0; i < n; i++) {
    X[i] = (X[i] - minX) * scale;
    Y[i] = (Y[i] - minY) * scale;
  }
  const depth = new Float32Array(width * height).fill(-Infinity);
  const ids = new Int32Array(width * height).fill(-1);

  const triCount = triangleSlot.length;
  for (let t = 0; t < triCount; t++) {
    const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
    const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], cx = X[c], cy = Y[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    let x0 = Math.ceil(Math.min(ax, bx, cx) - 0.5), x1 = Math.floor(Math.max(ax, bx, cx) - 0.5);
    let y0 = Math.ceil(Math.min(ay, by, cy) - 0.5), y1 = Math.floor(Math.max(ay, by, cy) - 0.5);
    if (x1 < x0 || y1 < y0) continue;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= width) x1 = width - 1;
    if (y1 >= height) y1 = height - 1;
    const inv = 1 / area;
    const ta = T[a], tb = T[b], tc = T[c];
    const slot = triangleSlot[t];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * ta + w1 * tb + w2 * tc;
        const p = y * width + x;
        if (d > depth[p]) {
          depth[p] = d;
          ids[p] = slot;
        }
      }
    }
  }
  return { ...view, dir, right, up, width, height, scale, minX, minY, depth, ids };
}

/**
 * Renders the car from every view. Big models are drawn from fewer
 * directions so preparing them stays quick.
 * @returns {{slots: object[], views: object[], triangles: number}}
 */
export function renderViews(root, { size = 112, views = VIEWS } = {}) {
  const scene = collect(root);
  const tris = scene.triangleSlot.length;
  const chosen = tris > 600000 ? views.filter((v, i) => v.side || i % 2 === 0) : views;
  return { slots: scene.slots, triangles: tris, views: chosen.map((v) => rasterise(scene, v, size)) };
}

/** Pixels each slot covers across the views that see the car from above the ground. */
export function visiblePixels(raster) {
  const counts = new Float64Array(raster.slots.length);
  for (const v of raster.views) {
    if (v.el < 0) continue;
    for (const id of v.ids) if (id >= 0) counts[id]++;
  }
  return counts;
}

/**
 * The window line seen from each side: for every column of the middle part of
 * the car, the pixels between 58% and 90% of that column's height. For each
 * group of slots (by default each slot; pass `groupOf` to group by material),
 * how much of that band it covers, how much of its own side-view area lies in
 * it, and how much of the car's length it reaches on its better side.
 */
export function windowBand(raster, carBox, groupOf = (slot) => slot.id) {
  const L = carBox.max.z - carBox.min.z;
  const groups = new Map();
  const get = (key) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, slots: [], band: 0, side: 0, columns: { left: 0, right: 0 } }));
    return g;
  };
  for (const s of raster.slots) get(groupOf(s)).slots.push(s);
  const keyOf = raster.slots.map((s) => groupOf(s));
  let bandTotal = 0;
  const columnTotal = { left: 0, right: 0 };
  for (const v of raster.views) {
    if (!v.side) continue;
    const { width, height, ids, right, scale, minX } = v;
    for (let x = 0; x < width; x++) {
      const along = (x + 0.5) / scale + minX;
      if (Math.abs(along * right.z) > L * 0.3) continue;
      let top = -1, bottom = -1;
      for (let y = 0; y < height; y++) {
        if (ids[y * width + x] < 0) continue;
        if (bottom < 0) bottom = y;
        top = y;
      }
      if (top < 0) continue;
      columnTotal[v.side]++;
      const h = top - bottom + 1;
      const lo = bottom + Math.floor(0.58 * h), hi = bottom + Math.ceil(0.9 * h);
      const seen = new Set();
      for (let y = bottom; y <= top; y++) {
        const id = ids[y * width + x];
        if (id < 0) continue;
        const g = get(keyOf[id]);
        g.side++;
        if (y < lo || y > hi) continue;
        g.band++;
        bandTotal++;
        seen.add(g);
      }
      for (const g of seen) g.columns[v.side]++;
    }
  }
  for (const g of groups.values()) {
    g.bandShare = bandTotal ? g.band / bandTotal : 0;
    g.inBand = g.side ? g.band / g.side : 0;
    g.reach = Math.max(g.columns.left / (columnTotal.left || 1), g.columns.right / (columnTotal.right || 1));
  }
  return { bandTotal, groups };
}
