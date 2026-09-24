import { describe, expect, it } from "vitest";
import { PARTS_BY_SLUG } from "@/data/parts";
import { VEHICLES_BY_SLUG } from "@/data/vehicles";
import { evaluateCompatibility, summarize } from "@/lib/compatibility/engine";
import type { RuleContext } from "@/lib/compatibility/types";
import type { Finding } from "@/types/compatibility";
import type { FitmentRecord, Part } from "@/types/part";
import type { CatalogVehicle, VehicleProfile } from "@/types/vehicle";

/**
 * The compatibility engine is the part of this product that has to be right.
 * Everything else is presentation; a wrong verdict here costs somebody a set
 * of wheels.
 *
 * These tests are written against the seeded catalogue rather than fixtures
 * invented for the test, so they also check that the seed data says what the
 * data is supposed to say.
 */

function vehicle(slug: string): VehicleProfile {
  const found = VEHICLES_BY_SLUG.get(slug);
  if (!found) throw new Error(`test vehicle missing: ${slug}`);
  return found;
}

/** Wrap a curated profile as the catalogue entry the engine now takes. */
function catalogued(slug: string): CatalogVehicle {
  const profile = vehicle(slug);
  return {
    key: `${profile.manufacturerSlug}/${profile.model}/${profile.year}`,
    makeSlug: profile.manufacturerSlug,
    make: profile.manufacturer,
    modelSlug: profile.model.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    model: profile.model,
    year: profile.year,
    types: ["car"],
    profile,
  };
}

function part(slug: string): Part {
  const found = PARTS_BY_SLUG.get(slug);
  if (!found) throw new Error(`test part missing: ${slug}`);
  return found;
}

function context(
  vehicleSlug: string,
  partSlug: string,
  selected: readonly string[] = [],
  fitment?: FitmentRecord,
): RuleContext {
  return {
    vehicle: catalogued(vehicleSlug),
    part: part(partSlug),
    selected: selected.map(part),
    fitment,
  };
}

const findingFor = (findings: readonly Finding[], ruleKey: string) =>
  findings.filter((f) => f.ruleKey === ruleKey);

describe("bolt pattern", () => {
  it("is compatible when the pattern matches", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "bbs-ch-r-19x95-et35-5x112"),
    );
    const [finding] = findingFor(result.findings, "wheel.bolt_pattern");
    expect(finding?.status).toBe("compatible");
    expect(result.status).toBe("compatible");
  });

  it("is incompatible when the pattern does not match, and says why", () => {
    // APEX ARC-8 is 5x120. The M3 is 5x112.
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "apex-arc8-18x95-et40-5x120"),
    );
    const [finding] = findingFor(result.findings, "wheel.bolt_pattern");

    expect(finding?.status).toBe("incompatible");
    expect(finding?.detail).toContain("5x120");
    expect(finding?.detail).toContain("5x112");
    expect(result.status).toBe("incompatible");
  });

  it("reports incompatible overall even when every other check passes", () => {
    const result = evaluateCompatibility(
      context("toyota-gr86-zn8-2023", "volk-te37-18x95-et38-5x1143"),
    );
    // The GR86 is 5x100; the TE37 here is 5x114.3.
    expect(result.status).toBe("incompatible");
  });
});

describe("centre bore", () => {
  it("requires modification when the wheel bore is larger than the hub", () => {
    // Volk TE37 is bored to 73mm; the WRX hub is 56.1mm.
    const result = evaluateCompatibility(
      context("subaru-wrx-vb-2022", "volk-te37-18x95-et38-5x1143"),
    );
    const [finding] = findingFor(result.findings, "wheel.center_bore");

    expect(finding?.status).toBe("requires_modification");
    expect(finding?.detail).toContain("centring rings");
  });

  it("is compatible when the bore matches exactly", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "bbs-ch-r-19x95-et35-5x112"),
    );
    const [finding] = findingFor(result.findings, "wheel.center_bore");
    expect(finding?.status).toBe("compatible");
  });
});

describe("unknown fitment", () => {
  it("returns unknown for offset when the car has no recorded envelope", () => {
    // The ND2 Miata deliberately carries no offset range.
    const result = evaluateCompatibility(
      context("mazda-mx5-nd2-2023", "konig-hypergram-17x8-et45-5x1143"),
    );
    const findings = findingFor(result.findings, "wheel.offset");

    expect(findings).toHaveLength(2); // front and rear
    for (const finding of findings) {
      expect(finding.status).toBe("unknown");
    }
    expect(result.status).toBe("unknown");
  });

  it("never reports compatible for an application-specific part with no record", () => {
    // A carbon splitter has no recorded application for the Supra.
    const result = evaluateCompatibility(
      context("toyota-supra-30-a90-2023", "front-splitter-carbon"),
    );

    expect(result.status).toBe("unknown");
    const [finding] = findingFor(result.findings, "fitment.no_application_record");
    expect(finding?.detail).toContain("nobody has checked");
  });

  it("treats a part that no rule examined as unknown rather than compatible", () => {
    expect(summarize([]).status).toBe("unknown");
  });
});

