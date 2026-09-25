"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { buildCabinGeometry, buildTubGeometry } from "./geometry";
import {
  fabricRoofMaterial,
  tintedGlass,
  paintMaterial,
  underbodyMaterial,
} from "./materials";

/**
 * The painted body and the greenhouse.
 *
 * Geometry is rebuilt only when the shape changes — a different car, not a
 * different paint — and materials only when the paint does, so picking a
 * colour never re-lofts the body.
 */
export function Body({
  shape,
  paintHex,
  finish,
  archInners,
  tint = null,
}: {
  shape: BodyShape;
  paintHex: string;
  finish: ViewerConfig["paintFinish"];
  tint?: ViewerConfig["tint"];
  /** Where to hang the black inner arch liners: x of each tire's inner face. */
  archInners: { front: number; rear: number };
}) {
  const tub = useMemo(() => buildTubGeometry(shape), [shape]);
  const cabin = useMemo(() => buildCabinGeometry(shape), [shape]);
  useEffect(() => () => tub.dispose(), [tub]);
  useEffect(() => () => cabin.dispose(), [cabin]);

  const paint = useMemo(() => paintMaterial(paintHex, finish), [paintHex, finish]);
  const under = useMemo(() => underbodyMaterial(), []);
  const glass = useMemo(() => tintedGlass(tint), [tint]);
  useEffect(() => () => glass.dispose(), [glass]);
  const roof = useMemo(
    () => (shape.style.roofMaterial === "fabric" ? fabricRoofMaterial() : paint),
    [shape.style.roofMaterial, paint],
  );
  useEffect(() => () => paint.dispose(), [paint]);

  const tubMaterials = useMemo(() => [paint, under], [paint, under]);
  // Glass, roof (paint or a fabric hood), and the A-pillars, always paint.
  const cabinMaterials = useMemo(() => [glass, roof, paint], [glass, roof, paint]);

  return (
    <group>
      <mesh geometry={tub} material={tubMaterials} castShadow receiveShadow />
      <mesh geometry={cabin} material={cabinMaterials} castShadow />
      <ArchLiners shape={shape} inners={archInners} />
      {shape.style.bed ? <Bed shape={shape} /> : null}
    </group>
  );
}

/**
 * Wheel-well liners.
 *
 * The loft has no inner wall at the arches — the floor simply rides over each
 * wheel — so without these you could look through one arch and out of the
 * other side of the car. A black plate inboard of each tire, shaped like the
 * opening, is what a real inner wing does for the same reason.
 */
function ArchLiners({
  shape,
  inners,
}: {
  shape: BodyShape;
  inners: { front: number; rear: number };
}) {
  const plates = useMemo(() => {
    return shape.arches.map((arch, i) => {
      const s = new THREE.Shape();
      const floor = shape.style.clearance - 0.02;
      s.moveTo(-arch.r, floor);
      s.lineTo(-arch.r, arch.y);
      s.absarc(0, arch.y, arch.r, Math.PI, 0, true);
      s.lineTo(arch.r, floor);
      s.closePath();
      const g = new THREE.ShapeGeometry(s, 32);
      g.rotateY(Math.PI / 2);
      return { g, z: arch.z, x: i === 0 ? inners.front : inners.rear };
    });
  }, [shape, inners.front, inners.rear]);

  useEffect(() => () => plates.forEach((p) => p.g.dispose()), [plates]);

  return (
    <>
      {plates.flatMap(({ g, z, x }) =>
        [1, -1].map((side) => (
          <mesh key={`${z}-${side}`} geometry={g} position={[side * x, 0, z]}>
            <meshStandardMaterial color="#050607" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        )),
      )}
    </>
  );
}

/** A pickup bed: a dark liner sunk just below the rails. */
function Bed({ shape }: { shape: BodyShape }) {
  const zFrom = shape.zBodyRear + 0.14;
  const zTo = shape.zBacklight - 0.06;
  const len = zTo - zFrom;
  const mid = (zFrom + zTo) / 2;
  const hw = shape.tubSection(mid).hw - 0.08;
  const top = shape.topAt(mid);
  return (
    <mesh position={[0, top - 0.004, mid]} receiveShadow>
      <boxGeometry args={[hw * 2, 0.012, len]} />
      <meshStandardMaterial color="#0c0d0f" roughness={0.95} />
    </mesh>
  );
}
