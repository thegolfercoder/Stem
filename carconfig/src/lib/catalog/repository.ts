import type { FitmentRecord, Part, PartCategorySlug } from "@/types/part";
import type {
  CatalogVehicle,
  MakeSummary,
  ModelLine,
  ModelSearchHit,
} from "@/types/vehicle";

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
  /** Every manufacturer in the catalogue, with how many model lines each has. */
  listMakes(): Promise<readonly MakeSummary[]>;

  /** Every model line for one make. */
  listModels(makeSlug: string): Promise<readonly ModelLine[]>;

  /** One model line, for picking a year. */
  getModelLine(makeSlug: string, modelSlug: string): Promise<ModelLine | null>;

  /**
   * One buildable car. Returns an identity with `profile: null` when the
   * catalogue knows the car exists but has no measurements for it, which is
   * the normal case and not an error.
   */
  getVehicle(
    makeSlug: string,
    modelSlug: string,
    year: number,
  ): Promise<CatalogVehicle | null>;

  /** Substring search across makes and models. */
  searchModels(query: string, limit?: number): Promise<readonly ModelSearchHit[]>;

  /** The cars that do have a fitment profile. Small, and worth showing first. */
  listProfiledVehicles(): Promise<readonly CatalogVehicle[]>;

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
