import { describe, expect, it } from "vitest";
import { frontDirection } from "@/lib/three/model-orientation";

describe("frontDirection", () => {
  it("finds the front from lights at both ends", () => {
    expect(frontDirection([{ label: "head light glass", along: 0.45 }, { label: "tail light red", along: -0.46 }])).toBe(1);
    expect(frontDirection([{ label: "head light glass", along: -0.45 }, { label: "tail light red", along: 0.46 }])).toBe(-1);
  });

  it("trusts the steering wheel", () => {
    expect(frontDirection([{ label: "steering wheel", along: -0.12 }])).toBe(-1);
  });

  it("reads wheel names that say front and rear", () => {
    expect(frontDirection([{ label: "wheel front left", along: 0.3 }, { label: "wheel rear left", along: -0.33 }])).toBe(1);
  });

  it("ignores parts in the middle and says nothing when names say nothing", () => {
    expect(frontDirection([{ label: "headlight", along: 0.02 }])).toBe(0);
    expect(frontDirection([{ label: "object 12 material 4", along: 0.4 }])).toBe(0);
  });
});