describe("requires modification", () => {
  it("flags passive coilovers on a car with electronic dampers", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "kw-v3-coilovers"),
    );
    const [finding] = findingFor(result.findings, "suspension.platform_conflict");

    expect(finding?.status).toBe("requires_modification");
    expect(finding?.detail).toContain("cancellers");
  });

  it("does not flag lowering springs, which keep the original dampers", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "eibach-pro-kit-springs"),
    );
    expect(findingFor(result.findings, "suspension.platform_conflict")).toHaveLength(0);
  });

  it("flags a part whose supporting part is missing from the build", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "vrsf-catless-downpipes"),
    );
    const [finding] = findingFor(result.findings, "build.requires_supporting_part");

    expect(finding?.status).toBe("requires_modification");
    expect(finding?.detail).toContain("engine");
  });

  it("clears that flag once the supporting part is in the build", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "vrsf-catless-downpipes", [
        "bootmod3-stage-2-tune",
      ]),
    );
    const [finding] = findingFor(result.findings, "build.requires_supporting_part");
    expect(finding?.status).toBe("compatible");
  });
});

describe("rules that depend on the rest of the build", () => {
  it("rejects a wheel that will not clear a brake kit already in the build", () => {
    // The APEX ARC-8 is 18 inch and clears the FL5's own 350mm front rotors.
    // Adding the 380mm Brembo kit, which needs a 19 inch wheel, is what makes
    // the same wheel wrong — which is the whole point of evaluating a part
    // against the build rather than against the car alone.
    const withoutKit = evaluateCompatibility(
      context("honda-civic-type-r-fl5-2023", "apex-arc8-18x95-et40-5x120"),
    );
    const withKit = evaluateCompatibility(
      context("honda-civic-type-r-fl5-2023", "apex-arc8-18x95-et40-5x120", [
        "brembo-gt-380-6pot",
      ]),
    );

    const kitFinding = findingFor(withKit.findings, "wheel.brake_clearance").find(
      (f) => f.status === "incompatible",
    );

    expect(kitFinding).toBeDefined();
    expect(kitFinding?.detail).toContain("19");
    expect(withKit.status).toBe("incompatible");
    // The same wheel without the kit is not rejected on brake clearance.
    expect(
      findingFor(withoutKit.findings, "wheel.brake_clearance").every(
        (f) => f.status === "compatible",
      ),
    ).toBe(true);
  });

  it("tells a brake kit it needs bigger wheels than the car currently has", () => {
    // GR86 runs 17 inch wheels; the StopTech kit needs 18.
    const result = evaluateCompatibility(
      context("toyota-gr86-zn8-2023", "stoptech-st60-355"),
    );
    const [finding] = findingFor(result.findings, "brakes.wheel_requirement");

    expect(finding?.status).toBe("requires_modification");
    expect(finding?.detail).toContain("18");
  });

  it("rejects a wheel too small for the car's own brakes", () => {
    // 17 inch wheel against the Nissan Z's 355mm front rotors.
    const result = evaluateCompatibility(
      context("nissan-z-rz34-2023", "konig-hypergram-17x8-et45-5x1143"),
    );
    const finding = findingFor(result.findings, "wheel.brake_clearance").find(
      (f) => f.axle === "front",
    );

    expect(finding?.status).toBe("incompatible");
    expect(finding?.detail).toContain("355mm");
  });
});

describe("tires", () => {
  it("rejects a tire whose rim diameter does not match the wheel", () => {
    // An 18 inch tire against the M3's 19/20 inch stock wheels.
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "bridgestone-re71rs-245-40-18"),
    );
    const finding = findingFor(result.findings, "tire.rim_diameter").find(
      (f) => f.status === "incompatible",
    );

    expect(finding).toBeDefined();
    expect(result.status).toBe("incompatible");
  });

  it("checks the tire against the wheel in the build, not the stock wheel", () => {
    // The GR86 is stock 17 inch. With 18 inch wheels in the build, an 18 inch
    // tire becomes correct and the 17 inch tire becomes wrong.
    const stock = evaluateCompatibility(
      context("toyota-gr86-zn8-2023", "falken-rt660-215-45-17"),
    );
    expect(
      findingFor(stock.findings, "tire.rim_diameter").every(
        (f) => f.status === "compatible",
      ),
    ).toBe(true);

    const withEighteens = evaluateCompatibility(
      context("toyota-gr86-zn8-2023", "falken-rt660-215-45-17", [
        "apex-arc8-18x95-et40-5x120",
      ]),
    );
    expect(
      findingFor(withEighteens.findings, "tire.rim_diameter").some(
        (f) => f.status === "incompatible",
      ),
    ).toBe(true);
  });
});

