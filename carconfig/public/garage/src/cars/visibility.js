// What of a car can be seen from outside, and where.
//
// A tiny software rasteriser: the car is drawn from a ring of directions into
// small depth buffers that record, for every pixel, the nearest triangle. It
// needs no GPU and runs the same in the browser and in Node, so the detection
// rules built on it can be tested without a browser.
//
// It answers questions names cannot: which parts form the outer body shell,
// which parts fill the window line when nothing is called "glass", and
// whether the windows are separate parts at all. Because every pixel keeps its
// triangle, the same views can be read part by part, material by material, or
// piece by piece (the connected pieces of one mesh), without drawing again.
import * as THREE from "three";
import { materialsOf } from "./names.js";

const deg = THREE.MathUtils.degToRad;

/** One name for a place a material is used: a mesh, and which of its materials. */
export const slotKey = (mesh, index) => `${mesh.uuid}|${index ?? -1}`;

/** Directions to look from: a low ring, a high ring, the top, and the window lines. */
export const VIEWS = [
  ...Array.from({ length: 12 }, (_, i) => ({ az: i * 30, el: 8 })),
  ...Array.from({ length: 8 }, (_, i) => ({ az: i * 45 + 22.5, el: 40 })),
  { az: 0, el: 89.9 },
  { az: 90, el: 0, line: "left", size: 192 },
  { az: 270, el: 0, line: "right", size: 192 },
  { az: 0, el: 4, line: "front", size: 160 },
  { az: 180, el: 4, line: "rear", size: 160 },
];

/**
 * The window lines. From each side, the columns of the middle of the car and,
 * in each column, the part of its height where the windows are: 58-90% from
 * the side, in columns at least 80% as tall as the cabin (not a pickup's bed); from the front and back, 60-93% (the windscreen and rear
 * window sit between the bonnet or boot and the roof). The door line is the
 * lower middle of the doors, which on nearly every car is body colour.
 */
export const LINES = {
  side: { views: ["left", "right"], axis: "z", middle: 0.3, band: [0.58, 0.9], cabin: 0.8 },
  ends: { views: ["front", "rear"], axis: "x", middle: 0.3, band: [0.6, 0.93] },
  // The door skins: whatever covers them is the body colour on nearly every car.
  doors: { views: ["left", "right"], axis: "z", middle: 0.2, band: [0.25, 0.55] },
};

/**
 * The parts of a car as rasterisable slots: one per mesh and material. Every
 * triangle of the car gets one global number; each slot knows its range.
 * Fully transparent materials are drawn a little behind where they are, so a
 * hidden duplicate of a surface never wins against the surface itself.
 */
function collect(root, skip) {
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
    let world = null;
    const base = vertexCount;
    for (const grp of groups) {
      const material = mats[grp.materialIndex ?? 0];
      const slotIndex = Array.isArray(o.material) ? grp.materialIndex ?? 0 : null;
      if (!material || skip?.has(slotKey(o, slotIndex))) continue;
      if (!world) {
        world = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          world[i * 3] = v.x;
          world[i * 3 + 1] = v.y;
          world[i * 3 + 2] = v.z;
        }
        vertexCount += pos.count;
      }
      const end = Math.min(grp.start + grp.count, count);
      const tris = Math.max(0, Math.floor((end - grp.start) / 3));
      const id = slots.length;
      const hidden = material.transparent && material.opacity < 0.05;
      slots.push({ id, mesh: o, index: slotIndex, material, first: triangleCount, count: tris, local: Math.floor(grp.start / 3), bias: hidden ? 0.03 : 0 });
      chunks.push({ world, index, start: grp.start, tris, base, id });
      triangleCount += tris;
    }
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

/** Draws every triangle from one direction, keeping the nearest triangle per pixel. */
function rasterise(scene, view, defaultSize) {
  const { positions, triangles, triangleSlot, slots } = scene;
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
    const bias = slots[triangleSlot[t]].bias;
    const ta = T[a] - bias, tb = T[b] - bias, tc = T[c] - bias;
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
          ids[p] = t;
        }
      }
    }
  }
  return { ...view, dir, right, up, width, height, scale, minX, minY, depth, ids };
}

/**
 * Renders the car from every view. Big models are drawn from fewer
 * directions so preparing them stays quick. Slots whose keys are in `skip`
 * are left out, to look through them. Pixels hold global triangle numbers.
 */
