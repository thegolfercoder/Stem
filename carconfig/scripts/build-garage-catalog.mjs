#!/usr/bin/env node
/**
 * Writes public/garage/data/vehicles.json, the Carbon Garage's vehicle list.
 *
 *   npm run garage:catalog
 *
 * Facts about each car come from scripts/lib/garage-vehicles.mjs. Credits,
 * licences and file sizes come from src/data/vehicles/model-assets.json. What
 * each model supports (paint, wheels, glass, lamps...) comes from the last
 * browser audit, src/data/vehicles/garage-capabilities.json, written by
 * scripts/garage-audit.mjs; the viewer re-detects all of it when a model loads,
 * so the list is a preview and never the authority.
 */
import { readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { GARAGE_VEHICLES, DUPLICATE_OF, EXCLUDED } from "./lib/garage-vehicles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = JSON.parse(readFileSync(join(root, "src/data/vehicles/model-assets.json"), "utf8"));
const capsFile = join(root, "src/data/vehicles/garage-capabilities.json");
const capabilities = existsSync(capsFile) ? JSON.parse(readFileSync(capsFile, "utf8")) : {};

const problems = [];
const vehicles = GARAGE_VEHICLES.map((v) => {
  const a = assets[v.id];
  if (!a) return problems.push(`${v.id}: no entry in model-assets.json`), null;
  if (!a.file?.startsWith("/models/")) return problems.push(`${v.id}: model is not stored locally (${a.file})`), null;
  const path = join(root, "public", a.file);
  if (!existsSync(path)) return problems.push(`${v.id}: ${a.file} is missing`), null;
  return {
    ...v,
    modelPath: basename(a.file),
    bytes: statSync(path).size,
    capabilities: capabilities[v.id] ?? null,
    credit: {
      title: a.name,
      author: a.author ?? null,
      authorUrl: a.authorUrl ?? null,
      license: a.licenseLabel ?? null,
      licenseUrl: a.licenseUrl ?? null,
      source: a.sourceUrl ?? null,
      own: Boolean(a.own),
    },
  };
}).filter(Boolean);

const listed = new Set(GARAGE_VEHICLES.map((v) => v.id));
for (const [id, a] of Object.entries(assets)) {
  if (a.file?.startsWith("/models/") && !listed.has(id) && !DUPLICATE_OF[id] && !EXCLUDED[id]) problems.push(`${id}: local model not in the garage list`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const out = join(root, "public/garage/data/vehicles.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generated: "scripts/build-garage-catalog.mjs", vehicles }, null, 1) + "\n");
console.log(`wrote ${vehicles.length} vehicles to ${out.slice(root.length + 1)}`);
