import type { CatalogRepository } from "./repository";
import { SeedCatalogRepository } from "./seed-repository";

/**
 * Which catalogue implementation the app uses.
 *
 * One place, one decision. When a Postgres adapter exists this becomes a check
 * on DATABASE_URL and returns that instead; nothing else in the app changes,
 * because nothing else in the app knows where the data comes from.
 */

let instance: CatalogRepository | null = null;

export function getCatalog(): CatalogRepository {
  if (!instance) instance = new SeedCatalogRepository();
  return instance;
}

export type { CatalogRepository, PartFilter } from "./repository";
export { SeedCatalogRepository } from "./seed-repository";
