import type { Metadata } from "next";
import Link from "next/link";
import { GLOSSARY } from "@/content/glossary";
import { getTopic } from "@/content/topics";
import { T } from "@/components/Math";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Glossary",
  description:
    "Every technical term in the IGCSE Additional Mathematics 0606 syllabus, defined the way an examiner expects to see it used.",
};

export default function GlossaryPage() {
  const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  const letters = [...new Set(sorted.map((g) => g.term[0]!.toUpperCase()))];

  return (
    <>
      <PageHeader
        eyebrow="Glossary"
        title={`${sorted.length} terms, defined precisely`}
        lead="“Explain in words why…” is worth marks, and those marks are for the right vocabulary. These are the definitions an examiner accepts."
      >
        <nav aria-label="Jump to letter" className="flex flex-wrap gap-1.5">
          {letters.map((l) => (
            <a
              key={l}
              href={`#letter-${l}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--border)] text-sm font-medium transition hover:border-[color:var(--accent)]/50"
            >
              {l}
            </a>
          ))}
        </nav>
      </PageHeader>

      <div className="py-9">
        {letters.map((letter) => (
          <section key={letter} id={`letter-${letter}`} className="scroll-mt-24 py-4">
            <h2 className="mb-3 border-b border-[color:var(--border)] pb-1.5 text-lg font-bold text-[color:var(--accent)]">
              {letter}
            </h2>
            <dl className="space-y-4">
              {sorted
                .filter((g) => g.term[0]!.toUpperCase() === letter)
                .map((g) => {
                  const topic = g.topic ? getTopic(g.topic) : undefined;
                  return (
                    <div key={g.term} className="card p-4">
                      <dt className="font-semibold">{g.term}</dt>
                      <dd className="mt-1.5 text-[0.95rem] leading-relaxed">
                        <T>{g.definition}</T>
                        {topic && (
                          <>
                            {" "}
                            <Link href={`/topics/${topic.slug}/`} className="link text-sm whitespace-nowrap">
                              {topic.short} →
                            </Link>
                          </>
                        )}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
