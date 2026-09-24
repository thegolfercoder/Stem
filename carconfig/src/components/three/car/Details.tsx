"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BodyShape } from "@/lib/three/body-shape";
import { surfaceNormal } from "@/lib/three/body-shape";
import type { ViewerConfig } from "@/lib/build/viewer-config";
import { buildSurfacePatch, endSurface } from "./geometry";
import { paintMaterial, trimMaterial } from "./materials";

/**
 * Lights, grille, mirrors and exhaust.
 *
 * Each light and trim panel is a patch laid on the body surface rather than a
 * separate object in front of it, so a headlight wraps round the corner of
 * the wing onto the nose the way a real one does. They are what make the
 * front of the loft read as a face.
 */

const DEG = Math.PI / 180;

/**
 * A rounded-rectangle skin on an end face, described in normalised face
 * coordinates so it scales with every car: (cx, cy) is its centre and (a, b)
 * its half-size, with −1..1 spanning the face. `n` is how square the corners
 * are — 2 is an ellipse, 6 is nearly a rectangle.
 */
interface FaceSpec {
  readonly end: "front" | "rear";
  readonly cx: number;
  readonly cy: number;
  readonly a: number;
  readonly b: number;
  readonly n: number;
}

function useFacePatches(shape: BodyShape, specs: readonly FaceSpec[]) {
  const geometries = useMemo(
    () =>
      specs.map(({ end, cx, cy, a, b, n }) =>
        buildSurfacePatch(
          (r, phi) => {
            const c = Math.cos(phi);
            const sn = Math.sin(phi);
            const u = Math.sign(c) * Math.abs(c) ** (2 / n);
            const v = Math.sign(sn) * Math.abs(sn) ** (2 / n);
            return shape.facePoint(end, cx + a * r * u, cy + b * r * v);
          },
          [0.0001, 1],
          [0, Math.PI * 2],
          [10, 48],
          0.003,
        ),
      ),
    // specs are static per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  return geometries;
}

const both = (spec: Omit<FaceSpec, "cx"> & { cx: number }): FaceSpec[] => [
  spec,
  { ...spec, cx: -spec.cx },
];

const HEADLIGHTS = both({ end: "front", cx: 0.64, cy: 0.4, a: 0.25, b: 0.11, n: 4 });
const DRL = both({ end: "front", cx: 0.62, cy: 0.27, a: 0.21, b: 0.022, n: 6 });
const GRILLE: FaceSpec[] = [{ end: "front", cx: 0, cy: 0.28, a: 0.3, b: 0.14, n: 3.5 }];
const INTAKE: FaceSpec[] = [
  { end: "front", cx: 0, cy: -0.36, a: 0.56, b: 0.2, n: 4.5 },
  ...both({ end: "front", cx: 0.8, cy: -0.28, a: 0.1, b: 0.17, n: 3 }),
];
const TAILLIGHTS = both({ end: "rear", cx: 0.66, cy: 0.44, a: 0.25, b: 0.1, n: 4.5 });
const LIGHT_BAR: FaceSpec[] = [{ end: "rear", cx: 0, cy: 0.46, a: 0.44, b: 0.018, n: 8 }];
const VALANCE: FaceSpec[] = [{ end: "rear", cx: 0, cy: -0.58, a: 0.78, b: 0.26, n: 4 }];
const PLATE: FaceSpec[] = [{ end: "rear", cx: 0, cy: -0.02, a: 0.19, b: 0.08, n: 6 }];

export function Lights({ shape }: { shape: BodyShape }) {
  const heads = useFacePatches(shape, HEADLIGHTS);
  const drl = useFacePatches(shape, DRL);
  const grille = useFacePatches(shape, GRILLE);
  const intake = useFacePatches(shape, INTAKE);
  const tails = useFacePatches(shape, [...TAILLIGHTS, ...LIGHT_BAR]);
  const valance = useFacePatches(shape, VALANCE);
  const plate = useFacePatches(shape, PLATE);

  return (
    <group>
      {heads.map((g, i) => (
        <mesh key={`h${i}`} geometry={g}>
          <meshPhysicalMaterial
            color="#0d1116"
            metalness={0.6}
            roughness={0.08}
            clearcoat={1}
            envMapIntensity={2}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {drl.map((g, i) => (
        <mesh key={`d${i}`} geometry={g}>
          <meshStandardMaterial
            color="#ffffff"
            emissive="#e6f2ff"
            emissiveIntensity={3.2}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {tails.map((g, i) => (
        <mesh key={`t${i}`} geometry={g}>
          <meshPhysicalMaterial
            color="#2a0305"
            emissive="#ff1414"
            emissiveIntensity={2}
            roughness={0.12}
            clearcoat={1}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {[...grille, ...intake].map((g, i) => (
        <mesh key={`g${i}`} geometry={g}>
          <meshPhysicalMaterial
            color="#050607"
            roughness={0.5}
            metalness={0.25}
            clearcoat={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {valance.map((g, i) => (
        <mesh key={`v${i}`} geometry={g}>
          <meshPhysicalMaterial color="#08090b" roughness={0.6} metalness={0.15} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {plate.map((g, i) => (
        <mesh key={`p${i}`} geometry={g}>
          <meshStandardMaterial color="#d8dcdf" roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Door mirrors, where a real car carries them: on the door, just behind the
 * base of the A-pillar. A small thing that does a lot for reading scale.
 */
export function Mirrors({
  shape,
  paintHex,
  finish,
}: {
  shape: BodyShape;
  paintHex: string;
  finish: ViewerConfig["paintFinish"];
}) {
  const cap = useMemo(() => paintMaterial(paintHex, finish), [paintHex, finish]);
  const trim = useMemo(() => trimMaterial(), []);
  useEffect(() => () => cap.dispose(), [cap]);

  // Just behind the base of the A-pillar, standing off the door on a stalk.
  const z = shape.zCowl - 0.22;
  const hw = shape.tubSection(z).hw;
  // The tub top, not topAt(): inside the greenhouse topAt is the roof.
  const belt = shape.tubSection(z).yTop;
  const y = belt + 0.055;

  return (
    <>
      {[1, -1].map((side) => (
        <group key={side} position={[side * (hw + 0.055), y, z]} rotation={[0, side * 0.12, 0]}>
          {/* Housing: a flattened teardrop, blunt face forward. */}
          <mesh material={cap} scale={[0.07, 0.058, 0.1]} castShadow>
            <sphereGeometry args={[1, 32, 20]} />
          </mesh>
          {/* The glass, facing rearward. */}
          <mesh position={[0, 0, -0.07]} rotation={[0, Math.PI, 0]} scale={[0.058, 0.046, 1]}>
            <circleGeometry args={[1, 32]} />
            <meshPhysicalMaterial color="#0a0e12" metalness={0.9} roughness={0.05} />
          </mesh>
          {/* Stalk back to the door. */}
          <mesh material={trim} position={[-side * 0.045, -0.04, 0.01]}>
            <boxGeometry args={[0.07, 0.02, 0.05]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * Door shut lines and handles.
 *
 * Thin dark cuts on the flank are what turn a smooth loft into panels. Where
 * they go comes from the body's own landmarks — behind the front arch, at the
 * B-pillar, ahead of the rear arch — so a coupe gets one long door and a
 * sedan gets two.
 */
export function Doors({ shape }: { shape: BodyShape }) {
  const S = shape.style;
  const [front, rear] = shape.arches;
  const doors = S.doors;

  const doorFront = front.z - front.r - 0.24;
  const doorRear = doors === 1 ? shape.zRoofRear + 0.05 : rear.z + rear.r + 0.04;
  const bPillar = doors === 2 ? (doorFront + doorRear) / 2 + 0.05 : null;
  const cuts = [doorFront, ...(bPillar === null ? [] : [bPillar]), doorRear];

  const geometries = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    const side = (z: number, t: number) => shape.tubPoint(z, t);
    for (const mirror of [1, -1]) {
      const band = (lo: number, hi: number) =>
        (mirror === 1 ? [lo, hi] : [Math.PI - hi, Math.PI - lo]) as [number, number];
      // Vertical cuts from rocker to beltline.
      for (const z of cuts) {
        out.push(buildSurfacePatch(side, [z - 0.0035, z + 0.0035], band(-0.62, 0.95), [1, 24], 0.0012));
      }
      // The top of each door, just under the glass.
      out.push(buildSurfacePatch(side, [cuts[cuts.length - 1]!, cuts[0]!], band(0.95, 1.0), [24, 1], 0.0012));
    }
    return out;
    // cuts derive from shape
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  // One handle per door, near its trailing edge, at a hand's height.
  const handles = cuts.slice(1).map((z) => z + 0.16);

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#020203" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {handles.flatMap((z) =>
        [1, -1].map((side) => {
          const theta = side === 1 ? 0.62 : Math.PI - 0.62;
          const p = shape.tubPoint(z, theta);
          return (
            <mesh key={`${z}${side}`} position={[p[0] + side * 0.006, p[1], p[2]]} castShadow>
              <boxGeometry args={[0.014, 0.022, 0.13]} />
              <meshPhysicalMaterial color="#1a1c1f" metalness={0.8} roughness={0.25} clearcoat={1} />
            </mesh>
          );
        }),
      )}
    </group>
  );
}

const TIP_COLOURS: Record<ViewerConfig["tipFinish"], { color: string; rough: number }> = {
  polished: { color: "#d4d8dc", rough: 0.12 },
  titanium: { color: "#6c6f9a", rough: 0.2 },
  black: { color: "#141517", rough: 0.35 },
};

/** Exhaust tips set into the rear valance, pointing straight out of it. */
export function Exhaust({
  shape,
  tips,
  finish,
}: {
  shape: BodyShape;
  tips: number;
  finish: ViewerConfig["tipFinish"];
}) {
  const surface = useMemo(() => endSurface(shape, "rear"), [shape]);

  const placements = useMemo(() => {
    // Angles on the rear face, below centre, spread for the tip count.
    const angles =
      tips >= 4
        ? [236, 250, 290, 304]
        : tips === 2
          ? [242, 298]
          : [270];
    return angles.map((deg) => {
      const t = deg * DEG;
      const s = 0.5;
      const p = surface(s, t);
      const n = surfaceNormal(surface, s, t);
      // Face backward regardless of the surface's local tilt.
      return { p, n, t };
    });
  }, [surface, tips]);

  const { color, rough } = TIP_COLOURS[finish];

  return (
    <>
      {placements.map(({ p, t }) => (
        <group key={t} position={[p[0], p[1], p[2] - 0.02]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.046, 0.05, 0.08, 32, 1, true]} />
            <meshStandardMaterial
              color={color}
              metalness={1}
              roughness={rough}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* The dark inside of the pipe, facing back out of it. */}
          <mesh rotation={[0, Math.PI, 0]} position={[0, 0, 0.012]}>
            <circleGeometry args={[0.042, 24]} />
            <meshStandardMaterial color="#020203" roughness={1} />
          </mesh>
        </group>
      ))}
    </>
  );
}
