#!/usr/bin/env node
/**
 * Fetch a 3D car model, make it web-sized, and record who made it.
 *
 *   SKETCHFAB_TOKEN=… node scripts/fetch-model.mjs --sketchfab <uid> --for <make/model>
 *   node scripts/fetch-model.mjs --objaverse <uid> --for <make/model> [--link]
 *   node scripts/fetch-model.mjs --url <glb-url> --for <make/model> \
 *        --name "…" --author "…" --author-url "…" --license by --source-url "…"
 *
 * Output:
 *   public/models/<make>__<model>.glb             the optimised model
 *   src/data/vehicles/model-assets.json           name, author, licence, source
 *
 * Licences are checked before anything is downloaded. The site republishes
 * the file (the browser downloads it), so only licences that allow that are
 * accepted: CC0, CC BY and CC BY-SA. Non-commercial licences need
 * --allow-noncommercial, because they stop working the day the site charges
 * for anything. No-derivatives licences are refused — shrinking a model for
 * the web changes it — and so are Sketchfab's store licences.
 *
 * --objaverse fetches a Sketchfab model from the Objaverse mirror on Hugging
 * Face (see scripts/lib/objaverse.mjs), so no token is needed; the credit
 * still points at the model's Sketchfab page. With --link nothing is
 * downloaded: the viewer loads the file from the mirror itself (Hugging Face
 * serves it to any site), unoptimised but costing the repository nothing.
 *
 * Optimisation: duplicate data merged, unused data dropped, textures capped
 * at 2048px and re-encoded as WebP, geometry meshopt-compressed. Models over
 * half a million triangles are simplified toward that, keeping their shape
 * within half a millimetre. Meshes and
 * materials are deliberately not merged, so their names survive. A 60MB
 * download typically comes out at 5–15MB.
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { fileUrl, vehicles } from "./lib/objaverse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "models");
const MANIFEST = join(ROOT, "src", "data", "vehicles", "model-assets.json");
const GLTF_TRANSFORM = join(ROOT, "node_modules", ".bin", "gltf-transform");

/** Above this, a model is simplified: more is invisible at viewer sizes and slow on a phone. */
const MAX_FACES = 500_000;
/** Exit status for a model taken down from Sketchfab, so a batch can stop asking for it. */
const WITHDRAWN = 3;
const ALLOWED = new Set(["cc0", "by", "by-sa"]);
const NONCOMMERCIAL = new Set(["by-nc", "by-nc-sa"]);
const LICENSE_URLS = {
  cc0: "https://creativecommons.org/publicdomain/zero/1.0/",
  by: "https://creativecommons.org/licenses/by/4.0/",
  "by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
  "by-nc": "https://creativecommons.org/licenses/by-nc/4.0/",
  "by-nc-sa": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};
const LICENSE_LABELS = {
  cc0: "CC0",
  by: "CC BY 4.0",
  "by-sa": "CC BY-SA 4.0",
  "by-nc": "CC BY-NC 4.0",
  "by-nc-sa": "CC BY-NC-SA 4.0",
};

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const key = a[i].slice(2);
    const next = a[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function checkLicense(slug, allowNc) {
  if (ALLOWED.has(slug)) return;
  if (NONCOMMERCIAL.has(slug)) {
    if (allowNc) return;
    fail(
      `Licence is ${slug} (non-commercial). Fine for a site shared among friends, ` +
        `but it forbids ever charging for anything. Re-run with --allow-noncommercial to accept that.`,
    );
  }
  fail(`Licence "${slug}" does not allow republishing a modified copy on a website. Pick another model.`);
}

async function download(url, dest, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) fail(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/** Largest file with the extension, anywhere under dir. */
function findLargest(dir, ext) {
  let best = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith(ext) && (!best || st.size > best.size)) best = { path: p, size: st.size };
    }
  };
  walk(dir);
  return best?.path ?? null;
}

async function fromSketchfab(uid, allowNc, work) {
  const token = process.env.SKETCHFAB_TOKEN;
  if (!token) fail("Set SKETCHFAB_TOKEN (sketchfab.com → Settings → Password & API → API token).");
  if (!/^[0-9a-f]{32}$/.test(uid)) fail(`"${uid}" is not a Sketchfab model id (32 hex characters).`);

  const metaRes = await fetch(`https://api.sketchfab.com/v3/models/${uid}`);
  if (!metaRes.ok) fail(`Model ${uid} not found (${metaRes.status}).`);
  const meta = await metaRes.json();
  const slug = meta.license?.slug;
  checkLicense(slug, allowNc);
  if (!meta.isDownloadable) fail("The author has not made this model downloadable.");

  const dlRes = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (dlRes.status === 401) fail("Sketchfab rejected the token.");
  if (!dlRes.ok) fail(`Sketchfab download request failed (${dlRes.status}).`);
  const links = await dlRes.json();

  let source;
  if (links.glb?.url) {
    source = join(work, "model.glb");
    await download(links.glb.url, source);
  } else if (links.gltf?.url) {
    const zip = join(work, "model.zip");
    await download(links.gltf.url, zip);
    execFileSync("unzip", ["-q", "-o", zip, "-d", join(work, "gltf")]);
    source = findLargest(join(work, "gltf"), ".gltf");
    if (!source) fail("The download had no .gltf file in it.");
  } else {
    fail("Sketchfab offered no glTF or GLB download for this model.");
  }

  return {
    source,
    credit: {
      name: meta.name,
      author: meta.user?.displayName ?? meta.user?.username,
      authorUrl: meta.user?.profileUrl,
      license: slug,
      sourceUrl: meta.viewerUrl,
    },
  };
}

