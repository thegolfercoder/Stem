import { describe, expect, it } from "vitest";
import * as THREE from "three";
// Plain JavaScript modules of the static Carbon Garage app.
// @ts-expect-error untyped module
import { chooseLength, dropFloor, dropStands, dropDebris, normalize } from "../public/garage/src/cars/normalizer.js";
// @ts-expect-error untyped module
import { choosePaint } from "../public/garage/src/cars/detector.js";
// @ts-expect-error untyped module
import { cleanBuild, isFactory } from "../public/garage/src/state/persistence.js";
// @ts-expect-error untyped module
import { matches, metaLine } from "../public/garage/src/cars/catalog.js";
// @ts-expect-error untyped module
import { FACTORY } from "../public/garage/src/config.js";
import catalog from "../public/garage/data/vehicles.json";

const box = (w: number, h: number, d: number, at: [number, number, number], name = "") => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
  m.position.set(...at);
  m.name = name;
  return m;
};

/** A crude car: body plus four wheels, 4.5 m long along the given axis. */
function toyCar(longAxis: "x" | "z" = "z") {
  const g = new THREE.Group();
  const [L, W] = [4.5, 1.8];
  const along = (z: number, x: number): [number, number, number] => (longAxis === "z" ? [x, 0, z] : [z, 0, x]);
  const body = box(longAxis === "z" ? W : L, 1, longAxis === "z" ? L : W, [0, 0.8, 0], "body");
  g.add(body);
  for (const z of [-1.4, 1.4]) for (const x of [-0.8, 0.8]) {
    const [px, , pz] = along(z, x);
    g.add(box(0.25, 0.66, 0.66, [px, 0.33, pz], "wheel"));
  }
  return g;
}

describe("garage: sizing a model", () => {
  it("uses the published length first", () => {
    expect(chooseLength(123, { dimensions: { length: 4572 } })).toEqual({ metres: 4.572, source: "published" });
  });
  it("reads metres, centimetres and millimetres", () => {
    expect(chooseLength(4.5, {}).source).toBe("model (m)");
    expect(chooseLength(450, {}).metres).toBeCloseTo(4.5);
    expect(chooseLength(4500, {}).metres).toBeCloseTo(4.5);
  });
  it("falls back to a typical length for the body style", () => {
    expect(chooseLength(1, { bodyStyle: "Pickup" })).toEqual({ metres: 5.6, source: "typical" });
  });
});

describe("garage: normalising a model", () => {
  it("turns a sideways car nose-along-z, grounds and centres it", () => {
    const model = toyCar("x");
    model.position.set(10, 3, -7);
    const { root } = normalize(model, { dimensions: { length: 4500 } });
    const b = new THREE.Box3().setFromObject(root);
    const s = b.getSize(new THREE.Vector3());
    expect(s.z).toBeCloseTo(4.5, 2);
    expect(s.x).toBeLessThan(s.z);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 5);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 5);
  });
  it("removes a display plinth but keeps the car", () => {
    const model = toyCar();
    model.add(box(4, 0.1, 7, [0, -0.1, 0], "plinth"));
    expect(dropFloor(model)).toBe(1);
    expect(model.children.some((c) => c.name === "plinth")).toBe(false);
  });
  it("removes a board standing below the car", () => {
    const model = toyCar();
    for (const c of model.children) c.position.y += 0.45;
    model.add(box(1.8, 1.7, 0.2, [0, 0.85, -2.4], "board"));
    expect(dropStands(model)).toBe(1);
    expect(model.children.some((c) => c.name === "board")).toBe(false);
  });
  it("removes a ground disc much wider than the car", () => {
    const model = toyCar();
    model.add(box(12, 0.05, 12, [0, 0.3, 0], "disc"));
    expect(dropDebris(model)).toBe(1);
    expect(model.children.length).toBe(5);
  });
});

