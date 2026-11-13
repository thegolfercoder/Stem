import type { Metadata } from "next";
import Link from "next/link";
import { allExamQuestions } from "@/lib/content";
import { TOPICS } from "@/content/topics";
import { TexExample } from "@/components/TexExample";
import { schemeFor } from "@/lib/marks";
import { Callout, PageHeader } from "@/components/ui";

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

        <nav aria-label="Jump to topic" className="mt-7 flex flex-wrap gap-x-4 gap-y-1">
          {TOPICS.filter((t) => t.examQuestions.length > 0).map((t) => (
            <a
              key={t.slug}
              href={`#${t.slug}`}
              className="link text-[0.95rem]"
            >
              {t.short}
            </a>
          ))}
        </nav>

        <div className="mt-8 space-y-10">
          {TOPICS.filter((t) => t.examQuestions.length > 0).map((topic, ti) => (
            <section key={topic.slug} id={topic.slug} className="scroll-mt-24">
              <div className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-[color:var(--border)] pb-2">
                <h2 className="text-[1.3rem] font-bold">
                  {ti + 1}&ensp;{topic.title}
                </h2>
                <Link href={`/topics/${topic.slug}/`} className="link text-sm">
                  notes
                </Link>
              </div>
              <div>
                {topic.examQuestions.map((q, qi) => (
                  <TexExample
                    key={q.id}
                    label={`Question ${ti + 1}.${qi + 1}`}
                    title={q.title}
                    difficulty={q.difficulty}
                    prompt={q.prompt}
                    {...(q.figure ? { figure: q.figure } : {})}
                    steps={q.steps}
                    answer={q.answer}
                    marks={q.marks}
                    {...(q.paper ? { paper: q.paper } : {})}
                    scheme={schemeFor(q)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
