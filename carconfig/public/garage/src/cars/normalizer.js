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
  return Math.sign(vote);
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
  const removed = dropFloor(model);
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
