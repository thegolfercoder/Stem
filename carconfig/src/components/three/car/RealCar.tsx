"use client";

import { useGLTF } from "@react-three/drei";
import { Component, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { rollingRadiusM, type ViewerConfig } from "@/lib/build/viewer-config";
import type { ModelAsset, ModelTuning } from "@/lib/three/model-assets";
import { paintMaterial } from "./materials";
import { Wheel } from "./Wheel";

/**
 * A real 3D model of the car, made to behave like the generated one.
 *
 * Models come from many authors and no two are built alike, so the handling
 * is defensive and every guess has a fallback:
 *
 *   - Orientation and size: turned so its length runs along z, scaled to the
 *     car's published length, centred, and sat on the floor.
 *   - Paint: materials named like paint ("Paint", "Body", "CarPaint") are
 *     repainted with the chosen colour and finish; near-black ones are left
 *     alone, since those are trim, not paint. A model whose paint is named
 *     "Material.004" gets it listed in its tuning.
 *   - Wheels: parts named like wheels are grouped by corner. If exactly four
 *     sensible, round groups turn up, they are hidden and the build's own
 *     wheels are drawn in their place — so wheel swaps, calipers, poke and
 *     ride height still work on the real car. If the groups are ambiguous,
 *     the model keeps its own wheels rather than half-replacing them.
 */

const DEG = Math.PI / 180;
// Words starting this way: "Tireside" and "Rim 1" match, "Trim" does not.
const WHEEL_RE = /\b(wheel|rim|tyre|tire|brake|caliper|disc|rotor|lug|hub|spoke)/i;

/** "WheelFrontLRim1" → "Wheel Front L Rim 1", so word boundaries mean something. */
function words(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_.\-:]+/g, " ");
}
const PAINT_RE = /paint|body|exterior|shell|coat/i;
const NOT_PAINT_RE =
  /glass|window|windshield|light|lamp|tire|tyre|rubber|chrome|interior|seat|dash|rim|wheel|brake|caliper|disc|logo|badge|emblem|plate|licen[cs]e|mirror|grill|trim|carbon|plastic|under|engine|exhaust|gasket|black|matte|metal/i;

interface Corner {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

interface Prepared {
  readonly root: THREE.Group;
  readonly paintSlots: readonly { mesh: THREE.Mesh; index: number | null }[];
  readonly corners: { readonly fl: Corner; readonly fr: Corner; readonly rl: Corner; readonly rr: Corner } | null;
}

function chainName(o: THREE.Object3D): string {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name) names.push(words(p.name));
  return names.join(" ");
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function luminance(m: THREE.Material): number {
  const c = (m as THREE.MeshStandardMaterial).color;
  return c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0;
}

/**
 * `length` is the car's published length, or null when it has none — then the
 * model keeps its own size if that is a believable car's, since most models
 * are built to scale, and is scaled to a typical length for its type if not.
 */
function prepare(scene: THREE.Object3D, length: number | null, fallbackLength: number, tuning: ModelTuning): Prepared {
  const model = scene.clone(true);
  // Materials are shared with the loader's cache; repainting this car must
  // not repaint every other instance of it.
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    o.castShadow = true;
    o.receiveShadow = true;
  });

  const orient = new THREE.Group();
  orient.add(model);
  const root = new THREE.Group();
  root.add(orient);

  // Length along z.
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  orient.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + (tuning.yawDeg ?? 0) * DEG;
  root.updateMatrixWorld(true);

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

  // Paint.
  const explicit = tuning.paintMaterials;
  const paintSlots: { mesh: THREE.Mesh; index: number | null }[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = materialsOf(o);
    mats.forEach((m, i) => {
      const isPaint = explicit
        ? explicit.includes(m.name)
        : PAINT_RE.test(m.name) && !NOT_PAINT_RE.test(m.name) && luminance(m) > 0.04 && !WHEEL_RE.test(chainName(o));
      if (isPaint) paintSlots.push({ mesh: o, index: Array.isArray(o.material) ? i : null });
    });
  });

  // Wheels, grouped by corner.
  let corners: Prepared["corners"] = null;
  if (tuning.wheels !== "model") {
    const groups = new Map<string, { box: THREE.Box3; meshes: THREE.Mesh[] }>();
    let merged = false;
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const label = `${chainName(o)} ${materialsOf(o).map((m) => words(m.name)).join(" ")}`;
      if (!WHEEL_RE.test(label) || /steering|spare|light|lamp|arch|well/i.test(label)) return;
      const b = new THREE.Box3().setFromObject(o);
      // A wheel part sits low and outboard, and is no taller than a big wheel.
      const bs = b.getSize(new THREE.Vector3());
      const bc = b.getCenter(new THREE.Vector3());
      if (bs.y > 0.95 || bc.y > 0.6) return;
      // One mesh spanning both sides, or both axles, is all four wheels
      // merged together; nothing sensible can be swapped out of that.
      if (b.min.x < 0 && b.max.x > 0 && b.getSize(new THREE.Vector3()).x > 0.6) merged = true;
      if (b.min.z < 0 && b.max.z > 0 && b.getSize(new THREE.Vector3()).z > target * 0.4) merged = true;
      const c = b.getCenter(new THREE.Vector3());
      if (Math.abs(c.x) < 0.15) return;
      const key = `${c.z > 0 ? "f" : "r"}${c.x > 0 ? "r" : "l"}`;
      const g = groups.get(key);
      if (g) {
        g.box.union(b);
        g.meshes.push(o);
      } else groups.set(key, { box: b, meshes: [o] });
    });

    const found = ["fl", "fr", "rl", "rr"].map((k) => groups.get(k));
    const sane = found.every((g) => {
      if (!g) return false;
      const s = g.box.getSize(new THREE.Vector3());
      const r = s.y / 2;
      return r > 0.2 && r < 0.52 && Math.abs(s.z - s.y) / s.y < 0.3;
    });
    if (!merged && sane) {
      const corner = (g: { box: THREE.Box3 }): Corner => {
        const c = g.box.getCenter(new THREE.Vector3());
        return { x: c.x, z: c.z, radius: g.box.getSize(new THREE.Vector3()).y / 2 };
      };
      const [fl, fr, rl, rr] = found.map((g) => corner(g!));
      corners = { fl: fl!, fr: fr!, rl: rl!, rr: rr! };
      for (const g of found) for (const m of g!.meshes) m.visible = false;
    }
  }

  return { root, paintSlots, corners };
}

/** The model is a scene-graph object owned by this component; painting it is a side effect. */
function applyPaint(slots: Prepared["paintSlots"], paint: THREE.Material) {
  for (const { mesh, index } of slots) {
    if (index === null) mesh.material = paint;
    else (mesh.material as THREE.Material[])[index] = paint;
  }
}

export function RealCar({ config, asset }: { config: ViewerConfig; asset: ModelAsset }) {
  const gltf = useGLTF(asset.file, false);
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

  // Repaint when the colour or finish changes.
  const paint = useMemo(() => paintMaterial(config.paintHex, config.paintFinish), [config.paintHex, config.paintFinish]);
  useEffect(() => {
    applyPaint(prepared.paintSlots, paint);
    return () => paint.dispose();
  }, [prepared, paint]);

  const { corners } = prepared;
  if (!corners) {
    // The model keeps its own wheels, so the stance cannot change either.
    return <primitive object={prepared.root} />;
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
      </group>
      {placed.map(({ c, side, axle, radius, caliper, steer }) => (
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
            caliperHex={caliper}
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
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
