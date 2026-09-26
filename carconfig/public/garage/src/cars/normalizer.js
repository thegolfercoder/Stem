// Putting any downloaded car the same way up, the same size and in the same
// place: nose toward +z, wheels on y = 0, centred on the origin, in metres.
// Nothing is hard-coded per model; everything comes from the model's own
// bounding box, its part names and the published length when one is known.
import * as THREE from "three";
import { label } from "./names.js";

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
const REAR = [
  [/\b(tail ?lights?|tail ?lamps?|taillamps?|brake ?lights?|reverse ?lights?|feux arriere|ruckleuchten?)\b/, 3],
  [/\b(exhausts?|muffler|tailpipes?|auspuff\w*|scarico)\b/, 2],
  [/\b(trunk|boot|diffuser|kofferraum)\b/, 2],
  [/\b(rear|back|arriere|posteriore|trasero|hinten|heck\w*)\b/, 1],
];

const box3 = (o) => new THREE.Box3().setFromObject(o);

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
    const l = label(o);
    const side = Math.sign(along);
    for (const [re, w] of FRONT) if (re.test(l)) vote += w * side;
    for (const [re, w] of REAR) if (re.test(l)) vote -= w * side;
  });
  if (vote !== 0) return Math.sign(vote);
  return Math.sign(tailLampVote(root, box, mid, len));
}

/**
 * When names say nothing: small, strongly red parts at one end of the car are
 * its tail lamps (red paint is a large surface and does not count).
 */
function tailLampVote(root, box, mid, len) {
  const width = box.max.x - box.min.x;
  let vote = 0;
  const red = (c) => c && c.r > 0.15 && c.r > 3 * c.g && c.r > 3 * c.b;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = box3(o);
    const s = b.getSize(new THREE.Vector3());
    const along = (b.getCenter(new THREE.Vector3()).z - mid) / len;
    if (Math.abs(along) < 0.38 || s.x > width * 0.6 || s.z > len * 0.25) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => red(m?.color) || (m?.emissive && red(m.emissive) && m.emissiveIntensity > 0))) vote -= Math.sign(along);
  });
  return vote;
}

/**
 * Decides the car's length in metres:
 *   1. the published length, when the catalogue has one;
 *   2. the model's own length, when it is a believable car size in metres,
 *      centimetres or millimetres;
 *   3. a typical length for the body style.
 */
export function chooseLength(rawLength, entry) {
  const published = entry?.dimensions?.length;
  if (published) return { metres: published / 1000, source: "published" };
  for (const [unit, factor] of [["m", 1], ["cm", 0.01], ["mm", 0.001]]) {
    const m = rawLength * factor;
    if (m >= 2.6 && m <= 7) return { metres: m, source: `model (${unit})` };
  }
  return { metres: TYPICAL_LENGTH[entry?.bodyStyle] ?? 4.6, source: "typical" };
}

/**
 * Wraps a loaded model in `root > orient > model` and normalises it.
 * Returns the root and what was decided, for the vehicle info panel and logs.
 */
export function normalize(model, entry) {
  const removed = dropFloor(model) + dropBoards(model) + dropStands(model) + dropDebris(model);
  const orient = new THREE.Group();
  orient.name = "orient";
  orient.add(model);
  const root = new THREE.Group();
  root.name = "vehicle";
  root.add(orient);

  // A model standing on its nose or tail (height the largest side) is laid down.
  let size = box3(root).getSize(new THREE.Vector3());
  if (size.y > Math.max(size.x, size.z) * 1.15) {
    orient.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    size = box3(root).getSize(new THREE.Vector3());
  }
  // The long side runs along z.
  if (size.x > size.z) orient.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  if (frontVote(root) < 0) {
    orient.rotation.y += Math.PI;
    root.updateMatrixWorld(true);
  }

  size = box3(root).getSize(new THREE.Vector3());
  const length = chooseLength(size.z, entry);
  orient.scale.multiplyScalar(length.metres / size.z);
  root.updateMatrixWorld(true);
  const box = box3(root);
  const centre = box.getCenter(new THREE.Vector3());
  orient.position.set(-centre.x, -box.min.y, -centre.z);
  root.updateMatrixWorld(true);

  return { root, orient, lengthSource: length.source, floorsRemoved: removed };
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
