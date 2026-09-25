"use client";

import { useLoader } from "@react-three/fiber";
import { Component, useEffect, useMemo, type ErrorInfo, type ReactNode } from "react";
import { GLTFLoader, MeshoptDecoder } from "three-stdlib";
import * as THREE from "three";
import { rollingRadiusM, type ViewerConfig } from "@/lib/build/viewer-config";
import type { ModelAsset, ModelTuning } from "@/lib/three/model-assets";
import { createBodyShape } from "@/lib/three/body-shape";
import { Aero } from "./Aero";
import { paintMaterial } from "./materials";
import { materialWords, normaliseMaterial } from "./model-materials";
import { frontDirection, type NamedPart } from "@/lib/three/model-orientation";
import { choosePaint, type PaintChoice } from "@/lib/three/model-paint";
import { dropFloor, materialStats, materialsOf, wheelsByName, wheelsByShape, type WheelGroup } from "./model-analysis";
import { modelProgress } from "./model-progress";
import { specGlossPlugin } from "./spec-gloss";
import { Wheel } from "./Wheel";

/**
 * A real 3D model of the car, made to behave like the generated one.
 *
 * Models come from many authors and no two are built alike, so the handling
 * is defensive and every guess has a fallback:
 *
 *   - Orientation and size: whatever the car stands on is removed; it is
 *     turned so its length runs along z and its front faces +z, scaled to the
 *     car's published length, centred, and sat on the floor.
 *   - Paint: the model keeps its own paint until a colour is chosen. The
 *     paint is found by name where the name says so, and otherwise as the
 *     largest opaque surface running the car's length at body height (see
 *     model-paint.ts). A model drawn with one material for everything cannot
 *     be repainted, and the panel says so.
 *   - Wheels: found by name, or failing that by shape, and one group per
 *     corner. They stay the model's own until a wheel design (or a wheel or
 *     brake part) is chosen; then they are hidden and the build's wheels
 *     drawn in their place. Either way they are separated from the body, so
 *     ride height works: the body moves, the wheels stay on the ground.
 */

const DEG = Math.PI / 180;

interface Corner {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** A material slot on a mesh, and what was there before it was changed. */
interface Slot {
  readonly mesh: THREE.Mesh;
  readonly index: number | null;
  readonly original: THREE.Material;
}

/** What a model turned out to allow, for the panel to explain. */
export interface ModelInfo {
  /** How its paint was found, or "none" if it cannot be repainted. */
  readonly paint: PaintChoice["how"];
  /** Whether its four wheels were found (so wheel designs and ride height work). */
  readonly wheels: boolean;
  /** Whether its own brake calipers can be recoloured. */
  readonly calipers: boolean;
}

interface Prepared {
  readonly root: THREE.Group;
  /** The model's own wheels, lifted out of the body so the body can move over them. */
  readonly wheels: THREE.Group;
  readonly paintHow: PaintChoice["how"];
  readonly paintSlots: readonly Slot[];
  readonly caliperSlots: readonly Slot[];
  readonly corners: { readonly fl: Corner; readonly fr: Corner; readonly rl: Corner; readonly rr: Corner } | null;
}

function chainName(o: THREE.Object3D): string {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name) names.push(materialWords(p.name));
  return names.join(" ");
}

const CALIPER_RE = /\b(calipers?|callipers?|bremssattel|pinza|etrier|pinzas?)\b/;

function slotsWhere(root: THREE.Object3D, test: (m: THREE.Material, mesh: THREE.Mesh) => boolean): Slot[] {
  const slots: Slot[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    materialsOf(o).forEach((m, i) => {
      if (test(m, o)) slots.push({ mesh: o, index: Array.isArray(o.material) ? i : null, original: m });
    });
  });
  return slots;
}

/**
 * `length` is the car's published length, or null when it has none — then the
 * model keeps its own size if that is a believable car's, since most models
 * are built to scale, and is scaled to a typical length for its type if not.
 */
