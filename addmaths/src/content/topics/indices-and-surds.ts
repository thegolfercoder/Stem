import type { Topic } from "@/lib/types";

export const indicesAndSurds: Topic = {
  slug: "indices-and-surds",
  unit: 0,
  title: "Indices and surds",
  short: "Indices & surds",
  blurb:
    "Assumed from IGCSE Mathematics and never tested on its own — but it decides whether the rest of the paper goes smoothly.",
  syllabus: [
    {
      code: "—",
      text: "Cambridge states that IGCSE Mathematics content not in the 0606 subject content, **such as surds and indices**, will not be tested directly but may be required in response to questions on other topics.",
      notes: "Syllabus for 2025–2027, Subject content, opening paragraphs.",
    },
  ],
  prerequisites: [],
  estimatedMinutes: 45,
  sections: [
    {
      id: "index-laws",
      heading: "The index laws",
      body: [
        { k: "p", t: "Six rules, and everything else follows from them." },
        {
          k: "table",
          head: ["Law", "Statement", "Example"],
          rows: [
            ["Multiplication", "$a^m \\times a^n = a^{m+n}$", "$x^3 \\times x^5 = x^8$"],
            ["Division", "$a^m \\div a^n = a^{m-n}$", "$\\dfrac{x^7}{x^2} = x^5$"],
            ["Power of a power", "$\\left(a^m\\right)^n = a^{mn}$", "$\\left(x^4\\right)^3 = x^{12}$"],
            ["Zero index", "$a^0 = 1$ for $a \\ne 0$", "$7^0 = 1$"],
            ["Negative index", "$a^{-n} = \\dfrac{1}{a^n}$", "$x^{-2} = \\dfrac{1}{x^2}$"],
            ["Fractional index", "$a^{m/n} = \\sqrt[n]{a^m}$", "$8^{2/3} = \\left(\\sqrt[3]{8}\\right)^2 = 4$"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "Read a fractional index right to left",
          t: "For $a^{m/n}$, take the **root first** and then the power: $32^{3/5} = \\left(\\sqrt[5]{32}\\right)^3 = 2^3 = 8$. Doing the power first gives $32^3 = 32768$, which is far harder to root by hand.",
        },
        {
          k: "note",
          tone: "warn",
          t: "$\\left(2x\\right)^3 = 8x^3$, not $2x^3$: the index applies to everything inside the bracket. And $(a+b)^2 \\ne a^2 + b^2$ — there is no index law for a sum.",
        },
      ],
    },
    {
      id: "index-equations",
      heading: "Equations with indices",
      body: [
        {
          k: "p",
          t: "If both sides can be written with the **same base**, the indices must be equal. This is the standard non-calculator method.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $9^{x+1} = 27^{x-1}$. Rewrite both sides in base 3.", m: "\\left(3^2\\right)^{x+1} = \\left(3^3\\right)^{x-1}" },
            { t: "Apply the power-of-a-power law.", m: "3^{2x+2} = 3^{3x-3}" },
            { t: "Equate the indices.", m: "2x + 2 = 3x - 3" },
            { t: "Solve.", m: "x = 5" },
          ],
        },
        {
          k: "p",
          t: "When the bases cannot be matched, take logarithms — that is unit 6's job, and the two topics meet constantly.",
        },
      ],
    },
    {
      id: "surds",
      heading: "Surds",
      body: [
        {
          k: "p",
          t: "A **surd** is an irrational root left in exact form. On the non-calculator paper, exact form is the required answer: $3\\sqrt{2}$, not $4.24$.",
        },
        {
          k: "ul",
          items: [
            "$\\sqrt{a}\\times\\sqrt{b} = \\sqrt{ab}$ and $\\dfrac{\\sqrt a}{\\sqrt b} = \\sqrt{\\dfrac ab}$.",
            "**Simplify** by pulling out square factors: $\\sqrt{50} = \\sqrt{25 \\times 2} = 5\\sqrt2$.",
            "There is no rule for $\\sqrt{a+b}$ — it is **not** $\\sqrt a + \\sqrt b$. Test it: $\\sqrt{9+16}=5$ but $3+4=7$.",
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "Rationalising the denominator",
          t: "Multiply top and bottom by the **conjugate**: for $\\dfrac{1}{a+\\sqrt b}$ use $a - \\sqrt b$, because $(a+\\sqrt b)(a - \\sqrt b) = a^2 - b$ contains no surd.",
        },
        {
          k: "steps",
          items: [
            { t: "Rationalise $\\dfrac{6}{4 - \\sqrt{7}}$. Multiply top and bottom by the conjugate $4+\\sqrt7$.", m: "\\frac{6}{4-\\sqrt7} \\times \\frac{4+\\sqrt7}{4+\\sqrt7}" },
            { t: "The denominator is a difference of two squares.", m: "(4-\\sqrt7)(4+\\sqrt7) = 16 - 7 = 9" },
            { t: "Expand the numerator.", m: "\\frac{24 + 6\\sqrt7}{9}" },
            { t: "Divide through by the common factor 3.", m: "= \\frac{8 + 2\\sqrt7}{3}" },
          ],
        },
      ],
    },
    {
      id: "why-it-matters",
      heading: "Where this shows up in 0606",
      body: [
        {
          k: "ul",
          items: [
            "**Differentiation**: $\\sqrt{x} = x^{1/2}$ and $\\dfrac{1}{x^3} = x^{-3}$ must be converted before the power rule can be used.",
            "**Integration**: the same conversion, in reverse, and $\\int \\frac{1}{\\sqrt x}\\,\\mathrm{d}x$ is impossible until you write it as $x^{-1/2}$.",
            "**Quadratics**: exact roots like $\\dfrac{3 \\pm \\sqrt5}{2}$ are the expected answers on Paper 1.",
            "**Logarithms**: $\\log_a a^n = n$ relies on recognising powers of the base.",
            "**Coordinate geometry**: lengths come out as $\\sqrt{40} = 2\\sqrt{10}$, and the simplified form is expected.",
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Product and quotient", latex: "a^m a^n = a^{m+n}, \\qquad \\frac{a^m}{a^n} = a^{m-n}", given: false },
    { name: "Power of a power", latex: "\\left(a^m\\right)^n = a^{mn}", given: false },
    { name: "Negative and fractional indices", latex: "a^{-n} = \\frac{1}{a^n}, \\qquad a^{m/n} = \\left(\\sqrt[n]{a}\\right)^m", given: false },
    { name: "Surd products", latex: "\\sqrt{a}\\sqrt{b} = \\sqrt{ab}", given: false },
    { name: "Conjugate", latex: "(a+\\sqrt b)(a-\\sqrt b) = a^2 - b", given: false },
  ],
  examples: [
    {
      id: "ind-ex1",
      title: "Evaluating a fractional index",
      difficulty: "easy",
      prompt: "Evaluate $\\left(\\dfrac{16}{81}\\right)^{-3/4}$ without a calculator.",
      steps: [
        { t: "A negative index means take the reciprocal.", m: "\\left(\\frac{81}{16}\\right)^{3/4}" },
        { t: "Take the fourth root first: $81 = 3^4$ and $16 = 2^4$.", m: "\\left(\\frac{3}{2}\\right)^{3}" },
        { t: "Now cube.", m: "= \\frac{27}{8}" },
      ],
      answer: "$\\dfrac{27}{8}$",
    },
    {
      id: "ind-ex2",
      title: "Same-base index equation",
      difficulty: "medium",
      prompt: "Solve $2^{3x} \\times 4^{x-1} = 8^{x+2}$.",
      steps: [
        { t: "Write every base as a power of 2.", m: "2^{3x} \\times \\left(2^2\\right)^{x-1} = \\left(2^3\\right)^{x+2}" },
        { t: "Apply the power law inside each bracket.", m: "2^{3x} \\times 2^{2x-2} = 2^{3x+6}" },
        { t: "Add indices on the left.", m: "2^{5x-2} = 2^{3x+6}" },
        { t: "Equate the indices.", m: "5x - 2 = 3x + 6" },
        { t: "Solve.", m: "2x = 8 \\;\\Rightarrow\\; x = 4" },
      ],
      answer: "$x = 4$",
    },
    {
      id: "ind-ex3",
      title: "Surds in a coordinate-geometry answer",
      difficulty: "hard",
      prompt: "Simplify $\\dfrac{\\sqrt{75} + \\sqrt{12}}{\\sqrt3 - 1}$, giving your answer in the form $a + b\\sqrt3$.",
      steps: [
        { t: "Simplify each surd in the numerator.", m: "\\sqrt{75} = 5\\sqrt3, \\qquad \\sqrt{12} = 2\\sqrt3" },
        { t: "Add them.", m: "\\frac{7\\sqrt3}{\\sqrt3 - 1}" },
        { t: "Rationalise with the conjugate $\\sqrt3 + 1$.", m: "\\frac{7\\sqrt3(\\sqrt3+1)}{(\\sqrt3-1)(\\sqrt3+1)}" },
        { t: "The denominator becomes $3 - 1 = 2$; expand the numerator using $\\sqrt3\\times\\sqrt3 = 3$.", m: "\\frac{21 + 7\\sqrt3}{2}" },
        { t: "Split into the requested form.", m: "= \\tfrac{21}{2} + \\tfrac{7}{2}\\sqrt3" },
      ],
      answer: "$\\dfrac{21}{2} + \\dfrac{7}{2}\\sqrt3$",
    },
    {
      id: "ind-ex4",
      title: "A nested surd",
      difficulty: "olympiad",
      prompt: "Show that $\\sqrt{7 + 4\\sqrt3} = 2 + \\sqrt3$.",
      steps: [
        { t: "Rather than un-nest the root, square the proposed answer and compare.", m: "\\left(2+\\sqrt3\\right)^2 = 4 + 4\\sqrt3 + 3" },
        { t: "Simplify.", m: "= 7 + 4\\sqrt3" },
        { t: "So $2+\\sqrt3$ is a square root of $7+4\\sqrt3$. Since $2+\\sqrt3 > 0$ and $\\sqrt{\\ }$ denotes the positive root, it is *the* square root.", m: "\\sqrt{7+4\\sqrt3} = 2+\\sqrt3 \\ \\blacksquare" },
      ],
      answer: "Squaring $2+\\sqrt3$ gives $7+4\\sqrt3$, and $2+\\sqrt3>0$, so the equality holds.",
      remark: "In general $\\sqrt{a + 2\\sqrt{b}} = \\sqrt{m}+\\sqrt{n}$ when $m+n=a$ and $mn=b$ — here $m=4$, $n=3$.",
    },
  ],
  examQuestions: [
    {
      id: "ind-eq1",
      title: "Indices inside a calculus question",
      difficulty: "medium",
      marks: 5,
      paper: 1,
      prompt:
        "The curve $y = \\dfrac{4}{\\sqrt{x}} + 3x\\sqrt{x}$ is given.\n(a) Write $y$ in the form $ax^p + bx^q$. [2]\n(b) Hence find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$. [3]",
      steps: [
        { t: "(a) Convert each term to a power of $x$. A root is a half power; a denominator is a negative power.", m: "\\frac{4}{\\sqrt x} = 4x^{-1/2}" },
        { t: "For the second term, $x \\cdot x^{1/2} = x^{3/2}$.", m: "3x\\sqrt x = 3x^{3/2}" },
        { t: "So the curve is a sum of two powers.", m: "y = 4x^{-1/2} + 3x^{3/2}" },
        { t: "(b) Differentiate term by term with the power rule.", m: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = -2x^{-3/2} + \\tfrac92 x^{1/2}" },
        { t: "Optionally return to root form.", m: "= -\\frac{2}{x\\sqrt x} + \\frac{9\\sqrt x}{2}" },
      ],
      answer: "(a) $y = 4x^{-1/2} + 3x^{3/2}$. (b) $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x} = -2x^{-3/2} + \\dfrac92 x^{1/2}$.",
    },
    {
      id: "ind-eq2",
      title: "Exact answers in surd form",
      difficulty: "hard",
      marks: 6,
      paper: 1,
      prompt: "Solve the equation $x^2 - 6x + 4 = 0$, giving your answers in the form $a + b\\sqrt{c}$ where $c$ is as small as possible. [6]",
      steps: [
        { t: "Complete the square — cleaner than the formula here.", m: "(x-3)^2 - 9 + 4 = 0" },
        { t: "Isolate the square.", m: "(x-3)^2 = 5" },
        { t: "Take both square roots.", m: "x - 3 = \\pm\\sqrt5" },
        { t: "Solve.", m: "x = 3 \\pm \\sqrt5" },
        { t: "Check by the formula: $x = \\dfrac{6 \\pm \\sqrt{36-16}}{2} = \\dfrac{6\\pm\\sqrt{20}}{2}$." },
        { t: "Simplify $\\sqrt{20} = 2\\sqrt5$ and cancel — the same answer, and this is why simplifying surds matters.", m: "= \\frac{6 \\pm 2\\sqrt5}{2} = 3 \\pm \\sqrt5" },
      ],
      answer: "$x = 3 + \\sqrt5$ or $x = 3 - \\sqrt5$.",
    },
  ],
  mistakes: [
    {
      wrong: "$(3x)^2 = 3x^2$.",
      why: "The index applies to the 3 as well as the $x$.",
      fix: "$(3x)^2 = 9x^2$. Expand the bracket explicitly if unsure.",
    },
    {
      wrong: "$\\sqrt{a + b} = \\sqrt a + \\sqrt b$.",
      why: "No such law exists; roots do not distribute over addition.",
      fix: "Only products and quotients split: $\\sqrt{ab} = \\sqrt a\\sqrt b$.",
    },
    {
      wrong: "$x^{-2} = -x^2$.",
      why: "A negative index means a reciprocal, not a negative number.",
      fix: "$x^{-2} = \\dfrac{1}{x^2}$, which is positive whenever $x \\ne 0$.",
    },
    {
      wrong: "Leaving $\\sqrt{72}$ or a surd denominator in a final answer.",
      why: "Marks are for a fully simplified exact answer.",
      fix: "Pull out square factors ($\\sqrt{72}=6\\sqrt2$) and rationalise denominators.",
    },
    {
      wrong: "Rounding on the non-calculator paper.",
      why: "Paper 1 asks for exact values; a decimal loses the accuracy mark.",
      fix: "Leave $\\pi$, $\\sqrt{\\ }$, $e$ and $\\ln$ in the answer unless told otherwise.",
    },
  ],
  tips: [
    "Convert every root and fraction into a power **before** differentiating or integrating. Most calculus errors start here.",
    "For a fractional index, root first, power second — the numbers stay small.",
    "$\\sqrt{a^2 b} = a\\sqrt b$ for $a>0$: look for the largest square factor, not the first one you spot.",
    "Rationalising a denominator is worth doing even when not asked; it is how the mark scheme writes the answer.",
    "Learn the small powers by sight: $2^{10}=1024$, $3^5=243$, $5^4=625$. They turn up constantly in index equations.",
  ],
  generators: ["ind-evaluate", "ind-equation-same-base", "surd-simplify", "surd-rationalise"],
};
