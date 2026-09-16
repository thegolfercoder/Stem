import { FITMENT_RECORDS, PARTS, PARTS_BY_ID, PARTS_BY_SLUG } from "@/data/parts";
import { VEHICLES, VEHICLES_BY_ID, VEHICLES_BY_SLUG } from "@/data/vehicles";
import type { FitmentRecord, Part } from "@/types/part";
import type { Vehicle } from "@/types/vehicle";
import type { CatalogRepository, PartFilter } from "./repository";

/**
 * The catalogue served from the seed modules.
 *
 * Fifteen vehicles and forty-odd parts fit in memory without argument, so
 * there is no caching layer here and no need for one. When this is replaced by
 * a Postgres adapter the filtering below becomes a WHERE clause; the shapes
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
  async listVehicles(): Promise<readonly Vehicle[]> {
    return [...VEHICLES].sort((a, b) =>
      `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`),
    );
  }

  async getVehicleBySlug(slug: string): Promise<Vehicle | null> {
    return VEHICLES_BY_SLUG.get(slug) ?? null;
  }

  async getVehicleById(id: string): Promise<Vehicle | null> {
    return VEHICLES_BY_ID.get(id) ?? null;
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