describe("garage: finding the paint", () => {
  const stat = (id: number, name: string, rgb: number[], area: number, extra = {}) => ({
    id, name, kind: null, rgb, opacity: 1, hasMap: false, area, span: 0.9, height: 0.5, ...extra,
  });
  it("takes materials named as paint", () => {
    expect(choosePaint([stat(0, "CarPaint", [0.5, 0, 0], 10), stat(1, "Rubber", [0.02, 0.02, 0.02], 5, { kind: "tyre" })])).toEqual({ how: "named", ids: [0] });
  });
  it("groups a body split into shades of one hue", () => {
    const shades = [stat(0, "color_1", [0.02, 0.1, 0.4], 30), stat(1, "color_2", [0.01, 0.07, 0.3], 8), stat(2, "color_3", [0.4, 0.4, 0.4], 20)];
    expect(choosePaint(shades).ids.sort()).toEqual([0, 1]);
  });
  it("offers nothing when one material covers everything", () => {
    expect(choosePaint([stat(0, "Material", [1, 1, 1], 100)]).how).toBe("none");
  });
});

describe("garage: saved builds", () => {
  it("keeps valid options and drops everything else", () => {
    const b = cleanBuild({ paint: { hex: "#B60F16", finish: "solid", name: "Guards Red" }, rims: "black", tint: "limo", ride: "slammed", evil: 1 });
    expect(b.paint).toEqual({ hex: "#b60f16", finish: "solid", name: "Guards Red" });
    expect(b.rims).toBe("black");
    expect(b.tint).toBe("limo");
    expect(b.ride).toBe("factory");
    expect("evil" in b).toBe(false);
  });
  it("rejects malformed colours", () => {
    expect(cleanBuild({ paint: { hex: "red", finish: "solid" } }).paint).toBeNull();
    expect(cleanBuild({ paint: { hex: "#123456", finish: "glitter" } }).paint).toBeNull();
  });
  it("knows a factory build", () => {
    expect(isFactory({ ...FACTORY })).toBe(true);
    expect(isFactory({ ...FACTORY, lights: "on" })).toBe(false);
  });
});

describe("garage: the vehicle list", () => {
  const vehicles = catalog.vehicles;
  it("has every car's facts and a local model", () => {
    for (const v of vehicles) {
      expect(v.manufacturer && v.model && v.category && v.bodyStyle).toBeTruthy();
      expect(v.modelPath).toMatch(/\.glb$/);
    }
    expect(new Set(vehicles.map((v) => v.id)).size).toBe(vehicles.length);
  });
  it("searches across make, model and generation", () => {
    const gt3 = vehicles.find((v) => v.id === "porsche/911-gt3-rs");
    expect(matches(gt3, { query: "porsche 992" })).toBe(true);
    expect(matches(gt3, { query: "bmw" })).toBe(false);
    expect(matches(gt3, { make: "Porsche", category: "Sports" })).toBe(true);
    expect(metaLine(gt3)).toBe("992 · Coupe · 2023");
  });
});

// ---------------------------------------------------------------- detection

// @ts-expect-error untyped module
import { kindOf } from "../public/garage/src/cars/names.js";
// @ts-expect-error untyped module
import { fillsWindowLine, WINDOW, classifyPieces, PIECE, tyreZones, detectParts, wheelsByShape } from "../public/garage/src/cars/detector.js";
// @ts-expect-error untyped module
import { splitMesh, meshPieces } from "../public/garage/src/cars/geometry.js";
// @ts-expect-error untyped module
import { survey } from "../public/garage/src/cars/visibility.js";
// @ts-expect-error untyped module
import { dropLines, dropStrays, footprintTurn, squareMeshes, tailLampVote, grilleVote } from "../public/garage/src/cars/normalizer.js";

const mat = (name: string, hex = 0x888888, extra: Record<string, unknown> = {}) => Object.assign(new THREE.MeshStandardMaterial({ color: hex }), { name }, extra);
const part = (w: number, h: number, d: number, at: [number, number, number], material: THREE.Material, name = "") => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(...at);
  m.name = name;
  return m;
};
const tyre = (x: number, z: number, material: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 24), material);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, 0.33, z);
  return m;
};

/**
 * A plain car, nose +z, 4.5 m long, without any names: a body, a roof on four
 * pillars, side windows, a windscreen and rear window, and four tyres.
 */
