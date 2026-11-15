import type { Topic } from "@/lib/types";

export const integration: Topic = {
  slug: "integration",
  unit: 14,
  title: "Integration",
  short: "Integration",
  blurb:
    "Reversing differentiation: the standard integrals, the arbitrary constant, and functions of $ax+b$.",
  syllabus: [
    { code: "14.10", text: "Understand integration as the reverse process of differentiation.", notes: "Indefinite integrals must include an arbitrary constant." },
    { code: "14.11", text: "Integrate sums of terms in powers of $x$, including $\\frac1x$ and $\\frac{1}{ax+b}$." },
    { code: "14.12", text: "Integrate functions of the form $(ax+b)^n$ for any rational $n$ (including $n=-1$), $\\sin(ax+b)$, $\\cos(ax+b)$, $\\sec^2(ax+b)$, $e^{ax+b}$." },
  ],
  prerequisites: ["differentiation"],
  estimatedMinutes: 90,
  sections: [
    {
      id: "reverse",
      heading: "Integration reverses differentiation",
      body: [
        {
          k: "p",
          t: "If differentiating $F(x)$ gives $f(x)$, then integrating $f(x)$ gives $F(x)$ — plus a constant, because every constant differentiates to zero and is therefore invisible to the derivative.",
        },
        { k: "math", t: "\\int x^n \\,\\mathrm{d}x = \\frac{x^{n+1}}{n+1} + c, \\qquad n \\ne -1" },
        {
          k: "note",
          tone: "key",
          title: "Add one, divide by the new power",
          t: "That sentence is the power rule for integration. The exclusion $n \\ne -1$ matters: it would mean dividing by zero, and that single case is handled by the logarithm.",
        },
        { k: "math", t: "\\int \\frac{1}{x}\\,\\mathrm{d}x = \\ln|x| + c" },
        {
          k: "note",
          tone: "warn",
          t: "**Always write $+c$** on an indefinite integral. It is worth a mark on its own and is the single most commonly dropped mark in the whole calculus section.",
        },
      ],
    },
    {
      id: "standard",
      heading: "The standard integrals",
      body: [
        {
          k: "table",
          head: ["$f(x)$", "$\\int f(x)\\,\\mathrm{d}x$"],
          rows: [
            ["$x^n \\ (n\\ne-1)$", "$\\dfrac{x^{n+1}}{n+1} + c$"],
            ["$\\dfrac{1}{x}$", "$\\ln|x| + c$"],
            ["$e^{x}$", "$e^{x} + c$"],
            ["$\\sin x$", "$-\\cos x + c$"],
            ["$\\cos x$", "$\\sin x + c$"],
            ["$\\sec^2 x$", "$\\tan x + c$"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "The sign swaps",
          t: "Differentiating $\\cos$ produces a minus; integrating $\\sin$ produces one. If you can only remember one, remember the derivative pair and reverse it.",
        },
      ],
    },
    {
      id: "linear-inside",
      heading: "Functions of $ax+b$",
      body: [
        {
          k: "p",
          t: "When the inside is linear, integrate as usual and then **divide by the coefficient of $x$**. This is the chain rule run backwards, and it is the only composite case the syllabus requires.",
        },
        {
          k: "table",
          head: ["$f(x)$", "$\\int f(x)\\,\\mathrm{d}x$"],
          rows: [
            ["$(ax+b)^n$", "$\\dfrac{(ax+b)^{n+1}}{a(n+1)} + c$"],
            ["$\\dfrac{1}{ax+b}$", "$\\dfrac{1}{a}\\ln|ax+b| + c$"],
            ["$e^{ax+b}$", "$\\dfrac{1}{a}e^{ax+b} + c$"],
            ["$\\sin(ax+b)$", "$-\\dfrac{1}{a}\\cos(ax+b) + c$"],
            ["$\\cos(ax+b)$", "$\\dfrac{1}{a}\\sin(ax+b) + c$"],
            ["$\\sec^2(ax+b)$", "$\\dfrac{1}{a}\\tan(ax+b) + c$"],
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "This works **only** when the inside is linear. $\\int e^{x^2}\\,\\mathrm{d}x$ cannot be done by dividing by $2x$, and is outside this syllabus entirely — if you meet something like it, you have made an earlier error.",
        },
        {
          k: "steps",
          items: [
            { t: "Find $\\displaystyle\\int \\left(3 - 2x\\right)^{5}\\,\\mathrm{d}x$. Add one to the power and divide by the new power.", m: "\\frac{(3-2x)^6}{6}" },
            { t: "Divide by the coefficient of $x$ inside, which is $-2$.", m: "= \\frac{(3-2x)^6}{6 \\times (-2)}" },
            { t: "Simplify and add the constant.", m: "= -\\frac{(3-2x)^6}{12} + c" },
            { t: "Check by differentiating: $-\\frac{6(3-2x)^5(-2)}{12} = (3-2x)^5$ ✓." },
          ],
        },
      ],
    },
    {
      id: "definite",
      heading: "Definite integrals",
      body: [
        {
          k: "p",
          t: "A definite integral has limits and evaluates to a number. The constant cancels, so it is omitted.",
        },
        { k: "math", t: "\\int_a^b f(x)\\,\\mathrm{d}x = \\Big[F(x)\\Big]_a^b = F(b) - F(a)" },
        {
          k: "note",
          tone: "tip",
          t: "Use square brackets and show the substitution line in full. Marks are given for the correct integral, for the substitution, and for the final value — so writing only the answer risks all three.",
        },
        {
          k: "steps",
          items: [
            { t: "Evaluate $\\displaystyle\\int_1^4 \\left(2x + \\frac{3}{\\sqrt x}\\right)\\mathrm{d}x$. Convert to powers first.", m: "\\int_1^4\\left(2x + 3x^{-1/2}\\right)\\mathrm dx" },
            { t: "Integrate each term.", m: "= \\Big[x^2 + 6x^{1/2}\\Big]_1^4" },
            { t: "Substitute the upper limit.", m: "= \\left(16 + 6\\times 2\\right) = 28" },
            { t: "Substitute the lower limit.", m: "\\left(1 + 6\\right) = 7" },
            { t: "Subtract.", m: "28 - 7 = 21" },
          ],
        },
      ],
    },
    {
      id: "finding-c",
      heading: "Finding the constant",
      body: [
        {
          k: "p",
          t: "Given $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ and one point on the curve, integrating recovers the equation of the curve — the point pins down $c$.",
        },
        {
          k: "steps",
          items: [
            { t: "A curve passes through $(2, 9)$ and has gradient $\\frac{\\mathrm dy}{\\mathrm dx} = 6x - 4$. Integrate.", m: "y = 3x^2 - 4x + c" },
            { t: "Substitute the known point.", m: "9 = 3(4) - 8 + c" },
            { t: "Solve.", m: "9 = 4 + c \\;\\Rightarrow\\; c = 5" },
            { t: "State the equation.", m: "y = 3x^2 - 4x + 5" },
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Power rule", latex: "\\int x^n\\,\\mathrm dx = \\frac{x^{n+1}}{n+1} + c, \\ n \\ne -1", given: false },
    { name: "Reciprocal", latex: "\\int \\frac{1}{ax+b}\\,\\mathrm dx = \\frac1a\\ln|ax+b| + c", given: false },
    { name: "Linear inside", latex: "\\int (ax+b)^n\\,\\mathrm dx = \\frac{(ax+b)^{n+1}}{a(n+1)} + c", given: false },
    { name: "Exponential", latex: "\\int e^{ax+b}\\,\\mathrm dx = \\frac1a e^{ax+b} + c", given: false },
    { name: "Trigonometric", latex: "\\int \\sin(ax+b)\\,\\mathrm dx = -\\frac1a\\cos(ax+b) + c", given: false },
    { name: "Definite integral", latex: "\\int_a^b f(x)\\,\\mathrm dx = F(b) - F(a)", given: false },
  ],
  examples: [
    {
      id: "int-ex1",
      title: "Powers and roots",
      difficulty: "easy",
      prompt: "Find $\\displaystyle\\int\\left(4x^3 - \\frac{6}{x^2} + \\sqrt{x}\\right)\\mathrm{d}x$.",
      steps: [
        { t: "Convert to powers.", m: "\\int\\left(4x^3 - 6x^{-2} + x^{1/2}\\right)\\mathrm dx" },
        { t: "Integrate each term: add one to the index, divide by the new index.", m: "= \\frac{4x^4}{4} - \\frac{6x^{-1}}{-1} + \\frac{x^{3/2}}{3/2} + c" },
        { t: "Simplify.", m: "= x^4 + \\frac{6}{x} + \\frac{2}{3}x^{3/2} + c" },
      ],
      answer: "$x^4 + \\dfrac6x + \\dfrac23 x^{3/2} + c$",
    },
    {
      id: "int-ex2",
      title: "Linear inside a bracket",
      difficulty: "medium",
      prompt: "Find $\\displaystyle\\int\\left(\\frac{4}{(2x-1)^3} + e^{5x} - \\sin 3x\\right)\\mathrm{d}x$.",
      steps: [
        { t: "Write the first term as a power.", m: "4(2x-1)^{-3}" },
        { t: "Integrate it: add one to the index, divide by the new index and by 2.", m: "\\frac{4(2x-1)^{-2}}{(-2)(2)} = -\\frac{1}{(2x-1)^2}" },
        { t: "Integrate the exponential: divide by 5.", m: "\\frac{1}{5}e^{5x}" },
        { t: "Integrate $-\\sin 3x$: the integral of $\\sin 3x$ is $-\\frac13\\cos 3x$, so with the minus outside it becomes $+\\frac13\\cos 3x$.", m: "+\\tfrac13\\cos 3x" },
        { t: "Collect, with the constant.", m: "-\\frac{1}{(2x-1)^2} + \\frac{e^{5x}}{5} + \\frac{\\cos 3x}{3} + c" },
      ],
      answer: "$-\\dfrac{1}{(2x-1)^2} + \\dfrac{e^{5x}}{5} + \\dfrac{\\cos 3x}{3} + c$",
    },
    {
      id: "int-ex3",
      title: "A definite integral with a logarithm",
      difficulty: "hard",
      prompt: "Evaluate $\\displaystyle\\int_1^3 \\frac{6}{2x+1}\\,\\mathrm{d}x$, giving your answer in the form $a\\ln b$.",
      steps: [
        { t: "Take the 6 outside and integrate the reciprocal, dividing by the coefficient of $x$.", m: "6 \\times \\tfrac12\\Big[\\ln|2x+1|\\Big]_1^3" },
        { t: "Simplify the constant.", m: "= 3\\Big[\\ln(2x+1)\\Big]_1^3" },
        { t: "Substitute the limits.", m: "= 3\\left(\\ln 7 - \\ln 3\\right)" },
        { t: "Combine with the quotient law of logarithms.", m: "= 3\\ln\\frac73" },
      ],
      answer: "$3\\ln\\dfrac73 \\approx 2.54$",
    },
    {
      id: "int-ex4",
      title: "Reverse-engineering a product",
      difficulty: "olympiad",
      prompt:
        "Show that $\\dfrac{\\mathrm{d}}{\\mathrm{d}x}\\left(x\\sin x\\right) = \\sin x + x\\cos x$, and hence find $\\displaystyle\\int x\\cos x\\,\\mathrm{d}x$.",
      steps: [
        { t: "Differentiate the product with the product rule.", m: "\\frac{\\mathrm d}{\\mathrm dx}(x\\sin x) = x\\cos x + \\sin x \\ \\blacksquare" },
        { t: "Integrating both sides of that identity undoes the derivative on the left.", m: "x\\sin x = \\int \\sin x\\,\\mathrm dx + \\int x\\cos x\\,\\mathrm dx" },
        { t: "The first integral on the right is standard.", m: "x\\sin x = -\\cos x + \\int x\\cos x\\,\\mathrm dx" },
        { t: "Rearrange to isolate the wanted integral.", m: "\\int x\\cos x\\,\\mathrm dx = x\\sin x + \\cos x + c" },
        { t: "Check by differentiating: $\\sin x + x\\cos x - \\sin x = x\\cos x$ ✓." },
      ],
      answer: "$\\displaystyle\\int x\\cos x\\,\\mathrm{d}x = x\\sin x + \\cos x + c$",
      remark:
        "Integration by parts is not on this syllabus, so questions of this type always supply the derivative to reverse. Recognising “show that … hence integrate” as that hint is the skill.",
    },
  ],
  examQuestions: [
    {
      id: "int-eq1",
      title: "Curve from its gradient",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt:
        "A curve has $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x} = 3\\sqrt{x} - \\dfrac{4}{x^2}$ and passes through the point $(1, 5)$. Find the equation of the curve. [6]",
      steps: [
        { t: "Convert to powers.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = 3x^{1/2} - 4x^{-2}" },
        { t: "Integrate the first term.", m: "\\frac{3x^{3/2}}{3/2} = 2x^{3/2}" },
        { t: "Integrate the second.", m: "\\frac{-4x^{-1}}{-1} = \\frac{4}{x}" },
        { t: "Write the general solution with the constant.", m: "y = 2x^{3/2} + \\frac4x + c" },
        { t: "Substitute the given point.", m: "5 = 2 + 4 + c \\;\\Rightarrow\\; c = -1" },
        { t: "State the equation.", m: "y = 2x^{3/2} + \\frac4x - 1" },
      ],
      answer: "$y = 2x^{3/2} + \\dfrac4x - 1$",
    },
    {
      id: "int-eq2",
      title: "Definite integral with trigonometry",
      difficulty: "hard",
      marks: 6,
      paper: 1,
      prompt: "Evaluate $\\displaystyle\\int_0^{\\pi/12}\\left(\\cos 2x + \\sec^2 3x\\right)\\mathrm{d}x$, giving an exact answer. [6]",
      steps: [
        { t: "Integrate each term, dividing by the coefficient of $x$ inside.", m: "\\Big[\\tfrac12\\sin 2x + \\tfrac13\\tan 3x\\Big]_0^{\\pi/12}" },
        { t: "At the upper limit, $2x = \\frac{\\pi}{6}$ and $3x = \\frac{\\pi}{4}$.", m: "\\sin\\tfrac{\\pi}{6} = \\tfrac12, \\qquad \\tan\\tfrac{\\pi}{4} = 1" },
        { t: "Substitute the upper limit.", m: "\\tfrac12\\left(\\tfrac12\\right) + \\tfrac13(1) = \\tfrac14 + \\tfrac13" },
        { t: "At the lower limit both terms vanish.", m: "\\tfrac12\\sin 0 + \\tfrac13\\tan 0 = 0" },
        { t: "Subtract, over a common denominator of 12.", m: "\\frac{3}{12} + \\frac{4}{12} = \\frac{7}{12}" },
        { t: "Note the interval was chosen to stop short of $x = \\frac{\\pi}{6}$, where $\\sec^2 3x$ has an asymptote." },
      ],
      answer: "$\\dfrac{7}{12}$",
    },
  ],
  mistakes: [
    { wrong: "Omitting $+c$ from an indefinite integral.", why: "Infinitely many functions share the same derivative.", fix: "Write $+c$ as you write the integral, not as an afterthought." },
    { wrong: "Integrating $\\frac1x$ as $\\frac{x^0}{0}$.", why: "The power rule fails at $n=-1$ — it would divide by zero.", fix: "$\\int\\frac1x\\,\\mathrm dx = \\ln|x| + c$." },
    { wrong: "Multiplying by the inside coefficient instead of dividing.", why: "Integration reverses the chain rule, so the factor goes the other way.", fix: "$\\int e^{4x}\\,\\mathrm dx = \\frac14 e^{4x} + c$. Check by differentiating." },
    { wrong: "$\\int \\sin x\\,\\mathrm dx = \\cos x$.", why: "The sign flips: differentiating $\\cos$ gives $-\\sin$.", fix: "$\\int\\sin x\\,\\mathrm dx = -\\cos x + c$." },
    { wrong: "Keeping the constant in a definite integral.", why: "It appears at both limits and cancels.", fix: "Omit it, and show the $F(b)-F(a)$ line instead." },
    { wrong: "Trying to integrate a product term by term.", why: "There is no product rule for integration.", fix: "Expand the product first, or use a “show that” derivative supplied by the question." },
  ],
  tips: [
    "Every integration can be checked by differentiating the answer. On a 2-hour paper that check costs ten seconds.",
    "Convert to powers first. $\\frac{1}{\\sqrt x}$ is $x^{-1/2}$, which integrates to $2x^{1/2}$.",
    "For anything of the form (linear inside), integrate normally then divide by the coefficient of $x$.",
    "No calculus formulas are printed on the paper. Write the six standard integrals down before you start.",
    "Exact answers — $\\ln\\frac73$, $\\frac{\\pi}{4}$, $\\frac{7}{12}$ — are expected on Paper 1.",
  ],
  generators: ["int-power-rule", "int-linear-inside", "int-definite", "int-find-constant", "int-trig-exp"],
};
