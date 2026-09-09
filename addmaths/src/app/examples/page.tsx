import type { Metadata } from "next";
import Link from "next/link";
import { allExamples } from "@/lib/content";
import { DIFFICULTY_LABEL, DIFFICULTIES } from "@/lib/types";
import { Steps } from "@/components/Blocks";
import { T } from "@/components/Math";
import { Plot } from "@/components/Plot";
import { DifficultyBadge, PageHeader, Chip } from "@/components/ui";

export const metadata: Metadata = {
  title: "Worked examples",
  description:
    "Every worked example on the site, from a first pass through an idea to olympiad-level extensions, each solved step by step with the reasoning shown.",
};

export default function ExamplesPage() {
  const examples = allExamples();
  const byLevel = DIFFICULTIES.map((d) => ({
    level: d,
    items: examples.filter((e) => e.example.difficulty === d),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Worked examples"
        title={`${examples.length} solutions, step by step`}
        lead="Grouped by difficulty so you can find the level you need. Each solution gives the reasoning for every line, not just the algebra."
      >
        <nav aria-label="Jump to difficulty" className="flex flex-wrap gap-2">
          {byLevel.map(({ level, items }) => (
            <a
              key={level}
              href={`#${level}`}
              className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium transition hover:border-[color:var(--accent)]/50"
            >
              {DIFFICULTY_LABEL[level]} ({items.length})
            </a>
          ))}
        </nav>
      </PageHeader>

      <div className="py-9">
        {byLevel.map(({ level, items }) => (
          <section key={level} id={level} className="scroll-mt-24 py-6">
            <h2 className="mb-1 text-xl font-bold sm:text-2xl">{DIFFICULTY_LABEL[level]}</h2>
            <p className="muted mb-5 text-sm">
              {level === "easy"
                ? "One idea at a time, applied directly. If these are comfortable, move on."
                : level === "medium"
                  ? "The standard exam level: two or three steps, with a decision in the middle."
                  : level === "hard"
                    ? "Where the A and A* marks are: restricted domains, sign choices and justification."
                    : "Beyond the syllabus in difficulty, though not in content. For students who want to be certain."}
            </p>
            <div className="space-y-4">
              {items.map(({ topic, example }) => (
                <details key={example.id} className="card group overflow-hidden">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5 transition hover:bg-[color:var(--bg-soft)]">
                    <DifficultyBadge level={example.difficulty} />
                    <span className="font-medium">{example.title}</span>
                    <Chip>{topic.short}</Chip>
                    <span className="muted ml-auto text-xs group-open:hidden">Show</span>
                    <span className="muted ml-auto hidden text-xs group-open:inline">Hide</span>
                  </summary>
                  <div className="border-t border-[color:var(--border)] p-5">
                    <div className="rounded-xl bg-[color:var(--bg-soft)] p-4 leading-relaxed">
                      {example.prompt.split("\n").map((line, i) => (
                        <p key={i}>
                          <T>{line}</T>
                        </p>
                      ))}
                    </div>
                    {example.figure && <Plot spec={example.figure} />}
                    <div className="mt-5">
                      <Steps steps={example.steps} />
                    </div>
                    <div className="mt-5 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.09em]">Answer</p>
                      <p className="mt-1">
                        <T>{example.answer}</T>
                      </p>
                    </div>
                    {example.remark && (
                      <p className="muted mt-4 text-sm leading-relaxed">
                        <T>{example.remark}</T>
                      </p>
                    )}
                    <Link
                      href={`/topics/${topic.slug}/`}
                      className="link mt-4 inline-block text-sm"
                    >
                      Read the {topic.title} notes →
                    </Link>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
