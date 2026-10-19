import raw from "@/data/vehicles/generated/identities.json";
import { CURATED_MODEL_LINES } from "@/data/vehicles/curated-lines";
import { PROFILE_MATCHES } from "@/data/vehicles/profile-matches";
import { VEHICLES_BY_SLUG } from "@/data/vehicles";
import type {
  BodyType,
  CatalogVehicle,
  MakeSummary,
  ModelLine,
  ModelSearchHit,
  VehicleIdentity,
  VehicleProfile,
} from "@/types/vehicle";
import { identityKey } from "@/types/vehicle";

/**
 * The identity catalogue: every car the importer found, and the lookup that
 * pairs one with its fitment profile when a profile exists.
 *
 * This module is server-only by consequence rather than by decoration — the
 * generated JSON is a few hundred kilobytes and must never reach the browser
 * bundle. Everything that needs it goes through the catalog repository, which
 * is only ever called from server components and route handlers.
 *
 * The indexes are built once at module load. At ten thousand model-years that
 * costs a few milliseconds and makes every lookup afterwards a map hit; it is
 * the same shape a Postgres adapter would get from an index, which is the
 * point.
 */

interface RawPayload {
  readonly source: string;
  readonly sourceUrl: string;
  readonly licence: string;
  readonly importedOn: string;
  readonly yearRange: readonly [number, number];
  readonly note: string;
  readonly vehicles: readonly {
    makeSlug: string;
    make: string;
    modelSlug: string;
    model: string;
    years: number[];
    types: string[];
  }[];
}

const payload = raw as unknown as RawPayload;

export const IDENTITY_SOURCE = {
  source: payload.source,
  sourceUrl: payload.sourceUrl,
  licence: payload.licence,
  importedOn: payload.importedOn,
  yearRange: payload.yearRange,
  note: payload.note,
};

export const MODEL_LINES: readonly ModelLine[] = [
  ...payload.vehicles.map((v) => ({
    makeSlug: v.makeSlug,
    make: v.make,
    modelSlug: v.modelSlug,
    model: v.model,
    years: v.years,
    types: v.types as BodyType[],
  })),
  // Variants vPIC folds into their parent model. See curated-lines.ts.
  ...CURATED_MODEL_LINES,
];

const byMake = new Map<string, ModelLine[]>();
for (const line of MODEL_LINES) {
  const list = byMake.get(line.makeSlug);
  if (list) list.push(line);
  else byMake.set(line.makeSlug, [line]);
}

export const MAKES: readonly MakeSummary[] = [...byMake.entries()]
  .map(([slug, lines]) => ({
    slug,
    name: lines[0]!.make,
    modelCount: lines.length,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const modelKey = (makeSlug: string, modelSlug: string) => `${makeSlug}/${modelSlug}`;

const byModel = new Map<string, ModelLine>(
  MODEL_LINES.map((l) => [modelKey(l.makeSlug, l.modelSlug), l]),
);

export function listModels(makeSlug: string): readonly ModelLine[] {
  return [...(byMake.get(makeSlug) ?? [])].sort((a, b) =>
    a.model.localeCompare(b.model),
  );
}

export function getModelLine(
  makeSlug: string,
  modelSlug: string,
): ModelLine | null {
  return byModel.get(modelKey(makeSlug, modelSlug)) ?? null;
}

export function getIdentity(
  makeSlug: string,
  modelSlug: string,
  year: number,
): VehicleIdentity | null {
  const line = getModelLine(makeSlug, modelSlug);
  if (!line || !line.years.includes(year)) return null;
  return {
    key: identityKey(makeSlug, modelSlug, year),
    makeSlug: line.makeSlug,
    make: line.make,
    modelSlug: line.modelSlug,
    model: line.model,
    year,
    types: line.types,
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface CompiledMatch {
  readonly profileSlug: string;
  readonly from: number;
  readonly to: number | null;
}

/** make/model -> the profiles that claim some of its years. */
const matchesByModel = new Map<string, CompiledMatch[]>();

for (const [profileSlug, match] of Object.entries(PROFILE_MATCHES)) {
  const key = modelKey(match.makeSlug, match.modelSlug);
  const entry: CompiledMatch = {
    profileSlug,
    from: match.years[0],
    to: match.years[1],
  };
  const list = matchesByModel.get(key);
  if (list) list.push(entry);
  else matchesByModel.set(key, [entry]);
}

export function findProfile(
  makeSlug: string,
  modelSlug: string,
  year: number,
): VehicleProfile | null {
  const candidates = matchesByModel.get(modelKey(makeSlug, modelSlug));
  if (!candidates) return null;

  for (const c of candidates) {
    if (year >= c.from && (c.to === null || year <= c.to)) {
      return VEHICLES_BY_SLUG.get(c.profileSlug) ?? null;
    }
  }
  return null;
}

/** True when this model line has a fitment profile for at least one year. */
export function modelHasProfile(makeSlug: string, modelSlug: string): boolean {
  return matchesByModel.has(modelKey(makeSlug, modelSlug));
}

export function resolveVehicle(
  makeSlug: string,
  modelSlug: string,
  year: number,
): CatalogVehicle | null {
  const identity = getIdentity(makeSlug, modelSlug, year);
  if (!identity) return null;
  return { ...identity, profile: findProfile(makeSlug, modelSlug, year) };
}

/** Every model line a profile is attached to. Used by the data-quality page. */
export function profiledModelKeys(): readonly string[] {
  return [...matchesByModel.keys()];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Substring search over make and model.
 *
 * Deliberately simple. At a thousand model lines a linear scan is under a
 * millisecond, and a real search index is the sort of thing to add when the
 * profiling says to, not before. Profiled cars are ranked first because they
 * are the ones the product can actually answer questions about.
 */
export function searchModels(query: string, limit = 40): readonly ModelSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: { line: ModelLine; score: number }[] = [];

  for (const line of MODEL_LINES) {
    const haystack = `${line.make} ${line.model}`.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at === -1) continue;

    // Earlier matches and profiled cars rank higher.
    const profiled = modelHasProfile(line.makeSlug, line.modelSlug);
    hits.push({ line, score: at + (profiled ? -1000 : 0) });
  }

  return hits
    .sort((a, b) =>
      a.score - b.score ||
      `${a.line.make} ${a.line.model}`.localeCompare(
        `${b.line.make} ${b.line.model}`,
      ),
    )
    .slice(0, limit)
    .map((h) => ({
      ...h.line,
      hasProfile: modelHasProfile(h.line.makeSlug, h.line.modelSlug),
    }));
}

export const CATALOG_STATS = {
  makes: MAKES.length,
  modelLines: MODEL_LINES.length,
  modelYears: MODEL_LINES.reduce((n, l) => n + l.years.length, 0),
  profiled: Object.keys(PROFILE_MATCHES).length,
};
