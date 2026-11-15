/**
 * Builds the companion book as LaTeX from the same typed content as the site.
 *
 *   PER_GEN  exercises generated per question template (Parts IV and V)
 *   MIXED    exercises in the final mixed-review chapter
 *
 * Every exercise comes from a seeded generator whose answers are checked by
 * `npm test`, so the solutions in Part V are as reliable as the practice engine.
 * scripts/book/fit.ts tunes MIXED until the PDF has exactly the target length.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOPICS } from "../../src/content/topics";
import { GLOSSARY } from "../../src/content/glossary";
import { GENERATORS, GENERATOR_BY_ID, generate, type Question } from "../../src/lib/questions";
import { questionTypes } from "../../src/lib/questions/gallery";
import { schemeFor } from "../../src/lib/marks";
import { unitName } from "../../src/lib/content";
import type { Block, MarkItem, PlotSpec, Step } from "../../src/lib/types";
import { DIFFICULTY_LABEL } from "../../src/lib/types";

const PER_GEN = Number(process.env.PER_GEN ?? 40);
const MIXED = Number(process.env.MIXED ?? 0);
const OUT = join(process.cwd(), "book", "build");
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------- text → TeX */


function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/“/g, "``")
    .replace(/”/g, "''");
}

function markdown(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}").replace(/\*([^*\s][^*]*)\*/g, "\\emph{$1}");
}

/** Inline text with $…$ maths, as stored in the content. */
export function tex(s: string): string {
  let out = "";
  let i = 0;
  let buf = "";
  const flush = () => {
    out += markdown(escapeText(buf));
    buf = "";
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "$") {
      buf += "\u0001";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const j = s.indexOf("$", i + 1);
      if (j < 0) {
        buf += "\u0001";
        i += 1;
        continue;
      }
      flush();
      out += "$" + mathFix(s.slice(i + 1, j)) + "$";
      i = j + 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out.replace(/\u0001/g, "\\$");
}

/** KaTeX accepts a few things LaTeX does not. */
function mathFix(m: string): string {
  return m.replace(/\\operatorname\{([^}]*)\}/g, "\\operatorname{$1}");
}

function display(m: string): string {
  return `\\[ ${mathFix(m)} \\]\n`;
}

/* ------------------------------------------------------------------ plots */

const COLORS = ["blue!70!black", "red!70!black", "green!45!black", "violet!80!black", "orange!80!black"];

function num(x: number): string {
  return Number.isFinite(x) ? (Math.abs(x) < 1e-12 ? "0" : x.toFixed(4)) : "nan";
}