export function renderViews(root, { size = 112, views = VIEWS, skip = null } = {}) {
  const scene = collect(root, skip);
  const tris = scene.triangleSlot.length;
  const chosen = tris > 600000 ? views.filter((v, i) => v.line || i % 2 === 0) : views;
  return { ...scene, triangleCount: tris, views: chosen.map((v) => rasterise(scene, v, size)) };
}

/** Pixels each triangle covers across the views that see the car from above the ground. */
export function visibleTriangles(raster) {
  const counts = new Uint32Array(raster.triangleCount);
  for (const v of raster.views) {
    if (v.el < 0) continue;
    for (const t of v.ids) if (t >= 0) counts[t]++;
  }
  return counts;
}

/**
 * One window line, read for groups of triangles (`groupOf` maps a triangle
 * number to a key: its slot, its material, its piece). For every column of
 * the middle of the car, the pixels in the line's band of that column's
 * height. For each group: how much of the band it covers (bandShare), how much
 * of its own area in these views lies in the band (inBand), how much of the
 * car's length or width it reaches on its better side (reach), how much of
 * the band's height it fills where it appears (cover: a window fills it, a
 * trim strip does not), how far in metres it sits inside the body below it
 * (inset), how far behind the roof edge above it (behind), and how much of the
 * band it covers flush with that edge (flushShare: glass or body, not a seat
 * seen through an open window). `roofline` is how high the cabin reaches
 * against the whole car.
 */
export function windowBand(raster, carBox, groupOf, line = LINES.side) {
  const groups = new Map();
  const get = (key) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, band: 0, own: 0, flush: 0, insetSum: 0, insetCount: 0, behindSum: 0, bandRows: 0, columns: {} }));
    return g;
  };
  let bandTotal = 0;
  const columnTotal = {};
  const roofline = [];
  for (const v of raster.views) {
    if (!line.views.includes(v.line)) continue;
    const { width, ids, depth } = v;
    const { columns, roof } = lineColumns(v, carBox, line);
    roofline.push(roof);
    columnTotal[v.line] = columns.length;
    for (const { x, top, bottom, lo, hi } of columns) {
      const h = top - bottom + 1;
      // How far out the body reaches below the band, to measure how deep
      // inside the car each part of the band sits.
      let below = -Infinity;
      for (let y = bottom + Math.floor(0.3 * h); y < lo; y++) if (ids[y * width + x] >= 0) below = Math.max(below, depth[y * width + x]);
      // And the roof edge above it: a window meets the roof and leans out from
      // it, while a seat seen through an empty window sits well behind it.
      let edge = depth[top * width + x];
      for (let y = hi + 1; y <= top; y++) if (ids[y * width + x] >= 0) edge = Math.max(edge, depth[y * width + x]);
      const seen = new Set();
      for (let y = bottom; y <= top; y++) {
        const t = ids[y * width + x];
        if (t < 0) continue;
        const g = get(groupOf(t));
        g.own++;
        if (y < lo || y > hi) continue;
        g.band++;
        bandTotal++;
        if (below > -Infinity) {
          g.insetSum += below - depth[y * width + x];
          g.insetCount++;
        }
        g.behindSum += edge - depth[y * width + x];
        if (edge - depth[y * width + x] <= 0.1) g.flush++;
        seen.add(g);
      }
      for (const g of seen) {
        g.columns[v.line] = (g.columns[v.line] ?? 0) + 1;
        g.bandRows += hi - lo + 1;
      }
    }
  }
  for (const g of groups.values()) {
    g.bandShare = bandTotal ? g.band / bandTotal : 0;
    g.inBand = g.own ? g.band / g.own : 0;
    g.reach = Math.max(0, ...Object.entries(g.columns).map(([k, n]) => n / (columnTotal[k] || 1)));
    g.cover = g.bandRows ? g.band / g.bandRows : 0;
    g.inset = g.insetCount ? g.insetSum / g.insetCount : 0;
    g.behind = g.band ? g.behindSum / g.band : 0;
    g.flushShare = bandTotal ? g.flush / bandTotal : 0;
  }
  return { bandTotal, groups, roofline: roofline.length ? Math.min(...roofline) : 0 };
}

