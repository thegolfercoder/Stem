import Link from "next/link";
import { SITE } from "@/lib/site";
import { siteStats, topicsByUnit } from "@/lib/content";
import { GENERATORS } from "@/lib/questions";
import { questionTypes } from "@/lib/questions/gallery";
import { TOPICS } from "@/content/topics";
import { MD } from "@/components/Math";

export default function HomePage() {
  const stats = siteStats();
  const groups = topicsByUnit();
  const typeCount = TOPICS.reduce(
    (n, t) => n + questionTypes(t.generators).reduce((m, q) => m + q.instances.length, 0),
    0,
  );

  return (
    <>
      <header className="mx-auto max-w-3xl border-b border-[color:var(--rule)] pb-8 pt-12 text-center">
        <h1 className="text-[2rem] font-bold leading-tight sm:text-[2.6rem]">Additional Mathematics</h1>
        <p className="mt-2 text-[1.15rem]">A complete course for Cambridge IGCSE 0606</p>
        <p className="smallcaps mt-1 text-[color:var(--text-muted)]">syllabus for {SITE.syllabusYears}</p>
        <div className="mx-auto mt-7 max-w-2xl text-left">
          <p className="text-center text-sm font-bold">Abstract</p>
          <p className="mt-1 leading-[1.7]" style={{ textAlign: "justify" }}>
            These notes cover all fourteen units of the syllabus in {stats.topics} topics. Each topic gives the
            theory, worked examples from first principles to olympiad level, a worked instance of every type of
            question the practice engine sets, exam-style questions with mark schemes, and the errors that cost
            the most marks. Practice questions are generated afresh, marked at once and solved in full. Nothing
            is sent anywhere: progress stays in your browser.
          </p>
        </div>
        <p className="mt-6">
          <Link href="/topics/" className="link">
            Contents
          </Link>
          {" · "}
          <Link href="/practice/" className="link">
            Practice
          </Link>
          {" · "}
          <Link href="/exam/" className="link">
            Timed paper
          </Link>
          {" · "}
          <Link href="/formulas/" className="link">
            Formulas
          </Link>
        </p>
      </header>

      <section className="mx-auto max-w-3xl py-8" aria-labelledby="inventory">
        <h2 id="inventory" className="sr-only">
          What the course contains
        </h2>
        <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="What the course contains">
          <table className="mx-auto w-full max-w-md border-collapse text-left">
            <caption className="caption-bottom pt-2 text-center text-sm">
              <span className="tex-label">Table 1.</span> What the course contains.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-6 font-semibold">Item</th>
                <th scope="col" className="py-1 text-right font-semibold">Count</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Topics", stats.topics],
                ["Syllabus objectives", stats.objectives],
                ["Written worked examples and exam questions", stats.examples + stats.examQuestions],
                ["Question templates", GENERATORS.length],
                ["Worked instances, one per question type and method", typeCount],
              ].map(([label, value]) => (
                <tr key={label as string}>
                  <td className="py-1 pr-6">{label}</td>
                  <td className="py-1 text-right tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-3xl py-4" aria-labelledby="contents">
        <h2 id="contents" className="mb-3 text-[1.35rem] font-bold">
          Contents
        </h2>
        <ol className="space-y-4">
          {groups.map((g) => (
            <li key={g.unit}>
              <p className="font-bold">
                {g.unit === 0 ? "0" : g.unit}&ensp;{g.name}
              </p>
              <ol className="mt-1 space-y-0.5 pl-8">
                {g.topics.map((t) => (
                  <li key={t.slug} className="flex items-baseline gap-2">
                    <Link href={`/topics/${t.slug}/`} className="link">
                      {t.title}
                    </Link>
                    <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-[color:var(--border)]" />
                    <span className="shrink-0 text-sm tabular-nums text-[color:var(--text-muted)]">
                      {t.estimatedMinutes} min
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl py-8" aria-labelledby="method">
        <h2 id="method" className="mb-3 text-[1.35rem] font-bold">
          How the solutions are written
        </h2>
        <p className="leading-[1.7]" style={{ textAlign: "justify" }}>
          Every solution gives each step with the reason for it, including the sign choices and domain checks that
          decide most marks. For instance, when inverting a quadratic restricted to <i>x</i> ≥ 4, the step reads:
        </p>
        <p className="mt-3 leading-[1.7]">
          <span className="tex-italic-label">Take the square root.</span> Because the domain is <i>x</i> ≥ 4, the
          bracket is non-negative, so only the positive root is valid:
        </p>
        <MD className="my-3">{"x - 4 = +\\sqrt{y - 5} \\quad\\Longrightarrow\\quad f^{-1}(x) = 4 + \\sqrt{x-5}"}</MD>
        <p className="leading-[1.7]">
          See the{" "}
          <Link href="/examples/" className="link">
            index of worked examples
          </Link>
          , the{" "}
          <Link href="/exam-technique/" className="link">
            notes on exam technique
          </Link>
          , and the{" "}
          <Link href="/tools/" className="link">
            calculators
          </Link>
          .
        </p>
      </section>
    </>
  );
}
