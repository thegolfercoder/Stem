import type { Topic } from "@/lib/types";

export const trigonometricFunctions: Topic = {
  slug: "trigonometric-functions",
  unit: 10,
  title: "Trigonometric functions and graphs",
  short: "Trig graphs",
  blurb:
    "All six functions for angles of any size, the CAST rule, and how to draw $y = a\\sin bx + c$ and read amplitude and period off it.",
  syllabus: [
    { code: "10.1", text: "Know and use the six trigonometric functions of angles of any magnitude: sine, cosine, tangent, secant, cosecant, cotangent." },
    { code: "10.2", text: "Understand and use the amplitude and period of a trigonometric function, including the relationship between graphs of related trigonometric functions." },
    { code: "10.3", text: "Draw and use the graphs of $y=a\\sin bx + c$, $y = a\\cos bx + c$, $y = a\\tan bx + c$, labelling asymptotes for the tangent graph." },
  ],
  prerequisites: ["circular-measure", "functions"],
  estimatedMinutes: 85,
  sections: [
    {
      id: "six-functions",
      heading: "The six functions",
      body: [
        {
          k: "p",
          t: "Beyond sine, cosine and tangent, the syllabus needs their three reciprocals. The names are deliberately unhelpful — **se**cant pairs with **co**sine, and **cose**cant with **s**ine — so learn them by the third letter.",
        },
        { k: "math", t: "\\sec\\theta = \\frac{1}{\\cos\\theta}, \\qquad \\operatorname{cosec}\\theta = \\frac{1}{\\sin\\theta}, \\qquad \\cot\\theta = \\frac{1}{\\tan\\theta} = \\frac{\\cos\\theta}{\\sin\\theta}" },
        {
          k: "note",
          tone: "warn",
          t: "$\\sec\\theta$ is **not** $\\cos^{-1}\\theta$. The superscript $-1$ means the inverse function (arccos); the reciprocal is written $\\sec$. Confusing the two is a guaranteed lost mark.",
        },
        {
          k: "table",
          head: ["Function", "Domain restriction", "Range"],
          rows: [
            ["$\\sin\\theta$, $\\cos\\theta$", "all $\\theta$", "$[-1, 1]$"],
            ["$\\tan\\theta$", "$\\theta \\ne \\frac{\\pi}{2} + n\\pi$", "all reals"],
            ["$\\sec\\theta$", "$\\theta \\ne \\frac{\\pi}{2} + n\\pi$", "$|y| \\ge 1$"],
            ["$\\operatorname{cosec}\\theta$", "$\\theta \\ne n\\pi$", "$|y| \\ge 1$"],
            ["$\\cot\\theta$", "$\\theta \\ne n\\pi$", "all reals"],
          ],
        },
      ],
    },
    {
      id: "cast",
      heading: "Angles of any magnitude and the CAST rule",
      body: [
        {
          k: "p",
          t: "For angles beyond the first quadrant, the value of each function is the value for the corresponding **acute** angle, with a sign determined by the quadrant.",
        },
        {
          k: "note",
          tone: "key",
          title: "CAST",
          t: "Starting in the fourth quadrant and going anticlockwise: **C**osine positive, **A**ll positive, **S**ine positive, **T**angent positive. Everything not named is negative in that quadrant.",
        },
        {
          k: "table",
          head: ["Quadrant", "Angle range", "Positive functions", "Reference angle"],
          rows: [
            ["1st", "$0$ to $\\frac{\\pi}{2}$", "all", "$\\theta$"],
            ["2nd", "$\\frac{\\pi}{2}$ to $\\pi$", "$\\sin$ (and cosec)", "$\\pi - \\theta$"],
            ["3rd", "$\\pi$ to $\\frac{3\\pi}{2}$", "$\\tan$ (and cot)", "$\\theta - \\pi$"],
            ["4th", "$\\frac{3\\pi}{2}$ to $2\\pi$", "$\\cos$ (and sec)", "$2\\pi - \\theta$"],
          ],
        },
        {
          k: "steps",
          items: [
            { t: "Find the exact value of $\\cos\\dfrac{5\\pi}{6}$. Locate the quadrant: $\\frac{5\\pi}{6}$ is between $\\frac{\\pi}{2}$ and $\\pi$, so the second." },
            { t: "In the second quadrant only sine is positive, so cosine is negative." },
            { t: "The reference angle is $\\pi - \\frac{5\\pi}{6} = \\frac{\\pi}{6}$.", m: "\\cos\\tfrac{\\pi}{6} = \\tfrac{\\sqrt3}{2}" },
            { t: "Apply the sign.", m: "\\cos\\tfrac{5\\pi}{6} = -\\tfrac{\\sqrt3}{2}" },
          ],
        },
      ],
    },
    {
      id: "graphs",
      heading: "Transformed graphs",
      body: [
        { k: "p", t: "For $y = a\\sin bx + c$ — and equally for cosine — three numbers control the picture:" },
        {
          k: "ul",
          items: [
            "$a$ is the **amplitude**: the curve reaches $c \\pm a$. A vertical stretch.",
            "$b$ sets the **period**: $\\dfrac{2\\pi}{b}$ radians, or $\\dfrac{360^\\circ}{b}$. A horizontal squash — larger $b$ means more cycles.",
            "$c$ is the **vertical shift**: the centre line moves from $y=0$ to $y=c$.",
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 2 * Math.PI],
            yRange: [-2, 6],
            radians: true,
            curves: [
              { f: (x: number) => Math.sin(x), label: "y = sin x", dashed: true },
              { f: (x: number) => 3 * Math.sin(2 * x) + 2, label: "y = 3 sin 2x + 2", color: 1 },
            ],
            hLines: [{ y: 2 }],
            caption:
              "Amplitude 3 about the centre line y = 2, so the range is −1 ≤ y ≤ 5; period 2π/2 = π, so two complete cycles in 2π.",
            height: 340,
          },
        },
        {
          k: "note",
          tone: "key",
          title: "Tangent is different",
          t: "$y = \\tan x$ has **no amplitude** — it is unbounded — and its period is $\\pi$, not $2\\pi$. So $y = a\\tan bx + c$ has period $\\dfrac{\\pi}{b}$, with vertical asymptotes wherever $bx = \\frac{\\pi}{2} + n\\pi$.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-Math.PI, Math.PI],
            yRange: [-6, 6],
            radians: true,
            curves: [{ f: (x: number) => Math.tan(x), label: "y = tan x" }],
            vLines: [
              { x: -Math.PI / 2, label: "x = −π/2" },
              { x: Math.PI / 2, label: "x = π/2" },
            ],
            caption: "Period π, with asymptotes at every odd multiple of π/2. Label them — the syllabus asks for it explicitly.",
            height: 320,
          },
        },
        {
          k: "p",
          t: "The number of solutions of an equation like $a\\sin bx + c = k$ over a given interval is simply the number of times the horizontal line $y=k$ crosses the curve. Sketch, then count.",
        },
      ],
    },
    {
      id: "modulus-trig",
      heading: "Modulus of a trigonometric graph",
      body: [
        {
          k: "p",
          t: "$y = |a\\sin bx + c|$ reflects everything below the $x$-axis upward, exactly as in unit 1 — and the number of solutions typically doubles.",
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 2 * Math.PI],
            yRange: [-3, 3.5],
            radians: true,
            curves: [
              { f: (x: number) => 2 * Math.cos(x), label: "y = 2 cos x", dashed: true },
              { f: (x: number) => Math.abs(2 * Math.cos(x)), label: "y = |2 cos x|", color: 1 },
            ],
            caption: "The modulus halves the period visually: |2 cos x| repeats every π, and y = 1 now meets it four times in one revolution.",
            height: 320,
          },
        },
      ],
    },
  ],
  formulas: [
    { name: "Reciprocal functions", latex: "\\sec\\theta = \\frac{1}{\\cos\\theta}, \\ \\operatorname{cosec}\\theta = \\frac{1}{\\sin\\theta}, \\ \\cot\\theta = \\frac{\\cos\\theta}{\\sin\\theta}", given: false },
    { name: "Amplitude and period (sine, cosine)", latex: "y = a\\sin bx + c: \\ \\text{amplitude } |a|, \\ \\text{period } \\tfrac{2\\pi}{b}", given: false },
    { name: "Period (tangent)", latex: "y = a\\tan bx + c: \\ \\text{period } \\tfrac{\\pi}{b}", given: false },
    { name: "Range of a transformed sine", latex: "c - |a| \\le y \\le c + |a|", given: false },
    { name: "Asymptotes of $\\tan bx$", latex: "x = \\frac{\\pi}{2b} + \\frac{n\\pi}{b}", given: false },
  ],
  examples: [
    {
      id: "trg-ex1",
      title: "Amplitude, period and range",
      difficulty: "easy",
      prompt: "For $y = 4\\cos 3x - 1$, state the amplitude, the period in radians, and the range.",
      steps: [
        { t: "The amplitude is the coefficient of the cosine.", m: "\\text{amplitude} = 4" },
        { t: "The period is $\\frac{2\\pi}{b}$ with $b=3$.", m: "\\text{period} = \\frac{2\\pi}{3}" },
        { t: "The centre line is $y = -1$, and the curve reaches 4 either side of it.", m: "-1 - 4 \\le y \\le -1 + 4" },
        { t: "Simplify.", m: "-5 \\le y \\le 3" },
      ],
      answer: "Amplitude 4, period $\\frac{2\\pi}{3}$, range $-5 \\le y \\le 3$.",
    },
    {
      id: "trg-ex2",
      title: "Exact values using CAST",
      difficulty: "medium",
      prompt: "Find the exact values of $\\sin\\dfrac{4\\pi}{3}$, $\\sec\\dfrac{4\\pi}{3}$ and $\\cot\\dfrac{4\\pi}{3}$.",
      steps: [
        { t: "$\\frac{4\\pi}{3}$ lies between $\\pi$ and $\\frac{3\\pi}{2}$: the third quadrant, where only tangent is positive." },
        { t: "The reference angle is $\\frac{4\\pi}{3} - \\pi = \\frac{\\pi}{3}$.", m: "\\sin\\tfrac{\\pi}{3} = \\tfrac{\\sqrt3}{2}, \\quad \\cos\\tfrac{\\pi}{3} = \\tfrac12, \\quad \\tan\\tfrac{\\pi}{3} = \\sqrt3" },
        { t: "Sine is negative in the third quadrant.", m: "\\sin\\tfrac{4\\pi}{3} = -\\tfrac{\\sqrt3}{2}" },
        { t: "Cosine is also negative there, and secant is its reciprocal.", m: "\\cos\\tfrac{4\\pi}{3} = -\\tfrac12 \\;\\Rightarrow\\; \\sec\\tfrac{4\\pi}{3} = -2" },
        { t: "Tangent is positive, and cotangent is its reciprocal.", m: "\\cot\\tfrac{4\\pi}{3} = \\tfrac{1}{\\sqrt3} = \\tfrac{\\sqrt3}{3}" },
      ],
      answer: "$-\\dfrac{\\sqrt3}{2}$, $-2$ and $\\dfrac{\\sqrt3}{3}$.",
    },
    {
      id: "trg-ex3",
      title: "Building a function from a description",
      difficulty: "hard",
      prompt:
        "A curve of the form $y = a\\sin bx + c$ has a maximum value of 7, a minimum of $-3$, and completes 4 full cycles between $x=0$ and $x=2\\pi$. Find $a$, $b$ and $c$.",
      steps: [
        { t: "The centre line is halfway between the extremes.", m: "c = \\frac{7 + (-3)}{2} = 2" },
        { t: "The amplitude is half the total range.", m: "a = \\frac{7 - (-3)}{2} = 5" },
        { t: "Four cycles in $2\\pi$ means each cycle takes $\\frac{2\\pi}{4}$.", m: "\\text{period} = \\frac{\\pi}{2}" },
        { t: "Set the period formula equal to this.", m: "\\frac{2\\pi}{b} = \\frac{\\pi}{2}" },
        { t: "Solve.", m: "b = 4" },
        { t: "Check: $y = 5\\sin 4x + 2$ has maximum $7$, minimum $-3$ ✓." },
      ],
      answer: "$a = 5$, $b = 4$, $c = 2$.",
    },
    {
      id: "trg-ex4",
      title: "Counting solutions from a sketch",
      difficulty: "olympiad",
      prompt:
        "How many solutions does $|3\\sin 2x| = 2$ have for $0 \\le x \\le 2\\pi$? Justify your answer without solving the equation.",
      steps: [
        { t: "$y = 3\\sin 2x$ has period $\\frac{2\\pi}{2} = \\pi$, so it completes 2 full cycles on $[0, 2\\pi]$." },
        { t: "Each full cycle has one positive hump and one negative hump, so there are 4 humps in total." },
        { t: "Taking the modulus flips the two negative humps up, giving 4 identical arches, each of height 3." },
        { t: "The line $y=2$ lies strictly between 0 and 3, so it cuts each arch exactly twice.", m: "4 \\text{ arches} \\times 2 = 8" },
        { t: "Check the endpoints: at $x=0$ and $x=2\\pi$ the value is 0, not 2, so no solution sits on the boundary and none is double-counted." },
      ],
      answer: "8 solutions.",
      remark:
        "The pattern generalises: $|a\\sin bx| = k$ with $0<k<|a|$ has $4b$ solutions in $[0, 2\\pi]$.",
    },
  ],
  examQuestions: [
    {
      id: "trg-eq1",
      title: "Sketch, asymptote and solutions",
      difficulty: "medium",
      marks: 8,
      paper: 2,
      prompt:
        "(a) Sketch $y = 2\\tan\\left(\\tfrac12 x\\right)$ for $0 \\le x \\le 2\\pi$, stating the equation of any asymptote. [4]\n(b) State, with a reason, the number of solutions of $2\\tan\\left(\\tfrac12 x\\right) = 1$ in this interval. [2]\n(c) Solve the equation, giving your answer to 3 significant figures. [2]",
      steps: [
        { t: "(a) The period of $\\tan bx$ is $\\frac{\\pi}{b}$, here with $b = \\frac12$.", m: "\\text{period} = \\frac{\\pi}{1/2} = 2\\pi" },
        { t: "Asymptotes occur where $\\frac12 x = \\frac{\\pi}{2} + n\\pi$.", m: "x = \\pi + 2n\\pi \\;\\Rightarrow\\; x = \\pi \\text{ in this interval}" },
        { t: "So the curve rises from $0$ at $x=0$ to $+\\infty$ as $x \\to \\pi^-$, returns from $-\\infty$ just after $x=\\pi$, and climbs back to $0$ at $x=2\\pi$." },
        { t: "(b) The line $y=1$ is positive, and the curve is positive only on the first branch, $0 \\le x < \\pi$, where it increases from 0 without bound. It therefore crosses exactly once.", m: "1 \\text{ solution}" },
        { t: "(c) Rearrange.", m: "\\tan\\left(\\tfrac12 x\\right) = \\tfrac12" },
        { t: "Take the inverse tangent (radian mode).", m: "\\tfrac12 x = \\arctan 0.5 = 0.46365" },
        { t: "Double it. The next value, $\\frac12 x = 0.46365 + \\pi$, gives $x = 7.21$, which is beyond $2\\pi$.", m: "x = 0.927" },
      ],
      answer: "(a) period $2\\pi$, asymptote $x=\\pi$. (b) One, since the curve is positive only on $0 \\le x < \\pi$. (c) $x = 0.927$.",
    },
    {
      id: "trg-eq2",
      title: "Reading a graph",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt:
        "The curve $y = a\\cos bx + c$ passes through $(0, 5)$, has a minimum value of $-1$, and has period $\\dfrac{2\\pi}{3}$.\n(a) Find $a$, $b$ and $c$. [4]\n(b) State the range of the function. [2]",
      steps: [
        { t: "At $x=0$, $\\cos 0 = 1$, so the curve is at its maximum there.", m: "a + c = 5" },
        { t: "The minimum is $c - a$.", m: "c - a = -1" },
        { t: "Add the two equations.", m: "2c = 4 \\;\\Rightarrow\\; c = 2" },
        { t: "Subtract to find $a$.", m: "a = 3" },
        { t: "Use the period.", m: "\\frac{2\\pi}{b} = \\frac{2\\pi}{3} \\;\\Rightarrow\\; b = 3" },
        { t: "(b) The range runs between the minimum and the maximum.", m: "-1 \\le y \\le 5" },
      ],
      answer: "(a) $a=3$, $b=3$, $c=2$. (b) $-1 \\le y \\le 5$.",
    },
  ],
  mistakes: [
    {
      wrong: "Writing $\\sec x = \\cos^{-1}x$.",
      why: "$\\cos^{-1}$ is the inverse function; $\\sec$ is the reciprocal.",
      fix: "$\\sec x = \\dfrac{1}{\\cos x}$. Say “one over cos” in your head every time.",
    },
    {
      wrong: "Giving the period of $y = a\\tan bx$ as $\\frac{2\\pi}{b}$.",
      why: "Tangent repeats twice as often as sine and cosine.",
      fix: "Period of $\\tan bx$ is $\\dfrac{\\pi}{b}$.",
    },
    {
      wrong: "Saying $y = 3\\sin x + 4$ has range $-3 \\le y \\le 3$.",
      why: "The vertical shift moves the whole range.",
      fix: "Range is $c-|a| \\le y \\le c+|a|$, here $1 \\le y \\le 7$.",
    },
    {
      wrong: "Sketching $y = \\tan x$ with no asymptotes marked.",
      why: "The syllabus explicitly requires the asymptote positions to be labelled.",
      fix: "Draw them as dashed vertical lines and write their equations.",
    },
    {
      wrong: "Assuming $y = a\\tan bx + c$ has an amplitude.",
      why: "The tangent function is unbounded, so no amplitude exists.",
      fix: "Describe it by its period and asymptotes instead.",
    },
  ],
  tips: [
    "Sketch first. Amplitude, period, centre line and the number of solutions all fall out of one picture.",
    "Learn the quadrant signs as CAST, and use reference angles rather than trying to memorise values beyond $90^\\circ$.",
    "The number of cycles in an interval $= \\dfrac{\\text{interval length}}{\\text{period}}$ — a quick check on any sketch you draw.",
    "In calculus every trigonometric angle is in radians. Get into radian mode and stay there.",
    "Reciprocal functions are undefined where their partner is zero — that is exactly where their asymptotes are.",
  ],
  generators: ["trig-amplitude-period", "trig-exact-value", "trig-range-transformed", "trig-solutions-count"],
};
