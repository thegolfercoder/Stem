import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOPICS, getTopic } from "@/content/topics";
import { M, T } from "@/components/Math";

export function generateStaticParams() {
  return TOPICS.filter((t) => t.summary).map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic?.summary) return {};
  return {
    title: `${topic.title}: one-page summary`,
    description: `Everything to know cold about ${topic.title.toLowerCase()} for IGCSE Additional Mathematics 0606, on one page: the key idea, the formulas, the methods and the traps.`,
    alternates: { canonical: `/topics/${topic.slug}/summary/` },
  };
}

/** One page, designed to print on one side of A4. */
export default async function SummaryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic?.summary) notFound();
  const sum = topic.summary;
  const given = topic.formulas.filter((f) => !f.given);

  return (
    <article className="summary-page mx-auto max-w-4xl pb-10">
      <nav aria-label="Breadcrumb" className="muted flex flex-wrap items-center gap-1.5 pt-6 text-xs print:hidden">
        <Link href="/topics/" className="hover:text-[color:var(--accent)]">
          Topics
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/topics/${topic.slug}/`} className="hover:text-[color:var(--accent)]">
          {topic.title}
        </Link>
        <span aria-hidden>/</span>
        <span>Summary</span>
      </nav>

      <header className="border-b border-[color:var(--border)] py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--accent)]">One-page summary</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{topic.title}</h1>
        <p className="mt-3 max-w-3xl leading-relaxed">
          <T>{sum.bigIdea}</T>
        </p>
      </header>

      <div className="grid gap-6 py-6 md:grid-cols-2">
        <section aria-labelledby="must-know">
          <h2 id="must-know" className="text-base font-bold">
            Know cold
          </h2>
          <ul className="mt-2 space-y-1.5 text-[0.95rem] leading-relaxed">
            {sum.mustKnow.map((k, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-[color:var(--accent)]">•</span>
                <span>
                  <T>{k}</T>
                </span>
              </li>
            ))}
          </ul>
          {given.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Formulas you must remember</h3>
              <p className="muted text-xs">These are not on the formula page of the paper.</p>
              <ul className="mt-2 space-y-2">
                {given.map((f) => (
                  <li key={f.name} className="text-sm">
                    <span className="muted">{f.name}</span>
                    <div tabIndex={0} role="region" aria-label={f.name} className="overflow-x-auto">
                      <M>{f.latex}</M>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="methods">
          <h2 id="methods" className="text-base font-bold">
            Methods
          </h2>
          <div className="mt-2 space-y-3">
            {sum.methods.map((m) => (
              <div key={m.name} className="rounded-xl border border-[color:var(--border)] p-3">
                <h3 className="text-sm font-semibold">{m.name}</h3>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                  {m.steps.map((st, i) => (
                    <li key={i}>
                      <T>{st}</T>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="traps" className="rounded-xl border border-[color:var(--hard)]/40 bg-[color:var(--hard)]/5 p-4">
        <h2 id="traps" className="text-base font-bold">
          Traps that cost marks
        </h2>
        <ul className="mt-2 space-y-1.5 text-[0.95rem] leading-relaxed">
          {sum.traps.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-[color:var(--hard)]">✗</span>
              <span>
                <T>{t}</T>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-sm print:hidden">
        <Link href={`/topics/${topic.slug}/`} className="link">
          Back to the full {topic.title.toLowerCase()} lesson
        </Link>
      </p>
    </article>
  );
}
