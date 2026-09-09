import Link from "next/link";
import { SITE } from "@/lib/site";
import { siteStats, topicsByUnit } from "@/lib/content";
import { GENERATORS } from "@/lib/questions";
import { Chip } from "@/components/ui";
import { M } from "@/components/Math";

export default function HomePage() {
  const stats = siteStats();
  const groups = topicsByUnit();

  return (
    <>
      <section className="relative isolate -mx-4 overflow-hidden px-4 pb-14 pt-14 sm:-mx-6 sm:px-6 sm:pt-20">
        <div
          aria-hidden
          className="grid-fade absolute inset-0 -z-10 opacity-[0.55] dark:opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="mx-auto max-w-3xl text-center">
          <p className="fade-up mb-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3.5 py-1.5 text-xs font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" aria-hidden />
            Cambridge IGCSE 0606 · syllabus for {SITE.syllabusYears}
          </p>
          <h1 className="fade-up text-[2.1rem] font-bold leading-[1.1] tracking-tight sm:text-[3.3rem]">
            Everything you need to master{" "}
            <span className="bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--olympiad)] bg-clip-text text-transparent">
              IGCSE Additional Mathematics
            </span>
          </h1>
          <p className="fade-up muted mx-auto mt-5 max-w-2xl text-[1.05rem] leading-relaxed sm:text-[1.15rem]">
            Complete notes for all fourteen Cambridge topics, worked solutions
            that show the reasoning, an endless supply of generated practice
            questions marked instantly, and a timed exam simulator that tells
            you exactly where the marks are going.
          </p>
          <div className="fade-up mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/topics/"
              className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-[color:var(--accent-contrast)] shadow-sm transition hover:opacity-90"
            >
              Start with the topics
            </Link>
            <Link
              href="/practice/"
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] px-5 py-3 text-sm font-semibold transition hover:border-[color:var(--accent)]/50"
            >
              Generate practice questions
            </Link>
          </div>
          <p className="muted fade-up mt-4 text-xs">
            Free, no sign-up, works offline once loaded. Progress stays in your browser.
          </p>
        </div>

        <dl className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Topic guides", value: stats.topics },
            { label: "Syllabus objectives covered", value: stats.objectives },
            { label: "Worked solutions", value: stats.examples + stats.examQuestions },
            { label: "Question generators", value: GENERATORS.length },
          ].map((s) => (
            <div key={s.label} className="card px-4 py-5 text-center">
              <dt className="muted order-2 mt-1 block text-xs leading-snug">{s.label}</dt>
              <dd className="text-2xl font-bold tabular-nums text-[color:var(--accent)]">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="py-10">
        <h2 className="text-xl font-bold sm:text-2xl">Built for the way the exam actually works</h2>
        <p className="muted mt-2 max-w-2xl">
          Two papers, two hours each, eighty marks each — one without a
          calculator and one with. Everything here is organised around that.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <Link key={f.href} href={f.href} className="card group p-5 transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-[color:var(--accent)]">
                {f.icon}
              </div>
              <h3 className="font-semibold group-hover:text-[color:var(--accent)]">{f.title}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{f.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">The whole course</h2>
            <p className="muted mt-2 max-w-2xl">
              Every Cambridge unit, split into pages you can finish in one
              sitting. Each page runs from the idea to the exam question.
            </p>
          </div>
          <Link href="/syllabus/" className="link text-sm">
            See the syllabus audit
          </Link>
        </div>
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <div key={g.unit}>
              <h3 className="mb-2.5 flex items-center gap-2.5 text-sm font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--bg-soft)] text-[11px] tabular-nums text-[color:var(--text-muted)]">
                  {g.unit === 0 ? "—" : g.unit}
                </span>
                {g.name}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.topics.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/topics/${t.slug}/`}
                    className="card group p-4 transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50"
                  >
                    <h4 className="text-[0.95rem] font-semibold group-hover:text-[color:var(--accent)]">{t.title}</h4>
                    <p className="muted mt-1 text-[0.83rem] leading-relaxed">{t.blurb}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Chip>{t.estimatedMinutes} min</Chip>
                      <Chip>{t.examples.length + t.examQuestions.length} solutions</Chip>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card my-10 overflow-hidden p-6 sm:p-9">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
              Solutions, not answers
            </p>
            <h2 className="text-xl font-bold sm:text-2xl">Every step, with the reason for it</h2>
            <p className="muted mt-3 leading-relaxed">
              A final answer teaches nothing. Every worked example and every
              generated question comes with the full argument: what to do, and
              why that is the move — including the sign choices and domain
              checks that quietly decide most marks.
            </p>
            <Link href="/examples/" className="link mt-4 inline-block text-sm font-medium">
              Browse the worked examples →
            </Link>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-5">
            <p className="muted mb-3 text-xs font-semibold uppercase tracking-wider">Example step</p>
            <p className="text-sm leading-relaxed">
              Take the square root. Because the domain is <M>{"x \\ge 4"}</M>, the
              bracket is non-negative, so only the positive root is valid:
            </p>
            <div className="mt-3 rounded-lg bg-[color:var(--bg-card)] px-4 py-3">
              <M>{"x - 4 = +\\sqrt{y - 5} \\quad\\Longrightarrow\\quad f^{-1}(x) = 4 + \\sqrt{x-5}"}</M>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const FEATURES = [
  {
    href: "/practice/",
    title: "Practice that never repeats",
    body: "Pick a topic and a difficulty and the generator builds fresh questions from parameterised templates, marks them instantly and shows the full solution.",
    icon: "∑",
  },
  {
    href: "/exam/",
    title: "Timed exam simulator",
    body: "A full paper against the clock, with question navigation, marking, time-per-question analysis and a topic-by-topic breakdown at the end.",
    icon: "⏱",
  },
  {
    href: "/formulas/",
    title: "Formula sheet that tells the truth",
    body: "Which formulas Cambridge prints on page 2, and — more importantly — which ones you have to know by heart. Calculus gets nothing.",
    icon: "ƒ",
  },
  {
    href: "/progress/",
    title: "Progress and weak areas",
    body: "Accuracy by topic and by difficulty, a retry queue of everything you got wrong, and a clear answer to “what should I revise next?”.",
    icon: "◔",
  },
  {
    href: "/tools/",
    title: "Interactive tools",
    body: "A graph plotter, quadratic and discriminant solver, binomial term finder, radian converter, differentiator and more.",
    icon: "⚙",
  },
  {
    href: "/exam-technique/",
    title: "Exam technique",
    body: "How marks are awarded, what “show that” demands, when to leave answers exact, and the small habits worth several grades.",
    icon: "✓",
  },
];
