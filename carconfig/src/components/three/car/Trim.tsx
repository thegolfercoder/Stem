"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";
import { buildSurfacePatch } from "./geometry";

/**
 * Gloss-black trim: the sill between the wheels and the strip along the
 * bottom of the side glass. Small, but dark bands at the bottom of the body
 * make a car look lower, and a trim line under the glass separates the
 * greenhouse from the body the way a real car's seals and finishers do.
 *
 * Both are surface patches, so they follow the body exactly. Angles are
 * section angles: 0 is the right-hand side, negative runs downward, and the
 * left side mirrors them about π/2.
 */
export function Trim({ shape }: { shape: BodyShape }) {
  const geometries = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    const [front, rear] = shape.arches;
    const sides = (lo: number, hi: number): [number, number][] => [
      [lo, hi],
      [Math.PI - hi, Math.PI - lo],
    ];

    // Sills, between the arches, just above where the underside begins.
    const sill: [number, number] = [rear.z + rear.r + 0.03, front.z - front.r - 0.03];
    if (sill[1] > sill[0]) {
      for (const t of sides(-0.36, -0.14)) {
        out.push(buildSurfacePatch((z, a) => shape.tubPoint(z, a), sill, t, [40, 4], 0.003));
      }
    }

    // Beltline finisher along the bottom of the side glass, from the C-pillar
    // to the base of the windshield. Not on a soft-top: there it is fabric.
    if (shape.style.roofMaterial === "paint") {
      const belt: [number, number] = [shape.zRoofRear, shape.zCowl - 0.06];
      if (belt[1] > belt[0]) {
        for (const t of sides(-1.3, -0.62)) {
          out.push(buildSurfacePatch((z, a) => shape.cabinPoint(z, a), belt, t, [40, 3], 0.003));
        }
      }
    }
    return out;
  }, [shape]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshPhysicalMaterial color="#060708" roughness={0.18} metalness={0.2} clearcoat={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