function plot(spec: PlotSpec): string {
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  const lines: string[] = [];
  lines.push("\\begin{center}\\begin{tikzpicture}\\begin{axis}[");
  lines.push(`  width=0.8\\linewidth, height=0.5\\linewidth, xmin=${x0}, xmax=${x1}, ymin=${y0}, ymax=${y1},`);
  lines.push("  axis lines=middle, unbounded coords=jump, grid=major, grid style={gray!20}, tick label style={font=\\scriptsize},");
  lines.push("  xlabel={$x$}, ylabel={$y$}, legend style={font=\\scriptsize, draw=none, fill=white, fill opacity=0.8, text opacity=1}, legend pos=outer north east,");
  lines.push("  clip=true]");
  if (spec.shade) {
    const { f, from, to, g } = spec.shade;
    const n = 80;
    const top: string[] = [], bot: string[] = [];
    for (let i = 0; i <= n; i++) {
      const x = from + ((to - from) * i) / n;
      top.push(`(${num(x)},${num(Math.max(y0, Math.min(y1, f(x))))})`);
      bot.push(`(${num(x)},${num(g ? Math.max(y0, Math.min(y1, g(x))) : 0)})`);
    }
    lines.push(`\\addplot[fill=gray!25, draw=none, forget plot] coordinates {${top.join(" ")} ${bot.reverse().join(" ")}} -- cycle;`);
  }
  for (const [ci, c] of (spec.curves ?? []).entries()) {
    const [a, b] = c.domain ?? [x0, x1];
    const n = 200;
    const pts: string[] = [];
    let prev: number | null = null;
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n;
      let y = c.f(x);
      // Break the path at a jump such as an asymptote, rather than joining it.
      if (!Number.isFinite(y) || y > y1 + 3 * (y1 - y0) || y < y0 - 3 * (y1 - y0)) y = NaN;
      if (prev !== null && Number.isFinite(y) && Math.abs(y - prev) > 0.5 * (y1 - y0)) pts.push(`(${num(x)},nan)`);
      pts.push(`(${num(x)},${num(y)})`);
      prev = Number.isFinite(y) ? y : null;
    }
    const col = COLORS[(c.color ?? ci) % COLORS.length];
    lines.push(`\\addplot[${col}, thick, no markers${c.dashed ? ", dashed" : ""}${c.label ? "" : ", forget plot"}] coordinates {${pts.join(" ")}};`);
    if (c.label) lines.push(`\\addlegendentry{${escapeText(c.label)}}`);
  }
  for (const v of spec.vLines ?? []) lines.push(`\\addplot[gray, dashed, forget plot] coordinates {(${v.x},${y0}) (${v.x},${y1})};`);
  for (const h of spec.hLines ?? []) lines.push(`\\addplot[gray, dashed, forget plot] coordinates {(${x0},${h.y}) (${x1},${h.y})};`);
  for (const p of spec.points ?? []) {
    lines.push(`\\addplot[only marks, mark=${p.open ? "o" : "*"}, mark size=1.6pt, forget plot] coordinates {(${num(p.x)},${num(p.y)})};`);
    if (p.label) lines.push(`\\node[font=\\scriptsize, anchor=south west] at (axis cs:${num(p.x)},${num(p.y)}) {${escapeText(p.label)}};`);
  }
  lines.push("\\end{axis}\\end{tikzpicture}");
  if (spec.caption) lines.push(`\\par\\smallskip{\\small ${tex(spec.caption)}}`);
  lines.push("\\end{center}");
  return lines.join("\n") + "\n";
}

/* ----------------------------------------------------------------- blocks */

const NOTE_LABEL: Record<string, string> = { key: "Key idea", tip: "Exam tip", warn: "Caution", info: "Remark" };

function blocks(list: Block[]): string {
  return list.map(block).join("\n");
}

function block(b: Block): string {
  switch (b.k) {
    case "p":
      return tex(b.t) + "\n";
    case "math":
      return display(b.t);
    case "ul":
      return `\\begin{itemize}\n${b.items.map((it) => `\\item ${tex(it)}`).join("\n")}\n\\end{itemize}\n`;
    case "ol":
      return `\\begin{enumerate}[label=(\\roman*)]\n${b.items.map((it) => `\\item ${tex(it)}`).join("\n")}\n\\end{enumerate}\n`;
    case "note":
      return `\\begin{note}{${b.title ? tex(b.title) : NOTE_LABEL[b.tone] ?? "Remark"}}${tex(b.t)}\\end{note}\n`;
    case "table": {
      const cols = b.head.length;
      const spec = "@{}" + "X".repeat(cols) + "@{}";
      return [
        "\\begin{center}\\small",
        `\\begin{tabularx}{\\linewidth}{${spec}}`,
        "\\toprule",
        b.head.map((h) => `\\textbf{${tex(h)}}`).join(" & ") + " \\\\",
        "\\midrule",
        ...b.rows.map((r) => r.map((c) => tex(c)).join(" & ") + " \\\\"),
        "\\bottomrule",
        "\\end{tabularx}",
        b.caption ? `\\par\\smallskip ${tex(b.caption)}` : "",
        "\\end{center}",
      ].join("\n") + "\n";
    }
    case "steps":
      return steps(b.items);
    case "plot":
      return plot(b.spec);
    case "columns":
      return blocks(b.left) + blocks(b.right);
  }
}

