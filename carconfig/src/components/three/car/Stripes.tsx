"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { StripeStyle } from "@/lib/build/appearance";
import type { BodyShape } from "@/lib/three/body-shape";
import { buildSurfacePatch } from "./geometry";
import { paintMaterial } from "./materials";

/**
 * Stripes, laid on the body like everything else on its surface.
 *
 * Over-the-top stripes are described by where they sit across the car — a
 * fraction of its half-width — and turned into section angles for each
 * surface, because the tub and the greenhouse have different roundness and
 * the same angle lands in a different place on each. That keeps a stripe the
 * same width from the bonnet, over the roof, to the tail.
 */

/** The section angle whose point sits at fraction `u` of the half-width, on the top. */
function thetaForU(u: number, n: number): number {
  return Math.acos(Math.min(Math.max(u, 0), 1) ** (n / 2));
}

/**
 * Bands across the car, as [inner, outer] fractions of half-width. A band
 * starting at 0 is one stripe down the centre; any other is a pair, mirrored.
 */
const BANDS: Record<"twin" | "single", readonly [number, number]> = {
  twin: [0.05, 0.28],
  single: [0, 0.3],
};

/** Section-angle ranges covering a band, on a surface of roundness n. */
function bandAngles([inner, outer]: readonly [number, number], n: number): [number, number][] {
  const a = thetaForU(outer, n);
  if (inner === 0) return [[a, Math.PI - a]];
  const b = thetaForU(inner, n);
  return [
    [a, b],
    [Math.PI - b, Math.PI - a],
  ];
}

export function Stripes({ shape, style, hex }: { shape: BodyShape; style: StripeStyle; hex: string }) {
  const geometries = useMemo(() => {
    if (style === "none") return [];
    const out: THREE.BufferGeometry[] = [];
    const S = shape.style;

    if (style === "side") {
      // A band low on each flank, from the tail to the nose.
      for (const mirror of [1, -1]) {
        const band = (lo: number, hi: number) =>
          (mirror === 1 ? [lo, hi] : [Math.PI - hi, Math.PI - lo]) as [number, number];
        out.push(
          buildSurfacePatch(
            (z, t) => shape.tubPoint(z, t),
            [shape.zBodyRear + 0.02, shape.zBodyFront - 0.02],
            band(-0.2, -0.1),
            [90, 4],
            0.004,
          ),
        );
      }
      return out;
    }

    const band = BANDS[style];
    const tub = (z: number, t: number) => shape.tubPoint(z, t);
    const cabin = (z: number, t: number) => shape.cabinPoint(z, t);
    for (const across of bandAngles(band, S.roundTop)) {
      // Bonnet, from the windshield base to the nose.
      out.push(buildSurfacePatch(tub, [shape.zCowl + 0.01, shape.zBodyFront - 0.01], across, [60, 6], 0.004));
      // Deck, from the tail to the base of the rear glass.
      if (shape.zBacklight - shape.zBodyRear > 0.05) {
        out.push(buildSurfacePatch(tub, [shape.zBodyRear + 0.01, shape.zBacklight - 0.01], across, [40, 6], 0.004));
      }
    }
    // Over the roof, between the glass.
    for (const across of bandAngles(band, S.cabinRound)) {
      out.push(buildSurfacePatch(cabin, [shape.zRoofRear, shape.zRoofFront], across, [30, 6], 0.004));
    }
    return out;
  }, [shape, style]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  const material = useMemo(() => {
    const m = paintMaterial(hex, "gloss");
    m.side = THREE.DoubleSide;
    return m;
  }, [hex]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} material={material} />
      ))}
    </group>
  );
}

