import type { Metadata } from "next";
import Link from "next/link";
import { Blocks } from "@/components/Blocks";
import { PageHeader } from "@/components/ui";
import type { Block } from "@/lib/types";

export const metadata: Metadata = {
  title: "Exam technique",
  description:
    "How marks are actually awarded in IGCSE Additional Mathematics 0606: method marks, “show that” questions, accuracy, timing, and the habits worth several grades.",
};

const SECTIONS: { id: string; heading: string; body: Block[] }[] = [
  {
    id: "how-marks-work",
    heading: "How the marks are actually awarded",
    body: [
      {
        k: "p",
        t: "Cambridge marks in two currencies. **Method marks (M)** are for a correct approach, and you keep them even if the arithmetic goes wrong. **Accuracy marks (A)** are for the right number, and they usually depend on the method mark before them. A third kind, **B marks**, are independent — awarded for a specific correct statement regardless of what surrounds it.",
      },
      {
        k: "note",
        tone: "key",
        title: "The one consequence that matters",
        t: "A correct answer with no working can score 1 mark out of 5. Wrong arithmetic with clear, correct method can score 4 out of 5. **Always show the method.** The syllabus says it outright: “Candidates must show all necessary working.”",
      },
      {
        k: "ul",
        items: [
          "Write the formula you are using **before** substituting into it.",
          "Show the substitution line in full — this is usually where the method mark lives.",
          "Never erase working that led nowhere; cross it out with one line. Uncrossed working is marked, crossed-out working is ignored, and erased working cannot earn anything.",
          "If you get a wrong answer in part (a), carry it into part (b) anyway. **Follow-through marks** exist for exactly this.",
        ],
      },
    ],
  },
  {
    id: "command-words",
    heading: "What each command word demands",
    body: [
      {
        k: "table",
        head: ["Command", "What it means", "What loses the marks"],
        rows: [
          ["**Show that**", "The answer is given; you must produce the argument that reaches it.", "Working backwards from the given answer, or leaping steps."],
          ["**Hence**", "You must use the previous part. It is not optional.", "Starting again from scratch — often unmarked even when correct."],
          ["**Hence or otherwise**", "The previous part is the intended route, but any valid method scores.", "Nothing, if the method is sound."],
          ["**Exact**", "Leave $\\pi$, $e$, surds and logarithms in the answer.", "Writing 2.618 instead of $\\frac{3+\\sqrt5}{2}$."],
          ["**Explain / justify**", "Words are required, using the right technical terms.", "Only algebra, with no sentence."],
          ["**State / write down**", "No working needed; the answer alone is enough.", "Wasting minutes deriving something worth one mark."],
          ["**Sketch**", "Shape, intercepts, asymptotes and turning points, labelled.", "An unlabelled curve, or graph paper accuracy that was never asked for."],
          ["**Draw**", "An accurate graph, to scale, on the grid provided.", "A freehand sketch when accuracy was required."],
        ],
      },
      {
        k: "note",
        tone: "warn",
        t: "In a “show that” question, the answer is printed for you. That means the marks are entirely for the argument — so a solution that ends at the right place by an invalid route scores nothing.",
      },
    ],
  },
  {
    id: "accuracy",
    heading: "Accuracy and rounding",
    body: [
      {
        k: "ul",
        items: [
          "Unless told otherwise, give answers to **3 significant figures**, or **1 decimal place for angles in degrees**.",
          "Keep full accuracy in the calculator throughout, and round only at the very end. Rounding intermediate values is the commonest source of a lost accuracy mark.",
          "On Paper 1 (no calculator) the expected answer is exact: $\\frac{\\pi}{6}$, $3\\sqrt2$, $\\ln 5$, $\\frac{7}{12}$.",
          "Match the units to the question: cm³ s⁻¹, m s⁻², square units. A bare number can lose a mark.",
          "Money to 2 decimal places; a count of people or years to a whole number, rounded the way the context requires.",
        ],
      },
      {
        k: "note",
        tone: "tip",
        title: "Radian mode",
        t: "Any question with $\\pi$ in the interval, or any calculus involving trigonometry, is in radians. Set the mode at the start of the paper and check it with $\\sin\\frac{\\pi}{2} = 1$.",
      },
    ],
  },
  {
    id: "timing",
    heading: "Timing",
    body: [
      {
        k: "p",
        t: "Two hours for 80 marks is **90 seconds per mark**. That is the only timing rule you need, and it converts directly: a 6-mark question deserves about nine minutes, and if you are past fifteen you are losing marks elsewhere.",
      },
      {
        k: "ol",
        items: [
          "Spend the first two minutes reading through and marking the questions you can do immediately.",
          "Do those first. Easy marks are worth exactly as much as hard ones.",
          "If you are stuck for more than two minutes, leave a gap and move on. Come back with fresh eyes.",
          "Reserve the last ten minutes for checking: units, rounding, and whether you answered the question that was asked.",
        ],
      },
      {
        k: "note",
        tone: "warn",
        t: "Never leave a question blank. Write the relevant formula, or set up the equation you would solve. An unattempted question scores zero with certainty; an attempted one often earns a method mark.",
      },
    ],
  },
  {
    id: "checking",
    heading: "Checking your work",
    body: [
      {
        k: "ul",
        items: [
          "**Substitute back.** Roots of an equation, solutions of a simultaneous pair, and the constant in an integration can all be verified in seconds.",
          "**Differentiate your integral.** If it does not return the integrand, something is wrong.",
          "**Sanity-check the size.** A probability above 1, a negative length, an angle over $360^\\circ$ or a sine outside $[-1,1]$ all mean an error upstream.",
          "**Re-read the question.** Did it ask for $x$, or for the maximum volume? For distance, or displacement? For the number of terms, or the sum?",
          "**Check the domain.** Reject roots that make a logarithm undefined, a square root negative, or a length impossible — and say why you rejected them.",
        ],
      },
    ],
  },
  {
    id: "presentation",
    heading: "Presentation",
    body: [
      {
        k: "ul",
        items: [
          "One line per step, working down the page. A marker who cannot follow your work cannot award your method marks.",
          "Use correct notation: $\\frac{\\mathrm{d}y}{\\mathrm{d}x}$ not $dy/dx$ scrawled; $f^{-1}(x)$ not $f^{-1}$ alone; $\\Rightarrow$ between statements that follow from each other.",
          "Label your answer clearly, or box it. Do not leave the marker guessing which of three numbers is your final one.",
          "Draw diagrams. Coordinate geometry, vectors, circular measure and area questions all become easier with a picture, and a diagram is never penalised.",
        ],
      },
      {
        k: "note",
        tone: "key",
        title: "The last minute of every question",
        t: "Read the question again and ask three things: did I answer what was asked, in the right units, to the right accuracy? Those three checks recover more marks than any amount of extra revision.",
      },
    ],
  },
];

export default function ExamTechniquePage() {
  return (
    <>
      <PageHeader
        eyebrow="Exam technique"
        title="Earning the marks you have already worked for"
        lead="Most students lose more marks to technique than to mathematics. This page is the difference between knowing the content and being paid for it."
      />
      <div className="gap-10 lg:flex">
        <nav aria-label="On this page" className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24 py-9">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              On this page
            </p>
            <ul className="space-y-1.5 border-l border-[color:var(--border)]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-[0.82rem] text-[color:var(--text-muted)] hover:text-[color:var(--text)]">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="min-w-0 flex-1 py-9">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-b border-[color:var(--border)] py-8 last:border-0">
              <h2 className="mb-4 text-xl font-bold sm:text-2xl">{s.heading}</h2>
              <Blocks blocks={s.body} />
            </section>
          ))}
          <div className="pt-4">
            <Link href="/exam/" className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-[color:var(--accent-contrast)]">
              Put it into practice — sit a timed paper
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
