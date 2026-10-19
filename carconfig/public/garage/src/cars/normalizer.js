// Putting any downloaded car the same way up, the same size and in the same
// place: nose toward +z, wheels on y = 0, centred on the origin, in metres.
// Nothing is hard-coded per model; everything comes from the model's own
// bounding box, its part names and the published length when one is known.
import * as THREE from "three";
import { label, nodeLabel } from "./names.js";
import { splitMesh, meshPieces } from "./geometry.js";
import { renderViews } from "./visibility.js";

/** Typical lengths (m) by body style, used only when a model's own size is not believable. */
const TYPICAL_LENGTH = { Coupe: 4.5, Roadster: 4.1, Sedan: 4.85, Hatchback: 4.2, Wagon: 4.9, SUV: 4.9, MPV: 4.6, Pickup: 5.6, Van: 5.4, "Two-door": 3.4 };

const FRONT = [
  [/\b(head ?lights?|head ?lamps?|headlamps?|phares?|faros?|scheinwerfer)\b/, 3],
  [/\bsteering\b/, 3],
  [/\b(grille?|grill|radiator|kuhlergrill)\b/, 2],
  [/\b(windshield|windscreen|wipers?|dashboard|dash)\b/, 2],
  [/\b(bonnet|hood|splitter|motorhaube)\b/, 1],
  [/\b(front|avant|anteriore|delantero|vorne|vorder\w*)\b/, 1],
];
/** Door mirrors, which sit at the front of the cabin, by their node names. */
const DOOR_MIRROR = /\b(mirrors?|spiegel\w*|retrovisor\w*|retroviseur\w*|specchi\w*)\b/;
const REAR = [
  [/\b(tail ?lights?|tail ?lamps?|taillamps?|brake ?lights?|reverse ?lights?|feux arriere|ruckleuchten?)\b/, 3],
  [/\b(exhausts?|muffler|tailpipes?|auspuff\w*|scarico)\b/, 2],
  [/\b(trunk|boot|diffuser|kofferraum)\b/, 2],
  [/\b(rear|back|arriere|posteriore|trasero|hinten|heck\w*)\b/, 1],
];

const box3 = (o) => new THREE.Box3().setFromObject(o);

/**
 * Removes lines and points: the edges a CAD or SketchUp export draws over
 * its faces, which are not surfaces of the car (and can reach far beyond it).
 */
export function dropLines(model) {
  const lines = [];
  model.traverse((o) => (o.isLine || o.isPoints || o.isSprite) && lines.push(o));
  for (const o of lines) o.removeFromParent();
  return lines.length;
}

/**
 * Removes a display plinth, turntable or ground plane the model was
 * published on: a part wider and longer than the rest of the car that lies
 * underneath it. A car's own flat undertray is inside its footprint and stays.
 */
export function dropFloor(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push({ o, box: box3(o) }));
  const floors = new Set();
  for (const { o, box } of meshes) {
    const rest = new THREE.Box3();
    for (const m of meshes) if (m.o !== o && !floors.has(m.o)) rest.union(m.box);
    if (rest.isEmpty()) continue;
    const r = rest.getSize(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    if (s.x > r.x * 1.05 && s.z > r.z * 1.05 && box.max.y < rest.min.y + r.y * 0.2) floors.add(o);
  }
  for (const o of floors) o.removeFromParent();
  return floors.size;
}

/**
 * Removes reference boards left in a scene: a big flat quad or two (a
 * blueprint, a backdrop card) standing beside or behind the car. Real flat
 * parts (number plates, badges) are small, so size keeps them.
 */
export function dropBoards(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push({ o, box: box3(o) }));
  const boards = meshes.filter(({ o, box }) => {
    const g = o.geometry;
    const tris = (g.index?.count ?? g.attributes.position?.count ?? 0) / 3;
    if (tris > 200) return false;
    const s = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => a - b);
    return s[0] < s[2] * 0.15;
  });
  if (!boards.length || boards.length === meshes.length) return 0;
  const rest = new THREE.Box3();
  for (const m of meshes) if (!boards.includes(m)) rest.union(m.box);
  const r = rest.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
  let removed = 0;
  for (const { o, box } of boards) {
    const s = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
    const rh = rest.max.y - rest.min.y;
    // Taller than the car, or sticking out past it: scenery, not bodywork.
    const outside = box.max.y > rest.max.y + rh * 0.1 || box.min.x < rest.min.x - 0.1 * r[1] || box.max.x > rest.max.x + 0.1 * r[1] || box.min.z < rest.min.z - 0.05 * r[0] || box.max.z > rest.max.z + 0.05 * r[0];
    if (s[0] > r[1] * 0.6 && s[1] > r[2] * 0.6 && outside) {
      o.removeFromParent();
      removed++;
    }
  }
  return removed;
}