function plainCar({ windows = true, body = mat("m0", 0xb00000) } = {}) {
  const g = new THREE.Group();
  const glass = mat("m1", 0x101418, { roughness: 0.05 });
  const rubber = mat("m2", 0x151515);
  g.add(part(1.8, 0.55, 4.5, [0, 0.62, 0], body));
  g.add(part(1.5, 0.08, 2.1, [0, 1.36, -0.2], body));
  for (const x of [-0.72, 0.72]) for (const z of [-1.2, 0.0, 0.82]) g.add(part(0.06, 0.48, 0.12, [x, 1.1, z], body));
  if (windows) {
    for (const x of [-0.73, 0.73]) for (const [z, d] of [[-0.6, 1.1], [0.41, 0.7]] as const) g.add(part(0.03, 0.42, d, [x, 1.1, z], glass));
    g.add(part(1.4, 0.42, 0.04, [0, 1.1, 0.86], glass));
    g.add(part(1.4, 0.42, 0.04, [0, 1.1, -1.24], glass));
  }
  for (const x of [-0.78, 0.78]) for (const z of [-1.4, 1.4]) g.add(tyre(x, z, rubber));
  return g;
}

/** A clay car whose greenhouse, windows and all, is one block of the body material. */
function fusedCar() {
  const g = new THREE.Group();
  const clay = mat("clay", 0xcccccc);
  g.add(part(1.8, 0.55, 4.5, [0, 0.62, 0], clay));
  g.add(part(1.5, 0.5, 2.1, [0, 1.12, -0.2], clay));
  for (const x of [-0.78, 0.78]) for (const z of [-1.4, 1.4]) g.add(tyre(x, z, mat("t", 0x111111)));
  return g;
}

describe("garage: names of parts", () => {
  it("tells windows, lamp covers and mirror glass apart", () => {
    expect(kindOf("windowglass")).toBe("glass");
    expect(kindOf("szyba_przednia")).toBe("glass");
    expect(kindOf("redglass")).toBe("lens");
    expect(kindOf("clearglass")).toBe("lens");
    expect(kindOf("clear_glass")).toBe("glass"); // could be a window
    expect(kindOf("Mirror_glass")).toBe("mirror");
    expect(kindOf("Window_Frame")).toBeNull();
  });
});

describe("garage: paint by what is seen", () => {
  const stat = (id: number, name: string, rgb: number[], area: number, extra = {}) => ({
    id, name, kind: null, rgb, opacity: 1, hasMap: false, area, span: 0.9, height: 0.5, ...extra,
  });
  it("prefers the most visible panel to a hidden one with more area", () => {
    const chassis = stat(0, "m0", [0.02, 0.02, 0.02], 60, { vis: 0.05 });
    const body = stat(1, "m1", [0.5, 0.1, 0.1], 20, { vis: 0.6 });
    expect(choosePaint([chassis, body]).ids).toEqual([1]);
  });
  it("never paints what fills the window line, even the body's colour", () => {
    const body = stat(0, "m0", [0.01, 0.01, 0.01], 20, { vis: 0.6 });
    const glass = stat(1, "m1", [0.01, 0.01, 0.01], 5, { vis: 0.15, window: true });
    expect(choosePaint([body, glass]).ids).toEqual([0]);
  });
  it("lets the door skins decide when black trim outweighs the body", () => {
    const trim = stat(0, "black", [0.0, 0.0, 0.0], 60, { vis: 0.57, doors: 0.05 });
    const body = stat(1, "grey", [0.2, 0.2, 0.2], 15, { vis: 0.27, doors: 0.95 });
    expect(choosePaint([trim, body]).ids).toEqual([1]);
  });
  it("treats a 'paint' that makes up hardly any of the outside as a detail", () => {
    const detail = stat(0, "exterior", [1, 1, 1], 8, { vis: 0.01 });
    const body = stat(1, "white", [0.9, 0.9, 0.9], 20, { vis: 0.48, doors: 0.94 });
    expect(choosePaint([detail, body])).toEqual({ how: "largest", ids: [1] });
  });
  it("drops a textured body atlas that stays off the doors", () => {
    const paint = stat(0, "Paint", [0.2, 0.2, 0.2], 25, { vis: 0.52, doors: 1 });
    const atlas = stat(1, "Car_Body", [1, 1, 1], 54, { vis: 0.4, doors: 0, hasMap: true });
    expect(choosePaint([paint, atlas])).toEqual({ how: "named", ids: [0] });
  });
});

