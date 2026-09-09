import type { Metadata } from "next";
import Link from "next/link";
import { TOPICS } from "@/content/topics";
import { CAMBRIDGE_UNITS } from "@/lib/content";
import { T } from "@/components/Math";
import { Callout, Chip, PageHeader } from "@/components/ui";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Syllabus and coverage audit",
  description:
    "Every objective of the Cambridge IGCSE Additional Mathematics 0606 syllabus for 2025–2027, mapped to the page that covers it.",
};

/** Topics students often expect to find in 0606 but which the syllabus excludes. */
const NOT_EXAMINED: { item: string; why: string }[] = [
  { item: "Numerical methods (Newton–Raphson, trapezium rule, iteration)", why: "Not in the 0606 subject content. It belongs to A Level Mathematics." },
  { item: "Integration by parts and by substitution", why: "Not required. Questions that need such an integral supply a derivative to reverse instead." },
  { item: "Differentiation from first principles", why: "Explicitly excluded by 14.1 — only an informal idea of a limit is expected." },
  { item: "Points of inflexion", why: "Explicitly excluded by 14.6 and 14.9." },
  { item: "Circular arrangements and repeated objects in counting", why: "Explicitly excluded by 11.3, along with problems mixing permutations and combinations." },
  { item: "Compound and double angle formulas", why: "Not in the 0606 identity list; only the three Pythagorean identities and the quotient relations are used." },
  { item: "Three-dimensional vectors, scalar product", why: "Unit 13 is vectors in **two** dimensions only." },
  { item: "Series expansions of $e^x$ and $\\ln(1+x)$", why: "Explicitly excluded by 6.1." },
  { item: "Proof by induction, matrices, complex numbers", why: "None appear in the 0606 subject content." },
];

export default function SyllabusPage() {
  const objectives = TOPICS.reduce((n, t) => n + t.syllabus.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="Syllabus"
        title={`The 0606 syllabus, objective by objective`}
        lead={`All fourteen Cambridge units for ${SITE.syllabusYears}, with every learning objective mapped to the page that teaches it. ${objectives} objectives, nothing left out.`}
      />

      <div className="py-9">
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Paper 1", body: "2 hours · 80 marks · 50% · no calculator" },
            { label: "Paper 2", body: "2 hours · 80 marks · 50% · scientific calculator" },
            { label: "Grades", body: "A* to E available. F and G are not; below E is unclassified." },
          ].map((c) => (
            <div key={c.label} className="card p-5">
              <p className="text-sm font-semibold">{c.label}</p>
              <p className="muted mt-1 text-sm leading-relaxed">{c.body}</p>
            </div>
          ))}
        </section>

        <section className="py-9">
          <h2 className="text-xl font-bold sm:text-2xl">Coverage audit</h2>
          <p className="muted mt-1.5 max-w-2xl">
            Each Cambridge unit and the site pages that cover it. Knowledge of Cambridge IGCSE
            Mathematics is assumed throughout — content such as surds and indices is not tested
            directly but is needed to answer questions on other topics, which is why it has a page
            of its own here.
          </p>

          <div className="mt-6 space-y-4">
            {CAMBRIDGE_UNITS.map((unit) => {
              const covering = TOPICS.filter((t) => t.unit === unit.n);
              return (
                <div key={unit.n} className="card p-5">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-xs font-bold tabular-nums text-[color:var(--accent)]">
                      {unit.n}
                    </span>
                    <h3 className="font-semibold">{unit.name}</h3>
                    <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[color:var(--easy)]">
                      ✓ covered
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {covering.map((t) => (
                      <Link key={t.slug} href={`/topics/${t.slug}/`}>
                        <Chip tone="accent">{t.title}</Chip>
                      </Link>
                    ))}
                  </div>
                  <ul className="mt-4 space-y-2">
                    {covering.flatMap((t) =>
                      t.syllabus.map((s) => (
                        <li key={t.slug + s.code} className="flex gap-3 text-sm leading-relaxed">
                          <Link
                            href={`/topics/${t.slug}/`}
                            className="mt-0.5 shrink-0 rounded-md bg-[color:var(--bg-soft)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
                          >
                            {s.code}
                          </Link>
                          <span>
                            <T>{s.text}</T>
                            {s.notes && (
                              <span className="muted block text-xs">
                                <T>{s.notes}</T>
                              </span>
                            )}
                          </span>
                        </li>
                      )),
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className="py-9">
          <h2 className="text-xl font-bold sm:text-2xl">Assumed knowledge</h2>
          <div className="mt-4">
            {TOPICS.filter((t) => t.unit === 0).map((t) => (
              <div key={t.slug} className="card p-5">
                <Link href={`/topics/${t.slug}/`} className="font-semibold hover:text-[color:var(--accent)]">
                  {t.title}
                </Link>
                <p className="muted mt-1.5 text-sm leading-relaxed">{t.blurb}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-9">
          <h2 className="text-xl font-bold sm:text-2xl">What is <em>not</em> examined</h2>
          <p className="muted mt-1.5 max-w-2xl">
            Just as useful as knowing what is on the syllabus. Every item below is either absent
            from the 0606 subject content or explicitly excluded by it.
          </p>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {NOT_EXAMINED.map((n) => (
              <li key={n.item} className="card p-4">
                <p className="text-sm font-medium">
                  <T>{n.item}</T>
                </p>
                <p className="muted mt-1 text-sm leading-relaxed">
                  <T>{n.why}</T>
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Callout title="A note on sources">
              Objective wording is summarised from the published Cambridge IGCSE Additional
              Mathematics 0606 syllabus for {SITE.syllabusYears}. Always check the official document
              on the Cambridge International website for the definitive version, and confirm the
              syllabus year with your school.
            </Callout>
          </div>
        </section>
      </div>
    </>
  );
}
