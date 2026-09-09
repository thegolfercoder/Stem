/**
 * Builds the whole site into one self-contained HTML file.
 *
 * Every page of the export is pre-rendered HTML; those get gzipped into a
 * single blob that the page decompresses on load, which turns 11.5 MB of
 * KaTeX-heavy markup into under a megabyte. The stylesheet, the KaTeX fonts,
 * the search index, KaTeX itself and the question engine are all inlined too,
 * so the result opens from a file:// URL with no server and no network.
 *
 * Run after `npm run build`:  tsx scripts/singlefile/build.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { TOPICS } from "../../src/content/topics";
import { NAV } from "../../src/lib/site";

const OUT = join(process.cwd(), "out");
if (!existsSync(OUT)) {
  console.error("No out/ — run `npm run build` first.");
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/* ------------------------------------------------------------ page bundle */

const pages: Record<string, { t: string; h: string }> = {};
for (const file of walk(OUT).filter((f) => f.endsWith("index.html"))) {
  const rel = relative(OUT, dirname(file)).replace(/\\/g, "/");
  const route = rel === "" ? "/" : `/${rel}/`;
  const html = readFileSync(file, "utf8");
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html);
  if (!main) continue;
  const title = /<title[^>]*>([^<]*)<\/title>/.exec(html);
  pages[route] = { t: title?.[1] ?? "", h: main[1]! };
}
console.log(`pages: ${Object.keys(pages).length}`);

/* ------------------------------------------------ stylesheet, with fonts */

const home = readFileSync(join(OUT, "index.html"), "utf8");
const cssNames = [...new Set([...home.matchAll(/\/_next\/static\/css\/([A-Za-z0-9]+\.css)/g)].map((m) => m[1]!))];
let css = cssNames.map((n) => readFileSync(join(OUT, "_next/static/css", n), "utf8")).join("\n");

css = css.replace(/\/_next\/static\/media\/(KaTeX_[A-Za-z0-9_-]+\.[a-f0-9]+\.woff2)/g, (_m, file: string) => {
  const data = readFileSync(join(OUT, "_next/static/media", file)).toString("base64");
  return `data:font/woff2;base64,${data}`;
});
// The woff and ttf fallbacks in each @font-face can no longer be fetched.
css = css.replace(/,url\(\/_next\/static\/media\/KaTeX_[^)]*\.(?:woff|ttf)\)format\("(?:woff|truetype)"\)/g, "");

/* ------------------------------------------------------- shell, from home */

const headerMatch = /<header[\s\S]*?<\/header>/.exec(home);
const footerMatch = /<footer[\s\S]*?<\/footer>/.exec(home);
if (!headerMatch || !footerMatch) throw new Error("could not find the header and footer in the export");

/* --------------------------------------------------------------- runtime */

const engineEntry = join(process.cwd(), "scripts/singlefile/engine-entry.ts");
execFileSync(
  "npx",
  ["esbuild", engineEntry, "--bundle", "--minify", "--format=iife", "--target=es2020",
   "--outfile=/tmp/sf-engine.js", "--tsconfig=tsconfig.json"],
  { stdio: "pipe" },
);
const topicMeta = JSON.stringify(
  TOPICS.map((t) => ({ slug: t.slug, title: t.title, short: t.short, unit: t.unit, minutes: t.estimatedMinutes })),
);
const engine = readFileSync("/tmp/sf-engine.js", "utf8").replace('"__TOPIC_META__"', topicMeta);

const katex = readFileSync(join(process.cwd(), "node_modules/katex/dist/katex.min.js"), "utf8");
const app = readFileSync(join(process.cwd(), "scripts/singlefile/app.js"), "utf8");
const searchIndex = readFileSync(join(process.cwd(), "public/search-index.json"), "utf8");
const icon = readFileSync(join(OUT, "icon.svg"), "utf8");

const pagesB64 = gzipSync(Buffer.from(JSON.stringify(pages)), { level: 9 }).toString("base64");
const searchB64 = gzipSync(Buffer.from(searchIndex), { level: 9 }).toString("base64");

/* ------------------------------------------------------------ the document */

