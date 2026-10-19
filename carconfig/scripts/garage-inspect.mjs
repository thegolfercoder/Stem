#!/usr/bin/env node
/**
 * Runs the Carbon Garage's own model preparation (normalise, find wheels,
 * detect parts) on every garage model in Node, without a browser, and reports
 * what each model supports and why options are missing. A full pass over all
 * cars takes about a minute, against an hour for the browser audit, so this is
 * the tool for working on detection rules.
 *
 *   node scripts/garage-inspect.mjs                 summary table and totals
 *   node scripts/garage-inspect.mjs bmw/m4 --why    one car, with its materials
 *   node scripts/garage-inspect.mjs --json out.json machine-readable results
 *
 * Textures are not decoded (the detection rules only need to know a texture
 * exists), so materials, geometry and names are exactly what the browser sees.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Enough of a browser for GLTFLoader: images become empty textures.
globalThis.self ??= globalThis;
THREE.TextureLoader.prototype.load = function (url, onLoad) {
  const t = new THREE.Texture();
  t.image = { width: 1, height: 1 };
  queueMicrotask(() => onLoad?.(t));
  return t;
};
const realWarn = console.warn;
console.warn = (...a) => (/THREE\.|GLTFLoader/.test(String(a[0])) ? undefined : realWarn(...a));

const { Vehicle } = await import("../public/garage/src/cars/vehicle.js");
const { materialStats } = await import("../public/garage/src/cars/detector.js");
const { paintNameSays, kindOf } = await import("../public/garage/src/cars/names.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "public/garage/data/vehicles.json"), "utf8")).vehicles;
const args = process.argv.slice(2);
const why = args.includes("--why");
const mats = args.includes("--mats");
const wheelsMode = args.includes("--wheels");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const only = args.filter((a) => a.includes("/") && !a.endsWith(".json"));
const entries = only.length ? catalog.filter((v) => only.includes(v.id)) : catalog;

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function prepare(entry) {
  const bytes = readFileSync(join(root, "public/models", entry.modelPath));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return new Vehicle(gltf, entry);
}

const KEYS = ["paint", "wheels", "rims", "calipers", "glass", "lights", "trim", "carbon", "mirrors", "spoiler", "exhaust"];
const results = [];
for (const entry of entries) {
  const started = Date.now();
  try {
    const v = await prepare(entry);
    const r = {
      id: entry.id,
      caps: v.caps,
      paintHow: v.parts.paintHow,
      paintNote: v.parts.paintNote,
      openings: v.parts.openings,
      size: v.size.toArray().map((n) => +n.toFixed(2)),
      triangles: v.info.triangles,
      lengthSource: v.info.lengthSource,
      floors: v.info.floorsRemoved,
      ms: Date.now() - started,
    };
    results.push(r);
    const flags = KEYS.map((k) => (v.caps[k] ? k[0].toUpperCase() : "·")).join("");
    const [w, , l] = r.size;
    console.log(`${entry.id.padEnd(30)} ${flags} paint:${r.paintHow.padEnd(7)} ${String(r.triangles).padStart(8)} tris  w/l ${(w / l).toFixed(2)}  ${r.ms}ms`);
    if (why) explain(v);
    if (mats) listMaterials(v);
    if (wheelsMode) listWheelParts(v);
    if (args.includes("--groups")) listWheelGroups(v);
  } catch (err) {
    results.push({ id: entry.id, error: String(err?.message ?? err) });
    console.log(`${entry.id.padEnd(30)} ERROR ${err?.stack ?? err}`);
  }
}

/** Every material in one line each: what it is called and how it is set up. */
function listMaterials(v) {
  const { materials, stats } = materialStats(v.object);
  const total = stats.reduce((s, m) => s + m.area, 0) || 1;
  const line = stats
    .map((s, i) => ({ s, m: materials[i] }))
    .sort((a, b) => b.s.area - a.s.area)
    .map(({ s, m }) => {
      const o = m.transparent ? ` op${m.opacity.toFixed(2)}` : "";
      const t = m.transmission ? ` tr${m.transmission.toFixed(2)}` : "";
      return `${m.name}(${(100 * s.area / total).toFixed(1)}% h${s.height.toFixed(2)} #${m.color?.getHexString() ?? "-"} m${(m.metalness ?? 0).toFixed(1)} r${(m.roughness ?? 0).toFixed(1)}${o}${t}${m.map ? " map" : ""})`;
    });
  console.log("   " + line.join("  "));
}