/**
 * The model as Sketchfab has it now. A model its author or Sketchfab has
 * since taken down is not used: a takedown is often a copyright claim, and
 * then the licence was never the uploader's to give. The licence checked is
 * the one on the page today, not the one the mirror recorded.
 */
async function liveOnSketchfab(uid) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}`, { signal: AbortSignal.timeout(30000) });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
      continue;
    }
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      console.error(`\n✖ Model ${uid} is no longer published on Sketchfab; not used.\n`);
      process.exit(WITHDRAWN);
    }
    if (!res.ok) fail(`Could not check model ${uid} on Sketchfab (${res.status}).`);
    return res.json();
  }
  fail("Sketchfab is rate limiting; try again later.");
}

async function fromObjaverse(uid, allowNc, work) {
  const v = vehicles()[uid];
  if (!v) fail(`${uid} is not a vehicle in the Objaverse index.`);
  const live = await liveOnSketchfab(uid);
  v.license = live.license?.slug ?? v.license;
  checkLicense(v.license, allowNc);
  const source = join(work, "model.glb");
  await download(fileUrl(v.path), source);
  return {
    source,
    faces: v.faceCount,
    credit: {
      name: v.name,
      author: v.author,
      authorUrl: v.authorUrl,
      license: v.license,
      sourceUrl: v.url,
    },
  };
}

async function fromUrl(opts, allowNc, work) {
  for (const k of ["name", "author", "license", "source-url"]) {
    if (!opts[k]) fail(`--url needs --${k} as well, so the model can be credited.`);
  }
  checkLicense(opts.license, allowNc);
  const source = join(work, "model.glb");
  await download(opts.url, source);
  return {
    source,
    credit: {
      name: opts.name,
      author: opts.author,
      authorUrl: opts["author-url"] ?? null,
      license: opts.license,
      sourceUrl: opts["source-url"],
    },
  };
}

async function main() {
  const opts = args();
  const target = opts.for;
  if (!target || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(target)) fail("--for <make/model> is required, e.g. porsche/911-gt3-rs");
  if (!existsSync(GLTF_TRANSFORM)) fail("Run npm install first (needs @gltf-transform/cli).");

  if (opts.link) {
    if (!opts.objaverse) fail("--link works with --objaverse only.");
    const v = vehicles()[opts.objaverse];
    if (!v) fail(`${opts.objaverse} is not a vehicle in the Objaverse index.`);
    const live = await liveOnSketchfab(opts.objaverse);
    v.license = live.license?.slug ?? v.license;
    checkLicense(v.license, opts["allow-noncommercial"] === true);
    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
    manifest[target] = {
      file: fileUrl(v.path),
      bytes: v.bytes,
      remote: true,
      name: v.name,
      author: v.author,
      authorUrl: v.authorUrl,
      license: v.license,
      sourceUrl: v.url,
      licenseLabel: LICENSE_LABELS[v.license],
      licenseUrl: LICENSE_URLS[v.license],
      fetchedOn: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`✔ ${target} → ${v.name} by ${v.author} (${LICENSE_LABELS[v.license]}), loaded from the mirror.`);
    return;
  }

  const work = join(tmpdir(), `fetch-model-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    const allowNc = opts["allow-noncommercial"] === true;
    const { source, credit, faces } = opts.sketchfab
      ? await fromSketchfab(opts.sketchfab, allowNc, work)
      : opts.objaverse
        ? await fromObjaverse(opts.objaverse, allowNc, work)
        : opts.url
          ? await fromUrl(opts, allowNc, work)
          : fail("Pass --sketchfab <uid>, --objaverse <uid> or --url <glb-url>.");

    mkdirSync(OUT_DIR, { recursive: true });
    const fileName = `${target.replace("/", "__")}.glb`;
    const out = join(OUT_DIR, fileName);
    console.log(`Optimising ${credit.name}…`);
    // Older exports describe materials as specular/glossiness, which three.js
    // no longer reads: every surface would come out bare white metal.
    const converted = join(work, "metalrough.glb");
    execFileSync(GLTF_TRANSFORM, ["metalrough", source, converted], { stdio: "inherit" });
    execFileSync(
      GLTF_TRANSFORM,
      [
        "optimize", converted, out,
        "--compress", "meshopt",
        "--texture-compress", "webp",
        "--texture-size", "2048",
        ...(faces > MAX_FACES
          ? ["--simplify", "true", "--simplify-ratio", String(MAX_FACES / faces), "--simplify-error", "0.0005"]
          : ["--simplify", "false"]),
        // Keep parts separate and named: the viewer finds the paint and the
        // four wheels by name and position, and merging would lose both.
        "--join", "false",
        "--palette", "false",
        "--flatten", "false",
        "--instance", "false",
      ],
      { stdio: "inherit" },
    );

    // The accuracy gate: a model that is not the real car's proportions is
    // not used, however good it looks. Only possible where the car has
    // published dimensions; --strict makes a failure final.
    try {
      execFileSync(process.execPath, [join(ROOT, "scripts", "check-model.mjs"), out, "--for", target], { stdio: "inherit" });
    } catch (e) {
      if (e.status === 1 && opts.strict) {
        rmSync(out, { force: true });
        fail(`${credit.name} does not match the real car's proportions; not used.`);
      }
      // Status 2: no published dimensions to check against. Nothing to gate on.
    }

    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
    manifest[target] = {
      file: `/models/${fileName}`,
      bytes: statSync(out).size,
      ...credit,
      licenseLabel: LICENSE_LABELS[credit.license],
      licenseUrl: LICENSE_URLS[credit.license],
      fetchedOn: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\n✔ ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB), credited to ${credit.author} under ${LICENSE_LABELS[credit.license]}.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
