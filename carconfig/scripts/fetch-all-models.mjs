#!/usr/bin/env node
/**
 * Download the best model for every car that has a candidate.
 *
 *   SKETCHFAB_TOKEN=… node scripts/fetch-all-models.mjs [--only porsche] [--limit 20]
 *        [--allow-noncommercial] [--budget-mb 800]
 *
 * Reads src/data/vehicles/model-candidates.json (from find-models.mjs) and,
 * for each model line without a model yet, fetches its top candidate through
 * fetch-model.mjs — which does the licence check, optimisation and credit.
 * If the top candidate fails (withdrawn, not downloadable after all), the
 * next one is tried.
 *
 * Cars with measured profiles go first, since those are the ones people
 * build. It stops at the size budget: every model is committed with the site
 * and downloaded by visitors, so a thousand of them is a hosting decision,
 * not a script flag.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = join(ROOT, "src", "data", "vehicles", "model-candidates.json");
const MANIFEST = join(ROOT, "src", "data", "vehicles", "model-assets.json");
const MATCHES = join(ROOT, "src", "data", "vehicles", "profile-matches.ts");
const MODELS_DIR = join(ROOT, "public", "models");

const USABLE = new Set(["cc0", "by", "by-sa"]);
const NONCOMMERCIAL = new Set(["by-nc", "by-nc-sa"]);

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

function folderMb(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0) / 1e6;
}

const opts = args();
if (!process.env.SKETCHFAB_TOKEN) {
  console.error("Set SKETCHFAB_TOKEN first (sketchfab.com → Settings → Password & API).");
  process.exit(1);
}
const allowNc = opts["allow-noncommercial"] === true;
const budget = Number(opts["budget-mb"] ?? 800);
const limit = opts.limit ? Number(opts.limit) : Infinity;

const candidates = JSON.parse(readFileSync(CANDIDATES, "utf8"));
const profiled = new Set(
  [...readFileSync(MATCHES, "utf8").matchAll(/makeSlug: "([^"]+)", modelSlug: "([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`),
);

const queue = Object.keys(candidates)
  .filter((k) => !opts.only || k.startsWith(`${opts.only}/`))
  .sort((a, b) => Number(profiled.has(b)) - Number(profiled.has(a)) || a.localeCompare(b));

let fetched = 0;
for (const key of queue) {
  if (fetched >= limit) break;
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  if (manifest[key]) continue;
  if (folderMb(MODELS_DIR) > budget) {
    console.log(`\nStopping: models folder is over the ${budget}MB budget.`);
    break;
  }

  const options = candidates[key].filter((c) => USABLE.has(c.license) || (allowNc && NONCOMMERCIAL.has(c.license)));
  for (const c of options) {
    console.log(`\n→ ${key}: ${c.name} by ${c.author} (${c.license})`);
    try {
      const flags = [
        "--sketchfab", c.uid, "--for", key,
        ...(NONCOMMERCIAL.has(c.license) ? ["--allow-noncommercial"] : []),
        // Measured cars must match their published proportions; a candidate
        // that does not is skipped for the next one.
        ...(profiled.has(key) ? ["--strict"] : []),
      ];
      execFileSync(process.execPath, [join(ROOT, "scripts", "fetch-model.mjs"), ...flags], { stdio: "inherit" });
      fetched++;
      break;
    } catch {
      console.log("  failed; trying the next candidate");
    }
  }
}
console.log(`\nFetched ${fetched} model(s). Models folder: ${folderMb(MODELS_DIR).toFixed(0)}MB.`);
