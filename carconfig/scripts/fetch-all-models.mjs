#!/usr/bin/env node
/**
 * Download the best model for every car that has a candidate.
 *
 *   node scripts/fetch-all-models.mjs [--only porsche] [--limit 20]
 *        [--allow-noncommercial] [--budget-mb 250] [--no-link] [--recheck]
 *
 * Candidates mirrored in Objaverse are fetched from there with no account;
 * the rest need SKETCHFAB_TOKEN, and are skipped without it.
 *
 * Reads src/data/vehicles/model-candidates.json (from find-models.mjs) and,
 * for each model line without a model yet, fetches its top candidate through
 * fetch-model.mjs — which does the licence check, optimisation and credit.
 * If the top candidate fails (withdrawn, not downloadable after all), the
 * next one is tried.
 *
 * Cars with measured profiles go first, since those are the ones people
 * build, and their models must pass the proportions check. Models are
 * optimised into public/models, and committed with the site, until the size
 * budget; past it, mirrored models are linked (--link) rather than copied, so
 * the rest of the catalogue costs the repository nothing. --no-link stops at
 * the budget instead.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rejects, uidOf } from "./lib/model-match.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = join(ROOT, "src", "data", "vehicles", "model-candidates.json");
const MANIFEST = join(ROOT, "src", "data", "vehicles", "model-assets.json");
const REJECTS = join(ROOT, "src", "data", "vehicles", "model-rejects.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MATCHES = join(ROOT, "src", "data", "vehicles", "profile-matches.ts");
const MODELS_DIR = join(ROOT, "public", "models");

const USABLE = new Set(["cc0", "by", "by-sa"]);
const LINK_MAX_BYTES = 40e6;
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
const token = Boolean(process.env.SKETCHFAB_TOKEN);
if (!token) console.log("No SKETCHFAB_TOKEN: fetching only models mirrored in Objaverse.");
const allowNc = opts["allow-noncommercial"] === true;
const budget = Number(opts["budget-mb"] ?? 250);
const limit = opts.limit ? Number(opts.limit) : Infinity;

const candidates = JSON.parse(readFileSync(CANDIDATES, "utf8"));
const profiled = new Set(
  [...readFileSync(MATCHES, "utf8").matchAll(/makeSlug: "([^"]+)", modelSlug: "([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`),
);

const queue = Object.keys(candidates)
  .filter((k) => !opts.only || k.startsWith(`${opts.only}/`))
  .sort((a, b) => Number(profiled.has(b)) - Number(profiled.has(a)) || a.localeCompare(b));

// Models no longer among a line's candidates (the matching rules have
// tightened since), turned down on review, or (with --recheck) withdrawn from
// Sketchfab are removed, file and all.
const turnedDown = rejects();

/** Has the model been taken down from Sketchfab (or made private)? */
async function withdrawn(uid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}`, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429) {
        await sleep(15000 * (attempt + 1));
        continue;
      }
      await sleep(400);
      return [401, 403, 404].includes(res.status);
    } catch {
      await sleep(3000);
    }
  }
  return false; // unknown: keep it rather than guess
}
{
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  let pruned = 0;
  let checked = 0;
  for (const [key, e] of Object.entries(manifest)) {
    if (e.own || !candidates[key]) continue;
    if (opts.recheck && ++checked % 50 === 0) console.log(`  rechecked ${checked}`);
    const uid = uidOf(e.sourceUrl);
    const gone = opts.recheck && (await withdrawn(uid));
    if (!gone && !turnedDown[key]?.[uid] && candidates[key].some((c) => c.uid === uid)) continue;
    delete manifest[key];
    pruned++;
    const stillUsed = Object.values(manifest).some((o) => o.file === e.file);
    if (!e.remote && !stillUsed) rmSync(join(ROOT, "public", e.file), { force: true });
  }
  if (pruned) {
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Removed ${pruned} model(s) that no longer match their car.`);
  }
}

let fetched = 0;
for (const key of queue) {
  if (fetched >= limit) break;
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  if (manifest[key]) continue;
  // Measured cars are always copied: their models have to pass the proportions check.
  const overBudget = folderMb(MODELS_DIR) > budget && !profiled.has(key);
  if (overBudget && opts["no-link"]) {
    console.log(`\nStopping: models folder is over the ${budget}MB budget.`);
    break;
  }

  const options = candidates[key]
    .filter((c) => USABLE.has(c.license) || (allowNc && NONCOMMERCIAL.has(c.license)))
    .filter((c) => c.path || (token && !overBudget))
    // A linked model is downloaded unoptimised by every visitor.
    .filter((c) => !overBudget || (c.bytes ?? Infinity) <= LINK_MAX_BYTES);
  // The same model already installed for another line (an RS 3 model serving the S3 too).
  const shared = Object.values(manifest).find((e) => options.some((c) => uidOf(e.sourceUrl) === c.uid));
  if (shared) {
    manifest[key] = shared;
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\n→ ${key}: shares ${shared.name}`);
    fetched++;
    continue;
  }
  for (const c of options) {
    console.log(`\n→ ${key}: ${c.name} by ${c.author} (${c.license})`);
    try {
      const flags = [
        ...(c.path ? ["--objaverse", c.uid] : ["--sketchfab", c.uid]), "--for", key,
        ...(overBudget ? ["--link"] : []),
        ...(NONCOMMERCIAL.has(c.license) ? ["--allow-noncommercial"] : []),
        // Measured cars must match their published proportions; a candidate
        // that does not is skipped for the next one.
        ...(profiled.has(key) ? ["--strict"] : []),
      ];
      execFileSync(process.execPath, [join(ROOT, "scripts", "fetch-model.mjs"), ...flags], { stdio: "inherit" });
      fetched++;
      break;
    } catch (e) {
      if (e.status === 3) {
        // Taken down: record it with the reviewed rejects so no later run asks again.
        const all = JSON.parse(readFileSync(REJECTS, "utf8"));
        (all[key] ??= {})[c.uid] = { name: c.name, reason: "no longer published on Sketchfab" };
        writeFileSync(REJECTS, `${JSON.stringify(all, null, 1)}\n`);
      }
      console.log("  failed; trying the next candidate");
    }
  }
}
console.log(`\nFetched ${fetched} model(s). Models folder: ${folderMb(MODELS_DIR).toFixed(0)}MB.`);
