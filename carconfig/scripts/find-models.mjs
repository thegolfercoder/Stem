#!/usr/bin/env node
/**
 * Find free, downloadable 3D models for every car in the catalogue.
 *
 *   node scripts/find-models.mjs [--only bmw] [--limit 50] [--fresh] [--out file.json]
 *
 * Searches Sketchfab (no account needed to search) for each make and model
 * line, keeps the downloadable ones under a licence the site can use, ranks
 * them, and writes the best few per car to
 * src/data/vehicles/model-candidates.json. Downloading is a separate step
 * (scripts/fetch-model.mjs), which needs an API token.
 *
 * Resumable: results already in the file are kept unless --fresh, so an
 * interrupted run picks up where it stopped. Requests are spaced out and
 * back off on 429, because a thousand searches is a lot to ask of anyone's
 * API.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITIES = join(ROOT, "src", "data", "vehicles", "generated", "identities.json");
const CURATED = join(ROOT, "src", "data", "vehicles", "curated-lines.ts");
const DEFAULT_OUT = join(ROOT, "src", "data", "vehicles", "model-candidates.json");

const USABLE = new Set(["cc0", "by", "by-sa"]);
const NONCOMMERCIAL = new Set(["by-nc", "by-nc-sa"]);
/** Things that come up for a car's name but are not the car. */
const NOT_A_CAR =
  /\b(lego|toy|hot ?wheels|rc|diecast|keychain|wheels?|rims?|tires?|tyres?|engine|interior|seat|steering|badge|logo|emblem|headlights?|taillights?|exhaust|brake|caliper|chassis only|wreck(ed)?|destroyed|burnt|crashed|scale model kit|papercraft|low ?poly|lowpoly|toon|cartoon|chibi|voxel|minecraft|roblox)\b/i;

/** Search results name the licence rather than giving its slug. */
const LICENSE_BY_LABEL = {
  "CC0 Public Domain": "cc0",
  "CC Attribution": "by",
  "CC Attribution-ShareAlike": "by-sa",
  "CC Attribution-NonCommercial": "by-nc",
  "CC Attribution-NonCommercial-ShareAlike": "by-nc-sa",
  "CC Attribution-NoDerivs": "by-nd",
  "CC Attribution-NonCommercial-NoDerivs": "by-nc-nd",
};
const licenseOf = (r) => r.license?.slug ?? LICENSE_BY_LABEL[r.license?.label] ?? r.license?.label ?? "unknown";

/** Words in titles that say nothing about which car it is. */
const FILLER = new Set(["free", "download", "model", "3d", "car", "the", "with", "and", "by", "sketchfab", "fbx", "obj", "blend", "gltf", "rigged", "realistic", "hq", "hd", "high", "poly", "game", "ready"]);

const DELAY_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const next = a[i + 1];
    if (next === undefined || next.startsWith("--")) out[a[i].slice(2)] = true;
    else out[a[i].slice(2)] = a[++i];
  }
  return out;
}

function modelLines() {
  const raw = JSON.parse(readFileSync(IDENTITIES, "utf8")).vehicles;
  const lines = raw.map((v) => ({ makeSlug: v.makeSlug, make: v.make, modelSlug: v.modelSlug, model: v.model, years: v.years }));
  // Curated lines (e.g. 911 GT3 RS) live in TypeScript; pull the few fields out.
  const src = readFileSync(CURATED, "utf8");
  for (const m of src.matchAll(/makeSlug: "([^"]+)",\s*make: "([^"]+)",\s*modelSlug: "([^"]+)",\s*model: "([^"]+)",\s*years: \[([^\]]*)\]/g)) {
    lines.push({ makeSlug: m[1], make: m[2], modelSlug: m[3], model: m[4], years: m[5].split(",").map((y) => Number(y.trim())) });
  }
  return lines;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean);

/** How well a result's name matches the car, or null if it is not this car. */
function score(result, line) {
  const name = norm(result.name);
  if (NOT_A_CAR.test(result.name)) return null;

  // Every token of the model name must appear ("mx 5", "911 gt3 rs"), joined
  // or spaced ("mx5" matches "mx 5").
  const squashed = name.replace(/ /g, "");
  for (const t of tokens(line.model)) {
    if (!name.split(" ").includes(t) && !squashed.includes(t)) return null;
  }
  // A result naming a longer variant ("911 GT3 RS" when looking for "911")
  // is a different car's measurements but the same shape; allow it, ranked lower.
  let s = 0;
  if (tokens(line.make).every((t) => name.includes(t))) s += 30;
  const extra = tokens(name).filter(
    (t) => !FILLER.has(t) && !tokens(line.make).includes(t) && !tokens(line.model).includes(t) && !/^(19|20)\d\d$/.test(t),
  );
  s -= Math.min(extra.length, 8) * 2;

  const year = name.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  if (year && line.years.includes(Number(year[1]))) s += 12;
  if (year && !line.years.includes(Number(year[1]))) s -= 6;

  const lic = licenseOf(result);
  if (USABLE.has(lic)) s += 25;
  else if (NONCOMMERCIAL.has(lic)) s += 5;
  else return null;

  const faces = result.faceCount ?? 0;
  if (faces < 8000) return null; // too crude to be worth drawing
  if (faces > 2_500_000) s -= 25; // too heavy for a browser
  else if (faces > 1_200_000) s -= 10;
  else if (faces >= 60_000) s += 10;

  s += Math.min(Math.log10((result.likeCount ?? 0) + 1) * 6, 18);
  return s;
}

async function search(q) {
  const url =
    "https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24" +
    `&categories=cars-vehicles&q=${encodeURIComponent(q)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(15000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`search ${res.status}`);
    return (await res.json()).results ?? [];
  }
  throw new Error("rate limited");
}

async function main() {
  const opts = args();
  // --out lets a long run write somewhere other than the repository until it is done.
  const OUT = opts.out ? resolve(opts.out) : DEFAULT_OUT;
  const existing = !opts.fresh && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const all = modelLines()
    .filter((l) => !opts.only || l.makeSlug === opts.only)
    .slice(0, opts.limit ? Number(opts.limit) : undefined);

  let done = 0;
  let found = 0;
  for (const line of all) {
    const key = `${line.makeSlug}/${line.modelSlug}`;
    done++;
    if (existing[key]) {
      if (existing[key].length) found++;
      continue;
    }
    try {
      const results = await search(`${line.make} ${line.model}`);
      const ranked = results
        .map((r) => ({ r, s: score(r, line) }))
        .filter((x) => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map(({ r, s }) => ({
          uid: r.uid,
          name: r.name,
          author: r.user?.displayName ?? r.user?.username,
          license: licenseOf(r),
          faces: r.faceCount,
          likes: r.likeCount,
          url: r.viewerUrl,
          score: Math.round(s),
        }));
      existing[key] = ranked;
      if (ranked.length) found++;
    } catch (e) {
      console.error(`  ${key}: ${e.message}`);
    }
    if (done % 25 === 0) {
      writeFileSync(OUT, `${JSON.stringify(existing, null, 1)}\n`);
      console.log(`${done}/${all.length} searched, ${found} with a usable model`);
    }
    await sleep(DELAY_MS);
  }

  // Stable order, so re-runs produce small diffs.
  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`\nDone: ${found}/${all.length} model lines have at least one usable model.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
