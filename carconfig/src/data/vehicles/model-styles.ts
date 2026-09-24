import type { BodyProfile, VehicleIdentity } from "@/types/vehicle";

/**
 * Body style for cars with no measured profile.
 *
 * vPIC's vehicle types are coarse: a 911 is a "car", exactly like a Camry,
 * and a Wrangler is both "mpv" and "truck", exactly like an F-150. Left to
 * those, the viewer draws a four-door 911 and a Wrangler with a bed.
 *
 * Body style is a plain categorical fact about a model line — not a
 * measurement — so naming it for well-known models is honest in a way that
 * inventing their dimensions would not be. Where a model has had several
 * bodies (a Civic has been a coupe, a sedan and a hatch) the entry is the one
 * most people picture, and the canvas still labels the car a stand-in.
 *
 * Patterns match "make/model" slugs, anchored, so "z4" cannot match "gz4x".
 */

const PICKUPS = [
  /^ford\/(f-\d+|ranger|maverick|explorer-sport-trac)$/,
  /^(chevrolet|gmc)\/(silverado.*|sierra.*|colorado|canyon|avalanche|s-10.*|3-ton)$/,
  /^ram\/\d+$/,
  /^dodge\/(dakota|ram-chassis-cab|ram-\d+)$/,
  /^toyota\/(tacoma|tundra|hilux)$/,
  /^nissan\/(frontier|titan.*)$/,
  /^honda\/ridgeline$/,
  /^jeep\/gladiator$/,
  /^hyundai\/santa-cruz$/,
  /^mazda\/b-series$/,
  /^mitsubishi\/raider$/,
  /^rivian\/r1t$/,
  /^tesla\/cybertruck$/,
];

// Order matters: the SUVs of sports-car makers come before the catch-alls
// that would otherwise make an Urus a coupe.
const STYLES: readonly (readonly [BodyProfile, readonly RegExp[]])[] = [
  [
    "suv",
    [
      /^lamborghini\/urus$/,
      /^ferrari\/purosangue$/,
      /^aston-martin\/dbx.*$/,
      /^porsche\/(cayenne.*|macan.*)$/,
      /^mini\/countryman$/,
      /^jeep\/.*$/,
      /^land-rover\/.*$/,
      /^rolls-royce\/cullinan$/,
      /^bentley\/bentayga$/,
    ],
  ],
  [
    "roadster",
    [
      /^mazda\/mx-5.*$/,
      /^bmw\/z[348]$/,
      /^honda\/s2000$/,
      /^porsche\/(boxster|718-boxster|718-spyder)$/,
      /^mercedes-benz\/(slk.*|slc.*|sl.*)$/,
      /^fiat\/124-spider$/,
      /^lotus\/elise$/,
      /^audi\/tt-roadster$/,
      /^nissan\/350z-roadster$/,
    ],
  ],
  [
    "coupe",
    [
      /^porsche\/(911|cayman|718-cayman|918.*|carrera-gt)$/,
      /^toyota\/(gr86|86|supra|gr-supra)$/,
      /^subaru\/brz$/,
      /^scion\/fr-s$/,
      /^nissan\/(z|nissan-z|350z|370z|gt-r)$/,
      /^ford\/(mustang.*|gt)$/,
      /^chevrolet\/(camaro|corvette)$/,
      /^dodge\/(challenger|viper)$/,
      /^bmw\/(m2|m4|m6|m8|2-series|4-series|6-series|8-series|i8)$/,
      /^audi\/(tt|tts|tt-rs|r8)$/,
      /^mercedes-benz\/(amg-gt|clk.*|cl.*)$/,
      /^lexus\/(rc.*|lc.*|sc.*)$/,
      /^infiniti\/(q60|g37-coupe)$/,
      /^jaguar\/f-type$/,
      /^alfa-romeo\/4c$/,
      /^acura\/nsx$/,
      /^honda\/prelude$/,
      /^hyundai\/genesis-coupe$/,
      /^lotus\/(evora|exige|emira)$/,
      /^(ferrari|lamborghini|mclaren|aston-martin)\/.*$/,
    ],
  ],
  [
    "hatch",
    [
      /^volkswagen\/(golf.*|gti|rabbit|polo|up)$/,
      /^honda\/fit$/,
      /^toyota\/(yaris.*|prius.*|gr-corolla)$/,
      /^mini\/.*$/,
      /^ford\/(fiesta|focus-rs|focus-st)$/,
      /^hyundai\/(veloster.*|elantra-gt|ioniq.*|accent-hatchback)$/,
      /^chevrolet\/(bolt.*|spark|sonic)$/,
      /^nissan\/(leaf|versa-note|cube)$/,
      /^fiat\/500.*$/,
      /^kia\/(rio-5-door|soul)$/,
      /^mazda\/mazda2$/,
      /^smart\/.*$/,
    ],
  ],
  [
    "wagon",
    [
      /^volvo\/(v\d+.*|xc70)$/,
      /^audi\/(allroad|a4-allroad|a6-allroad|rs-6-avant)$/,
      /^volkswagen\/(alltrack|sportwagen|golf-sportwagen)$/,
      /^subaru\/outback$/,
      /^mercedes-benz\/e-class-wagon$/,
    ],
  ],
];

/** The body style a model is known for, or null to fall back on vPIC's types. */
export function knownBodyStyle(identity: Pick<VehicleIdentity, "makeSlug" | "modelSlug">): BodyProfile | null {
  const key = `${identity.makeSlug}/${identity.modelSlug}`;
  if (PICKUPS.some((re) => re.test(key))) return "truck";
  for (const [style, patterns] of STYLES) {
    if (patterns.some((re) => re.test(key))) return style;
  }
  return null;
}

/**
 * vPIC's types, read conservatively: anything it calls a passenger car is a
 * sedan, and anything that is also an MPV is an SUV — including the ones it
 * additionally calls trucks, since those are mostly body-on-frame SUVs and
 * vans. The pickups among them are caught by name above.
 */
export function styleFromTypes(types: VehicleIdentity["types"]): BodyProfile {
  if (types.includes("mpv")) return types.includes("car") ? "sedan" : "suv";
  if (types.includes("truck")) return "truck";
  return "sedan";
}

export function bodyStyleFor(identity: Pick<VehicleIdentity, "makeSlug" | "modelSlug" | "types">): BodyProfile {
  return knownBodyStyle(identity) ?? styleFromTypes(identity.types);
}
