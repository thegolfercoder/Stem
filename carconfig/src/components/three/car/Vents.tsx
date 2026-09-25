"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";
import type { FactoryFeature } from "@/lib/three/model-shapes";
import { buildSurfacePatch } from "./geometry";

/**
 * Openings cut into the top of the body: bonnet vents, louvres over the front
 * wheels, the engine-lid grille.
 *
 * Like the lights, each is a patch laid on the body surface itself, so it
 * follows the bonnet's curve and the raised wings rather than floating over
 * them. Section angles: π/2 is the top of the car's centreline, smaller
 * angles run out toward the right-hand wing, and the left is the mirror.
 */

type Patch = { z: readonly [number, number]; t: readonly [number, number]; lift?: number };

const HALF = Math.PI / 2;

/** A patch and its mirror across the centreline. */
const mirrored = (p: Patch): Patch[] => [p, { ...p, t: [Math.PI - p.t[1], Math.PI - p.t[0]] }];

function patchesFor(shape: BodyShape, features: readonly FactoryFeature[]) {
  const recess: Patch[] = [];
  const slats: Patch[] = [];

  if (features.includes("hood_vents")) {
    // Two nostrils at the front of the bonnet, either side of a centre spine.
    const z0 = shape.zBodyFront - 0.46;
    const z1 = shape.zBodyFront - 0.16;
    recess.push(...mirrored({ z: [z0, z1], t: [HALF - 0.2, HALF - 0.035] }));
    // Fore-aft fins across each opening.
    for (const t of [0.07, 0.11, 0.15]) {
      slats.push(...mirrored({ z: [z0 + 0.02, z1 - 0.02], t: [HALF - t - 0.006, HALF - t + 0.006], lift: 0.005 }));
    }
  }

  if (features.includes("fender_louvres")) {
    // Blades across the top of each front wing, over the back of the wheel.
    const zStart = shape.zFrontAxle + 0.14;
    for (let i = 0; i < 9; i++) {
      const z = zStart - i * 0.042;
      recess.push(...mirrored({ z: [z - 0.012, z + 0.012], t: [0.5, 0.95] }));
    }
  }

  if (features.includes("engine_grille")) {
    // Louvres on the engine lid, just behind the rear glass.
    const zStart = shape.zBacklight - 0.08;
    for (let i = 0; i < 8; i++) {
      const z = zStart - i * 0.036;
      recess.push({ z: [z - 0.01, z + 0.01], t: [HALF - 0.3, HALF + 0.3] });
    }
  }

  // Side openings are placed by height on the flank, so they sit where the
  // photographs show them whatever the section's shape.
  const thetaAt = (z: number, y: number) => {
    const sec = shape.tubSection(z);
    const yc = (sec.yTop + sec.yBottom) / 2;
    const b = (sec.yTop - sec.yBottom) / 2;
    const v = Math.max(-0.98, Math.min(0.98, (y - yc) / b));
    const n = v >= 0 ? shape.style.roundTop : shape.style.roundBottom;
    return Math.sign(v) * Math.asin(Math.abs(v) ** (n / 2));
  };
  const H = shape.input.height;
  const [front, rear] = shape.arches;

  if (features.includes("arch_vents")) {
    // A tall opening in the wing just behind the front wheel.
    const z0 = front.z - front.r - 0.16;
    const z1 = front.z - front.r - 0.03;
    const zm = (z0 + z1) / 2;
    recess.push(...mirrored({ z: [z0, z1], t: [thetaAt(zm, 0.22 * H), thetaAt(zm, 0.5 * H)] }));
  }

  if (features.includes("side_intakes")) {
    // A slim intake high in the rear quarter, just ahead of the rear wheel.
    const z0 = rear.z + rear.r + 0.04;
    const z1 = rear.z + rear.r + 0.24;
    const zm = (z0 + z1) / 2;
    recess.push(...mirrored({ z: [z0, z1], t: [thetaAt(zm, 0.46 * H), thetaAt(zm, 0.62 * H)] }));
  }

  return { recess, slats };
}

function build(shape: BodyShape, patches: readonly Patch[]) {
  return patches.map(({ z, t, lift = 0.003 }) =>
    buildSurfacePatch((a, b) => shape.tubPoint(a, b), z, t, [8, 10], lift),
  );
}

export function Vents({ shape, features }: { shape: BodyShape; features: readonly FactoryFeature[] }) {
  const geometries = useMemo(() => {
    const { recess, slats } = patchesFor(shape, features);
    return { recess: build(shape, recess), slats: build(shape, slats) };
  }, [shape, features]);
  useEffect(
    () => () => [...geometries.recess, ...geometries.slats].forEach((g) => g.dispose()),
    [geometries],
  );

  return (
    <group>
      {geometries.recess.map((g, i) => (
        <mesh key={`r${i}`} geometry={g}>
          <meshStandardMaterial color="#030304" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {geometries.slats.map((g, i) => (
        <mesh key={`s${i}`} geometry={g}>
          <meshStandardMaterial color="#17191c" roughness={0.4} metalness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