describe("advisories", () => {
  it("does not let a legality warning change the fitment verdict", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "vrsf-catless-downpipes", [
        "bootmod3-stage-2-tune",
      ]),
    );
    const advisory = findingFor(result.findings, "legal.emissions")[0];

    expect(advisory?.advisory).toBe(true);
    expect(advisory?.detail).toContain("emissions");
    // The part fits. It is just not road legal, and that is a different thing.
    expect(result.status).not.toBe("incompatible");
  });

  it("warns about track tire compounds without calling them incompatible", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "michelin-cup2-275-35-19"),
    );
    const advisory = findingFor(result.findings, "tire.compound_advisory")[0];

    expect(advisory?.advisory).toBe(true);
    expect(advisory?.status).toBe("compatible");
  });
});

describe("explicit fitment records", () => {
  it("uses the recorded status when one exists", () => {
    const record: FitmentRecord = {
      vehicleId: "veh_bmw-m3-g80-competition-xdrive-2023",
      partId: "part_bbs-ch-r-19x95-et35-5x112",
      status: "compatible",
      note: "Confirmed by the wheel maker for this chassis.",
      provenance: { verification: "verified", source: "test" },
    };

    const result = evaluateCompatibility(
      context(
        "bmw-m3-g80-competition-xdrive-2023",
        "bbs-ch-r-19x95-et35-5x112",
        [],
        record,
      ),
    );

    expect(result.status).toBe("compatible");
    const [explicit] = findingFor(result.findings, "fitment.explicit_record");
    expect(explicit?.provenance?.verification).toBe("verified");

    // The overall confidence is still only "estimated", because reaching this
    // verdict also meant consulting the car's estimated diameter envelope.
    // Weakest-link is the intended behaviour: one verified record does not
    // upgrade the estimated data sitting next to it.
    expect(result.confidence).toBe("estimated");
  });

  it("does not let a positive record overrule a bolt pattern mismatch", () => {
    // Somebody's catalogue being wrong does not make 5x120 into 5x112.
    const record: FitmentRecord = {
      vehicleId: "veh_bmw-m3-g80-competition-xdrive-2023",
      partId: "part_apex-arc8-18x95-et40-5x120",
      status: "compatible",
      note: "Claimed to fit.",
      provenance: { verification: "verified", source: "test" },
    };

    const result = evaluateCompatibility(
      context(
        "bmw-m3-g80-competition-xdrive-2023",
        "apex-arc8-18x95-et40-5x120",
        [],
        record,
      ),
    );

    expect(result.status).toBe("incompatible");
  });

  it("lets a negative record stand even where the geometry would pass", () => {
    const result = evaluateCompatibility(
      context("toyota-gr86-zn8-2023", "brembo-gt-380-6pot", [], {
        vehicleId: "veh_toyota-gr86-zn8-2023",
        partId: "part_brembo-gt-380-6pot",
        status: "incompatible",
        note: "Not manufactured for this chassis.",
        provenance: { verification: "unverified", source: "test" },
      }),
    );
    expect(result.status).toBe("incompatible");
  });
});

describe("provenance citing", () => {
  it("cites the factory figure for a bolt pattern, not the estimated envelope", () => {
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "bbs-ch-r-19x95-et35-5x112"),
    );

    // A bolt pattern is a published measurement. Only the clearance envelope
    // is an estimate, and a rule that never read the envelope must not be
    // labelled as though it had.
    const [bolts] = findingFor(result.findings, "wheel.bolt_pattern");
    expect(bolts?.provenance?.verification).toBe("unverified");

    const offset = findingFor(result.findings, "wheel.offset")[0];
    expect(offset?.provenance?.verification).toBe("estimated");
  });
});

describe("confidence", () => {
  it("reports the weakest verification behind the verdict", () => {
    // The offset envelope is estimated, so a verdict relying on it cannot
    // claim to be better than estimated.
    const result = evaluateCompatibility(
      context("bmw-m3-g80-competition-xdrive-2023", "bbs-ch-r-19x95-et35-5x112"),
    );
    expect(result.confidence).toBe("estimated");
  });
});

describe("status ordering", () => {
  const finding = (status: Finding["status"]): Finding => ({
    ruleKey: "test",
    status,
    title: "t",
    detail: "d",
  });

  it("never reports compatible when anything is unknown", () => {
    expect(summarize([finding("compatible"), finding("unknown")]).status).toBe(
      "unknown",
    );
  });

  it("reports incompatible above everything else", () => {
    expect(
      summarize([finding("unknown"), finding("incompatible"), finding("compatible")])
        .status,
    ).toBe("incompatible");
  });

  it("reports compatible only when every finding passes", () => {
    expect(summarize([finding("compatible"), finding("compatible")]).status).toBe(
      "compatible",
    );
  });
});
