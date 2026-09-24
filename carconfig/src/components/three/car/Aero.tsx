"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";
import type { Attachment } from "@/lib/build/viewer-config";
import { carbonMaterial } from "./materials";

/**
 * Aero parts, sized and placed from the body they bolt to.
 *
 * Everything is measured off the shape — a wing's span comes from the width of
 * the deck it stands on, a splitter follows the nose — so the same part fits
 * a Miata and a Mustang without either looking borrowed from the other.
 */

/** A cambered aerofoil section, chord along x. */
function aerofoil(chord: number, thickness: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = 24;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    // NACA-style thickness plus camber, which is what makes it read as a wing.
    const t =
      5 * thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const camber = 0.06 * x * (1 - x) * 4;
    top.push([x * chord, (camber + t) * chord]);
    bottom.push([x * chord, (camber - t) * chord]);
  }
  s.moveTo(top[0]![0], top[0]![1]);
  for (const [x, y] of top) s.lineTo(x, y);
  for (let i = bottom.length - 1; i >= 0; i--) s.lineTo(bottom[i]![0], bottom[i]![1]);
  s.closePath();
  return s;
}

function useCarbon() {
  const m = useMemo(() => carbonMaterial(), []);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

function Wing({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  // Its trailing edge just past the bumper, under the rear valance.
  const z = shape.zRear + 0.25;
  const deck = shape.topAt(z);
  const span = shape.tubSection(z).hw * 2 * 0.98;
  const height = 0.3;

  const plane = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(aerofoil(0.3, 0.12), {
      depth: span,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.003,
      bevelSegments: 2,
    });
    // Chord runs fore-aft, span across the car, leading edge forward.
    g.rotateY(-Math.PI / 2);
    g.translate(span / 2, 0, 0);
    g.rotateY(Math.PI);
    return g;
  }, [span]);
  useEffect(() => () => plane.dispose(), [plane]);

  return (
    <group position={[0, deck + height, z + 0.12]}>
      {/* A few degrees of attack, trailing edge up. */}
      <mesh geometry={plane} material={carbon} rotation={[0.14, 0, 0]} castShadow />
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh material={carbon} position={[(side * span) / 2, 0.02, -0.14]} castShadow>
            <boxGeometry args={[0.012, 0.16, 0.36]} />
          </mesh>
          <mesh material={carbon} position={[side * span * 0.34, -height / 2, -0.08]} castShadow>
            <boxGeometry args={[0.018, height, 0.1]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Ducktail({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  const z = shape.zBodyRear + 0.08;
  const deck = shape.topAt(z);
  const width = shape.tubSection(z).hw * 2 * 0.86;

  const lip = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.2, 0);
    s.lineTo(0.02, 0.055);
    s.lineTo(-0.02, 0.05);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2, 0, 0);
    return g;
  }, [width]);
  useEffect(() => () => lip.dispose(), [lip]);

  return <mesh geometry={lip} material={carbon} position={[0, deck - 0.01, z]} castShadow />;
}

function Splitter({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  // Under the chin, standing proud of the bumper by a few centimetres — which
  // is all a road splitter does.
  const z = shape.zBodyFront - 0.2;
  const sec = shape.tubSection(z);
  const hw = sec.hw * 0.94;
  const depth = shape.zFront + 0.04 - z;

  const plate = useMemo(() => {
    const s = new THREE.Shape();
    const r = 0.12;
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, depth - r);
    s.quadraticCurveTo(hw, depth, hw - r, depth);
    s.lineTo(-hw + r, depth);
    s.quadraticCurveTo(-hw, depth, -hw, depth - r);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 1,
    });
    g.rotateX(Math.PI / 2);
    return g;
  }, [hw, depth]);
  useEffect(() => () => plate.dispose(), [plate]);

  return <mesh geometry={plate} material={carbon} position={[0, sec.yBottom + 0.01, z]} castShadow />;
}

function Diffuser({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  // Its trailing edge just past the bumper, under the rear valance.
  const z = shape.zRear + 0.25;
  const sec = shape.tubSection(z);
  const hw = sec.hw * 0.78;
  const y = sec.yBottom;
  const fins = [-0.66, -0.33, 0, 0.33, 0.66];

  return (
    <group position={[0, y, z]}>
      <mesh material={carbon} rotation={[-0.22, 0, 0]} position={[0, 0.02, -0.06]} castShadow>
        <boxGeometry args={[hw * 2, 0.012, 0.42]} />
      </mesh>
      {fins.map((f) => (
        <mesh key={f} material={carbon} position={[f * hw, -0.01, -0.12]} rotation={[-0.22, 0, 0]} castShadow>
          <boxGeometry args={[0.012, 0.09, 0.36]} />
        </mesh>
      ))}
    </group>
  );
}

function SideSkirts({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  const [front, rear] = shape.arches;
  const zFrom = rear.z + rear.r + 0.02;
  const zTo = front.z - front.r - 0.02;
  const len = zTo - zFrom;
  const mid = (zFrom + zTo) / 2;
  const sec = shape.tubSection(mid);

  return (
    <>
      {[1, -1].map((side) => (
        <mesh
          key={side}
          material={carbon}
          position={[side * (sec.hw + 0.004), sec.yBottom + 0.02, mid]}
          castShadow
        >
          <boxGeometry args={[0.05, 0.05, len]} />
        </mesh>
      ))}
    </>
  );
}

export function Aero({ shape, attachments }: { shape: BodyShape; attachments: readonly Attachment[] }) {
  return (
    <>
      {attachments.includes("wing") ? <Wing shape={shape} /> : null}
      {attachments.includes("spoiler") ? <Ducktail shape={shape} /> : null}
      {attachments.includes("splitter") ? <Splitter shape={shape} /> : null}
      {attachments.includes("diffuser") ? <Diffuser shape={shape} /> : null}
      {attachments.includes("side_skirts") ? <SideSkirts shape={shape} /> : null}
    </>
  );
}
