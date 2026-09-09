import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOPICS, getTopic } from "@/content/topics";
import { unitName } from "@/lib/content";
import { Blocks, Steps } from "@/components/Blocks";
import { M, T } from "@/components/Math";
import { Plot } from "@/components/Plot";
import { Chip, DifficultyBadge } from "@/components/ui";
import { TopicToc } from "@/components/TopicToc";
import { TopicComplete } from "@/components/TopicComplete";

export function generateStaticParams() {
  return TOPICS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) return {};
  return {
    title: topic.title,
    description: `${topic.blurb} Full notes, worked examples, exam-style questions with solutions, common mistakes and practice for IGCSE Additional Mathematics 0606.`,
    alternates: { canonical: `/topics/${topic.slug}/` },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) notFound();

  const index = TOPICS.findIndex((t) => t.slug === topic.slug);
  const prev = index > 0 ? TOPICS[index - 1] : undefined;
  const next = index < TOPICS.length - 1 ? TOPICS[index + 1] : undefined;

  const sectionLinks = [
    ...topic.sections.map((s) => ({ id: s.id, label: s.heading })),
    { id: "formulas", label: "Formulas for this topic" },
    { id: "examples", label: "Worked examples" },
    { id: "exam-questions", label: "Exam-style questions" },
    { id: "mistakes", label: "Common mistakes" },
    { id: "tips", label: "Exam tips" },
    { id: "practice", label: "Practise this topic" },
  ];

  return (
    <article className="pb-10">
      <nav aria-label="Breadcrumb" className="muted flex flex-wrap items-center gap-1.5 pt-6 text-xs">
        <Link href="/topics/" className="hover:text-[color:var(--accent)]">
          Topics
        </Link>
        <span aria-hidden>/</span>
        <span>{topic.unit === 0 ? "Assumed knowledge" : `Unit ${topic.unit}: ${unitName(topic.unit)}`}</span>
      </nav>

      <header className="border-b border-[color:var(--border)] py-6">
        <h1 className="text-[1.9rem] font-bold leading-tight sm:text-[2.4rem]">{topic.title}</h1>
        <p className="muted mt-3 max-w-3xl text-[1.02rem] leading-relaxed">{topic.blurb}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip tone="accent">{topic.estimatedMinutes} min</Chip>
          <Chip>{topic.syllabus.length} syllabus objectives</Chip>
          <Chip>{topic.examples.length + topic.examQuestions.length} full solutions</Chip>
          {topic.prerequisites.map((p) => {
            const pre = getTopic(p);
            return pre ? (
              <Link key={p} href={`/topics/${p}/`} className="link text-xs">
                Needs: {pre.short}
              </Link>
            ) : null;
          })}
        </div>
        <TopicComplete slug={topic.slug} />
      </header>

      <div className="gap-10 lg:flex">
        <TopicToc items={sectionLinks} />

        <div className="min-w-0 flex-1">
          <section className="py-8" aria-labelledby="objectives">
            <h2 id="objectives" className="text-lg font-bold">
              What the syllabus asks for
            </h2>
            <ul className="mt-3 space-y-2">
              {topic.syllabus.map((s) => (
                <li key={s.code} className="flex gap-3 text-[0.95rem] leading-relaxed">
                  <span className="mt-0.5 shrink-0 rounded-md bg-[color:var(--bg-soft)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[color:var(--text-muted)]">
                    {s.code}
                  </span>
                  <span>
                    <T>{s.text}</T>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {topic.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
              <h2 className="mb-4 text-xl font-bold sm:text-2xl">{s.heading}</h2>
              <Blocks blocks={s.body} />
            </section>
          ))}

          <section id="formulas" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Formulas for this topic</h2>
            <p className="muted mt-1.5 text-sm">
              “Given” means it is printed in the List of formulas on page 2 of the exam paper.
              Everything else you must know.
            </p>
            <ul className="mt-5 space-y-3">
              {topic.formulas.map((f) => (
                <li key={f.name} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.name}</p>
                    <div className="mt-1 overflow-x-auto" tabIndex={0} role="group" aria-label={f.name}>
                      <M>{f.latex}</M>
                    </div>
                    {f.note && (
                      <p className="muted mt-1 text-xs">
                        <T>{f.note}</T>
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      f.given
                        ? "border-[color:var(--easy)]/40 bg-[color:var(--easy)]/10 text-[color:var(--easy)]"
                        : "border-[color:var(--hard)]/40 bg-[color:var(--hard)]/10 text-[color:var(--hard)]"
                    }`}
                  >
                    {f.given ? "Given" : "Learn it"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section id="examples" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Worked examples</h2>
            <p className="muted mt-1.5 text-sm">From a first pass through the idea to the hardest version of it.</p>
            <div className="mt-5 space-y-4">
              {topic.examples.map((ex) => (
                <details key={ex.id} className="card group overflow-hidden" id={ex.id}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5 transition hover:bg-[color:var(--bg-soft)]">
                    <DifficultyBadge level={ex.difficulty} />
                    <span className="font-medium">{ex.title}</span>
                    <span className="muted ml-auto text-xs group-open:hidden">Show solution</span>
                    <span className="muted ml-auto hidden text-xs group-open:inline">Hide solution</span>
                  </summary>
                  <div className="border-t border-[color:var(--border)] p-5">
                    <div className="rounded-xl bg-[color:var(--bg-soft)] p-4">
                      {ex.prompt.split("\n").map((line, i) => (
                        <p key={i} className="leading-relaxed">
                          <T>{line}</T>
                        </p>
                      ))}
                    </div>
                    {ex.figure && <Plot spec={ex.figure} />}
                    <div className="mt-5">
                      <Steps steps={ex.steps} />
                    </div>
                    <div className="mt-5 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.09em]">Answer</p>
                      <p className="mt-1 leading-relaxed">
                        <T>{ex.answer}</T>
                      </p>
                    </div>
                    {ex.remark && (
                      <p className="muted mt-4 text-sm leading-relaxed">
                        <T>{ex.remark}</T>
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section id="exam-questions" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Exam-style questions</h2>
            <p className="muted mt-1.5 text-sm">
              Written in the style and mark tariff of the real papers. Try them before opening the solution.
            </p>
            <div className="mt-5 space-y-4">
              {topic.examQuestions.map((q) => (
                <details key={q.id} className="card group overflow-hidden" id={q.id}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5 transition hover:bg-[color:var(--bg-soft)]">
                    <DifficultyBadge level={q.difficulty} />
                    <span className="font-medium">{q.title}</span>
                    <Chip>{q.marks} marks</Chip>
                    {q.paper && <Chip>Paper {q.paper}</Chip>}
                    <span className="muted ml-auto text-xs group-open:hidden">Show solution</span>
                    <span className="muted ml-auto hidden text-xs group-open:inline">Hide solution</span>
                  </summary>
                  <div className="border-t border-[color:var(--border)] p-5">
                    <div className="rounded-xl bg-[color:var(--bg-soft)] p-4">
                      {q.prompt.split("\n").map((line, i) => (
                        <p key={i} className="leading-relaxed">
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
                      <p className="mt-1 leading-relaxed">
                        <T>{q.answer}</T>
                      </p>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section id="mistakes" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Common mistakes</h2>
            <p className="muted mt-1.5 text-sm">Each of these costs marks every session. Read them once before the exam.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {topic.mistakes.map((m, i) => (
                <div key={i} className="card p-5">
                  <p className="flex items-start gap-2 font-medium text-[color:var(--hard)]">
                    <span aria-hidden className="mt-0.5">✗</span>
                    <span>
                      <T>{m.wrong}</T>
                    </span>
                  </p>
                  <p className="muted mt-2 text-sm leading-relaxed">
                    <T>{m.why}</T>
                  </p>
                  <p className="mt-2.5 flex items-start gap-2 text-sm leading-relaxed text-[color:var(--easy)]">
                    <span aria-hidden className="mt-0.5">✓</span>
                    <span>
                      <T>{m.fix}</T>
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section id="tips" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Exam tips</h2>
            <ul className="mt-5 space-y-3">
              {topic.tips.map((tip, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4 text-[0.95rem] leading-relaxed">
                  <span aria-hidden className="text-[color:var(--easy)]">★</span>
                  <span>
                    <T>{tip}</T>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section id="practice" className="scroll-mt-24 border-t border-[color:var(--border)] py-8">
            <h2 className="text-xl font-bold sm:text-2xl">Practise this topic</h2>
            <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">
              {topic.generators.length > 0
                ? `${topic.generators.length} question templates for this topic, each with randomised numbers, instant marking and a full worked solution.`
                : "Practise this topic inside a mixed set, alongside the topics that use it."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/practice/?topic=${topic.slug}`}
                className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--accent-contrast)] transition hover:opacity-90"
              >
                Start practising
              </Link>
              <Link
                href="/exam/"
                className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold transition hover:border-[color:var(--accent)]/50"
              >
                Take a timed paper
              </Link>
            </div>
          </section>

          <nav className="flex flex-wrap justify-between gap-3 border-t border-[color:var(--border)] pt-6">
            {prev ? (
              <Link href={`/topics/${prev.slug}/`} className="card p-4 transition hover:border-[color:var(--accent)]/50">
                <span className="muted block text-xs">Previous</span>
                <span className="text-sm font-medium">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/topics/${next.slug}/`} className="card p-4 text-right transition hover:border-[color:var(--accent)]/50">
                <span className="muted block text-xs">Next</span>
                <span className="text-sm font-medium">{next.title}</span>
              </Link>
            )}
          </nav>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "LearningResource",
            name: topic.title,
            description: topic.blurb,
            educationalLevel: "IGCSE",
            learningResourceType: "Lesson",
            teaches: topic.syllabus.map((s) => s.text.replace(/\$/g, "")),
          }),
        }}
      />
    </article>
  );
}