describe("garage: the window line", () => {
  it("accepts a window and rejects trim, pillars and seats seen through an empty frame", () => {
    const window = { inBand: 0.9, reach: 0.6, bandShare: 0.35, cover: 0.55, behind: -0.1 };
    expect(fillsWindowLine(window, WINDOW)).toBe(true);
    expect(fillsWindowLine({ ...window, cover: 0.1 }, WINDOW)).toBe(false); // a trim strip
    expect(fillsWindowLine({ ...window, reach: 0.08 }, WINDOW)).toBe(false); // a pillar
    expect(fillsWindowLine({ ...window, behind: 0.4 }, WINDOW)).toBe(false); // a seat
  });
  it("reads unnamed windows from a car's views", () => {
    const car = plainCar();
    const sv = survey(car);
    const glass = [...sv.materials].find(([m]) => m.name === "m1")!;
    const body = [...sv.materials].find(([m]) => m.name === "m0")!;
    expect(fillsWindowLine(glass[1].band, WINDOW)).toBe(true);
    expect(fillsWindowLine(body[1].band, WINDOW)).toBe(false);
    expect(body[1].vis).toBeGreaterThan(glass[1].vis);
  });
  it("finds openings where the windows are, and none in a body without them", () => {
    expect(survey(fusedCar()).openings(() => true)).toBe(0);
    const sv = survey(plainCar());
    const body = new Set([...sv.slots.values()].filter((s) => s.material.name === "m0").map((s) => s.key));
    expect(sv.openings((t: number) => body.has(sv.keyOfTriangle(t)))).toBeGreaterThan(0.6);
    // An open cabin (no glass at all) is open too: seats or sky show through.
    expect(survey(plainCar({ windows: false })).openings(() => true)).toBeGreaterThan(0.6);
  });
});

describe("garage: a whole car without names", () => {
  it("paints the body, tints the windows and keeps the tyres black", () => {
    const car = plainCar();
    const wheels = wheelsByShape(car);
    expect(wheels).not.toBeNull();
    const parts = detectParts(car, wheels);
    const names = (slots: { original: THREE.Material }[]) => [...new Set(slots.map((s) => s.original.name))].sort();
    expect(names(parts.paint)).toEqual(["m0"]);
    expect(names(parts.glass)).toEqual(["m1"]);
    expect(parts.capabilities.wheels).toBe(true);
  });
  it("leaves paint hidden when the windows are part of the body", () => {
    const g = fusedCar();
    const parts = detectParts(g, wheelsByShape(g));
    expect(parts.capabilities.paint).toBe(false);
    expect(parts.paintNote).toBeTruthy();
  });
});

