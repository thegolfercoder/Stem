import { describe, expect, it } from "vitest";
import { ARCH_GAP, createBodyShape, pchip, type BodyShapeInput } from "@/lib/three/body-shape";
import { BODY_STYLES, STYLE_DEFAULTS } from "@/lib/three/body-styles";
import type { BodyProfile } from "@/types/vehicle";

/**
 * The generated body has to be a plausible car for every style, not just the
 * one that happened to be on screen while it was tuned. These check the
 * geometric promises the viewer relies on.
 */

const STYLES = Object.keys(BODY_STYLES) as BodyProfile[];

function inputFor(style: BodyProfile): BodyShapeInput {
  const d = STYLE_DEFAULTS[style];
  return {
    style,
    length: d.lengthMm / 1000,
    width: d.widthMm / 1000,
    height: d.heightMm / 1000,
    wheelbase: d.wheelbaseMm / 1000,
    frontTireRadius: 0.33,
    rearTireRadius: 0.34,
  };
}

describe("pchip", () => {
  it("passes through its points and never overshoots them", () => {
    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 1, 3];
    const f = pchip(xs, ys);
    xs.forEach((x, i) => expect(f(x)).toBeCloseTo(ys[i]!, 9));
    // A flat run stays flat: no bulge between two equal points.
    for (let x = 1; x <= 2; x += 0.05) expect(f(x)).toBeCloseTo(1, 9);
  });
});

describe.each(STYLES)("body shape: %s", (style) => {
  const input = inputFor(style);
  const shape = createBodyShape(input);

  it("is the length it was asked to be", () => {
    expect(shape.zFront - shape.zRear).toBeCloseTo(input.length, 3);
    expect(shape.zFrontAxle - shape.zRearAxle).toBeCloseTo(input.wheelbase, 3);
  });

  it("cuts arches that clear the stock tires", () => {
    const radii = [input.frontTireRadius, input.rearTireRadius];
    shape.arches.forEach((arch, i) => {
      expect(arch.r).toBeGreaterThanOrEqual(radii[i]! + ARCH_GAP - 1e-9);
      // Above the wheel centre, the floor of the body is above the tire.
      expect(shape.tubSection(arch.z).yBottom).toBeGreaterThanOrEqual(arch.y + radii[i]! - 1e-6);
    });
  });

  it("has a real cabin at the roof", () => {
    const mid = shape.cabinSection((shape.zRoofFront + shape.zRoofRear) / 2);
    expect(mid.yTop - mid.yBottom).toBeGreaterThan(0.25);
  });

  it("stays inside its own width", () => {
    // Measured on the surface itself, crease included.
    let widest = 0;
    for (const z of shape.tubStations(0.05)) {
      for (let i = 0; i < 180; i++) {
        widest = Math.max(widest, Math.abs(shape.tubPoint(z, (i / 180) * Math.PI * 2)[0]));
      }
    }
    expect(widest).toBeLessThanOrEqual(input.width / 2 + 1e-6);
    // A touch under is fine (the shoulder roll trims the crease); over is not.
    expect(widest).toBeGreaterThan(input.width / 2 - 0.02);
  });

  it("sits the greenhouse on the body, not through its sides", () => {
    for (const z of shape.cabinStations(0.05)) {
      const cabin = shape.cabinSection(z);
      const tub = shape.tubSection(z);
      expect(cabin.hwBottom).toBeLessThanOrEqual(tub.hw + 1e-6);
      expect(cabin.hwTop).toBeLessThanOrEqual(cabin.hwBottom + 1e-6);
      // It pinches to nothing at the windshield and backlight bases.
      expect(cabin.yTop).toBeGreaterThanOrEqual(cabin.yBottom);
      expect(cabin.yTop).toBeLessThanOrEqual(input.height + 0.05);
    }
  });

  it("puts face details on the end caps, between the body and the tip", () => {
    for (const end of ["front", "rear"] as const) {
      for (const [xn, vn] of [
        [0, 0],
        [0.6, 0.4],
        [-0.6, -0.4],
      ] as const) {
        const [x, , z] = shape.facePoint(end, xn, vn);
        expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
        if (end === "front") {
          expect(z).toBeGreaterThanOrEqual(shape.zBodyFront - 1e-6);
          expect(z).toBeLessThanOrEqual(shape.zFront + 1e-6);
        } else {
          expect(z).toBeLessThanOrEqual(shape.zBodyRear + 1e-6);
          expect(z).toBeGreaterThanOrEqual(shape.zRear - 1e-6);
        }
        // Mirror symmetry across the centreline.
        expect(shape.facePoint(end, -xn, vn)[0]).toBeCloseTo(-x, 6);
      }
    }
  });
});

describe("a body built from a traced side view", () => {
  // A plain coupe silhouette, as fractions of length and height.
  const traced = {
    frontAxle: 0.2,
    cowl: 0.36,
    roofFront: 0.48,
    roofRear: 0.62,
    backlight: 0.8,
    top: [
      [0, 0.42], [0.1, 0.5], [0.36, 0.64], [0.48, 0.99], [0.55, 1], [0.62, 0.98], [0.8, 0.68], [0.95, 0.62], [1, 0.52],
    ],
    belt: [[0.36, 0.64], [0.6, 0.67], [0.8, 0.68]],
    bottom: [[0, 0.14], [0.2, 0.09], [0.8, 0.09], [1, 0.16]],
  } as const;
  const input = { ...inputFor("coupe"), traced };
  const shape = createBodyShape(input);
  const H = input.height;

  it("puts the greenhouse where the tracing does", () => {
    expect(shape.zFront - shape.zCowl).toBeCloseTo(0.36 * input.length, 6);
    expect(shape.zFront - shape.zBacklight).toBeCloseTo(0.8 * input.length, 6);
  });

  it("follows the traced roofline to the published height", () => {
    const roofMid = (shape.zRoofFront + shape.zRoofRear) / 2;
    expect(shape.roofAt(roofMid)).toBeGreaterThan(0.97 * H);
    expect(shape.roofAt(roofMid)).toBeLessThanOrEqual(H + 1e-6);
  });

  it("keeps the published wheelbase even if the tracing's rear axle is off", () => {
    expect(shape.zFrontAxle - shape.zRearAxle).toBeCloseTo(input.wheelbase, 6);
  });

  it("keeps every promise an untraced body makes", () => {
    shape.arches.forEach((arch, i) => {
      const r = i === 0 ? input.frontTireRadius : input.rearTireRadius;
      expect(shape.tubSection(arch.z).yBottom).toBeGreaterThanOrEqual(arch.y + r - 1e-6);
    });
    expect(shape.zFront - shape.zRear).toBeCloseTo(input.length, 3);
  });
});
