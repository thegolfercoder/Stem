#!/usr/bin/env node
/**
 * Find models for every car in the catalogue in the Objaverse mirror of
 * Sketchfab, which needs no account to download from.
 *
 *   node scripts/find-objaverse-models.mjs [--only bmw]
 *
 * Adds what it finds to src/data/vehicles/model-candidates.json alongside the
 * Sketchfab search results, ranked by the same rules. Candidates that can be
 * fetched without a token carry the mirror `path`; that includes Sketchfab
 * search results that happen to be mirrored.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelLines, namesMake, rejects, score } from "./lib/model-match.mjs";
import { vehicles } from "./lib/objaverse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "vehicles", "model-candidates.json");
const KEEP = 5;
/** Bigger than this and the download alone is too much to ask of a visitor, even optimised. */
const MAX_BYTES = 150e6;

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const index = Object.values(vehicles());
const existing = JSON.parse(readFileSync(OUT, "utf8"));
const turnedDown = rejects();
const lines = modelLines().filter((l) => !only || l.makeSlug === only);

// Index by word, so each line only scores models that could name it.
const byWord = new Map();
for (const v of index) {
  for (const w of new Set(v.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" "))) {
    if (!w) continue;
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(v);
  }
}

const mirror = Object.fromEntries(index.map((v) => [v.uid, v]));
let lineCount = 0;
let fetchable = 0;
for (const line of lines) {
  const key = `${line.makeSlug}/${line.modelSlug}`;
  const modelWords = line.model.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  // Models whose title contains the model's rarest-looking word (or the squashed name).
  const pool = new Set([...(byWord.get(modelWords.at(-1)) ?? []), ...(byWord.get(modelWords.join("")) ?? [])]);
  const found = [];
  for (const v of pool) {
    if (v.bytes && v.bytes > MAX_BYTES) continue;
    // Sketchfab's search was run per car; here every vehicle is a candidate
    // for every line, so the title must name the make too.
    if (!namesMake(v.name, line)) continue;
    const s = score(v, line, v.license);
    if (s === null) continue;
    found.push({
      uid: v.uid,
      name: v.name,
      author: v.author,
      license: v.license,
      faces: v.faceCount,
      likes: v.likeCount,
      url: v.url,
      score: Math.round(s),
      path: v.path,
      bytes: v.bytes,
    });
  }
  const merged = new Map();
  for (const c of existing[key] ?? []) {
    // Earlier results are re-judged under the current rules.
    const s = score({ name: c.name, faceCount: c.faces, likeCount: c.likes }, line, c.license);
    if (s === null) continue;
    const m = mirror[c.uid];
    merged.set(c.uid, { ...c, score: Math.round(s), ...(m ? { path: m.path, bytes: m.bytes } : {}) });
  }
  for (const c of found) if (!merged.has(c.uid)) merged.set(c.uid, c);
  for (const uid of Object.keys(turnedDown[key] ?? {})) merged.delete(uid);
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, KEEP);
  existing[key] = ranked;
  if (ranked.length) lineCount++;
  if (ranked.some((c) => c.path)) fetchable++;
}

const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${lineCount}/${lines.length} model lines have a candidate; ${fetchable} can be fetched without a Sketchfab token.`);