/**
 * The columns of one view that a line reads: those over the middle of the
 * car (and, for the side line, as tall as the cabin), each with its first and
 * last row and the rows of the band. `roof` is how high the cabin reaches
 * against the whole car: a convertible's doors stop well short of its
 * windscreen.
 */
function lineColumns(view, carBox, line) {
  const { width, height, ids, scale, minX } = view;
  const extent = line.axis === "z" ? carBox.max.z - carBox.min.z : carBox.max.x - carBox.min.x;
  const middle = (x) => Math.abs((x + 0.5) / scale + minX) <= extent * line.middle;
  const tops = new Int32Array(width).fill(-1), bottoms = new Int32Array(width).fill(-1);
  const heights = [];
  let overall = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (ids[y * width + x] < 0) continue;
      if (bottoms[x] < 0) bottoms[x] = y;
      tops[x] = y;
    }
    if (tops[x] < 0) continue;
    overall = Math.max(overall, tops[x] + 1);
    if (middle(x)) heights.push(tops[x] + 1);
  }
  // The cabin's height: most middle columns reach it; a roof aerial or a wing does not count.
  heights.sort((a, b) => a - b);
  const cabin = heights.length ? heights[Math.floor(heights.length * 0.75)] : 0;
  const columns = [];
  for (let x = 0; x < width; x++) {
    const top = tops[x], bottom = bottoms[x];
    if (top < 0 || !middle(x) || (line.cabin && top + 1 < line.cabin * cabin)) continue;
    const h = top - bottom + 1;
    columns.push({ x, top, bottom, lo: bottom + Math.floor(line.band[0] * h), hi: bottom + Math.ceil(line.band[1] * h) });
  }
  return { columns, roof: overall ? cabin / overall : 0 };
}

/**
 * Of the cabin columns seen from the sides, the share whose window line has
 * an opening: a run of pixels, at least a sixth of the band's height, that
 * are not `solid` (glass, a seat seen through an empty frame, or sky).
 * Windows that are part of the paint leave no opening.
 */
function windowOpenings(raster, carBox, solid) {
  let columns = 0, open = 0;
  for (const v of raster.views) {
    if (!LINES.side.views.includes(v.line)) continue;
    for (const { x, lo, hi } of lineColumns(v, carBox, LINES.side).columns) {
      columns++;
      const need = Math.max(2, Math.ceil((hi - lo + 1) / 6));
      let run = 0;
      for (let y = lo; y <= hi; y++) {
        const t = v.ids[y * v.width + x];
        run = t >= 0 && solid(t) ? 0 : run + 1;
        if (run >= need) {
          open++;
          break;
        }
      }
    }
  }
  return columns ? open / columns : 0;
}

/** Joins the triangles of the given slots into connected pieces (sharing a corner within half a millimetre). */
function connectedPieces(raster, slots) {
  const { positions, triangles } = raster;
  const pieceOf = new Int32Array(raster.triangleCount).fill(-1);
  const pieces = [];
  const q = 2000; // half a millimetre
  const corner = new THREE.Vector3();
  for (const s of slots) {
    const parent = new Int32Array(s.count).map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const firstAt = new Map();
    for (let k = 0; k < s.count; k++) {
      const t = s.first + k;
      for (let c = 0; c < 3; c++) {
        const p = triangles[t * 3 + c] * 3;
        const key = (Math.round(positions[p] * q) + 2 ** 15) * 2 ** 32 + (Math.round(positions[p + 1] * q) + 2 ** 15) * 2 ** 16 + (Math.round(positions[p + 2] * q) + 2 ** 15);
        const other = firstAt.get(key);
        if (other === undefined) firstAt.set(key, k);
        else {
          const a = find(k), b = find(other);
          if (a !== b) parent[a] = b;
        }
      }
    }
    const idOfRoot = new Map();
    for (let k = 0; k < s.count; k++) {
      const r = find(k);
      let id = idOfRoot.get(r);
      if (id === undefined) {
        id = pieces.length;
        idOfRoot.set(r, id);
        pieces.push({ id, slot: s, triangles: 0, box: new THREE.Box3() });
      }
      pieceOf[s.first + k] = id;
      const piece = pieces[id];
      piece.triangles++;
      for (let c = 0; c < 3; c++) {
        const p = triangles[(s.first + k) * 3 + c] * 3;
        piece.box.expandByPoint(corner.set(positions[p], positions[p + 1], positions[p + 2]));
      }
    }
  }
  return { pieceOf, pieces };
}

