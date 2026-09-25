import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { classifyMaterial, normaliseMaterial } from "@/components/three/car/model-materials";

describe("material names from downloaded models", () => {
  it("recognises what a part is from how authors name it", () => {
    expect(classifyMaterial("Windscreen_Glass")).toBe("glass");
    expect(classifyMaterial("HeadlightGlass")).toBe("lens");
    expect(classifyMaterial("tail_light_lens")).toBe("lens");
    expect(classifyMaterial("Tyre_Sidewall")).toBe("tyre");
    expect(classifyMaterial("CarbonFibre")).toBe("carbon");
    expect(classifyMaterial("PianoBlack")).toBe("piano_black");
    expect(classifyMaterial("chrome_trim")).toBe("chrome");
    expect(classifyMaterial("Seat_Leather")).toBe("leather");
  });

  it("leaves names it cannot read alone", () => {
    expect(classifyMaterial("Material.004")).toBeNull();
    expect(classifyMaterial("Paint1")).toBeNull();
    expect(classifyMaterial("Body")).toBeNull();
  });

  it("gives glass real transparency and keeps the model's textures", () => {
    const map = new THREE.Texture();
    const out = normaliseMaterial(new THREE.MeshStandardMaterial({ name: "Glass", map })) as THREE.MeshPhysicalMaterial;
    expect(out.transparent).toBe(true);
    expect(out.opacity).toBeLessThan(0.5);
    expect(out.ior).toBeCloseTo(1.52);
    expect(out.map).toBe(map);
  });

  it("returns an unrecognised material untouched", () => {
    const m = new THREE.MeshStandardMaterial({ name: "Material.004" });
    expect(normaliseMaterial(m)).toBe(m);
  });
});