function steps(list: Step[]): string {
  return `\\begin{enumerate}[label=(\\arabic*), leftmargin=2.2em, itemsep=2pt]\n${list
    .map((s) => `\\item ${tex(s.t)}${s.m ? "\n" + display(s.m) : ""}`)
    .join("\n")}\n\\end{enumerate}\n`;
}

function scheme(items: MarkItem[], total: number): string {
  if (!items.length) return "";
  return [
    "\\begin{center}\\small",
    "\\begin{tabularx}{\\linewidth}{@{}l l X@{}}",
    `\\multicolumn{3}{@{}l}{\\emph{How the marks are awarded} (total ${total}; M method, A accuracy, B independent)}\\\\`,
    "\\toprule",
    "\\textbf{Part} & \\textbf{Mark} & \\textbf{Awarded for}\\\\",
    "\\midrule",
    ...items.map(
      (m) =>
        `${m.part ? tex(m.part) : ""} & ${m.type}${m.marks} & ${tex(m.criterion)}${
          m.dependsOn !== undefined && items[m.dependsOn] ? ` (dep.\\ on the ${items[m.dependsOn]!.type} mark)` : ""
        }\\\\`,
    ),
    "\\bottomrule",
    "\\end{tabularx}",
    "\\end{center}",
  ].join("\n") + "\n";
}

function promptLines(p: string): string {
  return p
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => tex(l))
    .join("\\par\n");
}

/* ------------------------------------------------------------------ parts */

const files: string[] = [];
function write(name: string, body: string) {
  writeFileSync(join(OUT, name), body);
  files.push(name);
}

// Part I: the lessons.
let partI = "\\part{The Course}\n";
for (const t of TOPICS) {
  partI += `\\chapter{${escapeText(t.title)}}\\label{ch:${t.slug}}\n`;
  partI += `\\begin{chapterabstract}${tex(t.blurb)}\\\\[2pt]\\textit{${
    t.unit === 0 ? "Assumed knowledge" : `Cambridge unit ${t.unit}: ${escapeText(unitName(t.unit))}`
  }. Reading time about ${t.estimatedMinutes} minutes.}\\end{chapterabstract}\n`;
  partI += "\\section*{Syllabus objectives}\n\\begin{description}[font=\\normalfont\\itshape, leftmargin=3em, style=nextline]\n";
  partI += t.syllabus.map((s) => `\\item[${escapeText(s.code)}] ${tex(s.text)}`).join("\n") + "\n\\end{description}\n";
  for (const s of t.sections) partI += `\\section{${tex(s.heading)}}\n${blocks(s.body)}\n`;
  partI += "\\section{Formulas}\n\\begin{description}[style=nextline]\n";
  partI += t.formulas
    .map((f) => `\\item[${escapeText(f.name)} \\normalfont\\textsc{(${f.given ? "given" : "learn"})}] $\\displaystyle ${mathFix(f.latex)}$${f.note ? `\\\\{\\small ${tex(f.note)}}` : ""}`)
    .join("\n");
  partI += "\n\\end{description}\n";
  partI += "\\section{Common mistakes}\n\\begin{enumerate}[label=\\arabic*.]\n";
  partI += t.mistakes
    .map((m) => `\\item \\textbf{Error.} ${tex(m.wrong)}\\\\\\emph{Why it is wrong.} ${tex(m.why)}\\\\\\emph{Correction.} ${tex(m.fix)}`)
    .join("\n");
  partI += "\n\\end{enumerate}\n\\section{Exam tips}\n\\begin{enumerate}[label=(\\roman*)]\n";
  partI += t.tips.map((tip) => `\\item ${tex(tip)}`).join("\n") + "\n\\end{enumerate}\n";
  if (t.summary) {
    const sm = t.summary;
    partI += "\\section{One-page summary}\n";
    partI += `\\begin{note}{The idea}${tex(sm.bigIdea)}\\end{note}\n`;
    partI += "\\subsection*{Know cold}\n\\begin{itemize}\n" + sm.mustKnow.map((k) => `\\item ${tex(k)}`).join("\n") + "\n\\end{itemize}\n";
    partI += "\\subsection*{Methods}\n";
    for (const m of sm.methods) partI += `\\paragraph{${tex(m.name)}.}\\begin{enumerate*}[label=(\\arabic*)]${m.steps.map((s) => `\\item ${tex(s)}`).join(" ")}\\end{enumerate*}\n\n`;
    partI += "\\subsection*{Traps}\n\\begin{itemize}\n" + sm.traps.map((k) => `\\item ${tex(k)}`).join("\n") + "\n\\end{itemize}\n";
  }
}
write("part1.tex", partI);

