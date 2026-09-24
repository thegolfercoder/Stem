import { FITMENT_RECORDS, PARTS, PARTS_BY_ID, PARTS_BY_SLUG } from "@/data/parts";
import { PROFILE_MATCHES } from "@/data/vehicles/profile-matches";
import type { FitmentRecord, Part } from "@/types/part";
import type {
  CatalogVehicle,
  MakeSummary,
  ModelLine,
  ModelSearchHit,
} from "@/types/vehicle";
import {
  MAKES,
  getModelLine,
  listModels,
  resolveVehicle,
  searchModels,
} from "./identities";
import type { CatalogRepository, PartFilter } from "./repository";

/**
 * The catalogue served from the imported identities and the seeded parts.
 *
 * Ten thousand model-years and forty-odd parts fit in memory without argument,
 * so there is no caching layer here and no need for one. When this is replaced
 * by a Postgres adapter the lookups below become indexed queries; the shapes
 * going in and out do not change.
 */

const fitmentByVehicle = (() => {
  const index = new Map<string, Map<string, FitmentRecord>>();
  for (const record of FITMENT_RECORDS) {
    let forVehicle = index.get(record.vehicleId);
    if (!forVehicle) {
      forVehicle = new Map();
      index.set(record.vehicleId, forVehicle);
    }
    forVehicle.set(record.partId, record);
  }
  return index;
})();

const EMPTY_FITMENT: ReadonlyMap<string, FitmentRecord> = new Map();

function matchesSearch(part: Part, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    part.name.toLowerCase().includes(needle) ||
    part.brand.toLowerCase().includes(needle) ||
    part.description.toLowerCase().includes(needle)
  );
}

export class SeedCatalogRepository implements CatalogRepository {
  async listMakes(): Promise<readonly MakeSummary[]> {
    return MAKES;
  }

  async listModels(makeSlug: string): Promise<readonly ModelLine[]> {
    return listModels(makeSlug);
  }

  async getModelLine(makeSlug: string, modelSlug: string): Promise<ModelLine | null> {
    return getModelLine(makeSlug, modelSlug);
  }

  async getVehicle(
    makeSlug: string,
    modelSlug: string,
    year: number,
  ): Promise<CatalogVehicle | null> {
    return resolveVehicle(makeSlug, modelSlug, year);
  }

  async searchModels(query: string, limit = 40): Promise<readonly ModelSearchHit[]> {
    return searchModels(query, limit);
  }

  /**
   * The measured cars, newest year first.
   *
   * Resolved through the same path as everything else rather than returned
   * straight from the seed module, so a profile whose matcher points at a
   * model line that does not exist simply does not appear — and the matcher
   * test catches it before that can happen quietly.
   */
  async listProfiledVehicles(): Promise<readonly CatalogVehicle[]> {
    const out: CatalogVehicle[] = [];

    for (const match of Object.values(PROFILE_MATCHES)) {
      const line = getModelLine(match.makeSlug, match.modelSlug);
      if (!line) continue;

      const [from, to] = match.years;
      const years = line.years.filter((y) => y >= from && (to === null || y <= to));
      const newest = years[years.length - 1];
      if (newest === undefined) continue;

      const vehicle = resolveVehicle(match.makeSlug, match.modelSlug, newest);
      if (vehicle?.profile) out.push(vehicle);
    }

    return out.sort((a, b) =>
      `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`),
    );
  }

  async listParts(filter?: PartFilter): Promise<readonly Part[]> {
    let parts: readonly Part[] = PARTS;
    if (filter?.category) {
      parts = parts.filter((p) => p.category === filter.category);
    }
    if (filter?.search) {
      const search = filter.search;
      parts = parts.filter((p) => matchesSearch(p, search));
    }
    return parts;
  }

  async getPartBySlug(slug: string): Promise<Part | null> {
    return PARTS_BY_SLUG.get(slug) ?? null;
  }

  async getPartById(id: string): Promise<Part | null> {
    return PARTS_BY_ID.get(id) ?? null;
  }

  async getPartsByIds(ids: readonly string[]): Promise<readonly Part[]> {
    const found: Part[] = [];
    for (const id of ids) {
      const part = PARTS_BY_ID.get(id);
      if (part) found.push(part);
    }
    return found;
  }

  async getFitmentForVehicle(
    vehicleId: string,
  ): Promise<ReadonlyMap<string, FitmentRecord>> {
    return fitmentByVehicle.get(vehicleId) ?? EMPTY_FITMENT;
  }
}
