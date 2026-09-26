#!/usr/bin/env node
/**
 * Packages Carbon Garage as a claude.ai artifact: the same page, styles and
 * modules as public/garage, with a subset of cars small enough for an
 * artifact version (64 MB).
 *
 *   node scripts/build-garage-artifact.mjs <out-dir>
 *
 * Artifacts serve only web file types, so each .glb is written as glTF JSON
 * with its buffers and images embedded as data URIs; the page reads models
 * from "models/<name>.json" instead of "../models/<name>.glb" via its
 * carbon-models meta tag. The page itself is written without html/head/body
 * tags, which the artifact host adds.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "public/garage");
const out = process.argv[2];
if (!out) {
  console.error("usage: build-garage-artifact.mjs <out-dir>");
  process.exit(1);
}

/** The cars that ship in the artifact, most wanted first; the budget decides where the list stops. */
const WANTED = [
  "porsche/911-gt3-rs", "chevrolet/corvette", "bmw/m4", "ford/mustang", "dodge/challenger", "aston-martin/db11",
  "porsche/718-cayman", "bmw/i8", "audi/rs-5", "chevrolet/camaro", "bentley/continental", "dodge/charger",
  "acura/nsx", "toyota/supra", "ford/f-150", "fiat/500", "mclaren/mp4-12c", "alfa-romeo/4c",
];
const BUDGET = 60e6;
const FILE_LIMIT = 15e6;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "models"), { recursive: true });

// Page: the part between the markers, without the document tags.
const html = readFileSync(join(src, "index.html"), "utf8");
const page = html
  .slice(html.indexOf("<!-- carbon:page-start -->"), html.indexOf("<!-- carbon:page-end -->"))
  .replace("<!-- carbon:page-start -->", "")
  .replace(/<\/head>\s*<body>/, "")
  .replace('content="../models/|.glb"', 'content="models/|.json"')
  .trim();
writeFileSync(join(out, "index.html"), page + "\n");
cpSync(join(src, "styles.css"), join(out, "styles.css"));
cpSync(join(src, "src"), join(out, "src"), { recursive: true });

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

/**
 * The model as glTF JSON whose one buffer (geometry and images alike, as in a
 * .glb) is a data URI. The page repacks it into a .glb in memory, so nothing
 * is ever fetched from a data: URL.
 */
async function toEmbeddedJson(glbPath) {
  const glb = Buffer.from(await io.writeBinary(await io.read(glbPath)));
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binStart);
  const bin = glb.subarray(binStart + 8, binStart + 8 + binLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString("base64")}`;
  return JSON.stringify(json);
}

const catalog = JSON.parse(readFileSync(join(src, "data/vehicles.json"), "utf8"));
const byId = new Map(catalog.vehicles.map((v) => [v.id, v]));
let used = [page, readFileSync(join(src, "styles.css"))].reduce((n, s) => n + s.length, 0);
for (const f of readdirSync(join(out, "src"), { recursive: true })) {
  const p = join(out, "src", f);
  if (statSync(p).isFile()) used += statSync(p).size;
}
const shipped = [];
for (const id of WANTED) {
  const v = byId.get(id);
  if (!v) continue;
  const text = await toEmbeddedJson(join(root, "public/models", v.modelPath));
  if (text.length > FILE_LIMIT || used + text.length > BUDGET) {
    console.log(`skip ${id}: ${(text.length / 1e6).toFixed(1)} MB would exceed the budget`);
    continue;
  }
  writeFileSync(join(out, "models", v.modelPath.replace(/\.glb$/, ".json")), text);
  used += text.length;
  shipped.push({ ...v, bytes: text.length });
  console.log(`${id.padEnd(28)} ${(text.length / 1e6).toFixed(1)} MB`);
}
mkdirSync(join(out, "data"), { recursive: true });
writeFileSync(join(out, "data/vehicles.json"), JSON.stringify({ generated: catalog.generated, vehicles: shipped }) + "\n");
console.log(`${shipped.length} cars, ${(used / 1e6).toFixed(1)} MB in ${out}`);
