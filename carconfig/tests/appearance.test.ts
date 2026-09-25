import { describe, expect, it } from "vitest";
import { appearanceSchema, applyAppearance, isEmptyAppearance } from "@/lib/build/appearance";
import { decodeShareCode, encodeShareCode } from "@/lib/build/share";
import { deriveViewerConfig } from "@/lib/build/viewer-config";
import { resolveVehicle } from "@/lib/catalog/identities";

const m3 = resolveVehicle("bmw", "m3", 2023)!;

describe("appearance", () => {
  it("changes nothing when empty", () => {
    const base = deriveViewerConfig(m3, []);
    expect(applyAppearance(base, {})).toEqual(base);
    expect(isEmptyAppearance({})).toBe(true);
  });

  it("sits on top of the parts: paint replaces, ride height adds, aero merges", () => {
    const base = deriveViewerConfig(m3, []);
    const out = applyAppearance(base, {
      paintHex: "#1aa4d9",
      paintFinish: "pearl",
      rideHeightMm: -30,
      aero: ["wing"],
      caliperHex: "#d4a019",
    });
    expect(out.paintHex).toBe("#1aa4d9");
    expect(out.paintFinish).toBe("pearl");
    expect(out.rideHeightDeltaMm).toBe(base.rideHeightDeltaMm - 30);
    expect(out.attachments).toContain("wing");
    expect(out.caliperHex).toBe("#d4a019");
    expect(out.rearCaliperHex).toBe("#d4a019");
  });

  it("marks what was chosen, so a real model keeps its own until then", () => {
    const base = deriveViewerConfig(m3, []);
    expect([base.paintChosen, base.wheelsChosen, base.caliperChosen]).toEqual([false, false, false]);
    const painted = applyAppearance(base, { paintFinish: "matte" });
    expect(painted.paintChosen).toBe(true);
    expect(painted.wheelsChosen).toBe(false);
    const wheels = applyAppearance(base, { wheelStyle: "mesh", caliperHex: "#d4a019" });
    expect([wheels.paintChosen, wheels.wheelsChosen, wheels.caliperChosen]).toEqual([false, true, true]);
  });

  it("carries tint and lights, and leaves them alone when unset", () => {
    const base = deriveViewerConfig(m3, []);
    expect([base.tint, base.lights]).toEqual([null, null]);
    const out = applyAppearance(base, { tint: "limo", lights: true });
    expect([out.tint, out.lights]).toEqual(["limo", true]);
    expect(appearanceSchema.safeParse({ tint: "mirror" }).success).toBe(false);
    const code = encodeShareCode({ vehicleKey: m3.key, name: "Night", parts: [], appearance: { tint: "dark", lights: false } });
    expect(decodeShareCode(code)?.appearance).toEqual({ tint: "dark", lights: false });
  });

  it("round-trips through a share link", () => {
    const appearance = { paintHex: "#6fae3c", stripe: "twin" as const, stripeHex: "#f1f2f3", wheelStyle: "mesh" as const };
    const code = encodeShareCode({ vehicleKey: m3.key, name: "Look", parts: [], appearance });
    expect(decodeShareCode(code)?.appearance).toEqual(appearance);
  });

  it("rejects tampered values rather than drawing them", () => {
    expect(appearanceSchema.safeParse({ paintHex: "red" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ rideHeightMm: -900 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ aero: ["rocket"] }).success).toBe(false);
    expect(appearanceSchema.safeParse({ script: "x" }).success).toBe(false);
    // A link with a bad appearance is a broken link, not a half-applied one.
    const bad = btoa(JSON.stringify({ v: 1, c: m3.key, n: "x", p: [], a: { paintHex: "red" } }));
    expect(decodeShareCode(bad)).toBeNull();
  });
});
