import type { Topic } from "@/lib/types";

export const differentiation: Topic = {
  slug: "differentiation",
  unit: 14,
  title: "Differentiation",
  short: "Differentiation",
  blurb:
    "The derivative as a gradient function, the standard results, and the chain, product and quotient rules.",
  syllabus: [
    { code: "14.1", text: "Understand the idea of a derived function.", notes: "Only an informal understanding of a limit is expected; differentiation from first principles is not required." },
    { code: "14.2", text: "Use the notations $f'(x)$, $f''(x)$, $\\frac{dy}{dx}$, $\\frac{d^2y}{dx^2}$, $\\delta x$, $\\delta x \\to 0$, $\\frac{\\delta y}{\\delta x}$." },
    { code: "14.3", text: "Know and use the derivatives of $x^n$ (any rational $n$), $\\sin x$, $\\cos x$, $\\tan x$, $e^x$, $\\ln x$, including constant multiples, sums and composite functions (chain rule).", notes: "Trigonometric angles are always in radians." },
    { code: "14.4", text: "Differentiate products and quotients of functions." },
  ],
  prerequisites: ["indices-and-surds", "trigonometric-functions", "logarithms-exponentials"],
  estimatedMinutes: 100,
  sections: [
    {
      id: "idea",
      heading: "What the derivative is",
      body: [
        {
          k: "p",
          t: "The gradient of a straight line is the same everywhere. The gradient of a curve changes from point to point, so “the gradient” has to mean the gradient of the **tangent** at that point. The derivative is the function that returns it.",
        },
        {
          k: "p",
          t: "Take two points on the curve a small distance $\\delta x$ apart. The chord between them has gradient $\\dfrac{\\delta y}{\\delta x}$. Slide the second point towards the first — as $\\delta x \\to 0$ the chord becomes the tangent:",
        },
        { k: "math", t: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = \\lim_{\\delta x \\to 0}\\frac{\\delta y}{\\delta x}" },
        {
          k: "note",
          tone: "info",
          t: "This syllabus asks only for an informal understanding of the limit. Differentiation from first principles is **not** examined — but the notation $\\delta x$, $\\delta x \\to 0$ and $\\frac{\\delta y}{\\delta x}$ is.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-1, 4],
            yRange: [-2, 9],
            curves: [
              { f: (x: number) => x * x - 2 * x + 1, label: "y = x² − 2x + 1" },
              { f: (x: number) => 2 * x - 3, label: "tangent at (2, 1): gradient 2", color: 1 },
            ],
            points: [{ x: 2, y: 1, label: "(2, 1)" }],
            caption: "dy/dx = 2x − 2, so at x = 2 the gradient is 2 — the slope of the tangent drawn here.",
            height: 320,
          },
        },
      ],
    },
    {
      id: "standard",
      heading: "The standard derivatives",
      body: [
        {
          k: "table",
          head: ["$y$", "$\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$", "Note"],
          rows: [
            ["$x^n$", "$nx^{n-1}$", "any rational $n$"],
            ["$\\sin x$", "$\\cos x$", "radians only"],
            ["$\\cos x$", "$-\\sin x$", "note the minus sign"],
            ["$\\tan x$", "$\\sec^2 x$", "radians only"],
            ["$e^x$", "$e^x$", "unchanged"],
            ["$\\ln x$", "$\\dfrac1x$", "for $x>0$"],
            ["constant $c$", "$0$", ""],
          ],
        },
        {
          k: "note",
          tone: "warn",
          title: "None of these is given",
          t: "The syllabus states plainly: “No formulas will be given in the List of formulas for the Calculus section.” Every derivative and integral in the course must be memorised.",
        },
        {
          k: "p",
          t: "Before differentiating, convert roots and fractions into powers. $\\dfrac{3}{x^2}$ is $3x^{-2}$; $\\sqrt{x}$ is $x^{1/2}$; $\\dfrac{5}{\\sqrt x}$ is $5x^{-1/2}$.",
        },
      ],
    },
    {
      id: "chain",
      heading: "The chain rule",
      body: [
        { k: "p", t: "For a function inside a function, differentiate the outside and multiply by the derivative of the inside." },
        { k: "math", t: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = \\frac{\\mathrm{d}y}{\\mathrm{d}u}\\times\\frac{\\mathrm{d}u}{\\mathrm{d}x}" },
        {
          k: "table",
          head: ["$y$", "$\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$"],
          rows: [
            ["$(ax+b)^n$", "$an(ax+b)^{n-1}$"],
            ["$\\sin(ax+b)$", "$a\\cos(ax+b)$"],
            ["$\\cos(ax+b)$", "$-a\\sin(ax+b)$"],
            ["$\\tan(ax+b)$", "$a\\sec^2(ax+b)$"],
            ["$e^{ax+b}$", "$ae^{ax+b}$"],
            ["$\\ln(ax+b)$", "$\\dfrac{a}{ax+b}$"],
          ],
        },
        {
          k: "steps",
          items: [
            { t: "Differentiate $y = \\left(4 + 3x^2\\right)^{1/3}$. The outside function is “to the power $\\frac13$”, the inside is $4+3x^2$.", m: "u = 4 + 3x^2, \\quad y = u^{1/3}" },
            { t: "Differentiate each part.", m: "\\frac{\\mathrm{d}y}{\\mathrm{d}u} = \\tfrac13 u^{-2/3}, \\qquad \\frac{\\mathrm{d}u}{\\mathrm{d}x} = 6x" },
            { t: "Multiply.", m: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = \\tfrac13\\left(4+3x^2\\right)^{-2/3}\\times 6x" },
            { t: "Simplify.", m: "= \\frac{2x}{\\left(4+3x^2\\right)^{2/3}}" },
          ],
        },
      ],
    },
    {
      id: "product-quotient",
      heading: "Products and quotients",
      body: [
        { k: "p", t: "**Product rule.** For $y = uv$:" },
        { k: "math", t: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = u\\frac{\\mathrm{d}v}{\\mathrm{d}x} + v\\frac{\\mathrm{d}u}{\\mathrm{d}x}" },
        { k: "p", t: "**Quotient rule.** For $y = \\dfrac{u}{v}$:" },
        { k: "math", t: "\\frac{\\mathrm{d}y}{\\mathrm{d}x} = \\frac{v\\dfrac{\\mathrm{d}u}{\\mathrm{d}x} - u\\dfrac{\\mathrm{d}v}{\\mathrm{d}x}}{v^2}" },
        {
          k: "note",
          tone: "warn",
          title: "Order matters in the quotient rule",
          t: "The numerator is $vu' - uv'$, in that order — subtraction is not commutative. A memory line: “bottom times derivative of top, minus top times derivative of bottom, all over bottom squared”.",
        },
        {
          k: "note",
          tone: "tip",
          t: "Set out $u$, $v$, $\\frac{\\mathrm du}{\\mathrm dx}$ and $\\frac{\\mathrm dv}{\\mathrm dx}$ in a little table before substituting. It costs ten seconds and prevents almost every product- and quotient-rule error.",
        },
        {
          k: "steps",
          items: [
            { t: "Differentiate $y = x^2 e^{3x}$. Identify the parts.", m: "u = x^2, \\quad v = e^{3x}" },
            { t: "Differentiate each, using the chain rule on $v$.", m: "\\frac{\\mathrm du}{\\mathrm dx} = 2x, \\qquad \\frac{\\mathrm dv}{\\mathrm dx} = 3e^{3x}" },
            { t: "Apply the product rule.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = x^2\\left(3e^{3x}\\right) + e^{3x}(2x)" },
            { t: "Factorise — examiners expect the tidy form.", m: "= x e^{3x}\\left(3x + 2\\right)" },
          ],
        },
      ],
    },
    {
      id: "second",
      heading: "The second derivative",
      body: [
        {
          k: "p",
          t: "Differentiating twice gives $\\dfrac{\\mathrm{d}^2y}{\\mathrm{d}x^2}$, written $f''(x)$. It measures how the gradient itself is changing, and it is what distinguishes maxima from minima in unit 14.9.",
        },
        {
          k: "note",
          tone: "warn",
          t: "$\\dfrac{\\mathrm{d}^2y}{\\mathrm{d}x^2}$ is **not** $\\left(\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}\\right)^2$. It is the derivative of the derivative.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Power rule", latex: "\\frac{\\mathrm{d}}{\\mathrm{d}x}x^n = nx^{n-1}", given: false },
    { name: "Trigonometric derivatives", latex: "\\frac{\\mathrm d}{\\mathrm dx}\\sin x = \\cos x, \\ \\frac{\\mathrm d}{\\mathrm dx}\\cos x = -\\sin x, \\ \\frac{\\mathrm d}{\\mathrm dx}\\tan x = \\sec^2 x", given: false },
    { name: "Exponential and log", latex: "\\frac{\\mathrm d}{\\mathrm dx}e^x = e^x, \\qquad \\frac{\\mathrm d}{\\mathrm dx}\\ln x = \\frac1x", given: false },
    { name: "Chain rule", latex: "\\frac{\\mathrm dy}{\\mathrm dx} = \\frac{\\mathrm dy}{\\mathrm du}\\cdot\\frac{\\mathrm du}{\\mathrm dx}", given: false },
    { name: "Product rule", latex: "(uv)' = uv' + vu'", given: false },
    { name: "Quotient rule", latex: "\\left(\\frac uv\\right)' = \\frac{vu' - uv'}{v^2}", given: false },
  ],
  examples: [
    {
      id: "diff-ex1",
      title: "Powers, roots and reciprocals",
      difficulty: "easy",
      prompt: "Differentiate $y = 3x^4 - \\dfrac{2}{x} + 5\\sqrt{x}$.",
      steps: [
        { t: "Convert every term into a power of $x$.", m: "y = 3x^4 - 2x^{-1} + 5x^{1/2}" },
        { t: "Differentiate term by term with the power rule.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = 12x^3 + 2x^{-2} + \\tfrac52 x^{-1/2}" },
        { t: "Optionally convert back to the original style.", m: "= 12x^3 + \\frac{2}{x^2} + \\frac{5}{2\\sqrt x}" },
      ],
      answer: "$\\dfrac{\\mathrm dy}{\\mathrm dx} = 12x^3 + \\dfrac{2}{x^2} + \\dfrac{5}{2\\sqrt x}$",
    },
    {
      id: "diff-ex2",
      title: "Quotient rule with a trigonometric function",
      difficulty: "medium",
      prompt: "Differentiate $y = \\dfrac{\\sin 2x}{x}$.",
      steps: [
        { t: "Set out the parts.", m: "u = \\sin 2x, \\qquad v = x" },
        { t: "Differentiate each — the chain rule gives the factor 2.", m: "\\frac{\\mathrm du}{\\mathrm dx} = 2\\cos 2x, \\qquad \\frac{\\mathrm dv}{\\mathrm dx} = 1" },
        { t: "Apply the quotient rule.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = \\frac{x(2\\cos 2x) - \\sin 2x (1)}{x^2}" },
        { t: "Tidy.", m: "= \\frac{2x\\cos 2x - \\sin 2x}{x^2}" },
      ],
      answer: "$\\dfrac{2x\\cos 2x - \\sin 2x}{x^2}$",
    },
    {
      id: "diff-ex3",
      title: "Product and chain rules together",
      difficulty: "hard",
      prompt: "Given $y = (2x-1)^4\\ln(3x)$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ and evaluate it at $x=1$.",
      steps: [
        { t: "Identify the two factors.", m: "u = (2x-1)^4, \\qquad v = \\ln 3x" },
        { t: "Differentiate $u$ by the chain rule.", m: "\\frac{\\mathrm du}{\\mathrm dx} = 4(2x-1)^3 \\times 2 = 8(2x-1)^3" },
        { t: "Differentiate $v$. Note $\\ln 3x = \\ln 3 + \\ln x$, so the derivative is simply $\\frac1x$.", m: "\\frac{\\mathrm dv}{\\mathrm dx} = \\frac{1}{x}" },
        { t: "Apply the product rule.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = (2x-1)^4\\cdot\\frac1x + \\ln(3x)\\cdot 8(2x-1)^3" },
        { t: "Evaluate at $x=1$, where $2x-1 = 1$.", m: "= \\frac{1}{1} + 8\\ln 3" },
        { t: "Compute.", m: "= 1 + 8(1.0986) = 9.79" },
      ],
      answer: "$\\dfrac{(2x-1)^4}{x} + 8(2x-1)^3\\ln(3x)$; at $x=1$ this is $1 + 8\\ln 3 \\approx 9.79$.",
      remark: "Splitting $\\ln 3x$ into $\\ln 3 + \\ln x$ makes the derivative obvious and avoids the chain rule entirely.",
    },
    {
      id: "diff-ex4",
      title: "Differentiating an implicit relationship",
      difficulty: "olympiad",
      prompt: "The curve $y = \\dfrac{e^{2x}}{1 + e^{2x}}$ is given. Show that $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x} = 2y(1-y)$.",
      steps: [
        { t: "Apply the quotient rule with $u = e^{2x}$ and $v = 1 + e^{2x}$.", m: "u' = 2e^{2x}, \\qquad v' = 2e^{2x}" },
        { t: "Substitute.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = \\frac{\\left(1+e^{2x}\\right)2e^{2x} - e^{2x}\\left(2e^{2x}\\right)}{\\left(1+e^{2x}\\right)^2}" },
        { t: "Expand the numerator; the $e^{4x}$ terms cancel.", m: "= \\frac{2e^{2x} + 2e^{4x} - 2e^{4x}}{\\left(1+e^{2x}\\right)^2} = \\frac{2e^{2x}}{\\left(1+e^{2x}\\right)^2}" },
        { t: "Now express this using $y$. Note $1 - y = \\dfrac{1}{1+e^{2x}}$.", m: "2y(1-y) = 2\\cdot\\frac{e^{2x}}{1+e^{2x}}\\cdot\\frac{1}{1+e^{2x}}" },
        { t: "Which is exactly the derivative found above.", m: "= \\frac{2e^{2x}}{\\left(1+e^{2x}\\right)^2} = \\frac{\\mathrm dy}{\\mathrm dx} \\ \\blacksquare" },
      ],
      answer: "Shown: both expressions equal $\\dfrac{2e^{2x}}{\\left(1+e^{2x}\\right)^2}$.",
      remark: "This is the logistic curve, and the relationship $y' = 2y(1-y)$ is why it models limited growth.",
    },
  ],
  examQuestions: [
    {
      id: "diff-eq1",
      title: "Chain rule and a gradient",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt:
        "A curve has equation $y = \\sqrt{4x^2 + 9}$.\n(a) Find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$. [4]\n(b) Find the gradient of the curve at the point where $x = 2$. [2]",
      steps: [
        { t: "(a) Write the root as a power.", m: "y = \\left(4x^2+9\\right)^{1/2}" },
        { t: "Differentiate the outside, keeping the inside unchanged.", m: "\\tfrac12\\left(4x^2+9\\right)^{-1/2}" },
        { t: "Multiply by the derivative of the inside.", m: "\\times\\ 8x" },
        { t: "Combine and simplify.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = \\frac{4x}{\\sqrt{4x^2+9}}" },
        { t: "(b) Substitute $x=2$, so $4x^2+9 = 25$.", m: "= \\frac{8}{\\sqrt{25}} = \\frac85" },
      ],
      answer: "(a) $\\dfrac{4x}{\\sqrt{4x^2+9}}$. (b) $\\dfrac85 = 1.6$.",
    },
    {
      id: "diff-eq2",
      title: "Product rule and a stationary point",
      difficulty: "hard",
      marks: 7,
      paper: 1,
      prompt:
        "A curve has equation $y = x^3\\ln x$ for $x>0$.\n(a) Find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$. [3]\n(b) Find the exact $x$-coordinate of the stationary point. [4]",
      steps: [
        { t: "(a) Use the product rule with $u = x^3$ and $v = \\ln x$.", m: "u' = 3x^2, \\qquad v' = \\tfrac1x" },
        { t: "Substitute.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = x^3\\cdot\\frac1x + \\ln x\\cdot 3x^2" },
        { t: "Simplify and factorise.", m: "= x^2 + 3x^2\\ln x = x^2\\left(1 + 3\\ln x\\right)" },
        { t: "(b) A stationary point has zero gradient.", m: "x^2\\left(1+3\\ln x\\right) = 0" },
        { t: "$x^2 = 0$ gives $x=0$, which is outside the domain $x>0$. So the other factor must vanish.", m: "1 + 3\\ln x = 0" },
        { t: "Solve for $\\ln x$.", m: "\\ln x = -\\tfrac13" },
        { t: "Exponentiate.", m: "x = e^{-1/3}" },
      ],
      answer: "(a) $x^2(1+3\\ln x)$. (b) $x = e^{-1/3} \\approx 0.717$.",
    },
  ],
  mistakes: [
    { wrong: "Differentiating $\\sin 3x$ as $\\cos 3x$.", why: "The chain rule contributes the derivative of the inside function.", fix: "$\\frac{\\mathrm d}{\\mathrm dx}\\sin 3x = 3\\cos 3x$." },
    { wrong: "Writing the derivative of $\\cos x$ as $\\sin x$.", why: "The minus sign is part of the result.", fix: "$\\frac{\\mathrm d}{\\mathrm dx}\\cos x = -\\sin x$. Only cosine picks up the minus." },
    { wrong: "Using $\\frac{u'}{v'}$ for the derivative of a quotient.", why: "Derivatives do not distribute over division.", fix: "Use the quotient rule, or rewrite as a product with a negative power." },
    { wrong: "Reversing the numerator of the quotient rule.", why: "$uv' - vu'$ is the negative of the correct answer.", fix: "Bottom times derivative of top **first**." },
    { wrong: "Differentiating trigonometric functions with the calculator in degrees.", why: "The standard derivatives are only valid in radians.", fix: "Work in radians throughout any calculus question." },
    { wrong: "Forgetting to convert $\\frac{1}{x^3}$ before differentiating.", why: "The power rule needs an explicit index.", fix: "Rewrite as $x^{-3}$, then differentiate to $-3x^{-4}$." },
  ],
  tips: [
    "Rewrite before you differentiate: every root and fraction becomes a power first.",
    "Write $u$, $v$, $u'$, $v'$ in a small table before applying the product or quotient rule.",
    "Factorise your answer. It is expected, and it makes the next part — solving $\\frac{\\mathrm dy}{\\mathrm dx}=0$ — far easier.",
    "$\\ln(ax) = \\ln a + \\ln x$, so its derivative is just $\\frac1x$. This shortcut appears every session.",
    "No calculus formula is on the paper. Write the six standard derivatives on your rough paper in the first minute.",
  ],
  generators: ["diff-power-rule", "diff-chain-rule", "diff-product-rule", "diff-quotient-rule", "diff-trig-exp"],
};
