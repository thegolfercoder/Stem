import type { Metadata } from "next";
import Link from "next/link";
import { TOPICS } from "@/content/topics";
import { M, T } from "@/components/Math";
import { PageHeader, Callout } from "@/components/ui";

export const metadata: Metadata = {
  title: "Formula sheet",
  description:
    "Every formula for IGCSE Additional Mathematics 0606 in one place, marked by whether Cambridge prints it on the exam paper or expects you to know it.",
};

/** The formulas Cambridge prints on page 2 of both papers, quoted from the syllabus. */
const GIVEN_LIST: { name: string; latex: string }[] = [
  { name: "Equation of a circle", latex: "(x-a)^2 + (y-b)^2 = r^2" },
  { name: "Curved surface area of a cone", latex: "A = \\pi r l" },
  { name: "Surface area of a sphere", latex: "A = 4\\pi r^2" },
  { name: "Volume of a pyramid or cone", latex: "V = \\tfrac13 A h" },
  { name: "Volume of a sphere", latex: "V = \\tfrac43 \\pi r^3" },
  { name: "Quadratic equation", latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" },
  { name: "Binomial theorem", latex: "(a+b)^n = a^n + \\binom n1 a^{n-1}b + \\cdots + \\binom nr a^{n-r}b^r + \\cdots + b^n" },
  { name: "Binomial coefficient", latex: "\\binom{n}{r} = \\frac{n!}{(n-r)!\\,r!}" },
  { name: "Arithmetic series", latex: "u_n = a + (n-1)d, \\qquad S_n = \\tfrac{n}{2}(a+l) = \\tfrac{n}{2}\\left[2a + (n-1)d\\right]" },
  { name: "Geometric series", latex: "u_n = ar^{n-1}, \\qquad S_n = \\frac{a(1-r^n)}{1-r}, \\qquad S_\\infty = \\frac{a}{1-r} \\ (|r|<1)" },
  { name: "Identity", latex: "\\sin^2 A + \\cos^2 A = 1" },
  { name: "Identity", latex: "\\sec^2 A = 1 + \\tan^2 A" },
  { name: "Identity", latex: "\\operatorname{cosec}^2 A = 1 + \\cot^2 A" },
  { name: "Sine rule", latex: "\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}" },
  { name: "Cosine rule", latex: "a^2 = b^2 + c^2 - 2bc\\cos A" },
  { name: "Area of a triangle", latex: "\\Delta = \\tfrac12 ab \\sin C" },
];

export default function FormulasPage() {
  const learn = TOPICS.flatMap((t) =>
    t.formulas.filter((f) => !f.given).map((f) => ({ ...f, topic: t })),
  );

  return (
    <>
      <PageHeader
        eyebrow="Formula sheet"
        title="What you are given, and what you must know"
        lead="Cambridge prints a List of formulas on page 2 of both papers. It is shorter than most students assume — and it contains nothing at all for the calculus section."
      />

      <div className="py-9">
        <Callout tone="accent" title="The rule that catches people out">
          The syllabus is explicit: “No formulas will be given in the List of formulas for the
          Calculus section.” Every derivative, every integral, and every formula for arc length,
          sector area and circular measure must be memorised.
        </Callout>

        <section className="py-9">
          <h2 className="text-xl font-bold sm:text-2xl">Given on the paper</h2>
          <p className="muted mt-1.5">
            Reproduced from the published 0606 syllabus for 2025–2027. You do not need to learn
            these — but you do need to know they are there.
          </p>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {GIVEN_LIST.map((f, i) => (
              <li key={i} className="card p-4">
                <p className="muted mb-1.5 text-xs font-medium uppercase tracking-wide">{f.name}</p>
                <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={f.name}>
                  <M>{f.latex}</M>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="py-9">
          <h2 className="text-xl font-bold sm:text-2xl">
            Not given — learn these ({learn.length})
          </h2>
          <p className="muted mt-1.5">
            Grouped by topic. These are the ones worth writing out from memory the morning of the
            exam.
          </p>
          <div className="mt-6 space-y-8">
            {TOPICS.map((topic) => {
              const own = topic.formulas.filter((f) => !f.given);
              if (!own.length) return null;
              return (
                <div key={topic.slug}>
                  <h3 className="mb-3 flex items-baseline gap-2 border-b border-[color:var(--border)] pb-1.5">
                    <Link href={`/topics/${topic.slug}/`} className="font-semibold hover:text-[color:var(--accent)]">
                      {topic.title}
                    </Link>
                    <span className="muted text-xs">{own.length} formulas</span>
                  </h3>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {own.map((f) => (
                      <li key={f.name + f.latex} className="card p-4">
                        <p className="muted mb-1.5 text-xs font-medium uppercase tracking-wide">{f.name}</p>
                        <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={f.name}>
                          <M>{f.latex}</M>
                        </div>
                        {f.note && (
                          <p className="muted mt-1.5 text-xs">
                            <T>{f.note}</T>
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
