import type { Metadata } from "next";
import Link from "next/link";
import { TOPICS } from "@/content/topics";
import { topicsByUnit } from "@/lib/content";
import { Chip, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "All topics",
  description:
    "Complete notes for every topic in Cambridge IGCSE Additional Mathematics 0606, from functions and quadratics to calculus, vectors and series.",
};

export default function TopicsPage() {
  const groups = topicsByUnit();
  const totalMinutes = TOPICS.reduce((n, t) => n + t.estimatedMinutes, 0);

  return (
    <>
      <PageHeader
        eyebrow="Topics"
        title="The complete course"
        lead={`Every part of the 0606 syllabus, written to be read in order or dipped into. About ${Math.round(totalMinutes / 60)} hours of reading in total — but each page stands on its own.`}
      />

      <div className="space-y-10 py-9">
        {groups.map((g) => (
          <section key={g.unit} aria-labelledby={`unit-${g.unit}`}>
            <div className="mb-4 flex items-baseline gap-3 border-b border-[color:var(--border)] pb-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                {g.unit === 0 ? "Assumed" : `Unit ${g.unit}`}
              </span>
              <h2 id={`unit-${g.unit}`} className="text-lg font-bold">
                {g.name}
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {g.topics.map((t) => (
                <Link
                  key={t.slug}
                  href={`/topics/${t.slug}/`}
                  className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50"
                >
                  <h3 className="font-semibold group-hover:text-[color:var(--accent)]">{t.title}</h3>
                  <p className="muted mt-1.5 flex-1 text-sm leading-relaxed">{t.blurb}</p>
                  <div className="mt-3.5 flex flex-wrap gap-1.5">
                    <Chip tone="accent">{t.estimatedMinutes} min read</Chip>
                    <Chip>{t.sections.length} sections</Chip>
                    <Chip>{t.examples.length} worked examples</Chip>
                    <Chip>{t.examQuestions.length} exam questions</Chip>
                    {t.generators.length > 0 && <Chip>{t.generators.length} question types</Chip>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
