/**
 * Audits the exported site: every internal link must resolve to a page that
 * was actually built, every page must have a title and an h1, and no page may
 * contain a KaTeX parse error. Run after `next build`.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = join(process.cwd(), "out");
if (!existsSync(OUT)) {
  console.error("No out/ directory — run `npm run build` first.");
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(OUT);
const pages = files.filter((f) => f.endsWith(".html"));
const routes = new Set(
  pages.map((f) => {
    const rel = relative(OUT, f).replace(/\\/g, "/");
    return "/" + rel.replace(/index\.html$/, "").replace(/\.html$/, "/");
  }),
);

let problems = 0;
function fail(message: string): void {
  problems += 1;
  console.error(`  ✗ ${message}`);
}

console.log(`Auditing ${pages.length} exported pages`);

const seenHrefs = new Set<string>();
for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const route = "/" + relative(OUT, file).replace(/\\/g, "/").replace(/index\.html$/, "");

  if (!/<title[^>]*>[^<]{5,}<\/title>/.test(html)) fail(`${route}: missing or empty <title>`);
  if (!/<h1[^>]*>/.test(html)) fail(`${route}: no <h1>`);
  if (!/<meta name="description"/.test(html)) fail(`${route}: no meta description`);
  if (/katex-error/.test(html)) fail(`${route}: contains a KaTeX parse error`);
  // "undefined" is legitimate prose in this subject (tan(pi/2), log of zero),
  // so only the numeric failure values are treated as bugs.
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");
  if (/\bNaN\b|\bInfinity\b/.test(visible)) {
    fail(`${route}: rendered text contains NaN or Infinity`);
  }

  // Images need alt text; SVG images need a label.
  for (const img of html.match(/<img[^>]*>/g) ?? []) {
    if (!/alt=/.test(img)) fail(`${route}: an <img> has no alt attribute`);
  }
  for (const svg of html.match(/<svg[^>]*role="img"[^>]*>/g) ?? []) {
    if (!/aria-label=/.test(svg)) fail(`${route}: an svg with role="img" has no aria-label`);
  }

  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const href = m[1]!;
    seenHrefs.add(href);
    const normalised = href.endsWith("/") ? href : `${href}/`;
    const isAsset = /\.(json|xml|txt|png|svg|ico|css|js)$/.test(href);
    if (isAsset) {
      if (!existsSync(join(OUT, href.replace(/^\//, "")))) fail(`${route}: asset ${href} is missing`);
      continue;
    }
    if (!routes.has(normalised)) fail(`${route}: link to ${href} does not resolve to a built page`);
  }
}

console.log(`  ${routes.size} routes, ${seenHrefs.size} distinct internal links`);

// The search index must exist and be non-trivial.
const indexPath = join(OUT, "search-index.json");
if (!existsSync(indexPath)) fail("search-index.json was not exported");
else {
  const docs = JSON.parse(readFileSync(indexPath, "utf8")) as { href: string; title: string }[];
  if (docs.length < 200) fail(`search index has only ${docs.length} documents`);
  for (const doc of docs) {
    const path = doc.href.split(/[#?]/)[0]!;
    const normalised = path.endsWith("/") ? path : `${path}/`;
    if (!routes.has(normalised)) fail(`search index points at ${doc.href}, which is not a built page`);
  }
  console.log(`  search index: ${docs.length} documents, all pointing at real pages`);
}

if (problems) {
  console.error(`\nFAILED — ${problems} problem${problems === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("\nAudit passed.");