/**
 * Removes a single part that hangs far below everything else: a stand, a
 * display board or a card the car was photographed against. No real part of
 * a car reaches 15% of its height below all its other parts.
 */
export function dropStands(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push({ o, box: box3(o) }));
  if (meshes.length < 3) return 0;
  const lowest = [...meshes].sort((a, b) => a.box.min.y - b.box.min.y);
  const [first] = lowest;
  const rest = new THREE.Box3();
  for (const m of meshes) if (m !== first) rest.union(m.box);
  const h = rest.max.y - rest.min.y;
  if (rest.min.y - first.box.min.y > 0.15 * h) {
    first.o.removeFromParent();
    return 1 + dropStands(model);
  }
  return 0;
}

/**
 * Removes parts that alone make the car much wider or longer than the rest
 * of it: a ground disc the car sits on, or a stray object left far away in
 * the scene. A real part never adds a quarter to a car's footprint, and one
 * with few triangles never adds an eighth.
 */
export function dropDebris(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const tris = (o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3;
    total += tris;
    meshes.push({ o, box: box3(o), tris });
  });
  if (meshes.length < 3) return 0;
  const whole = new THREE.Box3();
  meshes.forEach((m) => whole.union(m.box));
  const W = whole.getSize(new THREE.Vector3());
  let removed = 0;
  for (const m of meshes) {
    const rest = new THREE.Box3();
    for (const n of meshes) if (n !== m && n.o.parent) rest.union(n.box);
    if (rest.isEmpty()) continue;
    const R = rest.getSize(new THREE.Vector3());
    const grows = Math.max(W.x / R.x, W.z / R.z);
    const flat = m.box.max.y - m.box.min.y < R.y * 0.3;
    if ((grows > 1.25 && flat) || (grows > 1.12 && m.tris < total * 0.02)) {
      m.o.removeFromParent();
      removed++;
      whole.copy(rest);
      W.copy(R);
    }
  }
  return removed;
}

/** Up to `limit` vertex positions of a model's meshes, in world space, as [x, y, z, x, y, z...]. */
function samplePoints(model, limit) {
  model.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    meshes.push(o);
    total += o.geometry.attributes.position.count;
  });
  const step = Math.max(1, Math.ceil(total / limit));
  const out = [];
  const v = new THREE.Vector3();
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

/**
 * The box most of a model lies in: on each axis, from the 1st to the 99th
 * percentile of its vertices. A stray bit far from the car does not move it.
 */
function coreBox(model) {
  const pts = samplePoints(model, 150000);
  if (pts.length < 30) return null;
  const sorted = [0, 1, 2].map((axis) => {
    const values = new Float32Array(pts.length / 3);
    for (let i = axis, k = 0; i < pts.length; i += 3) values[k++] = pts[i];
    return values.sort();
  });
  const at = (axis, f) => sorted[axis][Math.min(sorted[axis].length - 1, Math.floor(sorted[axis].length * f))];
  return new THREE.Box3(new THREE.Vector3(at(0, 0.01), at(1, 0.01), at(2, 0.01)), new THREE.Vector3(at(0, 0.99), at(1, 0.99), at(2, 0.99)));
}

/**
 * Removes stray bits: meshes, or connected pieces of meshes, lying wholly
 * outside the car (its core box grown by a fifth of its size each way). A
 * stray triangle a metre past the bumper would stretch the car's box; an
 * aerial or a towing mirror touches the car and stays.
 */