// Part II: written worked examples and exam questions.
let partII = "\\part{Worked Examples and Exam Questions}\n";
for (const t of TOPICS) {
  partII += `\\chapter{${escapeText(t.title)}: worked}\n\\section{Worked examples}\n`;
  for (const ex of t.examples) {
    partII += `\\begin{example}[${tex(ex.title)}]\\textsc{[${DIFFICULTY_LABEL[ex.difficulty].toLowerCase()}]} ${promptLines(ex.prompt)}\\end{example}\n`;
    if (ex.figure) partII += plot(ex.figure);
    partII += `\\begin{solution}\n${steps(ex.steps)}\\textbf{Answer.} ${tex(ex.answer)}${ex.remark ? `\\par\\emph{Remark.} ${tex(ex.remark)}` : ""}\\end{solution}\n`;
  }
  partII += "\\section{Exam-style questions}\n";
  for (const q of t.examQuestions) {
    partII += `\\begin{question}[${tex(q.title)}]\\textsc{[${DIFFICULTY_LABEL[q.difficulty].toLowerCase()}, ${q.marks} marks${q.paper ? `, paper ${q.paper}` : ""}]} ${promptLines(q.prompt)}\\end{question}\n`;
    if (q.figure) partII += plot(q.figure);
    partII += `\\begin{solution}\n${steps(q.steps)}\\textbf{Answer.} ${tex(q.answer)}\n${scheme(schemeFor(q), q.marks)}\\end{solution}\n`;
  }
}
write("part2.tex", partII);

// Part III: every question type, worked.
let partIII = "\\part{Every Question Type}\n";
partIII += "\\chapter*{About this part}\\addcontentsline{toc}{chapter}{About this part}\nEach template the practice engine uses appears here once for every distinct method it can call for, worked in full with its mark scheme.\n";
for (const t of TOPICS) {
  const types = questionTypes(t.generators);
  if (!types.length) continue;
  partIII += `\\chapter{${escapeText(t.title)}: question types}\n`;
  for (const ty of types) {
    partIII += `\\section{${tex(ty.title)}}\n`;
    ty.instances.forEach((q, i) => {
      partIII += `\\begin{example}[${ty.instances.length > 1 ? `variant ${i + 1} of ${ty.instances.length}` : "worked instance"}]\\textsc{[${DIFFICULTY_LABEL[q.difficulty].toLowerCase()}, ${q.marks} marks, paper ${q.paper}]} ${promptLines(q.prompt)}\\end{example}\n`;
      partIII += `\\begin{solution}\n${steps(q.solution)}\\textbf{Answer.} ${tex(q.answer.display)}\n${scheme(q.markScheme, q.marks)}\\end{solution}\n`;
    });
  }
}
write("part3.tex", partIII);

