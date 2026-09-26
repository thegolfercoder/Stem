#!/usr/bin/env node
/**
 * Import the vehicle identity catalogue from NHTSA vPIC.
 *
 * vPIC is the US Department of Transportation's vehicle database. It is a work
 * of the US federal government and is in the public domain, it is free, it has
 * no API key, and it is the closest thing to an authoritative list of every car
 * sold in the United States. That makes it the right spine for this catalogue.
 *
 * What it gives us is *identity*: this make sold this model in this year. What
 * it does not give us is fitment - no bolt patterns, no offsets, no rotor
 * sizes. Those live in the hand-curated fitment profiles, and the compatibility
 * engine answers "unknown" for any car that has no profile yet. That split is
 * the whole point: the catalogue can contain every car immediately and stay
 * honest about which ones we actually know anything about.
 *
 *   node scripts/import-vpic.mjs            # incremental, uses the cache
 *   node scripts/import-vpic.mjs --years 2015:2026
 *   node scripts/import-vpic.mjs --fresh    # ignore the cache
 *
 * Responses are cached on disk, so re-running only fetches what is missing.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".vpic-cache");
const OUT_FILE = path.join(ROOT, "src/data/vehicles/generated/identities.json");

const BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

/**
 * Real passenger-car manufacturers.
 *
 * vPIC lists 12,000+ "makes", the overwhelming majority of which are trailer
 * builders, custom shops and one-off coachbuilders. Nobody configuring a car
 * wants to scroll past "12832429 CANADA INC." to reach Toyota, so the makes are
 * an explicit list rather than whatever the API returns. Adding a marque means
 * adding a line here.
 */
const MAKES = [
  "ACURA", "ALFA ROMEO", "ASTON MARTIN", "AUDI", "BENTLEY", "BMW", "BUICK",
  "CADILLAC", "CHEVROLET", "CHRYSLER", "DODGE", "FERRARI", "FIAT", "FORD",
  "GENESIS", "GMC", "HONDA", "HUMMER", "HYUNDAI", "INFINITI", "ISUZU", "JAGUAR",
  "JEEP", "KIA", "LAMBORGHINI", "LAND ROVER", "LEXUS", "LINCOLN", "LOTUS",
  "MASERATI", "MAZDA", "MCLAREN", "MERCEDES-BENZ", "MERCURY", "MINI",
  "MITSUBISHI", "NISSAN", "OLDSMOBILE", "PLYMOUTH", "POLESTAR", "PONTIAC",
  "PORSCHE", "RAM", "RIVIAN", "ROLLS-ROYCE", "SAAB", "SATURN", "SCION",
  "SMART", "SUBARU", "SUZUKI", "TESLA", "TOYOTA", "VOLKSWAGEN", "VOLVO",
];

/** Passenger vehicles only. Excludes motorcycles, buses and trailers. */
const TYPES = ["car", "mpv", "truck"];

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const yearArg = args[args.indexOf("--years") + 1];
const [START_YEAR, END_YEAR] = args.includes("--years") && yearArg
  ? yearArg.split(":").map(Number)
  : [2000, 2026];

const CONCURRENCY = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const cacheKey = (make, year, type) => `${slug(make)}_${year}_${type}.json`;

async function fetchModels(make, year, type) {
  const file = path.join(CACHE_DIR, cacheKey(make, year, type));
  if (!fresh && existsSync(file)) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // A truncated cache entry is worth re-fetching rather than crashing on.
    }
  }

  const url =
    `${BASE}/GetModelsForMakeYear/make/${encodeURIComponent(make)}` +
    `/modelyear/${year}/vehicletype/${type}?format=json`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const models = (body.Results ?? []).map((r) => r.Model_Name);
      await writeFile(file, JSON.stringify(models));
      return models;
    } catch (err) {
      if (attempt === 2) {
        process.stderr.write(`  ! ${make} ${year} ${type}: ${err.message}\n`);
        return [];
      }
      await sleep(500 * (attempt + 1));
    }
  }
  return [];
}

/** Run tasks with a bounded pool, so vPIC is not hammered. */
async function pool(tasks, limit, onDone) {
  let index = 0;
  let completed = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < tasks.length) {
      const i = index++;
      await tasks[i]();
      onDone(++completed, tasks.length);
    }
  });
  await Promise.all(workers);
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_FILE), { recursive: true });

  const years = [];
  for (let y = START_YEAR; y <= END_YEAR; y++) years.push(y);

  console.log(
    `Importing ${MAKES.length} makes x ${years.length} years x ${TYPES.length} types ` +
    `(${MAKES.length * years.length * TYPES.length} requests, cached)`,
  );

  // model key -> { make, model, years:Set, types:Set }
  const models = new Map();
  const jobs = [];

  for (const make of MAKES) {
    for (const year of years) {
      for (const type of TYPES) {
        jobs.push(async () => {
          const names = await fetchModels(make, year, type);
          for (const name of names) {
            if (!name) continue;
            const key = `${slug(make)}|${slug(name)}`;
            let entry = models.get(key);
            if (!entry) {
              entry = { make, model: name, years: new Set(), types: new Set() };
              models.set(key, entry);
            }
            entry.years.add(year);
            entry.types.add(type);
          }
        });
      }
    }
  }

  let lastLog = 0;
  await pool(jobs, CONCURRENCY, (done, total) => {
    if (done - lastLog >= 250 || done === total) {
      lastLog = done;
      process.stdout.write(`  ${done}/${total}\r`);
    }
  });
  process.stdout.write("\n");

  const out = [...models.values()]
    .map((e) => ({
      makeSlug: slug(e.make),
      make: titleCase(e.make),
      modelSlug: slug(e.model),
      model: e.model,
      years: [...e.years].sort((a, b) => a - b),
      types: [...e.types].sort(),
    }))
    .sort((a, b) =>
      a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
    );

  const payload = {
    source: "NHTSA vPIC (vpic.nhtsa.dot.gov)",
    sourceUrl: "https://vpic.nhtsa.dot.gov/api/",
    licence: "US federal government work, public domain",
    importedOn: new Date().toISOString().slice(0, 10),
    yearRange: [START_YEAR, END_YEAR],
    note:
      "Vehicle identities only - which make sold which model in which year. " +
      "Carries no fitment data: bolt patterns, offsets and brake sizes come " +
      "from hand-curated fitment profiles, and a vehicle with no profile is " +
      "reported as unknown by the compatibility engine rather than guessed at.",
    vehicles: out,
  };

  await writeFile(OUT_FILE, JSON.stringify(payload));

  const yearCount = out.reduce((n, v) => n + v.years.length, 0);
  console.log(`\n${out.length} model lines, ${yearCount} model-years`);
  console.log(`${new Set(out.map((v) => v.makeSlug)).size} makes`);
  console.log(`-> ${path.relative(ROOT, OUT_FILE)}`);
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bBmw\b/, "BMW")
    .replace(/\bGmc\b/, "GMC")
    .replace(/\bRam\b/, "RAM")
    .replace(/\bMini\b/, "MINI");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
