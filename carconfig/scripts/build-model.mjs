#!/usr/bin/env node
/**
 * Build one of our own car models with Blender and install it in the site.
 *
 *   BLENDER_PYTHON=/path/to/python node scripts/build-model.mjs porsche/911-gt3-rs
 *
 * Runs tools/blender/<script>.py (a Python with the `bpy` module: `pip install
 * bpy`, or Blender's own), optimises the result the same way downloaded
 * models are, and checks it against the car's published proportions before it
 * replaces the one in public/models. A model that fails the check is not
 * installed.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src", "data", "vehicles", "model-assets.json");
const GLTF_TRANSFORM = join(ROOT, "node_modules", ".bin", "gltf-transform");
const REPO = "https://github.com/thegolfercoder/Stem/blob/main/carconfig";

/** Model line → build script and the name it is credited under. */
const MODELS = {
  "porsche/911-gt3-rs": { script: "tools/blender/gt3rs.py", name: "Porsche 911 GT3 RS (992)" },
};

const key = process.argv[2];
const spec = MODELS[key];
if (!spec) {
  console.error(`usage: build-model.mjs <${Object.keys(MODELS).join(" | ")}>`);
  process.exit(2);
}
const python = process.env.BLENDER_PYTHON ?? "python3";
const work = mkdtempSync(join(tmpdir(), "build-model-"));
try {
  const raw = join(work, "raw.glb");
  const built = join(work, "built.glb");
  execFileSync(python, [join(ROOT, spec.script), raw], { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync(
    GLTF_TRANSFORM,
    ["optimize", raw, built, "--compress", "meshopt", "--texture-compress", "webp", "--simplify", "false",
      // Parts stay separate and named, as for downloaded models.
      "--join", "false", "--palette", "false", "--flatten", "false", "--instance", "false"],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, [join(ROOT, "scripts", "check-model.mjs"), built, "--for", key], { stdio: "inherit" });

  const file = `${key.replace("/", "__")}.glb`;
  const out = join(ROOT, "public", "models", file);
  writeFileSync(out, readFileSync(built));
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  manifest[key] = {
    file: `/models/${file}`,
    name: spec.name,
    author: "Stem",
    authorUrl: null,
    own: true,
    licenseLabel: "built for this site",
    licenseUrl: `${REPO}/${spec.script}`,
    sourceUrl: `${REPO}/${spec.script}`,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n✔ ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
