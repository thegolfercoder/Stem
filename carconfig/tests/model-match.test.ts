import { describe, expect, it } from "vitest";
// @ts-expect-error: plain JavaScript shared with the Node scripts
import { modelLines, namesMake, score } from "../scripts/lib/model-match.mjs";

type Line = { makeSlug: string; modelSlug: string; make: string; model: string; years: number[] };
const lines = modelLines() as Line[];
const line = (make: string, model: string) => {
  const l = lines.find((x) => x.makeSlug === make && x.modelSlug === model);
  if (!l) throw new Error(`no line ${make}/${model}`);
  return l;
};
const judge = (name: string, l: Line, license = "by") => score({ name, faceCount: 150_000, likeCount: 10 }, l, license);

describe("matching models to cars", () => {
  it("accepts a plainly named model", () => {
    expect(judge("2018 Tesla Model 3", line("tesla", "model-3"))).not.toBeNull();
    expect(judge("BMW E36 M3", line("bmw", "m3"))).not.toBeNull();
    expect(judge("2019 BMW Z4 Roadster", line("bmw", "z4"))).not.toBeNull();
  });

  it("does not find a one-letter model name inside other words", () => {
    // The "a" of A-Class is in almost every title.
    expect(judge("Mercedes-Benz E-Class (W212)", line("mercedes-benz", "a-class"))).toBeNull();
  });

  it("rejects titles naming another of the make's models", () => {
    expect(judge("2016 Chevrolet Camaro SS", line("chevrolet", "ss"))).toBeNull();
    expect(judge("1968 Chevrolet Chevelle SS", line("chevrolet", "ss"))).toBeNull();
  });

  it("rejects game rips, crude and non-car models", () => {
    expect(judge("2001 | BMW M3 GTR (E46) | NFSMW", line("bmw", "m3"))).toBeNull();
    expect(judge("aston martin db9 sport low-poly", line("aston-martin", "db9"))).toBeNull();
    expect(judge("Gen 1 Chevy Volt Battery", line("chevrolet", "volt"))).toBeNull();
    expect(judge("2043 Audi iRS-3 concept", line("audi", "rs-3"))).toBeNull();
  });

  it("refuses licences that do not allow republishing", () => {
    expect(judge("2018 Tesla Model 3", line("tesla", "model-3"), "by-nd")).toBeNull();
  });

  it("knows a make by its common short forms", () => {
    expect(namesMake("VW Golf GTI", line("volkswagen", "golf-gti"))).toBe(true);
    expect(namesMake("Chevy Tahoe", line("chevrolet", "tahoe"))).toBe(true);
    expect(namesMake("DraftPunk Game Assets", line("audi", "rs-3"))).toBe(false);
  });
});
