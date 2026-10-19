import { describe, expect, it } from "vitest";
import identities from "@/data/vehicles/generated/identities.json";
import { bodyStyleFor, knownBodyStyle, styleFromTypes } from "@/data/vehicles/model-styles";
import { faceDesign, faceFamilyFor, FACE_FAMILIES } from "@/lib/three/face-styles";
import type { BodyType } from "@/types/vehicle";

const id = (makeSlug: string, modelSlug: string, types: BodyType[] = ["car"]) => ({
  makeSlug,
  modelSlug,
  types,
});

describe("body style for unmeasured cars", () => {
  it("names well-known shapes vPIC cannot tell apart", () => {
    expect(bodyStyleFor(id("porsche", "911"))).toBe("coupe");
    expect(bodyStyleFor(id("mazda", "mx-5", ["car", "mpv"]))).toBe("roadster");
    expect(bodyStyleFor(id("volkswagen", "golf"))).toBe("hatch");
    expect(bodyStyleFor(id("volvo", "v60"))).toBe("wagon");
  });

  it("tells pickups from the SUVs vPIC also calls trucks", () => {
    expect(bodyStyleFor(id("ford", "f-150", ["mpv", "truck"]))).toBe("truck");
    expect(bodyStyleFor(id("ram", "1500", ["mpv", "truck"]))).toBe("truck");
    expect(bodyStyleFor(id("jeep", "wrangler", ["mpv", "truck"]))).toBe("suv");
    expect(bodyStyleFor(id("chevrolet", "tahoe", ["mpv", "truck"]))).toBe("suv");
  });

  it("does not let a sports-car make's catch-all swallow its SUV", () => {
    expect(bodyStyleFor(id("lamborghini", "urus"))).toBe("suv");
    expect(bodyStyleFor(id("lamborghini", "huracan"))).toBe("coupe");
  });

  it("matches whole slugs, not fragments", () => {
    expect(knownBodyStyle(id("bmw", "z4"))).toBe("roadster");
    expect(knownBodyStyle(id("bmw", "x4"))).toBeNull();
    expect(knownBodyStyle(id("ford", "f-150-lightning"))).toBeNull();
  });

  it("falls back on vPIC's types", () => {
    expect(styleFromTypes(["car"])).toBe("sedan");
    expect(styleFromTypes(["mpv"])).toBe("suv");
    expect(styleFromTypes(["truck"])).toBe("truck");
  });

  it("gives every car in the catalogue a style", () => {
    for (const v of identities.vehicles) {
      expect(bodyStyleFor(v as never)).toMatch(/^(sedan|coupe|hatch|wagon|suv|roadster|truck)$/);
    }
  });
});

describe("faces", () => {
  it("gives makes their signature and everyone else the modern default", () => {
    expect(faceFamilyFor("bmw", "sedan")).toBe("kidney");
    expect(faceFamilyFor("jeep", "suv")).toBe("seven_slot");
    expect(faceFamilyFor("ford", "truck")).toBe("big_rect");
    expect(faceFamilyFor("honda", "sedan")).toBe("slot");
  });

  it("keeps every patch on the face and mirrored in pairs", () => {
    for (const family of FACE_FAMILIES) {
      const d = faceDesign(family);
      const all = [...d.headlights, ...d.drl, ...d.projectors, ...d.surround, ...d.grille, ...d.intakes, ...d.taillights, ...d.lightBar];
      for (const p of all) {
        // Extent along each axis, generous for tilt.
        const r = Math.hypot(p.a, p.b);
        expect(Math.abs(p.cx) + Math.min(p.a, r)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.cy) + Math.min(p.b, r)).toBeLessThanOrEqual(1);
      }
      for (const lamp of [...d.headlights, ...d.taillights]) {
        if (lamp.cx === 0) continue;
        expect(d.headlights.concat(d.taillights).some((m) => m.cx === -lamp.cx && m.cy === lamp.cy)).toBe(true);
      }
    }
  });
});
