/**
 * Builds the site-wide search index.
 *
 * The index is a static JSON file fetched on first search, rather than part of
 * any page bundle, so it costs a reader nothing until they use it. Maths
 * delimiters and LaTeX commands are stripped so that searching for "sector
 * area" matches text that is written as "$\frac12 r^2\theta$".
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TOPICS } from "../src/content/topics";
import { GLOSSARY } from "../src/content/glossary";
import { NAV } from "../src/lib/site";
import { GENERATORS } from "../src/lib/questions";

interface Doc {
  title: string;
  href: string;
  kind: string;
  text: string;
}

/** Turns "$\frac{a}{b}$ of the total" into readable, searchable words. */
function plain(s: string): string {
  return s
    .replace(/\$([^$]*)\$/g, " $1 ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}$^_\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const docs: Doc[] = [];

for (const page of NAV) {
  docs.push({ title: page.label, href: page.href, kind: "Page", text: page.description });
}

for (const topic of TOPICS) {
  docs.push({
    title: topic.title,
    href: `/topics/${topic.slug}/`,
    kind: "Topic",
    text: plain(
      [topic.blurb, ...topic.syllabus.map((s) => s.text), ...topic.sections.map((s) => s.heading)].join(" · "),
    ),
  });

  for (const section of topic.sections) {
    const body = section.body
      .map((b) => {
        switch (b.k) {
          case "p":
          case "math":
            return b.t;
          case "ul":
          case "ol":
            return b.items.join(" ");
          case "note":
            return `${b.title ?? ""} ${b.t}`;
          case "table":
            return [...b.head, ...b.rows.flat()].join(" ");
          case "steps":
            return b.items.map((s) => `${s.t} ${s.m ?? ""}`).join(" ");
          default:
            return "";
        }
      })
      .join(" ");
    docs.push({
      title: `${section.heading} — ${topic.short}`,
      href: `/topics/${topic.slug}/#${section.id}`,
      kind: "Section",
      text: plain(body).slice(0, 900),
    });
  }

  for (const f of topic.formulas) {
    docs.push({
      title: `${f.name} (${topic.short})`,
      href: `/topics/${topic.slug}/#formulas`,
      kind: "Formula",
      text: plain(`${f.latex} ${f.note ?? ""} ${f.given ? "given on the exam paper" : "not given, learn it"}`),
    });
  }

  for (const ex of topic.examples) {
    docs.push({
      title: ex.title,
      href: `/topics/${topic.slug}/#${ex.id}`,
      kind: "Example",
      text: plain(`${ex.prompt} ${ex.answer}`),
    });
  }

  for (const q of topic.examQuestions) {
    docs.push({
      title: q.title,
      href: `/topics/${topic.slug}/#${q.id}`,
      kind: "Exam question",
      text: plain(`${q.marks} marks. ${q.prompt}`),
    });
  }

  for (const m of topic.mistakes) {
    docs.push({
      title: plain(m.wrong).slice(0, 70),
      href: `/topics/${topic.slug}/#mistakes`,
      kind: "Mistake",
      text: plain(`${m.why} ${m.fix}`),
    });
  }
}

for (const g of GLOSSARY) {
  docs.push({
    title: g.term,
    href: "/glossary/",
    kind: "Glossary",
    text: plain(g.definition),
  });
}

for (const gen of GENERATORS) {
  docs.push({
    title: gen.title,
    href: `/practice/?topic=${gen.topic}`,
    kind: "Practice",
    text: `${gen.difficulty} · ${gen.marks} marks · paper ${gen.paper}`,
  });
}

const out = join(process.cwd(), "public");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "search-index.json"), JSON.stringify(docs));
console.log(`search index: ${docs.length} documents`);
