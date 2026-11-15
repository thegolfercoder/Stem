import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOPICS, getTopic } from "@/content/topics";
import { unitName } from "@/lib/content";
import { Blocks } from "@/components/Blocks";
import { schemeFor } from "@/lib/marks";
import { M, T } from "@/components/Math";
import { TopicToc } from "@/components/TopicToc";
import { TopicComplete } from "@/components/TopicComplete";
import { TexExample } from "@/components/TexExample";
import { questionTypes } from "@/lib/questions/gallery";

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
    description: `${topic.blurb} Full notes, worked examples of every question type, exam-style questions with mark schemes, common mistakes and practice for IGCSE Additional Mathematics 0606.`,
    alternates: { canonical: `/topics/${topic.slug}/` },
  };
}

function SectionHeading({ n, id, children }: { n: number; id: string; children: React.ReactNode }) {
  return (
    <h2 id={`${id}-heading`} className="mb-3 flex gap-4 text-[1.3rem] font-bold leading-snug sm:text-[1.45rem]">
      <span className="tabular-nums">{n}</span>
      <span>{children}</span>
    </h2>
  );
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) notFound();

  const index = TOPICS.findIndex((t) => t.slug === topic.slug);
  const prev = index > 0 ? TOPICS[index - 1] : undefined;
  const next = index < TOPICS.length - 1 ? TOPICS[index + 1] : undefined;
  const types = questionTypes(topic.generators);
  const typeCount = types.reduce((n, t) => n + t.instances.length, 0);

  // Section numbers run on from the lesson into the reference material.
  const k = topic.sections.length;
  const num = {
    formulas: k + 1,
    examples: k + 2,
    types: k + 3,
    exam: k + 4,
    mistakes: k + 5,
    tips: k + 6,
    practice: k + 7,
  };

  const sectionLinks = [
    ...topic.sections.map((s, i) => ({ id: s.id, label: `${i + 1}  ${s.heading}` })),
    { id: "formulas", label: `${num.formulas}  Formulas` },
    { id: "examples", label: `${num.examples}  Worked examples` },
    ...(types.length ? [{ id: "question-types", label: `${num.types}  Every question type` }] : []),
    { id: "exam-questions", label: `${num.exam}  Exam-style questions` },
    { id: "mistakes", label: `${num.mistakes}  Common mistakes` },
    { id: "tips", label: `${num.tips}  Exam tips` },
    { id: "practice", label: `${num.practice}  Practice` },
  ];

  return (
    <article className="pb-10">
      <nav aria-label="Breadcrumb" className="muted flex flex-wrap items-center gap-1.5 pt-6 text-sm">
        <Link href="/topics/" className="link">
          Topics
        </Link>
        <span aria-hidden>/</span>
        <span>{topic.unit === 0 ? "Assumed knowledge" : `Unit ${topic.unit}: ${unitName(topic.unit)}`}</span>
      </nav>

      <header className="border-b border-[color:var(--rule)] pb-6 pt-6 text-center">
        <h1 className="text-[1.9rem] font-bold leading-tight sm:text-[2.35rem]">{topic.title}</h1>
        <p className="smallcaps mt-2 text-[color:var(--text-muted)]">
          Cambridge IGCSE Additional Mathematics 0606 · {topic.unit === 0 ? "assumed knowledge" : `unit ${topic.unit}`}
        </p>
        <div className="mx-auto mt-5 max-w-2xl text-left">
          <p className="text-center text-sm font-bold">Abstract</p>
          <p className="mt-1 text-[0.98rem] leading-[1.7]" style={{ textAlign: "justify" }}>
            <T>{topic.blurb}</T> This note has {k} sections of exposition, {topic.examples.length} worked examples,{" "}
            {typeCount > 0 ? `${typeCount} worked instances covering every question type the practice engine sets, ` : ""}
            and {topic.examQuestions.length} exam-style questions with mark schemes. Reading time about{" "}
            {topic.estimatedMinutes} minutes.
          </p>
          <p className="mt-2 text-center text-sm">
            {topic.prerequisites.length > 0 && (
              <>
                <span className="muted">Prerequisites: </span>
                {topic.prerequisites.map((p, i) => {
                  const pre = getTopic(p);
                  return pre ? (
                    <span key={p}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/topics/${p}/`} className="link">
                        {pre.short}
                      </Link>
                    </span>
                  ) : null;
                })}
                {topic.summary ? " · " : ""}
              </>
            )}
            {topic.summary && (
              <Link href={`/topics/${topic.slug}/summary/`} className="link">
                One-page summary
              </Link>
            )}
          </p>
        </div>
        <TopicComplete slug={topic.slug} />
      </header>

      <div className="gap-10 lg:flex">
        <TopicToc items={sectionLinks} />

        <div className="mx-auto min-w-0 max-w-[46rem] flex-1">
          <section className="py-7" aria-labelledby="objectives">
            <h2 id="objectives" className="mb-2 text-[1.1rem] font-bold">
              Syllabus objectives
            </h2>
            <ul className="space-y-1.5">
              {topic.syllabus.map((s) => (
                <li key={s.code} className="flex gap-3 leading-[1.65]">
                  <span className="w-10 shrink-0 tabular-nums text-[color:var(--text-muted)]">{s.code}</span>
                  <span>
                    <T>{s.text}</T>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {topic.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 py-6" aria-labelledby={`${s.id}-heading`}>
              <SectionHeading n={i + 1} id={s.id}>
                {s.heading}
              </SectionHeading>
              <Blocks blocks={s.body} />
            </section>
          ))}

          <section id="formulas" className="scroll-mt-24 py-6" aria-labelledby="formulas-heading">
            <SectionHeading n={num.formulas} id="formulas">
              Formulas
            </SectionHeading>
            <p className="leading-[1.7]">
              Formulas tagged <span className="smallcaps">given</span> are printed in the list of formulas on page 2
              of the paper; the rest must be known.
            </p>
            <ol className="mt-3">
              {topic.formulas.map((f, i) => (
                <li key={f.name} className="flex items-baseline gap-4 border-t border-[color:var(--border)] py-3 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.95rem]">
                      <span className="tex-italic-label">{f.name}.</span>
                    </p>
                    <div className="mt-1 overflow-x-auto" tabIndex={0} role="group" aria-label={f.name}>
                      <M>{f.latex}</M>
                    </div>
                    {f.note && (
                      <p className="muted mt-1 text-sm">
                        <T>{f.note}</T>
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">
                    ({num.formulas}.{i + 1}){" "}
                    <span className="smallcaps text-[color:var(--text-muted)]">{f.given ? "given" : "learn"}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section id="examples" className="scroll-mt-24 py-6" aria-labelledby="examples-heading">
            <SectionHeading n={num.examples} id="examples">
              Worked examples
            </SectionHeading>
            <p className="leading-[1.7]">Ordered from a first pass through the idea to its hardest form.</p>
            <div className="mt-2">
              {topic.examples.map((ex, i) => (
                <TexExample
                  key={ex.id}
                  id={ex.id}
                  label={`Example ${num.examples}.${i + 1}`}
                  title={ex.title}
                  difficulty={ex.difficulty}
                  prompt={ex.prompt}
                  {...(ex.figure ? { figure: ex.figure } : {})}
                  steps={ex.steps}
                  answer={ex.answer}
                  {...(ex.remark ? { remark: ex.remark } : {})}
                />
              ))}
            </div>
          </section>

          {types.length > 0 && (
            <section id="question-types" className="scroll-mt-24 py-6" aria-labelledby="question-types-heading">
              <SectionHeading n={num.types} id="question-types">
                Every question type
              </SectionHeading>
              <p className="leading-[1.7]" style={{ textAlign: "justify" }}>
                One fully worked instance of every kind of question the practice engine sets for this topic. Where a
                template can be answered by more than one method, each method has its own worked instance. Practice
                questions use the same methods with fresh numbers.
              </p>
              {types.map((t, ti) => (
                <div key={t.generator} className="mt-4">
                  <h3 className="text-[1.05rem] font-bold">
                    {num.types}.{ti + 1}&ensp;
                    <T>{t.title}</T>
                  </h3>
                  {t.instances.map((q, qi) => (
                    <TexExample
                      key={q.id}
                      id={`type-${t.generator}-${qi + 1}`}
                      label={`Type ${num.types}.${ti + 1}${t.instances.length > 1 ? String.fromCharCode(97 + qi) : ""}`}
                      title={t.instances.length > 1 ? `variant ${qi + 1} of ${t.instances.length}` : "worked instance"}
                      difficulty={q.difficulty}
                      prompt={q.prompt}
                      steps={q.solution}
                      answer={q.answer.display}
                      marks={q.marks}
                      paper={q.paper}
                      scheme={q.markScheme}
                    />
                  ))}
                </div>
              ))}
            </section>
          )}

          <section id="exam-questions" className="scroll-mt-24 py-6" aria-labelledby="exam-questions-heading">
            <SectionHeading n={num.exam} id="exam-questions">
              Exam-style questions
            </SectionHeading>
            <p className="leading-[1.7]">Written in the style and mark tariff of the real papers, with mark schemes.</p>
            <div className="mt-2">
              {topic.examQuestions.map((q, i) => (
                <TexExample
                  key={q.id}
                  id={q.id}
                  label={`Question ${num.exam}.${i + 1}`}
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

          <section id="mistakes" className="scroll-mt-24 py-6" aria-labelledby="mistakes-heading">
            <SectionHeading n={num.mistakes} id="mistakes">
              Common mistakes
            </SectionHeading>
            <ol className="mt-2">
              {topic.mistakes.map((m, i) => (
                <li key={i} className="border-t border-[color:var(--border)] py-3 leading-[1.7] first:border-t-0">
                  <p>
                    <span className="tex-label">
                      {num.mistakes}.{i + 1}&ensp;Error.
                    </span>{" "}
                    <T>{m.wrong}</T>
                  </p>
                  <p className="mt-1">
                    <span className="tex-italic-label">Why it is wrong.</span> <T>{m.why}</T>
                  </p>
                  <p className="mt-1">
                    <span className="tex-italic-label">Correction.</span> <T>{m.fix}</T>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section id="tips" className="scroll-mt-24 py-6" aria-labelledby="tips-heading">
            <SectionHeading n={num.tips} id="tips">
              Exam tips
            </SectionHeading>
            <ol className="ml-7 list-[lower-roman] space-y-1.5">
              {topic.tips.map((tip, i) => (
                <li key={i} className="pl-1 leading-[1.7]">
                  <T>{tip}</T>
                </li>
              ))}
            </ol>
          </section>

          <section id="practice" className="scroll-mt-24 py-6" aria-labelledby="practice-heading">
            <SectionHeading n={num.practice} id="practice">
              Practice
            </SectionHeading>
            <p className="leading-[1.7]">
              {topic.generators.length > 0
                ? `${topic.generators.length} question templates for this topic, each with randomised numbers, instant marking and a full worked solution.`
                : "Practise this topic inside a mixed set, alongside the topics that use it."}{" "}
              <Link href={`/practice/?topic=${topic.slug}`} className="link">
                Start practising
              </Link>{" "}
              or{" "}
              <Link href="/exam/" className="link">
                take a timed paper
              </Link>
              .
            </p>
          </section>

          <nav aria-label="Previous and next topic" className="flex flex-wrap justify-between gap-3 border-t border-[color:var(--rule)] pt-5">
            {prev ? (
              <Link href={`/topics/${prev.slug}/`} className="link">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/topics/${next.slug}/`} className="link text-right">
                {next.title} →
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
