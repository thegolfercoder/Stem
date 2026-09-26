import type { ProfileMatch } from "@/types/vehicle";

/**
 * Which imported identities each hand-curated profile speaks for.
 *
 * Written out by hand rather than derived from the profile's own model name,
 * because the two vocabularies genuinely differ: vPIC calls the car "m3" where
 * the profile calls it "M3 Competition xDrive", and it files the current Z
 * under "nissan-z" while the profile calls it "Z". A fuzzy match between those
 * would eventually attach a profile to the wrong car, and a wrong profile is
 * worse than no profile — it produces confident answers about measurements
 * that belong to a different vehicle.
 *
 * Adding a car to the catalogue's *measured* set means adding a profile in
 * ./index.ts and one line here. Everything else in the catalogue keeps working
 * without it, reported as unknown.
 */
export const PROFILE_MATCHES: Readonly<Record<string, ProfileMatch>> = {
  "bmw-m3-g80-competition-xdrive-2023": {
    makeSlug: "bmw", modelSlug: "m3", years: [2021, null],
  },
  "bmw-m2-g87-2023": {
    makeSlug: "bmw", modelSlug: "m2", years: [2023, null],
  },
  "toyota-gr86-zn8-2023": {
    makeSlug: "toyota", modelSlug: "gr86", years: [2022, null],
  },
  "subaru-wrx-vb-2022": {
    makeSlug: "subaru", modelSlug: "wrx", years: [2022, null],
  },
  "honda-civic-type-r-fl5-2023": {
    makeSlug: "honda", modelSlug: "civic-type-r", years: [2023, null],
  },
  "honda-civic-si-fe1-2022": {
    makeSlug: "honda", modelSlug: "civic-si", years: [2022, null],
  },
  "ford-mustang-gt-s550-2018": {
    makeSlug: "ford", modelSlug: "mustang", years: [2018, 2023],
  },
  "porsche-718-cayman-gts-40-2022": {
    makeSlug: "porsche", modelSlug: "718-cayman", years: [2017, 2025],
  },
  // A curated model line: vPIC files every 911 under one name. See
  // ./curated-lines.ts.
  "porsche-911-gt3-rs-992-2023": {
    makeSlug: "porsche", modelSlug: "911-gt3-rs", years: [2023, null],
  },
  "volkswagen-golf-r-mk8-2022": {
    makeSlug: "volkswagen", modelSlug: "golf-r", years: [2021, 2024],
  },
  "audi-rs3-8y-2023": {
    makeSlug: "audi", modelSlug: "rs-3", years: [2022, null],
  },
  "toyota-supra-30-a90-2023": {
    makeSlug: "toyota", modelSlug: "supra", years: [2020, null],
  },
  "nissan-z-rz34-2023": {
    makeSlug: "nissan", modelSlug: "nissan-z", years: [2023, null],
  },
  "mazda-mx5-nd2-2023": {
    makeSlug: "mazda", modelSlug: "mx-5", years: [2019, null],
  },
  "chevrolet-camaro-ss-1le-2019": {
    makeSlug: "chevrolet", modelSlug: "camaro", years: [2016, 2024],
  },
  "mitsubishi-lancer-evolution-x-cz4a-2015": {
    makeSlug: "mitsubishi", modelSlug: "lancer-evolution", years: [2008, 2015],
  },
};
