import type { ModelLine } from "@/types/vehicle";

/**
 * Model lines the catalogue lists that vPIC does not.
 *
 * vPIC identifies cars down to the model and stops: every 911 from a Carrera
 * to a GT3 RS is one "911". For most cars that is exactly right. For a few,
 * the variant is a different car in every way that matters here: its wheels,
 * its brakes, its hubs and its body. Attaching a GT3 RS profile to "911" would
 * give every Carrera the GT3 RS's measurements, which is worse than giving it
 * none.
 *
 * So those variants get their own line, listed alongside vPIC's and kept
 * short. The years are the variant's own, and each entry is expected to have
 * a profile. A curated line with no measurements would add nothing vPIC's own
 * line doesn't already say.
 */
export const CURATED_MODEL_LINES: readonly ModelLine[] = [
  {
    makeSlug: "porsche",
    make: "Porsche",
    modelSlug: "911-gt3-rs",
    model: "911 GT3 RS",
    years: [2023, 2024, 2025, 2026],
    types: ["car"],
  },
];