const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IGCSE Additional Mathematics 0606 — complete revision course</title>
<meta name="description" content="A complete study platform for Cambridge IGCSE Additional Mathematics (0606): full syllabus notes, worked examples, exam-style questions with solutions, a random question generator, timed exam simulator and progress tracking. Everything in one offline file.">
<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}">
<script>(function(){try{var s=localStorage.getItem('addmaths-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s==='dark'||(s!=='light'&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<style>
${css}
/* --- Styles for the parts this single-file build renders itself. --- */
.sf-chip{border:1px solid var(--border);border-radius:.5rem;padding:.375rem .75rem;font-size:.875rem;font-weight:500;background:transparent;color:var(--text);cursor:pointer;transition:border-color .15s}
.sf-chip:hover{border-color:color-mix(in oklab,var(--accent) 50%,transparent)}
.sf-chip-on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.sf-chip-static{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--border);background:var(--bg-soft);padding:.125rem .625rem;font-size:11px;color:var(--text-muted)}
.sf-badge{display:inline-flex;align-items:center;border-radius:999px;border:1px solid;padding:.125rem .625rem;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.sf-easy{color:var(--easy);border-color:color-mix(in oklab,var(--easy) 40%,transparent);background:color-mix(in oklab,var(--easy) 10%,transparent)}
.sf-medium{color:var(--medium);border-color:color-mix(in oklab,var(--medium) 40%,transparent);background:color-mix(in oklab,var(--medium) 10%,transparent)}
.sf-hard{color:var(--hard);border-color:color-mix(in oklab,var(--hard) 40%,transparent);background:color-mix(in oklab,var(--hard) 10%,transparent)}
.sf-olympiad{color:var(--olympiad);border-color:color-mix(in oklab,var(--olympiad) 40%,transparent);background:color-mix(in oklab,var(--olympiad) 10%,transparent)}
.sf-btn{border-radius:.5rem;background:var(--accent);color:var(--accent-contrast);padding:.625rem 1.25rem;font-size:.875rem;font-weight:600;border:0;cursor:pointer}
.sf-btn:disabled{opacity:.5;cursor:default}
.sf-btn-lg{padding:.75rem 1.25rem;border-radius:.75rem}
.sf-btn-outline{border-radius:.75rem;border:1px solid var(--border);background:transparent;color:var(--text);padding:.75rem 1.25rem;font-size:.875rem;font-weight:600;cursor:pointer}
.sf-btn-outline:disabled{opacity:.4;cursor:default}
.sf-input{border-radius:.5rem;border:1px solid var(--border);background:var(--bg);color:var(--text);padding:.625rem .875rem;font-family:ui-monospace,monospace;font-size:.95rem;outline:none;min-width:0;flex:1}
.sf-input:focus{border-color:var(--accent)}
.sf-link{color:var(--accent);font-size:.875rem;font-weight:500;text-decoration:underline;text-underline-offset:4px;background:none;border:0;cursor:pointer;padding:0}
.sf-result{margin-top:1rem;border-radius:.75rem;border:1px solid;padding:.75rem 1rem}
.sf-right{border-color:color-mix(in oklab,var(--easy) 45%,transparent);background:color-mix(in oklab,var(--easy) 10%,transparent)}
.sf-wrong{border-color:color-mix(in oklab,var(--hard) 45%,transparent);background:color-mix(in oklab,var(--hard) 10%,transparent)}
.sf-steps{margin-top:1rem;border-radius:.75rem;border:1px solid var(--border);background:var(--bg-soft);padding:1rem}
.sf-steps ol{counter-reset:sf}
.sf-step-n{counter-increment:sf;display:flex;height:1.5rem;width:1.5rem;flex-shrink:0;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);font-size:11px;font-weight:600}
.sf-step-n::before{content:counter(sf)}
.sf-prompt p{line-height:1.75;margin-bottom:.25rem}
.sf-grid2{display:grid;gap:1rem}
.sf-grid3{display:grid;gap:.5rem}
@media(min-width:640px){.sf-grid2{grid-template-columns:repeat(2,1fr)}.sf-grid3{grid-template-columns:repeat(3,1fr)}}
.sf-paper{padding:1.25rem;text-align:left;cursor:pointer;background:var(--bg-card);color:var(--text)}
.sf-navbtn{height:2.25rem;width:2.25rem;border-radius:.5rem;border:1px solid var(--border);background:transparent;color:var(--text);font-size:.875rem;font-weight:600;cursor:pointer}
.sf-navbtn-on{border-color:var(--accent);background:var(--accent);color:var(--accent-contrast)}
.sf-navbtn-done{border-color:color-mix(in oklab,var(--easy) 50%,transparent);background:color-mix(in oklab,var(--easy) 12%,transparent)}
#sf-loading{padding:5rem 1rem;text-align:center}
details>summary::-webkit-details-marker{display:none}
</style>
</head>
<body class="min-h-dvh">
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[color:var(--bg-card)] focus:px-4 focus:py-2 focus:shadow-lg">Skip to content</a>
${headerMatch[0]}
<main id="main" tabindex="-1" class="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
<div id="sf-loading"><p class="muted">Loading the course…</p></div>
</main>
${footerMatch[0]}
<script>window.__PAGES__=${JSON.stringify(pagesB64)};window.__SEARCH__=${JSON.stringify(searchB64)};window.__NAV__=${JSON.stringify(NAV)};</script>
<script>${katex}</script>
<script>${engine}</script>
<script>${app}</script>
</body>
</html>
`;

const dest = process.argv[2] ?? "/tmp/igcse-add-maths-0606.html";
writeFileSync(dest, doc);
const kb = (Buffer.byteLength(doc) / 1024).toFixed(0);
console.log(`wrote ${dest} — ${kb} KB`);
console.log(`  css ${(css.length / 1024).toFixed(0)} KB · katex ${(katex.length / 1024).toFixed(0)} KB · engine ${(engine.length / 1024).toFixed(0)} KB`);
console.log(`  pages ${(pagesB64.length / 1024).toFixed(0)} KB (from ${(JSON.stringify(pages).length / 1024 / 1024).toFixed(1)} MB) · search ${(searchB64.length / 1024).toFixed(0)} KB`);
