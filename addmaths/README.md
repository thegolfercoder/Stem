# Add Maths 0606

A complete study platform for **Cambridge IGCSE Additional Mathematics (0606)**,
written against the published syllabus for 2025, 2026 and 2027.

Full notes for every topic, worked solutions that show the reasoning rather than
just the answer, an endless supply of generated practice questions marked
instantly, and a timed exam simulator with a topic-by-topic breakdown.

```bash
cd addmaths
npm install
npm run dev          # http://localhost:3000
```

## What is here

| Page | What it does |
|---|---|
| `/topics` | 22 topic guides covering all 14 Cambridge units, each running from the idea to the exam question |
| `/syllabus` | Every learning objective mapped to the page that teaches it, plus what the syllabus explicitly *excludes* |
| `/formulas` | The List of formulas Cambridge prints on page 2, and — separately — everything you must memorise |
| `/examples` | Every worked example on the site, grouped from easy to olympiad |
| `/practice` | Randomised questions by topic and difficulty, marked instantly, with a retry queue |
| `/exam` | Timed papers with question navigation, marking, time-per-question analysis and a performance report |
| `/past-papers` | Full multi-part questions in the style and mark tariff of the real papers |
| `/tools` | Graph plotter, quadratic solver, radian converter, binomial tool, progression calculator, gradient checker |
| `/exam-technique` | How marks are actually awarded: method marks, command words, accuracy, timing |
| `/planner` | A revision schedule built backwards from your exam date |
| `/glossary` | 50 terms defined the way an examiner expects to see them used |
| `/progress` | Accuracy by topic and difficulty, weak areas, exam history — stored only in your browser |

Content coverage: **22 topic pages**, **all 14 Cambridge units**, **68 syllabus
objectives**, **132 worked solutions**, **92 question generators** and **50
glossary terms**.

## How it is built

- **Next.js 15** with the App Router, exported as fully static HTML
  (`output: "export"`). Every page is pre-rendered at build time, so the site
  is indexable, fast, and hostable from any static bucket with no server.
- **TypeScript** in strict mode, including `noUncheckedIndexedAccess`.
- **Tailwind CSS v4** with a small set of design tokens for the light and dark
  themes.
- **KaTeX**, rendered *on the server*. Equations arrive typeset in the first
  paint, with no layout shift and no maths library in the client bundle — only
  the stylesheet.
- **No chart or plotting library.** Every diagram is generated from a typed
  `PlotSpec` by `src/components/Plot.tsx`, which samples functions and breaks
  the path at discontinuities so a `tan` graph is not drawn with vertical lines
  through its asymptotes.

### Layout

```
src/
  app/                    routes, one directory per page
  components/             UI, maths rendering, the plotter, the practice and exam clients
  content/
    topics/               one typed module per topic — the entire course
    glossary.ts
  lib/
    types.ts              the content model
    questions/            the practice engine
      engine.ts           seeded RNG, answer marking, answer parsing
      generators/         92 question generators, grouped by area
    progress.ts           localStorage-backed progress tracking
scripts/
  build-search-index.ts   builds public/search-index.json at build time
  test.ts                 the self-test
  verify-maths.ts         independent re-derivation of generated answers
  audit.ts                audits the exported HTML
```

### The content model

Every lesson, example and question is a **typed value**, not JSX. That is what
lets the search index, the practice engine, the progress tracker and the
syllabus audit all read one source of truth — and what makes a missing field a
compile error rather than a blank space on a page. See `src/lib/types.ts`.

Text fields carry inline LaTeX between single dollars:

```ts
{ t: "Take the square root. Because $x \\ge 4$, only the positive root is valid.",
  m: "x - 4 = +\\sqrt{y-5}" }
```

### The practice engine

A *generator* is a pure function from a seeded random source to a question, its
answer and a full worked solution. Because generation is deterministic in the
seed, a question is stored as a short id (`qf-tangent-line:8371422`) and can be
replayed exactly — which is how the retry queue and the exam review work without
storing any question text.

Marking is generous about form and strict about mathematics: `1/2`, `0.5`,
`x = 1/2` and `(1)/(2)` are all the same answer, and `sqrt5`, `pi/6` and `2^3`
parse too. A student should lose a mark for the maths, not for how they typed it.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint via next lint
npm test            # the self-test, then independent verification of the maths
npm run build       # static export to out/
npm run audit       # audits the exported HTML (run after build)
```

`npm test` runs **8106 checks**: every generator across 60 seeds, verifying that
the answer is well formed, that the canonical answer marks correct, that a wrong
answer marks wrong, that maths delimiters balance, and that solutions have real
steps. It then **re-derives 419 answers independently** — by numerical
integration, numerical differentiation, or substitution back into the original
equation — and fails if a generator disagrees with first principles.

`npm run audit` checks the exported site: every internal link resolves to a page
that was actually built, every page has a title, an `h1` and a meta description,
no page contains a KaTeX parse error, and every entry in the search index points
at a real page.

The site was also checked with axe-core against WCAG 2.1 A and AA across
fourteen pages in both light and dark themes: **zero violations**. Every page was
checked at 375px for horizontal overflow: **zero**.

## One-file build

The whole site also builds into a single self-contained HTML file:

```bash
npm run build:singlefile        # writes /tmp/igcse-add-maths-0606.html
npm run build:singlefile -- ./addmaths.html
```

Every page is gzipped into one blob the page decompresses on load — 11.5 MB of
KaTeX-heavy markup becomes about 1 MB — and the stylesheet, the KaTeX fonts, the
search index, KaTeX itself and the question engine are all inlined. The result
is **1.9 MB**, opens from a `file://` URL, and makes **no network requests at
all**: notes, search, practice, the exam simulator, the tools, the planner and
progress tracking all work offline.

The three interactive pages are rebuilt in plain DOM against the real question
engine (`scripts/singlefile/app.js`), so they run the same generators and the
same marking as the React version rather than being a static copy of it. It
needs `DecompressionStream`: Chrome 80+, Firefox 113+, Safari 16.4+.

## Deploying

The build produces a directory of static files with no server component.

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.example npm run build
```

Setting `NEXT_PUBLIC_SITE_URL` gives correct canonical URLs, Open Graph tags and
`sitemap.xml`. Then upload `out/` anywhere:

- **Netlify** — publish directory `out`, build command `npm run build`.
- **Vercel** — detected automatically; the static export is served from the CDN.
- **GitHub Pages** — push `out/` to the `gh-pages` branch.
- **Cloudflare Pages / S3 / any static host** — upload `out/`.

Configure the host to serve `out/404.html` for missing paths. The site uses
trailing slashes (`/topics/functions/`), which most static hosts handle without
configuration.

To preview the export locally exactly as it will be served:

```bash
npm run build && npm run serve   # http://localhost:4173
```

## Notes on the content

Question wording follows the style and mark tariff of the real papers but no
Cambridge material is reproduced — past papers are copyright. Objective wording
on `/syllabus` is summarised from the published 0606 syllabus for 2025–2027;
check the official document on the Cambridge International website for the
definitive version, and confirm the syllabus year with your school.

This is an independent study resource. It is not endorsed by or affiliated with
Cambridge Assessment International Education.

## Privacy

There is no account, no server and no analytics. Practice history, exam results
and planner state live in the browser's `localStorage` and are never uploaded.
The progress page has an export button and a delete button, and both do exactly
what they say.
