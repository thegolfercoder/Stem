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
