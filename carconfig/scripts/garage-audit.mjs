#!/usr/bin/env node
/**
 * Loads every car in the Carbon Garage in headless Chromium and checks it:
 * it loads without errors, stands on the floor, is centred, faces a sensible
 * way, has a believable size, is framed by the camera, and takes a full build
 * (paint, tint, lights, ride height) and a reset without errors.
 *
 *   npx http-server public -p 3333 &   (or `npm run dev`)
 *   node scripts/garage-audit.mjs [--base http://localhost:3333] [--only id,id] [--shots dir]
 *
 * Writes src/data/vehicles/garage-capabilities.json (what each model
 * supports, shown in the garage before a car loads) and prints a report.
 * Needs Playwright and a Chromium; CDN files are fetched with curl and cached,
 * which also works behind proxies the browser cannot use.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg("base", "http://localhost:3333");
const only = arg("only", "")?.split(",").filter(Boolean);
const shots = arg("shots", null);
if (shots) mkdirSync(shots, { recursive: true });

const cdnCache = join(tmpdir(), "carbon-garage-cdn");
mkdirSync(cdnCache, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, async (route) => {
  const url = route.request().url();
  const file = join(cdnCache, createHash("sha1").update(url).digest("hex"));
  if (!existsSync(file)) {
    try {
      execFileSync("curl", ["-sSfL", "--retry", "4", "-A", "Mozilla/5.0 Chrome/120", "-o", file, url], { timeout: 60000 });
    } catch {
      return route.fulfill({ status: 502, body: "" });
    }
  }
  const type = url.includes("fonts.googleapis.com/css") ? "text/css" : url.endsWith(".js") ? "application/javascript" : "application/octet-stream";
  return route.fulfill({ status: 200, body: readFileSync(file), headers: { "content-type": type, "access-control-allow-origin": "*" } });
});

let errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${base}/garage/index.html?quality=low`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.carbonGarage, null, { timeout: 120000 });
const ids = only?.length ? only : await page.evaluate(() => window.carbonGarage.catalog.map((v) => v.id));

const settle = () =>
  page.waitForFunction(
    () => {
      const g = window.carbonGarage;
      const phase = g.store.get().load.phase;
      return (phase === "ready" || phase === "error") && !g.studio.rig.flight && !g.studio.running;
    },
    null,
    { timeout: 240000, polling: 250 },
  );

const results = [];
const capabilities = {};
for (const id of ids) {
  errors = [];
  const started = Date.now();
  await page.evaluate((v) => window.carbonGarage.select(v), id);
  await settle().catch(() => errors.push("timed out"));
  const r = await page.evaluate(() => {
    const g = window.carbonGarage;
    const s = g.store.get();
    if (s.load.phase !== "ready") return { phase: s.load.phase, message: s.load.message };
    const v = g.current();
    const THREE_box = v.box;
    const size = v.size;
    const cam = g.studio.camera;
    // How much of the frame the car fills in the default view.
    let fill = 0;
    for (let i = 0; i < 8; i++) {
      const p = THREE_box.min.clone();
      if (i & 1) p.x = THREE_box.max.x;
      if (i & 2) p.y = THREE_box.max.y;
      if (i & 4) p.z = THREE_box.max.z;
      p.project(cam);
      fill = Math.max(fill, Math.abs(p.x), Math.abs(p.y));
    }
    return {
      phase: "ready",
      caps: v.caps,
      info: v.info,
      size: [size.x, size.y, size.z].map((n) => +n.toFixed(3)),
      centre: [(THREE_box.min.x + THREE_box.max.x) / 2, (THREE_box.min.z + THREE_box.max.z) / 2].map((n) => +n.toFixed(3)),
      floor: +THREE_box.min.y.toFixed(3),
      fill: +fill.toFixed(2),
      lamps: { front: v.parts.lamps.filter((l) => !l.rear).length, rear: v.parts.lamps.filter((l) => l.rear).length },
    };
  });
  r.id = id;
  r.ms = Date.now() - started;
  if (r.phase === "ready") {
    if (shots) await page.locator("#viewer").screenshot({ path: join(shots, `${id.replace("/", "__")}.png`) });
    // A full build, then back to factory.
    await page.evaluate(() => {
      const g = window.carbonGarage;
      g.setBuild({ paint: { hex: "#1b3b74", finish: "metallic", name: "Gentian Blue" }, rims: "black", calipers: "red", trim: "gloss-black", carbon: "matte", mirrors: "gloss-black", spoiler: "gloss-black", exhaust: "titanium", tint: "dark", lights: "on", ride: "lowered" });
    });
    await settle().catch(() => errors.push("timed out after build"));
    if (shots) await page.locator("#viewer").screenshot({ path: join(shots, `${id.replace("/", "__")}-build.png`) });
    await page.evaluate(() => window.carbonGarage.setBuild({}));
    const c = r.caps;
    capabilities[id] = Object.fromEntries(Object.entries(c).filter(([k]) => k !== "rearLights"));
    const [w, h, l] = r.size;
    r.problems = [
      Math.abs(r.floor) > 0.02 && `floats or sinks (${r.floor} m)`,
      Math.hypot(...r.centre) > 0.05 && `off centre (${r.centre})`,
      (l < 2.6 || l > 7) && `length ${l} m`,
      (w / l < 0.3 || w / l > 0.55) && `width/length ${(w / l).toFixed(2)}`,
      (h / l < 0.2 || h / l > 0.6) && `height/length ${(h / l).toFixed(2)}`,
      (r.fill < 0.55 || r.fill > 0.9) && `fills ${r.fill} of the frame`,
    ].filter(Boolean);
  }
  r.errors = [...new Set(errors)];
  results.push(r);
  const flag = r.phase !== "ready" ? "FAIL" : r.problems.length || r.errors.length ? "WARN" : "ok";
  const caps = r.caps ? Object.entries(r.caps).filter(([, v]) => v).map(([k]) => k).join(" ") : r.message;
  console.log(`${flag.padEnd(4)} ${id.padEnd(30)} ${String(r.ms).padStart(6)}ms ${r.info ? `${r.info.lengthSource.padEnd(10)} paint:${r.info.paintHow.padEnd(7)}` : ""} ${caps} ${[...(r.problems ?? []), ...r.errors].join("; ")}`);
}

await browser.close();
if (!only?.length) {
  writeFileSync(join(root, "src/data/vehicles/garage-capabilities.json"), JSON.stringify(capabilities, null, 1) + "\n");
}
const failed = results.filter((r) => r.phase !== "ready");
const warned = results.filter((r) => r.phase === "ready" && (r.problems.length || r.errors.length));
console.log(`\n${results.length} vehicles: ${results.length - failed.length - warned.length} ok, ${warned.length} with warnings, ${failed.length} failed`);
if (shots) writeFileSync(join(shots, "report.json"), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
