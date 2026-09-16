import type { FitmentRecord, Part, PartCategorySlug } from "@/types/part";
import type { Vehicle } from "@/types/vehicle";

/**
 * The catalog read interface.
 *
 * Everything above this line in the app talks to this and never to the seed
 * modules directly. That is the whole point: the MVP serves the catalogue out
 * of TypeScript, and moving it to Postgres means writing one more
 * implementation of this interface, not touching a single component.
 *
 * Every method is async even though the seed implementation resolves
 * immediately. A synchronous interface here would mean rewriting every caller
 * the day the data comes over a network.
 */
export interface CatalogRepository {
  listVehicles(): Promise<readonly Vehicle[]>;
  getVehicleBySlug(slug: string): Promise<Vehicle | null>;
  getVehicleById(id: string): Promise<Vehicle | null>;

  listParts(filter?: PartFilter): Promise<readonly Part[]>;
  getPartBySlug(slug: string): Promise<Part | null>;
  getPartById(id: string): Promise<Part | null>;
  getPartsByIds(ids: readonly string[]): Promise<readonly Part[]>;

  /**
   * Explicit fitment claims for a vehicle, keyed by part id.
   *
   * Returned as a map for the whole vehicle rather than one lookup per part:
   * the configurator evaluates every part in a category at once, and a
   * per-part round trip would be one query per row against a real database.
   */
  getFitmentForVehicle(vehicleId: string): Promise<ReadonlyMap<string, FitmentRecord>>;
}

export interface PartFilter {
  readonly category?: PartCategorySlug;
  readonly search?: string;
}
