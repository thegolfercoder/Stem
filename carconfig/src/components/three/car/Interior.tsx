"use client";

import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";

/**
 * Just enough cabin to be seen through tinted glass: seats with headrests, a
 * dashboard and a steering wheel. Nobody inspects it; its job is to stop the
 * greenhouse reading as a sealed black pod, which is the quickest tell that a
 * car is generated.
 *
 * Placed from the greenhouse's own landmarks. The car faces +z, so its left
 * is +x; the wheel is on the left, as in most of the world's cars.
 */
const SEAT = new THREE.MeshStandardMaterial({ color: "#1b1c1f", roughness: 0.85 });
const DASH = new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.7 });
const WHEEL = new THREE.MeshStandardMaterial({ color: "#0c0d0e", roughness: 0.5 });

export function Interior({ shape }: { shape: BodyShape }) {
  const S = shape.style;
  const roofLen = shape.zRoofFront - shape.zRoofRear;
  // Front headrests sit a little behind the front of the roof.
  const zFront = Math.max(shape.zRoofFront - Math.max(0.42, roofLen * 0.45), shape.zBacklight + 0.25);
  const rows = S.doors === 2 && zFront - 0.85 > shape.zBacklight + 0.2 ? [zFront, zFront - 0.85] : [zFront];

  return (
    <group>
      {rows.map((z, row) => {
        const cabin = shape.cabinSection(z);
        const floor = shape.tubSection(z).yTop;
        // Seat backs rise from the floor to a hand below the roof lining.
        const top = Math.min(cabin.yTop - 0.1, floor + 0.62);
        const back = Math.max(top - floor - 0.18, 0.2);
        const x = cabin.hwBottom * 0.46;
        return [1, -1].map((side) => (
          <group key={`${row}${side}`} position={[side * x, floor, z]} rotation={[-0.22, 0, 0]}>
            <RoundedBox args={[0.46, back, 0.12]} radius={0.04} smoothness={3} material={SEAT} position={[0, back / 2, 0]} />
            <RoundedBox args={[0.26, 0.17, 0.1]} radius={0.04} smoothness={3} material={SEAT} position={[0, back + 0.1, 0]} />
          </group>
        ));
      })}

      {(() => {
        // Back from the windshield base until the glass is high enough over
        // the floor to hide a dashboard under it.
        let z = shape.zCowl - 0.05;
        while (z > shape.zRoofFront && shape.cabinSection(z).yTop - shape.tubSection(z).yTop < 0.24) z -= 0.02;
        const cabin = shape.cabinSection(z);
        const floor = shape.tubSection(z).yTop;
        const driverX = shape.cabinSection(zFront).hwBottom * 0.46;
        return (
          <>
            <mesh material={DASH} position={[0, floor + 0.05, z - 0.1]}>
              <boxGeometry args={[cabin.hwBottom * 1.7, 0.1, 0.26]} />
            </mesh>
            <mesh material={WHEEL} position={[driverX, floor + 0.14, zFront + 0.5]} rotation={[-0.35, 0, 0]}>
              <torusGeometry args={[0.18, 0.018, 12, 40]} />
            </mesh>
          </>
        );
      })()}
    </group>
  );
}
