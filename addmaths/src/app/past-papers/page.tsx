import type { Metadata } from "next";
import Link from "next/link";
import { allExamQuestions } from "@/lib/content";
import { TOPICS } from "@/content/topics";
import { Steps } from "@/components/Blocks";
import { T } from "@/components/Math";
import { Plot } from "@/components/Plot";
import { Callout, Chip, DifficultyBadge, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Past-paper style questions",
  description:
    "Full exam-style questions for IGCSE Additional Mathematics 0606, written to the mark tariff and structure of the real papers, each with a complete solution.",
};

export default function PastPapersPage() {
  const questions = allExamQuestions();
  const marks = questions.reduce((n, q) => n + q.question.marks, 0);

  return (
    <>
      <PageHeader
        eyebrow="Past-paper style"
        title="Full exam questions, with full solutions"
        lead={`${questions.length} multi-part questions worth ${marks} marks in total, written in the structure and mark tariff of the real papers — including the “show that”, “hence” and “explain why” parts that decide grades.`}
      />

      <div className="py-9">
        <Callout title="Why these are not real past papers">
          Cambridge past papers are copyright and cannot be reproduced here. These questions are
          written to match the style, structure and difficulty of the real thing. Use them alongside
          genuine papers from your school or the Cambridge website — nothing replaces sitting a real
          paper under timed conditions.
        </Callout>

        <nav aria-label="Jump to topic" className="mt-7 flex flex-wrap gap-2">
          {TOPICS.filter((t) => t.examQuestions.length > 0).map((t) => (
            <a
              key={t.slug}
              href={`#${t.slug}`}
              className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm transition hover:border-[color:var(--accent)]/50"
            >
              {t.short}
            </a>
          ))}
        </nav>

        <div className="mt-8 space-y-10">
          {TOPICS.filter((t) => t.examQuestions.length > 0).map((topic) => (
            <section key={topic.slug} id={topic.slug} className="scroll-mt-24">
              <div className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-[color:var(--border)] pb-2">
                <h2 className="text-lg font-bold">{topic.title}</h2>
                <Link href={`/topics/${topic.slug}/`} className="link text-sm">
                  notes
                </Link>
              </div>
              <div className="space-y-4">
                {topic.examQuestions.map((q) => (
                  <details key={q.id} className="card group overflow-hidden">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5 transition hover:bg-[color:var(--bg-soft)]">
                      <DifficultyBadge level={q.difficulty} />
                      <span className="font-medium">{q.title}</span>
                      <Chip>{q.marks} marks</Chip>
                      {q.paper && <Chip>Paper {q.paper}</Chip>}
                      <span className="muted ml-auto text-xs group-open:hidden">Show solution</span>
                      <span className="muted ml-auto hidden text-xs group-open:inline">Hide solution</span>
                    </summary>
                    <div className="border-t border-[color:var(--border)] p-5">
                      <div className="rounded-xl bg-[color:var(--bg-soft)] p-4 leading-relaxed">
                        {q.prompt.split("\n").map((line, i) => (
                          <p key={i}>
                            <T>{line}</T>
                          </p>
                        ))}
                      </div>
                      {q.figure && <Plot spec={q.figure} />}
                      <div className="mt-5">
                        <Steps steps={q.steps} />
                      </div>
                      <div className="mt-5 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.09em]">Answer</p>
                        <p className="mt-1">
                          <T>{q.answer}</T>
                        </p>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
