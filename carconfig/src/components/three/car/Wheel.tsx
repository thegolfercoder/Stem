"use client";

import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import {
  rimRadiusM,
  rollingRadiusM,
  type SpokeStyle,
  type WheelFit,
} from "@/lib/build/viewer-config";
import {
  buildBarrelGeometry,
  buildCaliperGeometry,
  buildDiscGeometry,
  buildLipGeometry,
  buildLugGeometry,
  buildSpokeGeometry,
  buildTireGeometry,
  type WheelDims,
} from "./geometry";

/**
 * One corner: tire, rim, lug nuts, disc and caliper.
 *
 * Every dimension is the real one. The tire is the fitted section and aspect,
 * the rim is the fitted diameter and width, the lug nuts sit on the car's own
 * bolt circle, and the disc is the rotor the build actually has — so adding a
 * 380mm kit makes the disc behind the spokes visibly bigger, and a caliper in
 * the kit's colour appears where the stock one was.
 *
 * Built for the right-hand side. The left is the same wheel mirrored by
 * `side = -1`; three.js flips the face winding for a negative scale itself.
 */

function useDisposable<T extends THREE.BufferGeometry>(g: T): T {
  useEffect(() => () => g.dispose(), [g]);
  return g;
}

export function Wheel({
  fit,
  style,
  finishHex,
  boltCount,
  boltCircleMm,
  rotorMm,
  pistons,
  caliperHex,
  side,
}: {
  fit: WheelFit;
  style: SpokeStyle;
  finishHex: string;
  boltCount: number;
  boltCircleMm: number;
  rotorMm: number;
  pistons: number;
  caliperHex: string;
  side: 1 | -1;
}) {
  const dims: WheelDims = useMemo(
    () => ({
      outerRadius: rollingRadiusM(fit),
      rimRadius: rimRadiusM(fit),
      tireWidth: fit.tireWidthMm / 1000,
      rimWidth: (fit.widthIn * 25.4) / 1000,
    }),
    [fit],
  );

  const tire = useDisposable(useMemo(() => buildTireGeometry(dims), [dims]));
  const barrel = useDisposable(useMemo(() => buildBarrelGeometry(dims), [dims]));
  const lip = useDisposable(useMemo(() => buildLipGeometry(dims), [dims]));
  const spokes = useDisposable(useMemo(() => buildSpokeGeometry(style, dims), [style, dims]));
  const lugs = useDisposable(
    useMemo(() => buildLugGeometry(dims, boltCount, boltCircleMm), [dims, boltCount, boltCircleMm]),
  );
  const disc = useDisposable(useMemo(() => buildDiscGeometry(rotorMm, dims), [rotorMm, dims]));
  const caliper = useDisposable(
    useMemo(() => buildCaliperGeometry(rotorMm, pistons, dims), [rotorMm, pistons, dims]),
  );

  return (
    <group scale={[side, 1, 1]}>
      <mesh geometry={tire} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#16171a"
          roughness={0.86}
          metalness={0}
          clearcoat={0.06}
          clearcoatRoughness={0.6}
          envMapIntensity={0.55}
        />
      </mesh>

      <mesh geometry={barrel}>
        <meshStandardMaterial color={finishHex} metalness={0.85} roughness={0.42} envMapIntensity={0.9} />
      </mesh>

      <mesh geometry={lip} castShadow>
        <meshStandardMaterial color="#d9dde1" metalness={1} roughness={0.14} envMapIntensity={1.4} />
      </mesh>

      <mesh geometry={spokes} castShadow>
        <meshPhysicalMaterial
          color={finishHex}
          metalness={0.9}
          roughness={0.26}
          clearcoat={0.6}
          clearcoatRoughness={0.1}
          envMapIntensity={1.3}
        />
      </mesh>

      <mesh geometry={lugs}>
        <meshStandardMaterial color="#c9ced3" metalness={1} roughness={0.2} />
      </mesh>

      <mesh geometry={disc}>
        <meshStandardMaterial color="#6f757b" metalness={0.9} roughness={0.38} />
      </mesh>

      <mesh geometry={caliper} castShadow>
        <meshPhysicalMaterial
          color={caliperHex}
          metalness={0.2}
          roughness={0.32}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </mesh>
    </group>
  );
}