function prepare(scene: THREE.Object3D, length: number | null, fallbackLength: number, tuning: ModelTuning): Prepared {
  const model = scene.clone(true);
  // Materials are shared with the loader's cache; repainting this car must
  // not repaint every other instance of it. One copy per material, so a
  // material used on forty meshes is still one material to find and paint.
  // Recognised materials are also given physically correct properties.
  const copies = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material) => {
    let c = copies.get(m);
    if (!c) {
      c = normaliseMaterial(m.clone());
      copies.set(m, c);
    }
    return c;
  };
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });

  dropFloor(model);
  const orient = new THREE.Group();
  orient.add(model);
  const root = new THREE.Group();
  root.add(orient);

  // Length along z.
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  orient.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + (tuning.yawDeg ?? 0) * DEG;
  root.updateMatrixWorld(true);

  // Front toward +z, judged from what the parts are called, unless the
  // model's tuning already says which way it faces.
  if (tuning.yawDeg === undefined) {
    box = new THREE.Box3().setFromObject(root);
    const mid = box.getCenter(new THREE.Vector3()).z;
    const len = box.getSize(new THREE.Vector3()).z;
    const parts: NamedPart[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const label = materialWords(`${chainName(o)} ${materialsOf(o).map((m) => m.name).join(" ")}`);
      parts.push({ label, along: (c.z - mid) / len });
    });
    if (frontDirection(parts) === -1) {
      orient.rotation.y += Math.PI;
      root.updateMatrixWorld(true);
    }
  }

  // Published length, centred, on the floor.
  box = new THREE.Box3().setFromObject(root);
  size = box.getSize(new THREE.Vector3());
  const native = size.z;
  const target = length ?? (native > 3 && native < 6.5 ? native : fallbackLength);
  orient.scale.multiplyScalar(target / native);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  orient.position.set(-centre.x, -box.min.y, -centre.z);
  root.updateMatrixWorld(true);

  // Wheels, by name or by shape, lifted out of the body.
  const wheels = new THREE.Group();
  let corners: Prepared["corners"] = null;
  if (tuning.wheels !== "model") {
    const label = (o: THREE.Mesh) => `${chainName(o)} ${materialsOf(o).map((m) => materialWords(m.name)).join(" ")}`;
    const found = wheelsByName(root, target, label) ?? wheelsByShape(root);
    if (found) {
      const corner = (g: WheelGroup): Corner => {
        const c = g.box.getCenter(new THREE.Vector3());
        return { x: c.x, z: c.z, radius: g.box.getSize(new THREE.Vector3()).y / 2 };
      };
      corners = { fl: corner(found.fl), fr: corner(found.fr), rl: corner(found.rl), rr: corner(found.rr) };
      for (const g of [found.fl, found.fr, found.rl, found.rr]) for (const m of g.meshes) wheels.attach(m);
    }
  }

  // Paint: named in the tuning, or found (never on the wheels).
  let paintHow: PaintChoice["how"] = "none";
  let paintSlots: Slot[] = [];
  if (tuning.paintMaterials) {
    const names = tuning.paintMaterials;
    paintSlots = slotsWhere(root, (m) => names.includes(m.name));
    paintHow = paintSlots.length ? "named" : "none";
  } else {
    const { materials, stats } = materialStats(root);
    const choice = choosePaint(stats);
    const chosen = new Set(choice.ids.map((i) => materials[i]));
    paintSlots = slotsWhere(root, (m) => chosen.has(m));
    paintHow = paintSlots.length ? choice.how : "none";
  }

  const caliperSlots = slotsWhere(wheels, (m) => CALIPER_RE.test(materialWords(m.name)));

  return { root, wheels, paintHow, paintSlots, caliperSlots, corners };
}

/** Height of the model's top surface on the centreline at z, or null if nothing is there. */
function deckHeight(root: THREE.Object3D, z: number): number | null {
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(root, true).find((h) => h.object.visible);
  return hit ? hit.point.y : null;
}

/** The model is a scene-graph object owned by this component; painting it is a side effect. */
function applyMaterial(slots: readonly Slot[], material: THREE.Material | null) {
  for (const { mesh, index, original } of slots) {
    const m = material ?? original;
    if (index === null) mesh.material = m;
    else (mesh.material as THREE.Material[])[index] = m;
  }
}

