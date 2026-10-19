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
import { modelLines, score } from "./lib/model-match.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(ROOT, "src", "data", "vehicles", "model-candidates.json");

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
        .map((r) => ({ r, s: score(r, line, licenseOf(r)) }))
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