describe("garage: pieces of merged meshes", () => {
  it("finds the connected pieces of one mesh, across split vertices", () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const b = new THREE.BoxGeometry(1, 1, 1).translate(3, 0, 0).toNonIndexed();
    const merged = new THREE.BufferGeometry();
    const corners = (g: THREE.BufferGeometry) => [...(g.getAttribute("position").array as Float32Array)];
    merged.setAttribute("position", new THREE.Float32BufferAttribute([...corners(a), ...corners(b)], 3));
    const { piece, count } = meshPieces(new THREE.Mesh(merged));
    expect(count).toBe(2);
    expect(new Set(piece.slice(0, 12)).size).toBe(1);
  });
  it("splits a mesh by the class of each triangle, keeping its place", () => {
    const parent = new THREE.Group();
    const mesh = part(1, 1, 1, [2, 0, 0], mat("x"), "box");
    parent.add(mesh);
    const classes = Int8Array.from({ length: 12 }, (_, k) => (k < 4 ? 1 : 0));
    const out = splitMesh(mesh, classes);
    expect(out.size).toBe(2);
    expect(out.get(1).geometry.attributes.position.count).toBe(12);
    expect(out.get(0).position.x).toBe(2);
    expect(mesh.parent).toBeNull();
  });
  it("gives pieces inside a wheel to the wheel and keeps found tyres out of paint", () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -2.25), new THREE.Vector3(1, 1.4, 2.25));
    const piece = (id: number, min: number[], max: number[], vis = 0.1) => ({ id, vis, box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) });
    const wheel = { corner: "fl", box: new THREE.Box3(new THREE.Vector3(0.6, 0, 1.1), new THREE.Vector3(0.95, 0.66, 1.7)) };
    const pieces = [piece(0, [0.65, 0.1, 1.2], [0.9, 0.5, 1.6]), piece(1, [-0.9, 0.3, -2], [0.9, 0.9, 2])];
    const classes = classifyPieces(pieces, () => "paint", { wheels: [wheel], box });
    expect(classes[0]).toBe(PIECE.fl);
    expect(classes[1]).toBe(PIECE.paint);
    const tyres = tyreZones([piece(0, [0.67, 0, 1.07], [0.89, 0.66, 1.73])], box);
    expect(tyres.length).toBe(1);
  });
});

describe("garage: putting models straight", () => {
  it("drops CAD edge lines", () => {
    const g = plainCar();
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-9, 0, 0), new THREE.Vector3(9, 0, 0)])));
    expect(dropLines(g)).toBe(1);
  });
  it("removes a stray piece far from the car but keeps the car", () => {
    const g = plainCar();
    const speck = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.5, 9), new THREE.Vector3(0.02, 0.5, 9), new THREE.Vector3(0, 0.52, 9)]), mat("stray"));
    g.add(speck);
    expect(dropStrays(g)).toBe(1);
    expect(new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).z).toBeCloseTo(4.5, 1);
  });
  it("squares up a car exported at an angle", () => {
    const g = plainCar();
    const root = new THREE.Group();
    root.add(g);
    expect(footprintTurn(root)).toBe(0);
    g.rotation.y = THREE.MathUtils.degToRad(28);
    root.updateMatrixWorld(true);
    expect(THREE.MathUtils.radToDeg(footprintTurn(root))).toBeCloseTo(28, 0);
  });
  it("bakes an odd turn into the geometry so boxes stay tight", () => {
    const root = new THREE.Group();
    const m = part(4, 1, 1, [0, 0, 0], mat("x"));
    m.rotation.y = THREE.MathUtils.degToRad(30);
    root.add(m);
    root.rotation.y = THREE.MathUtils.degToRad(-30);
    expect(new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).x).toBeCloseTo(4, 3);
    const loose = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).x;
    expect(loose).toBeCloseTo(4, 3);
    m.rotation.y = THREE.MathUtils.degToRad(17);
    root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).x).toBeGreaterThan(3.9);
    expect(squareMeshes(root)).toBe(1);
    const precise = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(box.x).toBeCloseTo(precise.x, 5);
    expect(box.z).toBeCloseTo(precise.z, 5);
  });
  it("only believes a model's own size when it suits the body style", () => {
    expect(chooseLength(3.05, { bodyStyle: "Sedan" }).source).toBe("typical");
    expect(chooseLength(4.8, { bodyStyle: "Sedan" })).toEqual({ metres: 4.8, source: "model (m)" });
  });
  it("finds the tail by its red lamps, and the front by its grille", () => {
    const car = plainCar({ body: mat("m0", 0xdddddd) });
    for (const x of [-0.6, 0.6]) car.add(part(0.35, 0.12, 0.05, [x, 0.75, -2.27], mat("l", 0xff0000)));
    expect(tailLampVote(car)).toBe(1);
    const grille = new THREE.Group();
    for (let i = 0; i < 9; i++) grille.add(part(1.0, 0.025, 0.05, [0, 0.45 + i * 0.05, 2.28], mat("g", 0x222222)));
    const plain = plainCar({ body: mat("m0", 0xdddddd) });
    plain.add(grille);
    expect(grilleVote(plain)).toBe(1);
  });
});