/** Meshes low enough and round enough to be wheels, and what they are called. */
function listWheelParts(v) {
  const whole = new THREE.Box3().setFromObject(v.object);
  const H = whole.max.y - whole.min.y;
  const rows = [];
  v.object.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    if (c.y > H * 0.45 || s.y < 0.2) return;
    rows.push(`    ${o.name.slice(0, 26).padEnd(26)} ${String(o.parent?.name).slice(0, 26).padEnd(26)} size ${s.toArray().map((n) => n.toFixed(2)).join(" ")} at ${c.toArray().map((n) => n.toFixed(2)).join(" ")} min.y ${b.min.y.toFixed(2)} [${[].concat(o.material).map((m) => m.name).join("|").slice(0, 40)}]`);
  });
  console.log(`  H ${H.toFixed(2)} W ${(whole.max.x - whole.min.x).toFixed(2)}; low meshes:`);
  console.log(rows.slice(0, 30).join("\n"));
}

/** The wheels as found: each corner's box and the meshes in it. */
function listWheelGroups(v) {
  for (const w of v.wheelInfo ?? []) {
    const s = w.box.getSize(new THREE.Vector3()), c = w.box.getCenter(new THREE.Vector3());
    const tris = w.meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
    console.log(`  ${w.corner} size ${s.toArray().map((n) => n.toFixed(2)).join(" ")} at ${c.toArray().map((n) => n.toFixed(2)).join(" ")} ${w.meshes.length} meshes ${tris} tris: ${w.meshes.map((m) => m.name).slice(0, 6).join(", ")}`);
  }
}

function explain(v) {
  const { stats } = materialStats(v.object);
  const total = stats.reduce((s, m) => s + m.area, 0) || 1;
  const rows = [...stats].sort((a, b) => b.area - a.area).slice(0, 40);
  console.log("  share  height span  opac map rgb              kind     says   name");
  for (const m of rows) {
    const rgb = m.rgb.map((x) => x.toFixed(2)).join(",");
    console.log(
      `  ${(100 * m.area / total).toFixed(1).padStart(5)}% ${m.height.toFixed(2)}   ${m.span.toFixed(2)} ${m.opacity.toFixed(2)} ${m.hasMap ? "map" : "   "} ${rgb.padEnd(16)} ${String(kindOf(m.name)).padEnd(8)} ${String(paintNameSays(m.name)).padEnd(6)} ${m.name}`,
    );
  }
  const meshes = [];
  v.object.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    meshes.push({ name: o.name, parent: o.parent?.name, mats: [].concat(o.material).map((m) => m.name).join("|"), s, c, tris: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 });
  });
  console.log(`  ${meshes.length} meshes; largest 25 by size:`);
  for (const m of meshes.sort((a, b) => b.s.length() - a.s.length()).slice(0, 25)) {
    console.log(`    ${m.name.slice(0, 28).padEnd(28)} ${String(m.parent).slice(0, 20).padEnd(20)} size ${m.s.toArray().map((n) => n.toFixed(2)).join(" ")} at ${m.c.toArray().map((n) => n.toFixed(2)).join(" ")} ${m.tris} tris  [${m.mats.slice(0, 50)}]`);
  }
}

if (!only.length || entries.length > 1) {
  const ok = results.filter((r) => r.caps);
  console.log(`\n${ok.length}/${results.length} prepared`);
  for (const k of KEYS) console.log(`  ${k.padEnd(9)} ${ok.filter((r) => r.caps[k]).length}/${ok.length}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
