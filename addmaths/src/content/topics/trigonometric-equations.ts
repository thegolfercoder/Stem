import type { Topic } from "@/lib/types";

export const trigonometricEquations: Topic = {
  slug: "trigonometric-equations",
  unit: 10,
  title: "Trigonometric equations",
  short: "Trig equations",
  blurb:
    "Finding every solution in an interval — including the ones the calculator does not give you.",
  syllabus: [
    {
      code: "10.5",
      text: "Solve, for a given domain, trigonometric equations involving the six trigonometric functions, e.g. $4\\cot\\theta = \\tan\\theta$, $2\\sec^2\\theta + \\tan\\theta - 3 = 0$, $5\\sin\\frac{\\theta}{3} + 2\\cos\\frac{\\theta}{3} = 0$, $3\\operatorname{cosec}\\left(2\\theta - \\frac{\\pi}{2}\\right) = 4$.",
    },
  ],
  prerequisites: ["trigonometric-functions", "trigonometric-identities"],
  estimatedMinutes: 90,
  sections: [
    {
      id: "the-problem",
      heading: "Why the calculator is not enough",
      body: [
        {
          k: "p",
          t: "A calculator returns exactly one angle — the **principal value**. But $\\sin\\theta = 0.5$ has infinitely many solutions, and an exam interval usually contains several. Finding the rest is the entire skill of this topic.",
        },
        {
          k: "note",
          tone: "key",
          title: "The two extra solutions",
          t: "Once you have a principal value $\\alpha$: for **sine**, the partner in the same revolution is $180^\\circ - \\alpha$. For **cosine**, it is $360^\\circ - \\alpha$ (equivalently $-\\alpha$). For **tangent**, it is $\\alpha + 180^\\circ$. After that, add multiples of $360^\\circ$ ($180^\\circ$ for tangent).",
        },
        {
          k: "table",
          head: ["Equation", "Principal value $\\alpha$", "Other solution in $[0^\\circ, 360^\\circ)$", "Repeats every"],
          rows: [
            ["$\\sin\\theta = k$", "$\\arcsin k$", "$180^\\circ - \\alpha$", "$360^\\circ$"],
            ["$\\cos\\theta = k$", "$\\arccos k$", "$360^\\circ - \\alpha$", "$360^\\circ$"],
            ["$\\tan\\theta = k$", "$\\arctan k$", "$\\alpha + 180^\\circ$", "$180^\\circ$"],
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 2 * Math.PI],
            yRange: [-1.4, 1.4],
            radians: true,
            curves: [
              { f: (x: number) => Math.sin(x), label: "y = sin x" },
              { f: () => 0.5, label: "y = 0.5", color: 1, dashed: true },
            ],
            points: [
              { x: Math.PI / 6, y: 0.5, label: "π/6" },
              { x: (5 * Math.PI) / 6, y: 0.5, label: "5π/6" },
            ],
            caption: "The calculator gives π/6. The graph shows the second solution, 5π/6, that it silently omits.",
            height: 300,
          },
        },
      ],
    },
    {
      id: "method",
      heading: "The method, in order",
      body: [
        {
          k: "ol",
          items: [
            "**Isolate** a single trigonometric function: get to $\\sin(\\text{something}) = k$.",
            "**Transform the interval.** If the argument is $2\\theta$ or $\\theta - 30^\\circ$, apply the same operation to the endpoints of the given range. This is the step people skip, and it is where the missing solutions live.",
            "**Find the principal value** with the calculator, in the right mode.",
            "**Generate all solutions** for the *transformed* variable across the *transformed* interval.",
            "**Transform back** to $\\theta$, and check every answer lies in the original interval.",
          ],
        },
        {
          k: "note",
          tone: "warn",
          title: "The interval trap",
          t: "For $\\sin 2\\theta = 0.5$ with $0^\\circ \\le \\theta \\le 360^\\circ$, the variable $2\\theta$ runs over $0^\\circ \\le 2\\theta \\le 720^\\circ$ — **two** revolutions, so up to four solutions. Solve in that doubled range and halve at the end.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $\\sin 2\\theta = \\tfrac12$ for $0^\\circ \\le \\theta \\le 360^\\circ$. Transform the interval first.", m: "0^\\circ \\le 2\\theta \\le 720^\\circ" },
            { t: "Principal value.", m: "2\\theta = 30^\\circ" },
            { t: "Sine's partner in the first revolution.", m: "2\\theta = 180^\\circ - 30^\\circ = 150^\\circ" },
            { t: "Add $360^\\circ$ to each to reach the second revolution, staying within $720^\\circ$.", m: "2\\theta = 390^\\circ, \\ 510^\\circ" },
            { t: "Halve all four.", m: "\\theta = 15^\\circ,\\ 75^\\circ,\\ 195^\\circ,\\ 255^\\circ" },
          ],
        },
      ],
    },
    {
      id: "quadratic-type",
      heading: "Quadratic-type equations",
      body: [
        {
          k: "p",
          t: "If an equation contains a squared ratio and the same ratio to the first power, it is a quadratic. If it contains two *different* ratios squared, use an identity to reduce it to one.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $2\\sec^2\\theta + \\tan\\theta - 3 = 0$ for $0^\\circ \\le \\theta \\le 360^\\circ$. Replace $\\sec^2$ using the given identity.", m: "2\\left(1+\\tan^2\\theta\\right) + \\tan\\theta - 3 = 0" },
            { t: "Expand and collect into a quadratic in $\\tan\\theta$.", m: "2\\tan^2\\theta + \\tan\\theta - 1 = 0" },
            { t: "Factorise.", m: "(2\\tan\\theta - 1)(\\tan\\theta + 1) = 0" },
            { t: "First branch.", m: "\\tan\\theta = \\tfrac12 \\;\\Rightarrow\\; \\theta = 26.6^\\circ, \\ 206.6^\\circ" },
            { t: "Second branch. The principal value is negative, so add $180^\\circ$ to bring it into range.", m: "\\tan\\theta = -1 \\;\\Rightarrow\\; \\theta = 135^\\circ, \\ 315^\\circ" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "Which identity to reach for",
          t: "Match the identity to the pair in front of you: $\\sin^2$ with $\\cos$ $\\to$ use $\\sin^2 = 1-\\cos^2$. $\\sec^2$ with $\\tan$ $\\to$ use $\\sec^2 = 1+\\tan^2$. $\\operatorname{cosec}^2$ with $\\cot$ $\\to$ use $\\operatorname{cosec}^2 = 1+\\cot^2$.",
        },
      ],
    },
    {
      id: "mixed-ratios",
      heading: "Equations mixing sine and cosine",
      body: [
        {
          k: "p",
          t: "An equation with one $\\sin$ and one $\\cos$, both to the first power, divides through by $\\cos$ to become a tangent equation.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $5\\sin\\tfrac{\\theta}{3} + 2\\cos\\tfrac{\\theta}{3} = 0$ for $0 \\le \\theta \\le 6\\pi$. Divide by $\\cos\\frac{\\theta}{3}$.", m: "5\\tan\\tfrac{\\theta}{3} + 2 = 0" },
            { t: "Isolate the tangent.", m: "\\tan\\tfrac{\\theta}{3} = -\\tfrac25" },
            { t: "Transform the interval: dividing $\\theta$ by 3 divides the endpoints by 3.", m: "0 \\le \\tfrac{\\theta}{3} \\le 2\\pi" },
            { t: "The principal value is $-0.3805$, outside the range; add $\\pi$ and then $2\\pi$ to find those inside.", m: "\\tfrac{\\theta}{3} = 2.761, \\ 5.903" },
            { t: "Multiply by 3.", m: "\\theta = 8.28, \\ 17.7" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Dividing by $\\cos$ is only safe because $\\cos\\frac\\theta3 = 0$ would force $\\sin\\frac\\theta3 = 0$ too, which is impossible. Whenever you divide by a trigonometric function, check it cannot be zero.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Sine symmetry", latex: "\\sin\\theta = \\sin(180^\\circ - \\theta)", given: false },
    { name: "Cosine symmetry", latex: "\\cos\\theta = \\cos(360^\\circ - \\theta) = \\cos(-\\theta)", given: false },
    { name: "Tangent period", latex: "\\tan\\theta = \\tan(\\theta + 180^\\circ)", given: false },
    { name: "General solution (sine)", latex: "\\theta = \\alpha + 360^\\circ n \\ \\text{ or } \\ \\theta = 180^\\circ - \\alpha + 360^\\circ n", given: false },
    { name: "Reciprocal conversions", latex: "\\operatorname{cosec}\\theta = k \\iff \\sin\\theta = \\tfrac1k", given: false },
  ],
  examples: [
    {
      id: "teq-ex1",
      title: "A basic equation over one revolution",
      difficulty: "easy",
      prompt: "Solve $\\cos\\theta = -0.4$ for $0^\\circ \\le \\theta \\le 360^\\circ$, giving answers to 1 decimal place.",
      steps: [
        { t: "Take the inverse cosine for the principal value.", m: "\\alpha = \\arccos(-0.4) = 113.6^\\circ" },
        { t: "For cosine, the second solution in a revolution is $360^\\circ - \\alpha$.", m: "\\theta = 360 - 113.6 = 246.4^\\circ" },
        { t: "Both lie in the required interval.", m: "\\theta = 113.6^\\circ, \\ 246.4^\\circ" },
      ],
      answer: "$\\theta = 113.6^\\circ$ or $246.4^\\circ$.",
    },
    {
      id: "teq-ex2",
      title: "A shifted argument",
      difficulty: "medium",
      prompt: "Solve $\\tan(2\\theta - 45^\\circ) = 1$ for $0^\\circ \\le \\theta \\le 360^\\circ$.",
      steps: [
        { t: "Transform the interval for the whole argument: multiply by 2, then subtract 45.", m: "-45^\\circ \\le 2\\theta - 45^\\circ \\le 675^\\circ" },
        { t: "Principal value.", m: "2\\theta - 45^\\circ = 45^\\circ" },
        { t: "Tangent repeats every $180^\\circ$; list every value inside the transformed interval.", m: "45^\\circ,\\ 225^\\circ,\\ 405^\\circ,\\ 585^\\circ" },
        { t: "Add $45^\\circ$ to each.", m: "2\\theta = 90^\\circ,\\ 270^\\circ,\\ 450^\\circ,\\ 630^\\circ" },
        { t: "Halve each.", m: "\\theta = 45^\\circ,\\ 135^\\circ,\\ 225^\\circ,\\ 315^\\circ" },
      ],
      answer: "$\\theta = 45^\\circ,\\ 135^\\circ,\\ 225^\\circ,\\ 315^\\circ$.",
    },
    {
      id: "teq-ex3",
      title: "Reciprocal function with a shifted argument",
      difficulty: "hard",
      prompt: "Solve $3\\operatorname{cosec}\\left(2\\theta - \\dfrac{\\pi}{2}\\right) = 4$ for $0 \\le \\theta \\le \\pi$.",
      steps: [
        { t: "Convert the cosecant into a sine.", m: "\\operatorname{cosec}\\left(2\\theta - \\tfrac{\\pi}{2}\\right) = \\tfrac43 \\;\\Rightarrow\\; \\sin\\left(2\\theta - \\tfrac{\\pi}{2}\\right) = \\tfrac34" },
        { t: "Transform the interval: double, then subtract $\\frac\\pi2$.", m: "-\\tfrac{\\pi}{2} \\le 2\\theta - \\tfrac{\\pi}{2} \\le \\tfrac{3\\pi}{2}" },
        { t: "Principal value in radians.", m: "u = \\arcsin 0.75 = 0.84806" },
        { t: "The sine partner is $\\pi - u$.", m: "u = \\pi - 0.84806 = 2.2935" },
        { t: "Both lie inside $[-\\frac\\pi2, \\frac{3\\pi}{2}] = [-1.571, 4.712]$ ✓. Now undo the transformation: add $\\frac\\pi2$ and halve.", m: "2\\theta = 0.84806 + 1.5708 = 2.4189 \\;\\Rightarrow\\; \\theta = 1.209" },
        { t: "Repeat for the second value.", m: "2\\theta = 2.2935 + 1.5708 = 3.8643 \\;\\Rightarrow\\; \\theta = 1.932" },
        { t: "Both lie in $[0, \\pi] = [0, 3.142]$ ✓." },
      ],
      answer: "$\\theta = 1.21$ or $\\theta = 1.93$ radians (3 s.f.).",
    },
    {
      id: "teq-ex4",
      title: "An equation needing factorisation, not cancellation",
      difficulty: "olympiad",
      prompt: "Solve $2\\sin\\theta\\cos\\theta = \\sin\\theta$ for $0^\\circ \\le \\theta \\le 360^\\circ$.",
      steps: [
        { t: "Do **not** divide by $\\sin\\theta$ — that discards solutions. Bring everything to one side.", m: "2\\sin\\theta\\cos\\theta - \\sin\\theta = 0" },
        { t: "Factorise.", m: "\\sin\\theta\\left(2\\cos\\theta - 1\\right) = 0" },
        { t: "First factor.", m: "\\sin\\theta = 0 \\;\\Rightarrow\\; \\theta = 0^\\circ,\\ 180^\\circ,\\ 360^\\circ" },
        { t: "Second factor.", m: "\\cos\\theta = \\tfrac12 \\;\\Rightarrow\\; \\theta = 60^\\circ,\\ 300^\\circ" },
        { t: "Collect all five, in order.", m: "\\theta = 0^\\circ,\\ 60^\\circ,\\ 180^\\circ,\\ 300^\\circ,\\ 360^\\circ" },
      ],
      answer: "$\\theta = 0^\\circ, 60^\\circ, 180^\\circ, 300^\\circ, 360^\\circ$.",
      remark: "Cancelling $\\sin\\theta$ would have lost three of the five solutions — over half the marks.",
    },
  ],
  examQuestions: [
    {
      id: "teq-eq1",
      title: "Quadratic in sine",
      difficulty: "medium",
      marks: 7,
      paper: 2,
      prompt: "Solve $3\\cos^2\\theta + 5\\sin\\theta - 1 = 0$ for $0^\\circ \\le \\theta \\le 360^\\circ$. [7]",
      steps: [
        { t: "Convert to a single ratio using the Pythagorean identity.", m: "3\\left(1 - \\sin^2\\theta\\right) + 5\\sin\\theta - 1 = 0" },
        { t: "Expand and collect.", m: "-3\\sin^2\\theta + 5\\sin\\theta + 2 = 0 \\;\\Rightarrow\\; 3\\sin^2\\theta - 5\\sin\\theta - 2 = 0" },
        { t: "Factorise.", m: "(3\\sin\\theta + 1)(\\sin\\theta - 2) = 0" },
        { t: "Reject the impossible branch: $\\sin\\theta = 2$ is outside $[-1,1]$.", m: "\\sin\\theta = -\\tfrac13" },
        { t: "Principal value.", m: "\\alpha = \\arcsin\\left(-\\tfrac13\\right) = -19.47^\\circ" },
        { t: "Sine is negative in the third and fourth quadrants. Third: $180^\\circ + 19.47^\\circ$. Fourth: $360^\\circ - 19.47^\\circ$.", m: "\\theta = 199.5^\\circ, \\ 340.5^\\circ" },
      ],
      answer: "$\\theta = 199.5^\\circ$ or $340.5^\\circ$.",
    },
    {
      id: "teq-eq2",
      title: "Cotangent and tangent together",
      difficulty: "hard",
      marks: 6,
      paper: 1,
      prompt: "Solve $4\\cot\\theta = \\tan\\theta$ for $0^\\circ < \\theta < 360^\\circ$. [6]",
      steps: [
        { t: "Write the cotangent as a reciprocal tangent.", m: "\\frac{4}{\\tan\\theta} = \\tan\\theta" },
        { t: "Multiply through by $\\tan\\theta$, valid since $\\tan\\theta \\ne 0$ (the equation would be undefined otherwise).", m: "\\tan^2\\theta = 4" },
        { t: "Take both square roots.", m: "\\tan\\theta = 2 \\quad \\text{or} \\quad \\tan\\theta = -2" },
        { t: "First branch: principal value $63.43^\\circ$, then add $180^\\circ$.", m: "\\theta = 63.4^\\circ, \\ 243.4^\\circ" },
        { t: "Second branch: principal value $-63.43^\\circ$; add $180^\\circ$ and $360^\\circ$ to reach the interval.", m: "\\theta = 116.6^\\circ, \\ 296.6^\\circ" },
        { t: "Four solutions altogether, evenly spaced $90^\\circ$ apart — a useful check.", m: "\\theta = 63.4^\\circ,\\ 116.6^\\circ,\\ 243.4^\\circ,\\ 296.6^\\circ" },
      ],
      answer: "$\\theta = 63.4^\\circ,\\ 116.6^\\circ,\\ 243.4^\\circ,\\ 296.6^\\circ$.",
    },
  ],
  mistakes: [
    {
      wrong: "Giving only the calculator's answer.",
      why: "The inverse functions return one value out of infinitely many.",
      fix: "Always sketch or use CAST to find every solution in the interval.",
    },
    {
      wrong: "Solving $\\sin 3\\theta = k$ over the original interval for $\\theta$.",
      why: "The argument $3\\theta$ runs over three times the range, so up to six solutions exist.",
      fix: "Transform the interval first, solve there, then divide back.",
    },
    {
      wrong: "Cancelling $\\cos\\theta$ from $\\sin\\theta\\cos\\theta = \\cos\\theta$.",
      why: "It silently discards every solution with $\\cos\\theta = 0$.",
      fix: "Factorise: $\\cos\\theta(\\sin\\theta - 1) = 0$, then solve both factors.",
    },
    {
      wrong: "Working in degrees when the interval is given in terms of $\\pi$.",
      why: "An interval like $0 \\le \\theta \\le 2\\pi$ is in radians.",
      fix: "Match the calculator mode to the interval, and give the answer in the same units.",
    },
    {
      wrong: "Rounding the principal value before generating the other solutions.",
      why: "The error is multiplied when you double or triple the angle.",
      fix: "Keep full accuracy until the very last step.",
    },
  ],
  tips: [
    "Write the transformed interval down on paper before doing anything else. It is the single highest-value habit in this topic.",
    "Count the expected number of solutions in advance: an argument of $n\\theta$ over a full revolution generally gives $2n$ solutions for sine or cosine.",
    "For reciprocal functions, convert to $\\sin$, $\\cos$ or $\\tan$ first — the calculator has no cosec button.",
    "Never divide by a trigonometric expression. Factorise instead.",
    "Answers in degrees to 1 d.p., in radians to 3 s.f., unless the question says otherwise.",
  ],
  generators: ["teq-basic", "teq-multiple-angle", "teq-quadratic", "teq-tan-equation"],
};
