/**
 * Objaverse: a public mirror, on Hugging Face, of about 800,000 downloadable
 * Sketchfab models, each with the licence its author released it under.
 *
 * It lets the site use Sketchfab's free car models without a Sketchfab
 * account: the files are fetched from the mirror, and the model's Sketchfab
 * page stays the credited source. A Creative Commons licence cannot be
 * withdrawn once granted, so a model mirrored under CC BY is still CC BY.
 *
 * The index (160 metadata shards, ~550MB) is downloaded once into
 * .cache/objaverse and reduced to the vehicles in it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CACHE = join(ROOT, ".cache", "objaverse");
const BASE = "https://huggingface.co/datasets/allenai/objaverse/resolve/main";
const SHARDS = 160;

export const fileUrl = (path) => `${BASE}/${path}`;

function fetchTo(url, dest) {
  // curl rather than fetch: it retries, and resumes nothing half-written.
  execFileSync("curl", ["-sfL", "--retry", "4", "-m", "600", "-o", `${dest}.part`, url]);
  execFileSync("mv", [`${dest}.part`, dest]);
}

/** Python-repr strings in the metadata ("[{'name': 'cars-vehicles'}]") → names. */
const names = (v) => (Array.isArray(v) ? v.map((x) => x.name ?? x) : [...String(v ?? "").matchAll(/'name': '([^']*)'/g)].map((m) => m[1]));
const field = (v, key) => (typeof v === "object" && v ? v[key] : String(v ?? "").match(new RegExp(`'${key}': '([^']*)'`))?.[1]) ?? null;
const glbSize = (v) => (typeof v === "object" && v ? v.glb?.size : Number(String(v ?? "").match(/'glb': \{[^}]*'size': (\d+)/)?.[1])) || null;

/**
 * Every vehicle in Objaverse, keyed by uid, with what matching and crediting need.
 * Built on first use and cached.
 */
export function vehicles({ log = console.log } = {}) {
  const out = join(CACHE, "vehicles.json");
  if (existsSync(out)) return JSON.parse(readFileSync(out, "utf8"));
  mkdirSync(join(CACHE, "metadata"), { recursive: true });

  const pathsFile = join(CACHE, "object-paths.json.gz");
  if (!existsSync(pathsFile)) fetchTo(`${BASE}/object-paths.json.gz`, pathsFile);
  const paths = JSON.parse(gunzipSync(readFileSync(pathsFile)).toString());

  const result = {};
  for (let i = 0; i < SHARDS; i++) {
    const shard = `000-${String(i).padStart(3, "0")}`;
    const file = join(CACHE, "metadata", `${shard}.json.gz`);
    if (!existsSync(file)) {
      log(`  index ${i + 1}/${SHARDS}`);
      fetchTo(`${BASE}/metadata/${shard}.json.gz`, file);
    }
    const meta = JSON.parse(gunzipSync(readFileSync(file)).toString());
    for (const [uid, m] of Object.entries(meta)) {
      if (!names(m.categories).includes("cars-vehicles") || !paths[uid]) continue;
      result[uid] = {
        uid,
        name: m.name,
        license: m.license,
        faceCount: m.faceCount,
        likeCount: m.likeCount,
        author: field(m.user, "displayName") ?? field(m.user, "username"),
        authorUrl: field(m.user, "profileUrl"),
        url: m.viewerUrl,
        path: paths[uid],
        bytes: glbSize(m.archives),
      };
    }
  }
  writeFileSync(out, JSON.stringify(result));
  log(`  ${Object.keys(result).length} vehicles in the index`);
  return result;
}