export function dropStrays(model) {
  const core = coreBox(model);
  if (!core) return 0;
  const size = core.getSize(new THREE.Vector3());
  const zone = core.clone();
  zone.min.addScaledVector(size, -0.2);
  zone.max.addScaledVector(size, 0.2);
  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push(o));
  let removed = 0;
  const v = new THREE.Vector3();
  for (const o of meshes) {
    const b = box3(o);
    if (zone.containsBox(b)) continue;
    if (!zone.intersectsBox(b)) {
      o.removeFromParent();
      removed++;
      continue;
    }
    // Partly outside: only the pieces that are wholly outside go.
    const { piece, count } = meshPieces(o);
    if (count < 2) continue;
    const boxes = Array.from({ length: count }, () => new THREE.Box3());
    const g = o.geometry, pos = g.attributes.position, index = g.index;
    for (let t = 0; t < piece.length; t++) {
      for (let c = 0; c < 3; c++) boxes[piece[t]].expandByPoint(v.fromBufferAttribute(pos, index ? index.getX(t * 3 + c) : t * 3 + c).applyMatrix4(o.matrixWorld));
    }
    const stray = boxes.map((pb) => !zone.intersectsBox(pb));
    if (!stray.some(Boolean)) continue;
    const out = splitMesh(o, Int8Array.from(piece, (k) => (stray[k] ? 1 : 0)), (c) => (c ? `${o.name} stray` : o.name));
    const gone = out?.get(1) ?? (out ? null : stray.every(Boolean) ? o : null);
    if (gone) {
      gone.removeFromParent();
      gone.geometry.dispose();
      removed++;
    }
  }
  return removed;
}

/**
 * The turn about the vertical that squares a car up with the axes: the angle
 * giving the smallest rectangle around its footprint seen from above. A model
 * exported at an angle is turned square; one already square stays (only a
 * footprint more than 5% smaller counts). Radians.
 */
export function footprintTurn(model) {
  const pts = samplePoints(model, 40000);
  if (pts.length < 30) return 0;
  const area = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i] * c - pts[i + 2] * s, z = pts[i] * s + pts[i + 2] * c;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return (x1 - x0) * (z1 - z0);
  };
  const square = area(0);
  let best = { a: 0, area: square };
  const deg = THREE.MathUtils.degToRad;
  for (let d = -45; d <= 45; d += 1) {
    const r = { a: deg(d), area: area(deg(d)) };
    if (r.area < best.area) best = r;
  }
  for (let d = -1; d <= 1; d += 0.1) {
    const a = best.a + deg(d), r = area(a);
    if (r < best.area) best = { a, area: r };
  }
  return best.area < square * 0.95 ? best.a : 0;
}

/** Whether a matrix only moves, scales, mirrors and turns by quarter turns: a box measured through it stays tight. */
function isSquare(m) {
  const e = m.elements;
  for (const c of [0, 4, 8]) {
    const len = Math.hypot(e[c], e[c + 1], e[c + 2]) || 1;
    for (let k = 0; k < 3; k++) {
      const v = Math.abs(e[c + k]) / len;
      if (v > 1e-3 && v < 1 - 1e-3) return false;
    }
  }
  return true;
}

/**
 * Bakes the transform of every mesh turned by an odd angle into its geometry.
 * Boxes are measured from each mesh's own bounding box, which such a turn
 * swells (a car exported at an angle measures far too wide); baked, the box
 * is tight. The mesh keeps its place in the scene with a fixed matrix, and
 * geometry shared between meshes is copied first.
 */
export function squareMeshes(root) {
  root.updateMatrixWorld(true);
  const users = new Map();
  root.traverse((o) => o.isMesh && users.set(o.geometry, (users.get(o.geometry) ?? 0) + 1));
  let baked = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.parent || o.isSkinnedMesh || isSquare(o.matrixWorld)) return;
    if (users.get(o.geometry) > 1) o.geometry = o.geometry.clone();
    // Quantised positions and normals (small integers scaled by the node)
    // cannot hold turned values: they become plain floats first.
    for (const name of ["position", "normal", "tangent"]) {
      const a = o.geometry.attributes[name];
      if (a && !(a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute)) o.geometry.setAttribute(name, toFloat(a));
    }
    o.geometry.applyMatrix4(o.matrixWorld);
    o.matrix.copy(o.parent.matrixWorld).invert();
    o.matrixAutoUpdate = false;
    baked++;
  });
  root.updateMatrixWorld(true);
  return baked;
}

