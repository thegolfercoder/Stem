import { describe, expect, it } from "vitest";
import { PROFILE_MATCHES } from "@/data/vehicles/profile-matches";
import { VEHICLES_BY_SLUG } from "@/data/vehicles";
import {
  CATALOG_STATS,
  MAKES,
  MODEL_LINES,
  findProfile,
  getModelLine,
  resolveVehicle,
  searchModels,
} from "@/lib/catalog/identities";
import { evaluateCompatibility } from "@/lib/compatibility/engine";
import { PARTS_BY_SLUG } from "@/data/parts";

/**
 * The catalogue holds ten thousand model-years imported from vPIC and a few
 * dozen hand-measured fitment profiles. These tests guard the seam between
 * those two: a profile that attaches to nothing is invisible, and a profile
 * that attaches to the wrong car is worse than none at all.
 */

describe("identity import", () => {
  it("has a substantial catalogue", () => {
    expect(CATALOG_STATS.makes).toBeGreaterThan(40);
    expect(CATALOG_STATS.modelLines).toBeGreaterThan(800);
    expect(CATALOG_STATS.modelYears).toBeGreaterThan(5000);
  });

  it("gives every model line at least one year and a make", () => {
    for (const line of MODEL_LINES) {
      expect(line.years.length).toBeGreaterThan(0);
      expect(line.makeSlug).toMatch(/^[a-z0-9-]+$/);
      expect(line.modelSlug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("lists makes in alphabetical order with model counts", () => {
    const names = MAKES.map((m) => m.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    for (const make of MAKES) expect(make.modelCount).toBeGreaterThan(0);
  });
});

describe("profile matchers", () => {
  /**
   * The failure this catches is silent: vPIC files the Audi RS 3 under "rs-3",
   * so a matcher written as "rs3" attaches to nothing and the car quietly
   * loses its measurements. Nothing in the UI would look broken.
   */
  it("every matcher points at a model line that exists", () => {
    for (const [profileSlug, match] of Object.entries(PROFILE_MATCHES)) {
      const line = getModelLine(match.makeSlug, match.modelSlug);
      expect(
        line,
        `${profileSlug} matches ${match.makeSlug}/${match.modelSlug}, which is not in the catalogue`,
      ).not.toBeNull();
    }
  });

  it("every matcher names a profile that exists", () => {
    for (const profileSlug of Object.keys(PROFILE_MATCHES)) {
      expect(VEHICLES_BY_SLUG.get(profileSlug), profileSlug).toBeDefined();
    }
  });

  it("every matcher covers at least one real year of that model", () => {
    for (const [profileSlug, match] of Object.entries(PROFILE_MATCHES)) {
      const line = getModelLine(match.makeSlug, match.modelSlug);
      const [from, to] = match.years;
      const covered = (line?.years ?? []).filter(
        (y) => y >= from && (to === null || y <= to),
      );
      expect(
        covered.length,
        `${profileSlug} covers no year the catalogue lists`,
      ).toBeGreaterThan(0);
    }
  });

  it("resolves a known car to its profile", () => {
    const m3 = resolveVehicle("bmw", "m3", 2023);
    expect(m3?.profile?.slug).toBe("bmw-m3-g80-competition-xdrive-2023");
    expect(m3?.key).toBe("bmw/m3/2023");
  });

  it("does not attach a profile outside its year range", () => {
    // The G80 profile starts in 2021; a 2005 M3 is a different car entirely.
    expect(findProfile("bmw", "m3", 2005)).toBeNull();
    expect(resolveVehicle("bmw", "m3", 2005)?.profile).toBeNull();
  });

  it("returns null for a car the catalogue does not list", () => {
    expect(resolveVehicle("bmw", "not-a-model", 2023)).toBeNull();
    expect(resolveVehicle("bmw", "m3", 1970)).toBeNull();
  });
});

describe("search", () => {
  it("finds a car by model name", () => {
    const hits = searchModels("supra");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.modelSlug === "supra")).toBe(true);
  });

  it("ranks measured cars above unmeasured ones", () => {
    const hits = searchModels("m3");
    const measuredAt = hits.findIndex((h) => h.hasProfile);
    const unmeasuredAt = hits.findIndex((h) => !h.hasProfile);
    if (measuredAt !== -1 && unmeasuredAt !== -1) {
      expect(measuredAt).toBeLessThan(unmeasuredAt);
    }
  });

  it("ignores queries too short to be useful", () => {
    expect(searchModels("")).toHaveLength(0);
  });
});

describe("a car with no fitment profile", () => {
  /**
   * Picked from the catalogue rather than hardcoded, so this keeps testing the
   * real majority case as the measured set grows.
   */
  const unprofiled = () => {
    for (const line of MODEL_LINES) {
      const year = line.years[line.years.length - 1]!;
      const v = resolveVehicle(line.makeSlug, line.modelSlug, year);
      if (v && !v.profile) return v;
    }
    throw new Error("expected at least one unmeasured car in the catalogue");
  };

  it("still resolves and opens", () => {
    const v = unprofiled();
    expect(v.profile).toBeNull();
    expect(v.key).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+\/\d{4}$/);
  });

  /**
   * The whole argument of the product in one assertion: with no measurements
   * on record, no part may come back compatible.
   */
  it("never reports a part as compatible", () => {
    const vehicle = unprofiled();

    for (const slug of [
      "bbs-ch-r-19x95-et35-5x112",
      "michelin-ps4s-255-35-19",
      "kw-v3-coilovers",
      "brembo-gt-380-6pot",
      "remus-cat-back-stainless",
    ]) {
      const part = PARTS_BY_SLUG.get(slug);
      if (!part) throw new Error(`missing test part: ${slug}`);

      const result = evaluateCompatibility({ vehicle, part, selected: [] });
      expect(result.status, `${slug} on an unmeasured car`).not.toBe("compatible");
    }
  });

  it("still lets a finish be applied, because that needs no measurements", () => {
    const vehicle = unprofiled();

    const paint = PARTS_BY_SLUG.get("wrap-satin-black");
    if (!paint) throw new Error("missing paint part");

    const result = evaluateCompatibility({ vehicle, part: paint, selected: [] });
    expect(result.status).toBe("compatible");
  });
});
