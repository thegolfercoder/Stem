#!/usr/bin/env node
/**
 * Does a 3D model have the real car's proportions?
 *
 *   node scripts/check-model.mjs <file.glb> --for <make/model>
 *   node scripts/check-model.mjs <file.glb> --dims 4794,1903,1433,2857
 *
 * The viewer scales every model to the car's published length, so what has
 * to be right is everything relative to that: wheelbase, height and width.
 * A model that is a different generation, a stretched fan render, or simply
 * inaccurate shows up here as a ratio that does not match.
 *
 * The wheelbase is measured from the model's own wheels (parts named like
 * wheels, grouped by corner). Width is allowed to run over, since a model's
 * bounding box includes its mirrors and a published width does not.
 *
 * Exits non-zero when any check fails, so it can gate a model's acceptance.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Tolerances on ratios to length. Wheelbase is the one that gives a wrong car away. */
const TOLERANCE = { wheelbase: 0.02, height: 0.04, widthUnder: 0.03, widthOver: 0.16 };

const WHEEL_RE = /\b(wheel|rim|tyre|tire|brake|caliper|disc|rotor|hub|spoke)/i;
const words = (s) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_.\-:]+/g, " ");

function args() {
  const a = process.argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) out[a[i].slice(2)] = a[++i];
    else out._.push(a[i]);
  }
  return out;
}

/** Published [length, width, height, wheelbase] in mm, from the measured profiles. */
function publishedDims(key) {
  const [make, model] = key.split("/");
  const matches = readFileSync(join(ROOT, "src/data/vehicles/profile-matches.ts"), "utf8");
  const re = new RegExp(`"([a-z0-9-]+)": \\{\\s*makeSlug: "${make}", modelSlug: "${model}"`);
  const slug = matches.match(re)?.[1];
  if (!slug) return null;
  const vehicles = readFileSync(join(ROOT, "src/data/vehicles/index.ts"), "utf8");
  const at = vehicles.indexOf(`slug: "${slug}"`);
  const dims = vehicles.slice(at).match(/dims: \[(\d+), (\d+), (\d+), (\d+)\]/);
  return dims ? dims.slice(1, 5).map(Number) : null;
}

async function main() {
  const opts = args();
  const file = opts._[0];
  if (!file) throw new Error("usage: check-model.mjs <file.glb> (--for make/model | --dims L,W,H,WB)");
  const pub = opts.dims ? opts.dims.split(",").map(Number) : opts.for ? publishedDims(opts.for) : null;
  if (!pub || pub.length !== 4) throw new Error("No published dimensions: give --for a measured car, or --dims.");
  const [L, W, H, WB] = pub;

  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  // Many uploads stand the car on a floor or shadow plane; it is not the car.
  const whole = getBounds(scene);
  const span = Math.max(...[0, 1, 2].map((i) => whole.max[i] - whole.min[i]));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const b = getBounds(node);
    const ext = [0, 1, 2].map((i) => b.max[i] - b.min[i]).sort((a, c) => a - c);
    if (ext[0] < ext[2] * 0.01 && ext[2] > span * 0.5) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

  // Length runs along whichever horizontal axis is longer; y is up in glTF.
  const lengthAxis = size[0] > size[2] ? 0 : 2;
  const widthAxis = lengthAxis === 0 ? 2 : 0;
  const mL = size[lengthAxis];
  const mW = size[widthAxis];
  const mH = size[1];
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  // Wheel centres by corner.
  const corners = new Map();
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const label = words(`${node.getName()} ${node.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() ?? "").join(" ")}`);
    if (!WHEEL_RE.test(label) || /steering|spare|light|lamp/i.test(label)) continue;
    const b = getBounds(node);
    const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
    if (c[1] - min[1] > mH * 0.45) continue; // wheels sit low
    const along = c[lengthAxis] - centre[lengthAxis];
    const across = c[widthAxis] - centre[widthAxis];
    if (Math.abs(across) < mW * 0.1) continue;
    const key = `${along > 0 ? "a" : "b"}${across > 0 ? "r" : "l"}`;
    const list = corners.get(key) ?? [];
    list.push(c[lengthAxis]);
    corners.set(key, list);
  }
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  let mWB = null;
  if (["ar", "al", "br", "bl"].every((k) => corners.has(k))) {
    const a = mean([...corners.get("ar"), ...corners.get("al")]);
    const b = mean([...corners.get("br"), ...corners.get("bl")]);
    mWB = Math.abs(a - b);
  }

  const rows = [];
  const check = (name, model, published, lo, hi) => {
    const dev = model / published - 1;
    const ok = dev >= -lo && dev <= hi;
    rows.push({ name, ok, text: `${name.padEnd(10)} model ${(model * 100).toFixed(1)}%  real ${(published * 100).toFixed(1)}%  (${dev >= 0 ? "+" : ""}${(dev * 100).toFixed(1)}%)` });
  };
  // Everything as a share of length, since length is what the viewer scales to.
  check("height", mH / mL, H / L, TOLERANCE.height, TOLERANCE.height);
  check("width", mW / mL, W / L, TOLERANCE.widthUnder, TOLERANCE.widthOver);
  if (mWB !== null) check("wheelbase", mWB / mL, WB / L, TOLERANCE.wheelbase, TOLERANCE.wheelbase);

  console.log(`\n${file}`);
  console.log(`  proportions as a share of length (${L}mm published)\n`);
  for (const r of rows) console.log(`  ${r.ok ? "✔" : "✖"} ${r.text}`);
  if (mWB === null) console.log("  ? wheelbase  could not find four named wheels to measure from");
  const failed = rows.filter((r) => !r.ok);
  console.log(failed.length ? `\n✖ Proportions do not match the real car.\n` : `\n✔ Proportions match the real car.\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(2);
});
