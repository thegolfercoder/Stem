// A loaded car, ready for the studio: normalised, its parts found, its own
// materials upgraded, and able to take a build (paint, wheels, glass...).
import * as THREE from "three";
import { normalize, groundOnWheels } from "./normalizer.js";
import { detectParts, wheelsByName, wheelsByShape } from "./detector.js";
import { materialsOf, kindOf } from "./names.js";
import { factoryPaint, paintMaterial } from "../materials/paint.js";
import { factoryGlass, glassMaterial, lensMaterial } from "../materials/glass.js";
import { rimMaterial, caliperMaterial, factoryTyre, finishMaterial, carbonMaterial, forgetMaterialsOf } from "../materials/wheels.js";
import { upgradeSurface, sharpenTextures, texturesOf } from "../materials/surfaces.js";
import { RIM_FINISHES, CALIPERS, TRIMS, ACCENTS, EXHAUSTS, TINTS, RIDES } from "../config.js";

export const CAR_LAYER = 1;
const byId = (list, id) => list.find((o) => o.id === id);

function setSlot(slot, material) {
  if (slot.index === null) slot.mesh.material = material;
  else {
    // Multi-material meshes share their array between clones; give each mesh its own.
    if (!slot.mesh.userData.ownArray) {
      slot.mesh.material = slot.mesh.material.slice();
      slot.mesh.userData.ownArray = true;
    }
    slot.mesh.material[slot.index] = material;
  }
}

