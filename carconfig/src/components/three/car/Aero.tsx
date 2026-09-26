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

/**
 * A wing element spanning the car: leading edge at z = 0, chord running
 * rearward to z = −chord, centred across x.
 */
function wingPlane(chord: number, thickness: number, span: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(aerofoil(chord, thickness), {
    depth: span,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(span / 2, 0, 0);
  g.rotateY(Math.PI);
  return g;
}

/**
 * A flat band of constant width following a curve in the car's side plane
 * (z along the car, y up), extruded across the car by `thickness`.
 */
function bandGeometry(points: readonly [number, number][], width: number, thickness: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(([z, y]) => new THREE.Vector3(z, y, 0)));
  const n = 40;
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPoint(t);
    const d = curve.getTangent(t);
    const nx = -d.y;
    const ny = d.x;
    left.push(new THREE.Vector2(p.x + (nx * width) / 2, p.y + (ny * width) / 2));
    right.push(new THREE.Vector2(p.x - (nx * width) / 2, p.y - (ny * width) / 2));
  }
  const shape = new THREE.Shape([...left, ...right.reverse()]);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
  });
  // Shape x is the car's z; the extrusion becomes the car's x.
  g.rotateY(-Math.PI / 2);
  g.translate(thickness / 2, 0, 0);
  return g;
}

function useCarbon() {
  const m = useMemo(() => carbonMaterial(), []);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

function Wing({ shape, deckOffset = 0 }: { shape: BodyShape; deckOffset?: number }) {
  const carbon = useCarbon();
  // On the boot lid, near its trailing edge.
  const z = shape.zRear + 0.25;
  const deck = shape.topAt(z) + deckOffset;
  const span = shape.tubSection(z).hw * 2 * 0.98;
  const height = 0.3;

  const plane = useMemo(() => wingPlane(0.3, 0.12, span), [span]);
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

/**
 * A swan-neck wing, as on Porsche's GT cars: two elements hung from their
 * top surface on curved mounts rising out of the engine lid, which keeps the
 * underside — the side doing most of the work — clean. Its top sits level
 * with the roof.
 */
function SwanNeckWing({ shape }: { shape: BodyShape }) {
  const carbon = useCarbon();
  // Over the engine lid: the mounts rise just behind the rear glass, and the
  // flap's trailing edge ends about level with the tail.
  const zBase = shape.zBacklight - 0.08;
  const zLE = zBase - 0.2;
  const span = shape.tubSection(zLE - 0.15).hw * 2 * 0.9;
  const wingY = shape.input.height - 0.1;

  const main = useMemo(() => wingPlane(0.32, 0.13, span), [span]);
  const flap = useMemo(() => wingPlane(0.19, 0.1, span - 0.02), [span]);
  useEffect(() => () => [main, flap].forEach((g) => g.dispose()), [main, flap]);

  // Each mount rises ahead of the wing, arcs over its leading edge, and
  // comes down onto its top surface.
  const deckY = shape.topAt(zBase);
  const zAttach = zLE - 0.13;
  const neck = useMemo(
    () =>
      bandGeometry(
        [
          [zBase, deckY - 0.06],
          [zBase + 0.005, (deckY + wingY) / 2],
          [zBase - 0.03, wingY + 0.12],
          [(zBase + zAttach) / 2, wingY + 0.165],
          [zAttach, wingY + 0.1],
          [zAttach - 0.005, wingY + 0.03],
        ],
        0.05,
        0.018,
      ),
    [zBase, deckY, zAttach, wingY],
  );
  useEffect(() => () => neck.dispose(), [neck]);

  return (
    <group>
      <group position={[0, wingY, zLE]}>
        <mesh geometry={main} material={carbon} rotation={[0.1, 0, 0]} castShadow />
        <mesh geometry={flap} material={carbon} position={[0, 0.065, -0.27]} rotation={[0.42, 0, 0]} castShadow />
        {[1, -1].map((side) => (
          <mesh key={side} material={carbon} position={[(side * span) / 2, 0.03, -0.24]} castShadow>
            <boxGeometry args={[0.012, 0.17, 0.5]} />
          </mesh>
        ))}
      </group>
      {[1, -1].map((side) => (
        <mesh key={side} geometry={neck} material={carbon} position={[side * span * 0.25, 0, 0]} castShadow />
      ))}
    </group>
  );
}

function Ducktail({ shape, deckOffset = 0 }: { shape: BodyShape; deckOffset?: number }) {
  const carbon = useCarbon();
  const z = shape.zBodyRear + 0.08;
  const deck = shape.topAt(z) + deckOffset;
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

  // In plan it follows the nose: full width at the back, narrowing to the
  // width of the face at the front, so no corner sticks out past the bumper.
  const hwFront = Math.min(hw, shape.tubSection(shape.zBodyFront).hw * shape.style.noseRatio * 0.92);
  const plate = useMemo(() => {
    const s = new THREE.Shape();
    const r = Math.min(0.14, depth * 0.4);
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, depth * 0.35);
    s.bezierCurveTo(hw, depth * 0.75, hwFront, depth - r * 0.4, hwFront - r, depth);
    s.lineTo(-hwFront + r, depth);
    s.bezierCurveTo(-hwFront, depth - r * 0.4, -hw, depth * 0.75, -hw, depth * 0.35);
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
  }, [hw, hwFront, depth]);
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

export function Aero({
  shape,
  attachments,
  factoryWing = false,
  deckOffset = 0,
}: {
  shape: BodyShape;
  attachments: readonly Attachment[];
  /** The car's own swan-neck wing; an aftermarket wing or spoiler replaces it. */
  factoryWing?: boolean;
  /**
   * How far the real boot lid sits above the shape's, when the parts are
   * being hung on a 3D model rather than the generated body.
   */
  deckOffset?: number;
}) {
  const aftermarketRear = attachments.includes("wing") || attachments.includes("spoiler");
  return (
    <>
      {factoryWing && !aftermarketRear ? <SwanNeckWing shape={shape} /> : null}
      {attachments.includes("wing") ? <Wing shape={shape} deckOffset={deckOffset} /> : null}
      {attachments.includes("spoiler") ? <Ducktail shape={shape} deckOffset={deckOffset} /> : null}
      {attachments.includes("splitter") ? <Splitter shape={shape} /> : null}
      {attachments.includes("diffuser") ? <Diffuser shape={shape} /> : null}
      {attachments.includes("side_skirts") ? <SideSkirts shape={shape} /> : null}
    </>
  );
}