/**
 * What the views say about a car, per slot and per material: the share of
 * everything visible from outside that it makes up (vis), its figures on the
 * side window line (band) and the front and rear one (ends), and, per
 * material, its share of the door skins (doors). `pieces`
 * reads chosen slots piece by piece in the same way. `throughGlass` draws the
 * car again without the given slots, to find what is only seen through them.
 */
export function survey(root) {
  const raster = renderViews(root);
  const box = new THREE.Box3().setFromObject(root);
  const counts = visibleTriangles(raster);
  let total = 0;
  for (const c of counts) total += c;
  total ||= 1;
  const { slots: list, triangleSlot } = raster;
  const keyOfSlot = list.map((s) => slotKey(s.mesh, s.index));
  const side = windowBand(raster, box, (t) => keyOfSlot[triangleSlot[t]], LINES.side);
  const ends = windowBand(raster, box, (t) => keyOfSlot[triangleSlot[t]], LINES.ends);
  const sideM = windowBand(raster, box, (t) => list[triangleSlot[t]].material, LINES.side);
  const endsM = windowBand(raster, box, (t) => list[triangleSlot[t]].material, LINES.ends);
  const doorsM = windowBand(raster, box, (t) => list[triangleSlot[t]].material, LINES.doors);

  const slots = new Map();
  const materials = new Map();
  list.forEach((s, i) => {
    const key = keyOfSlot[i];
    let vis = 0;
    for (let t = s.first; t < s.first + s.count; t++) vis += counts[t];
    vis /= total;
    const slot = slots.get(key) ?? { key, mesh: s.mesh, index: s.index, material: s.material, vis: 0, parts: [], band: side.groups.get(key), ends: ends.groups.get(key) };
    slot.vis += vis;
    slot.parts.push(s);
    slots.set(key, slot);
    const m = materials.get(s.material) ?? { vis: 0, band: sideM.groups.get(s.material), ends: endsM.groups.get(s.material), doors: doorsM.groups.get(s.material)?.bandShare ?? 0 };
    m.vis += vis;
    materials.set(s.material, m);
  });
  return {
    box,
    triangles: raster.triangleCount,
    bandTotal: side.bandTotal,
    endsTotal: ends.bandTotal,
    roofline: side.roofline,
    slots,
    materials,
    slot: (mesh, index) => slots.get(slotKey(mesh, index)),
    material: (m) => materials.get(m),
    /** The slot key of a triangle, by its global number. */
    keyOfTriangle: (t) => keyOfSlot[triangleSlot[t]],
    /** See windowOpenings: `solid(t)` says whether triangle t is paint. */
    openings: (solid) => windowOpenings(raster, box, solid),
    /** The connected pieces of the given slots, each with its own vis, band and ends figures. */
    pieces(chosen) {
      const { pieceOf, pieces } = connectedPieces(raster, chosen.flatMap((s) => s.parts));
      const pb = windowBand(raster, box, (t) => pieceOf[t], LINES.side);
      const pe = windowBand(raster, box, (t) => pieceOf[t], LINES.ends);
      const vis = new Float64Array(pieces.length);
      for (const s of new Set(pieces.map((p) => p.slot))) for (let t = s.first; t < s.first + s.count; t++) vis[pieceOf[t]] += counts[t];
      for (const p of pieces) {
        p.vis = vis[p.id] / total;
        p.band = pb.groups.get(p.id);
        p.ends = pe.groups.get(p.id);
        p.slotKey = slotKey(p.slot.mesh, p.slot.index);
      }
      return { pieceOf, pieces, bandTotal: pb.bandTotal, endsTotal: pe.bandTotal };
    },
    /** Slot keys seen when the `hidden` slots are taken away, that were not seen before. */
    throughGlass(hidden) {
      if (!hidden.size) return new Set();
      const views = VIEWS.filter((v) => v.el > 0 && !v.line);
      const again = renderViews(root, { views, skip: hidden });
      const seen = visibleTriangles(again);
      const out = new Set();
      for (const s of again.slots) {
        const key = slotKey(s.mesh, s.index);
        let n = 0;
        for (let t = s.first; t < s.first + s.count; t++) n += seen[t];
        if (n > 0 && !(slots.get(key)?.vis > 0)) out.add(key);
      }
      return out;
    },
  };
}