export class Vehicle {
  /**
   * @param {object} gltf a parsed glTF
   * @param {object} entry the catalogue entry
   * @param {{anisotropy:number}} options
   */
  constructor(gltf, entry, { anisotropy = 4 } = {}) {
    this.entry = entry;
    this.gltf = gltf;
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = true;
      // Lights and cameras shipped inside a model would fight the studio's own.
      if (o.isLight || o.isCamera) o.visible = false;
    });

    const { root, orient, lengthSource, floorsRemoved } = normalize(model, entry);
    const length = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).z;
    const wheels = wheelsByName(root, length) ?? wheelsByShape(root);
    const groundShift = groundOnWheels(root, orient, wheels);
    this.parts = detectParts(root, wheels);
    this.caps = this.parts.capabilities;
    this.wheelInfo = wheels;

    // Scene graph: car > body (moves with ride height) + wheels (stay put).
    this.body = new THREE.Group();
    this.body.name = "body";
    this.body.add(root);
    this.wheels = new THREE.Group();
    this.wheels.name = "wheels";
    this.object = new THREE.Group();
    this.object.name = entry.id;
    this.object.add(this.body, this.wheels);
    this.object.updateMatrixWorld(true);
    if (wheels) for (const w of wheels) for (const m of w.meshes) this.wheels.attach(m);

    // Factory look: each original material replaced once by its upgraded version.
    this.factory = new Map();
    const paintMats = new Set(this.parts.paint.map((s) => s.original));
    const tyreMats = new Set(this.parts.tyres.map((s) => s.original));
    const glassMats = new Set(this.parts.glass.map((s) => s.original));
    const lensMats = new Set(this.parts.lenses.map((s) => s.original));
    const upgrade = (m) => {
      if (!m) return m;
      let u = this.factory.get(m);
      if (u) return u;
      if (paintMats.has(m)) u = factoryPaint(m);
      else if (tyreMats.has(m)) u = factoryTyre(m);
      else if (glassMats.has(m)) u = factoryGlass(m);
      else if (lensMats.has(m) || kindOf(m.name) === "lens") u = lensMaterial(m);
      else u = upgradeSurface(m);
      sharpenTextures(u, anisotropy);
      this.factory.set(m, u);
      return u;
    };
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(upgrade) : upgrade(o.material);
      o.layers.enable(CAR_LAYER);
      o.castShadow = o.receiveShadow = false;
    });

    const box = new THREE.Box3().setFromObject(this.object);
    this.box = box;
    this.size = box.getSize(new THREE.Vector3());
    this.info = {
      lengthSource,
      floorsRemoved,
      groundShift,
      paintHow: this.parts.paintHow,
      triangles: this.countTriangles(),
      measured: { length: this.size.z, width: this.size.x, height: this.size.y },
    };
    this.frontLamps = this.lampClusters(false);
    this.build = null;
  }

  countTriangles() {
    let n = 0;
    this.object.traverse((o) => {
      if (o.isMesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3;
    });
    return Math.round(n);
  }

  /** Left and right headlamp positions, for the beams drawn on the floor. */
  lampClusters(rear) {
    const lamps = this.parts.lamps.filter((l) => l.rear === rear);
    if (!lamps.length) return [];
    const sides = [lamps.filter((l) => l.centre.x > 0), lamps.filter((l) => l.centre.x <= 0)].filter((s) => s.length);
    return sides.map((side) => {
      const c = new THREE.Vector3();
      side.forEach((l) => c.add(l.centre));
      return c.divideScalar(side.length);
    });
  }

  factoryOf(slot) {
    return this.factory.get(slot.original) ?? slot.original;
  }

  /** Puts slots back to their factory look, or gives them `make(slot)`. */
  setSlots(slots, make) {
    for (const s of slots) setSlot(s, make ? make(s) : this.factoryOf(s));
  }

  currentPaint(build) {
    if (build.paint) return paintMaterial(build.paint.hex, build.paint.finish);
    return null;
  }

  /** Applies a build. Options the model does not support are ignored. */
  apply(build) {
    const caps = this.caps;
    const paint = this.currentPaint(build);
    if (caps.paint) this.setSlots(this.parts.paint, paint ? () => paint : null);

    const bodyColour = (s) => paint ?? this.factoryOf(this.parts.paint[0] ?? s);
    const accent = (slots, id, kind) => {
      const opt = byId(ACCENTS, id);
      if (!opt || id === "factory") return this.setSlots(slots);
      this.setSlots(slots, (s) => (id === "body" ? bodyColour(s) : finishMaterial(kind, opt, s.original)));
    };

    if (caps.rims) {
      const opt = byId(RIM_FINISHES, build.rims);
      this.setSlots(this.parts.rims, opt && opt.id !== "factory" ? (s) => rimMaterial(opt, s.original) : null);
    }
    if (caps.calipers) {
      const opt = byId(CALIPERS, build.calipers);
      this.setSlots(this.parts.calipers, opt && opt.id !== "factory" ? (s) => caliperMaterial(opt, s.original) : null);
    }
    if (caps.trim) {
      const opt = byId(TRIMS, build.trim);
      this.setSlots(this.parts.trim, opt && opt.id !== "factory" ? (s) => finishMaterial("trim", opt, s.original) : null);
    }
    if (caps.carbon) {
      const id = build.carbon;
      this.setSlots(this.parts.carbon, id && id !== "factory" ? (s) => (id === "body" ? bodyColour(s) : carbonMaterial(id, s.original)) : null);
    }
    if (caps.mirrors) accent(this.parts.mirrors, build.mirrors, "mirror");
    if (caps.spoiler) accent(this.parts.spoiler, build.spoiler, "spoiler");
    if (caps.exhaust) {
      const opt = byId(EXHAUSTS, build.exhaust);
      this.setSlots(this.parts.exhaust, opt && opt.id !== "factory" ? (s) => finishMaterial("exhaust", opt, s.original) : null);
    }
    if (caps.glass) {
      const tint = build.tint ? byId(TINTS, build.tint) : null;
      this.setSlots(this.parts.glass, tint ? () => glassMaterial(tint) : null);
    }
    if (caps.lights) this.applyLights(build.lights);
    if (caps.ride) this.body.position.y = byId(RIDES, build.ride)?.offset ?? 0;
    this.build = build;
  }

  applyLights(mode) {
    this.lit ??= new Map();
    for (const lamp of this.parts.lamps) {
      const on = mode === "on" || (mode === "drl" && !lamp.rear);
      if (!on) {
        setSlot(lamp, this.factoryOf(lamp));
        continue;
      }
      const strength = lamp.rear ? 2.2 : mode === "on" ? 6 : 3;
      const key = `${lamp.original.uuid}|${lamp.rear}|${strength}`;
      let m = this.lit.get(key);
      if (!m) {
        m = this.factoryOf(lamp).clone();
        // clone() keeps onBeforeCompile (glass reflections) but not the cache key function's closure state; restore it.
        m.customProgramCacheKey = this.factoryOf(lamp).customProgramCacheKey;
        m.emissive = new THREE.Color(lamp.rear ? "#ff1a0e" : "#fff4e6");
        m.emissiveIntensity = strength;
        m.userData.generated = true;
        this.lit.set(key, m);
      }
      setSlot(lamp, m);
    }
  }

  /** Frees the GPU memory this car holds. Shared option materials are kept. */
  dispose() {
    const materials = new Set();
    const geometries = new Set();
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      geometries.add(o.geometry);
      materialsOf(o).forEach((m) => m && materials.add(m));
    });
    for (const [orig, up] of this.factory) {
      materials.add(orig);
      materials.add(up);
    }
    for (const m of this.lit?.values() ?? []) materials.add(m);
    const textures = new Set();
    for (const m of materials) {
      if (m.userData?.shared) continue;
      texturesOf(m).forEach((t) => textures.add(t));
      m.dispose();
    }
    forgetMaterialsOf(new Set(this.factory.keys()));
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    this.object.removeFromParent();
  }
}
