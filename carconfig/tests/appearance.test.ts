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
