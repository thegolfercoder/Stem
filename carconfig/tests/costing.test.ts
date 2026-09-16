import { describe, expect, it } from "vitest";
import { PARTS_BY_SLUG } from "@/data/parts";
import { VEHICLES_BY_SLUG } from "@/data/vehicles";
import { decodeShareCode, encodeShareCode } from "@/lib/build/share";
import { estimatePerformance } from "@/lib/performance";
import { calculateBuildCost, formatCents } from "@/lib/pricing";
import type { Part } from "@/types/part";

function part(slug: string): Part {
  const found = PARTS_BY_SLUG.get(slug);
  if (!found) throw new Error(`test part missing: ${slug}`);
  return found;
}

const m3 = () => {
  const v = VEHICLES_BY_SLUG.get("bmw-m3-g80-competition-xdrive-2023");
  if (!v) throw new Error("test vehicle missing");
  return v;
};

describe("pricing", () => {
  it("keeps part cost and installation cost separate", () => {
    const cost = calculateBuildCost([
      { part: part("brembo-gt-380-6pot"), quantity: 1 },
    ]);

    expect(cost.partsCents).toBe(540000);
    expect(cost.installCents).toBe(90000);
    expect(cost.totalCents).toBe(630000);
  });

  it("multiplies by quantity on both costs", () => {
    const cost = calculateBuildCost([
      { part: part("ferodo-ds2500-pads"), quantity: 2 },
    ]);
    expect(cost.partsCents).toBe(68000);
    expect(cost.installCents).toBe(36000);
  });

  it("reports the build's price confidence as demo", () => {
    const cost = calculateBuildCost([
      { part: part("bbs-ch-r-19x95-et35-5x112"), quantity: 1 },
    ]);
    // Every seeded price is invented, so no build may claim better than demo.
    expect(cost.confidence).toBe("demo");
  });

  it("totals an empty build to zero without dividing by anything", () => {
    const cost = calculateBuildCost([]);
    expect(cost.totalCents).toBe(0);
    expect(cost.lines).toHaveLength(0);
  });

  it("formats whole dollars", () => {
    expect(formatCents(630000)).toBe("$6,300");
  });
});

describe("performance estimation", () => {
  it("adds claimed power and weight changes to the stock figures", () => {
    const estimate = estimatePerformance(m3(), [
      part("eventuri-carbon-intake"), // +12hp, -2kg
      part("remus-cat-back-stainless"), // +8hp, -6kg
    ]);

    expect(estimate.stockPowerHp).toBe(503);
    expect(estimate.estimatedPowerHp).toBe(523);
    expect(estimate.weightDeltaKg).toBe(-8);
    expect(estimate.estimatedWeightKg).toBe(1772);
  });

  it("refuses to count a power claim whose prerequisites are missing", () => {
    // Catless downpipes claim +35hp, and make approximately none of it
    // without a calibration.
    const estimate = estimatePerformance(m3(), [part("vrsf-catless-downpipes")]);

    expect(estimate.powerDeltaHp).toBe(0);
    expect(estimate.estimatedPowerHp).toBe(503);
    expect(estimate.discounted).toHaveLength(1);
    expect(estimate.discounted[0]?.reason).toContain("Not counted");
    // The weight saving is real regardless, so it still counts.
    expect(estimate.weightDeltaKg).toBe(-4);
  });

  it("counts the claim once the supporting part is in the build", () => {
    const estimate = estimatePerformance(m3(), [
      part("vrsf-catless-downpipes"), // +35
      part("bootmod3-stage-2-tune"), // +95, needs an exhaust part
    ]);

    expect(estimate.powerDeltaHp).toBe(130);
    expect(estimate.discounted).toHaveLength(0);
  });

  it("computes power to weight per tonne", () => {
    const estimate = estimatePerformance(m3(), []);
    // 503hp / 1.78t
    expect(estimate.stockPowerToWeight).toBeCloseTo(282.6, 0);
    expect(estimate.estimatedPowerToWeight).toBe(estimate.stockPowerToWeight);
  });
});

describe("share codes", () => {
  it("round-trips a build", () => {
    const code = encodeShareCode({
      vehicleSlug: "bmw-m3-g80-competition-xdrive-2023",
      name: "Track M3",
      parts: [
        { slug: "bbs-ch-r-19x95-et35-5x112", quantity: 1 },
        { slug: "ferodo-ds2500-pads", quantity: 2 },
      ],
      paintHex: "#1a1c1e",
    });

    const decoded = decodeShareCode(code);

    expect(decoded?.vehicleSlug).toBe("bmw-m3-g80-competition-xdrive-2023");
    expect(decoded?.name).toBe("Track M3");
    expect(decoded?.parts).toEqual([
      { slug: "bbs-ch-r-19x95-et35-5x112", quantity: 1 },
      { slug: "ferodo-ds2500-pads", quantity: 2 },
    ]);
    expect(decoded?.paintHex).toBe("#1a1c1e");
  });

  it("produces URL-safe codes", () => {
    const code = encodeShareCode({
      vehicleSlug: "porsche-718-cayman-gts-40-2022",
      name: "Weekend car",
      parts: [{ slug: "michelin-cup2-275-35-19", quantity: 1 }],
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(code)).toBe(code);
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(decodeShareCode("")).toBeNull();
    expect(decodeShareCode("not-base64!!")).toBeNull();
    expect(decodeShareCode(btoa("{}"))).toBeNull();
    expect(decodeShareCode(btoa('{"v":9}'))).toBeNull();
  });

  it("rejects a payload whose slugs are not slugs", () => {
    // A tampered link trying to smuggle something through the slug field.
    const hostile = btoa(
      JSON.stringify({ v: 1, c: "../../etc/passwd", n: "x", p: [] }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(decodeShareCode(hostile)).toBeNull();
  });

  it("rejects an oversized code without decoding it", () => {
    expect(decodeShareCode("a".repeat(9000))).toBeNull();
  });
});