/** A copy of an attribute as plain 32-bit floats, read through its own scaling. */
function toFloat(a) {
  const n = a.itemSize, out = new Float32Array(a.count * n);
  const src = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  const stride = a.isInterleavedBufferAttribute ? a.data.stride : n, offset = a.isInterleavedBufferAttribute ? a.offset : 0;
  // glTF's normalised integers, as three.js reads them.
  const scale = !a.normalized ? 0 : src instanceof Int8Array ? 127 : src instanceof Uint8Array ? 255 : src instanceof Int16Array ? 32767 : src instanceof Uint16Array ? 65535 : 0;
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const v = src[i * stride + offset + k];
      out[i * n + k] = scale ? Math.max(v / scale, -1) : v;
    }
  }
  return new THREE.BufferAttribute(out, n);
}

/** Which way the nose points along z, from what the parts are called: +1, -1 or 0 (no idea). */
export function frontVote(root) {
  const box = box3(root);
  const mid = box.getCenter(new THREE.Vector3()).z;
  const len = box.getSize(new THREE.Vector3()).z || 1;
  let vote = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const along = (box3(o).getCenter(new THREE.Vector3()).z - mid) / len;
    if (Math.abs(along) < 0.08) return;
    // A rear-view mirror is not at the rear.
    const l = label(o).replace(/\brear ?view\b/g, "");
    const side = Math.sign(along);
    for (const [re, w] of FRONT) if (re.test(l)) vote += w * side;
    for (const [re, w] of REAR) if (re.test(l)) vote -= w * side;
    // A mirror at the car's side at waist height is a door mirror.
    const b = box3(o), c = b.getCenter(new THREE.Vector3());
    const h = (c.y - box.min.y) / (box.max.y - box.min.y || 1);
    if (DOOR_MIRROR.test(nodeLabel(o).replace(/\brear ?view\b/g, "")) && Math.abs(c.x - (box.min.x + box.max.x) / 2) > 0.35 * (box.max.x - box.min.x) && h > 0.45 && h < 0.85) vote += side;
  });
  if (vote !== 0) return Math.sign(vote);
  return tailLampVote(root) || grilleVote(root);
}

/**
 * When neither names nor lamps say: the front face has a grille and intakes,
 * whose bars and holes break the surface up, while a boot lid or tailgate is
 * smooth. Counts the depth breaks across the middle of each end, seen square
 * on; only a clear difference counts (a mid-engined car's rear vents, or a
 * convertible's seats seen from behind, come close and are left alone).
 */
export function grilleVote(root) {
  const box = box3(root);
  const W = box.max.x - box.min.x;
  const raster = renderViews(root, { size: 160, views: [{ az: 0, el: 4, line: "front" }, { az: 180, el: 4, line: "rear" }] });
  const [front, rear] = raster.views.map((v) => {
    let breaks = 0, total = 0;
    for (let y = 1; y < v.height; y++) {
      const h = (y + 0.5) / v.height;
      if (h < 0.2 || h > 0.55) continue;
      for (let x = 1; x < v.width; x++) {
        if (Math.abs((x + 0.5) / v.scale + v.minX) > 0.3 * W) continue;
        const p = y * v.width + x;
        if (v.ids[p] < 0) continue;
        total++;
        const left = p - 1, below = p - v.width;
        if (v.ids[left] < 0 || v.ids[below] < 0 || Math.abs(v.depth[p] - v.depth[left]) > 0.03 || Math.abs(v.depth[p] - v.depth[below]) > 0.03) breaks++;
      }
    }
    return total ? breaks / total : 0;
  });
  if (Math.max(front, rear) < 0.15 || Math.max(front, rear) < 2.5 * Math.min(front, rear)) return 0;
  return front > rear ? 1 : -1;
}

/**
 * When names say nothing: red parts at the ends of the car are its tail lamps
 * (behind a clear lens or not, and light bars of any width). Each votes with
 * its face area, so a full-width light bar outweighs a small reflector. Large
 * panels (a red car's body) do not count.
 */