export function RealCar({
  config,
  asset,
  onModelInfo,
}: {
  config: ViewerConfig;
  asset: ModelAsset;
  onModelInfo?: (info: ModelInfo) => void;
}) {
  const gltf = useLoader(
    GLTFLoader,
    asset.file,
    (loader) => {
      loader.setMeshoptDecoder(MeshoptDecoder());
      loader.register(specGlossPlugin);
    },
    (e) => modelProgress.set({ url: asset.file, loaded: e.loaded, total: e.total, done: false, failed: false }),
  );
  useEffect(() => {
    modelProgress.set({ url: asset.file, done: true, failed: false });
  }, [gltf, asset.file]);
  const prepared = useMemo(
    () =>
      prepare(
        gltf.scene,
        config.dimensionSource === "published" ? config.length : null,
        config.length,
        asset.tuning,
      ),
    [gltf.scene, config.dimensionSource, config.length, asset.tuning],
  );

  useEffect(() => {
    onModelInfo?.({
      paint: prepared.paintHow,
      wheels: prepared.corners !== null,
      calipers: prepared.caliperSlots.length > 0,
    });
  }, [prepared, onModelInfo]);

  // The model's own paint until a colour is chosen.
  const paint = useMemo(
    () => (config.paintChosen ? paintMaterial(config.paintHex, config.paintFinish) : null),
    [config.paintChosen, config.paintHex, config.paintFinish],
  );
  useEffect(() => {
    applyMaterial(prepared.paintSlots, paint);
    return () => paint?.dispose();
  }, [prepared, paint]);

  // The model's own wheels until a design is chosen, or a caliper colour the
  // model's calipers cannot take.
  const { corners } = prepared;
  const swap =
    corners !== null && (config.wheelsChosen || (config.caliperChosen && prepared.caliperSlots.length === 0));

  // Calipers on the model's own wheels are recoloured in place.
  const caliper = useMemo(() => {
    if (swap || !config.caliperChosen) return null;
    return new THREE.MeshPhysicalMaterial({ color: config.caliperHex, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  }, [swap, config.caliperChosen, config.caliperHex]);
  useEffect(() => {
    applyMaterial(prepared.caliperSlots, caliper);
    return () => caliper?.dispose();
  }, [prepared, caliper]);

  // Aero is placed from a generated shape of the same size. Only the boot
  // lid's height tends to differ enough to matter, so it is measured on the
  // model itself and the difference applied.
  const proxy = useMemo(
    () =>
      createBodyShape({
        style: config.style,
        length: config.length,
        width: config.width,
        height: config.height,
        wheelbase: config.wheelbase,
        frontTireRadius: rollingRadiusM(config.front.stock),
        rearTireRadius: rollingRadiusM(config.rear.stock),
        overrides: config.model?.overrides,
        traced: config.model?.traced,
      }),
    [config.style, config.length, config.width, config.height, config.wheelbase, config.front.stock, config.rear.stock, config.model],
  );
  const deckOffset = useMemo(() => {
    const z = proxy.zRear + 0.25;
    const real = deckHeight(prepared.root, z);
    return real === null ? 0 : real - proxy.topAt(z);
  }, [prepared, proxy]);
  const aero =
    config.attachments.length > 0 ? (
      <Aero shape={proxy} attachments={config.attachments} deckOffset={deckOffset} />
    ) : null;

  if (!corners) {
    // No wheels to stand on, so the stance cannot change either.
    return (
      <group>
        <primitive object={prepared.root} />
        {aero}
      </group>
    );
  }

  if (!swap) {
    // The model's own wheels stay put; the body rides over them.
    return (
      <group>
        <group position={[0, config.rideHeightDeltaMm / 1000, 0]}>
          <primitive object={prepared.root} />
          {aero}
        </group>
        <primitive object={prepared.wheels} />
      </group>
    );
  }

  // Same arithmetic as the generated car: bigger tires lift the body, springs
  // drop it, and a lower offset pushes the wheel out.
  const fittedF = rollingRadiusM(config.front.fitted);
  const fittedR = rollingRadiusM(config.rear.fitted);
  const modelF = (corners.fl.radius + corners.fr.radius) / 2;
  const modelR = (corners.rl.radius + corners.rr.radius) / 2;
  const dF = fittedF - modelF;
  const dR = fittedR - modelR;
  const lift = (dF + dR) / 2 + config.rideHeightDeltaMm / 1000;
  const wheelbase = Math.abs(corners.fl.z - corners.rl.z) || config.wheelbase;
  const pitch = -Math.atan2(dF - dR, wheelbase);

  const wheelProps = {
    style: config.wheelStyle,
    finishHex: config.wheelFinishHex,
    boltCount: config.boltCount,
    boltCircleMm: config.boltCircleMm,
  };
  const placed = [
    { c: corners.fr, side: 1 as const, axle: config.front, radius: fittedF, caliper: config.caliperHex, steer: 0.08 },
    { c: corners.fl, side: -1 as const, axle: config.front, radius: fittedF, caliper: config.caliperHex, steer: 0.08 },
    { c: corners.rr, side: 1 as const, axle: config.rear, radius: fittedR, caliper: config.rearCaliperHex, steer: 0 },
    { c: corners.rl, side: -1 as const, axle: config.rear, radius: fittedR, caliper: config.rearCaliperHex, steer: 0 },
  ];

  return (
    <group>
      <group position={[0, lift, 0]} rotation={[pitch, 0, 0]}>
        <primitive object={prepared.root} />
        {aero}
      </group>
      {placed.map(({ c, side, axle, radius, caliper: caliperHex, steer }) => (
        <group
          key={`${c.x}${c.z}`}
          position={[c.x + (side * (axle.stock.offsetMm - axle.fitted.offsetMm)) / 1000, radius, c.z]}
          rotation={[0, steer, 0]}
        >
          <Wheel
            {...wheelProps}
            side={side}
            fit={axle.fitted}
            rotorMm={axle.rotorMm}
            pistons={axle.caliperPistons}
            caliperHex={caliperHex}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * If a model fails to load — a missing file, a corrupt download — draw the
 * generated car instead of an empty studio.
 */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    modelProgress.set({ done: true, failed: true });
    console.warn("3D model failed to load; showing the generated car.", error.message, info.componentStack?.slice(0, 200));
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