// Parts IV and V: exercises and their solutions.
function exercisesFor(ids: string[], perGen: number, salt: number): Question[] {
  const out: Question[] = [];
  for (const id of ids) {
    const gen = GENERATOR_BY_ID.get(id);
    if (!gen) continue;
    const seen = new Set<string>();
    for (let s = 1; out.filter((q) => q.generator === id).length < perGen && s < perGen * 20; s++) {
      const q = generate(gen, s * 7907 + salt);
      if (seen.has(q.prompt)) continue;
      seen.add(q.prompt);
      out.push(q);
    }
  }
  // Easy first within each chapter.
  const rank = { easy: 0, medium: 1, hard: 2, olympiad: 3 } as const;
  return out.sort((a, b) => rank[a.difficulty] - rank[b.difficulty]);
}

let partIV = "\\part{Exercises}\n";
let partV = "\\part{Solutions to the Exercises}\n";
let chapterNo = 0;
for (const t of TOPICS) {
  const qs = exercisesFor(t.generators, PER_GEN, 31);
  if (!qs.length) continue;
  chapterNo += 1;
  partIV += `\\chapter{Exercises: ${escapeText(t.title)}}\n\\begin{enumerate}[label=\\textbf{E${chapterNo}.\\arabic*}, leftmargin=*, itemsep=6pt]\n`;
  partV += `\\chapter{Solutions: ${escapeText(t.title)}}\n`;
  qs.forEach((q, i) => {
    partIV += `\\item \\textsc{[${DIFFICULTY_LABEL[q.difficulty].toLowerCase()}, ${q.marks}]} ${promptLines(q.prompt)}\n`;
    partV += `\\subsection*{E${chapterNo}.${i + 1}}\n${steps(q.solution)}\\textbf{Answer.} ${tex(q.answer.display)}\n`;
  });
  partIV += "\\end{enumerate}\n";
}
// Mixed review: questions drawn from every template in turn.
if (MIXED > 0) {
  chapterNo += 1;
  const all = GENERATORS.map((g) => g.id);
  const mixed: Question[] = [];
  for (let k = 0; mixed.length < MIXED; k++) {
    const gen = GENERATORS[k % all.length]!;
    mixed.push(generate(gen, 500009 + k * 104729));
  }
  partIV += `\\chapter{Mixed review}\nQuestions from every topic, in no particular order, as in the real papers.\n\\begin{enumerate}[label=\\textbf{M\\arabic*}, leftmargin=*, itemsep=6pt]\n`;
  partV += `\\chapter{Solutions: mixed review}\n`;
  mixed.forEach((q, i) => {
    partIV += `\\item \\textsc{[${DIFFICULTY_LABEL[q.difficulty].toLowerCase()}, ${q.marks}]} ${promptLines(q.prompt)}\n`;
    partV += `\\subsection*{M${i + 1}}\n${steps(q.solution)}\\textbf{Answer.} ${tex(q.answer.display)}\n`;
  });
  partIV += "\\end{enumerate}\n";
}
write("part4.tex", partIV);
write("part5.tex", partV);

// Appendices.
let app = "\\appendix\n\\chapter{Formulas}\n";
for (const t of TOPICS) {
  app += `\\section*{${escapeText(t.title)}}\n\\begin{description}[style=nextline]\n`;
  app += t.formulas.map((f) => `\\item[${escapeText(f.name)} \\normalfont\\textsc{(${f.given ? "given" : "learn"})}] $\\displaystyle ${mathFix(f.latex)}$`).join("\n");
  app += "\n\\end{description}\n";
}
app += "\\chapter{Glossary}\n\\begin{description}\n";
app += [...GLOSSARY]
  .sort((a, b) => a.term.localeCompare(b.term))
  .map((g) => `\\item[${tex(g.term)}] ${tex(g.definition)}`)
  .join("\n");
app += "\n\\end{description}\n";
write("appendix.tex", app);

writeFileSync(
  join(OUT, "stats.json"),
  JSON.stringify({ PER_GEN, MIXED, generators: GENERATORS.length, topics: TOPICS.length }, null, 2),
);
console.log(`wrote ${files.join(", ")} to ${OUT} (PER_GEN=${PER_GEN}, MIXED=${MIXED})`);