export function tailLampVote(root) {
  const box = box3(root);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3()).z;
  const red = (c) => c && c.r > 0.15 && c.r > 3 * c.g && c.r > 3 * c.b;
  const isRed = (m) => red(m?.color) || (m?.emissive && red(m.emissive) && m.emissiveIntensity > 0);
  const ends = [0, 0];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = box3(o);
    const s = b.getSize(new THREE.Vector3());
    const along = (b.getCenter(new THREE.Vector3()).z - mid) / (size.z || 1);
    if (Math.abs(along) < 0.38 || s.z > size.z * 0.25 || s.x > size.x * 0.97 || s.y > size.y * 0.5) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(isRed)) ends[along > 0 ? 0 : 1] += s.x * s.y;
  });
  const [front, rear] = ends;
  // Next to nothing either way says nothing.
  if (Math.max(front, rear) < 2 * Math.min(front, rear) || Math.max(front, rear) < 0.002 * size.x * size.y) return 0;
  return rear > front ? 1 : -1;
}

/**
 * Decides the car's length in metres:
 *   1. the published length, when the catalogue has one;
 *   2. the model's own length, when it is a believable size for the body
 *      style in metres, centimetres or millimetres;
 *   3. a typical length for the body style.
 */
export function chooseLength(rawLength, entry) {
  const published = entry?.dimensions?.length;
  if (published) return { metres: published / 1000, source: "published" };
  // A size is believable when it is within a quarter of what the body style
  // usually measures (a 3 m saloon is a model made to the wrong scale).
  const typical = TYPICAL_LENGTH[entry?.bodyStyle];
  const [lo, hi] = typical ? [typical * 0.75, typical * 1.25] : [2.6, 7];
  for (const [unit, factor] of [["m", 1], ["cm", 0.01], ["mm", 0.001]]) {
    const m = rawLength * factor;
    if (m >= lo && m <= hi) return { metres: m, source: `model (${unit})` };
  }
  return { metres: typical ?? 4.6, source: "typical" };
}

/**
 * Wraps a loaded model in `root > orient > model` and normalises it.
 * Returns the root and what was decided, for the vehicle info panel and logs.
 */
export function normalize(model, entry) {
  dropLines(model);
  const removed = dropFloor(model) + dropBoards(model) + dropStands(model) + dropDebris(model) + dropStrays(model);
  const orient = new THREE.Group();
  orient.name = "orient";
  orient.add(model);
  const root = new THREE.Group();
  root.name = "vehicle";
  root.add(orient);
  // Turns about the world's axes, one after the other.
  const turn = (axis, angle) => {
    orient.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    root.updateMatrixWorld(true);
  };
  const Y = new THREE.Vector3(0, 1, 0);

  // A model standing on its nose or tail (height the largest side) is laid down.
  let size = box3(root).getSize(new THREE.Vector3());
  if (size.y > Math.max(size.x, size.z) * 1.15) turn(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  // A model exported at an angle is squared up, then its long side runs along z.
  const squared = footprintTurn(root);
  if (squared) turn(Y, -squared);
  squareMeshes(root);
  size = box3(root).getSize(new THREE.Vector3());
  if (size.x > size.z) turn(Y, Math.PI / 2);
  if (frontVote(root) < 0) turn(Y, Math.PI);

  size = box3(root).getSize(new THREE.Vector3());
  const length = chooseLength(size.z, entry);
  orient.scale.multiplyScalar(length.metres / size.z);
  root.updateMatrixWorld(true);
  const box = box3(root);
  const centre = box.getCenter(new THREE.Vector3());
  orient.position.set(-centre.x, -box.min.y, -centre.z);
  root.updateMatrixWorld(true);

  return { root, orient, lengthSource: length.source, floorsRemoved: removed, squared: Math.round(THREE.MathUtils.radToDeg(squared) * 10) / 10 };
}

/**
 * After the wheels are found, sits the car on its tyres rather than on its
 * lowest vertex (a hanging exhaust or a stray part must not float the car).
 */
export function groundOnWheels(root, orient, wheels) {
  if (!wheels) return 0;
  const lowest = Math.min(...wheels.map((w) => w.box.min.y));
  const height = box3(root).getSize(new THREE.Vector3()).y;
  if (!(Math.abs(lowest) > 0.002 && Math.abs(lowest) < height * 0.08)) return 0;
  orient.position.y -= lowest;
  root.updateMatrixWorld(true);
  for (const w of wheels) w.box.translate(new THREE.Vector3(0, -lowest, 0));
  return -lowest;
}
