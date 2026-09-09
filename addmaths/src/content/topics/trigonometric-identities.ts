import type { Topic } from "@/lib/types";

export const trigonometricIdentities: Topic = {
  slug: "trigonometric-identities",
  unit: 10,
  title: "Trigonometric identities and proofs",
  short: "Trig identities",
  blurb:
    "Three Pythagorean identities and the quotient relations — enough to prove anything the syllabus asks for.",
  syllabus: [
    { code: "10.4", text: "Use the relationships $\\sin^2 A + \\cos^2 A = 1$, $\\sec^2 A = 1 + \\tan^2 A$, $\\operatorname{cosec}^2 A = 1 + \\cot^2 A$.", notes: "These identities are given in the List of formulas." },
    { code: "10.6", text: "Prove trigonometric relationships involving the six trigonometric functions, e.g. $\\sin x\\tan x + \\cos x = \\sec x$." },
  ],
  prerequisites: ["trigonometric-functions"],
  estimatedMinutes: 75,
  sections: [
    {
      id: "the-identities",
      heading: "The identities you are given",
      body: [
        { k: "p", t: "Three Pythagorean identities appear on page 2 of the exam paper. All three are the same statement, divided through by different things." },
        { k: "math", t: "\\sin^2 A + \\cos^2 A = 1" },
        { k: "math", t: "\\sec^2 A = 1 + \\tan^2 A \\qquad\\qquad \\operatorname{cosec}^2 A = 1 + \\cot^2 A" },
        {
          k: "note",
          tone: "key",
          title: "Where the other two come from",
          t: "Divide $\\sin^2 A + \\cos^2 A = 1$ by $\\cos^2 A$ to get $\\tan^2 A + 1 = \\sec^2 A$. Divide by $\\sin^2 A$ instead to get $1 + \\cot^2 A = \\operatorname{cosec}^2 A$. Knowing the derivation means never misremembering which side the 1 sits on.",
        },
        { k: "p", t: "Two quotient relations complete the toolkit, and these are **not** given:" },
        { k: "math", t: "\\tan A = \\frac{\\sin A}{\\cos A}, \\qquad \\cot A = \\frac{\\cos A}{\\sin A}" },
        {
          k: "note",
          tone: "warn",
          t: "$\\sin^2 A$ means $(\\sin A)^2$, not $\\sin(A^2)$. The notation is a historical accident but it is universal, and misreading it makes an identity impossible to prove.",
        },
      ],
    },
    {
      id: "proof-strategy",
      heading: "How to prove an identity",
      body: [
        {
          k: "note",
          tone: "key",
          title: "The one rule",
          t: "Work on **one side only** until it becomes the other. Never move terms across the equals sign — you are proving the two sides are equal, so you cannot assume it.",
        },
        {
          k: "ol",
          items: [
            "Start with the **more complicated** side. There is more to do there, so there is more that can be simplified.",
            "Write everything in terms of $\\sin$ and $\\cos$. This one step solves the large majority of proofs.",
            "Combine fractions over a common denominator.",
            "Look for $\\sin^2 + \\cos^2$ — replace it with 1 — or for a difference of two squares.",
            "Finish by converting back to whatever functions the target side uses.",
          ],
        },
        {
          k: "steps",
          items: [
            { t: "Prove $\\sin x\\tan x + \\cos x = \\sec x$. Start with the left side and write $\\tan x$ in terms of $\\sin$ and $\\cos$.", m: "\\sin x\\cdot\\frac{\\sin x}{\\cos x} + \\cos x" },
            { t: "Combine over the common denominator $\\cos x$.", m: "= \\frac{\\sin^2 x}{\\cos x} + \\frac{\\cos^2 x}{\\cos x} = \\frac{\\sin^2 x + \\cos^2 x}{\\cos x}" },
            { t: "Apply the Pythagorean identity to the numerator.", m: "= \\frac{1}{\\cos x}" },
            { t: "Recognise the reciprocal.", m: "= \\sec x \\ \\blacksquare" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "The conjugate trick",
          t: "When you meet $\\dfrac{1}{1 + \\sin x}$ or $\\dfrac{\\cos x}{1 - \\sin x}$, multiply top and bottom by the conjugate. $\\left(1+\\sin x\\right)\\left(1 - \\sin x\\right) = 1 - \\sin^2 x = \\cos^2 x$, and the whole expression collapses.",
        },
      ],
    },
    {
      id: "worked-proofs",
      heading: "Two harder proofs",
      body: [
        {
          k: "steps",
          items: [
            { t: "Prove $\\dfrac{1+\\cos\\theta}{\\sin\\theta} + \\dfrac{\\sin\\theta}{1+\\cos\\theta} = 2\\operatorname{cosec}\\theta$. The left side is more complicated — combine the two fractions.", m: "\\frac{(1+\\cos\\theta)^2 + \\sin^2\\theta}{\\sin\\theta\\left(1+\\cos\\theta\\right)}" },
            { t: "Expand the numerator.", m: "= \\frac{1 + 2\\cos\\theta + \\cos^2\\theta + \\sin^2\\theta}{\\sin\\theta(1+\\cos\\theta)}" },
            { t: "Use $\\cos^2 + \\sin^2 = 1$.", m: "= \\frac{2 + 2\\cos\\theta}{\\sin\\theta(1+\\cos\\theta)}" },
            { t: "Factor 2 out of the numerator, and cancel the common bracket.", m: "= \\frac{2(1+\\cos\\theta)}{\\sin\\theta(1+\\cos\\theta)} = \\frac{2}{\\sin\\theta}" },
            { t: "Convert to the required form.", m: "= 2\\operatorname{cosec}\\theta \\ \\blacksquare" },
          ],
        },
        {
          k: "steps",
          items: [
            { t: "Prove $\\dfrac{\\cos x}{1-\\sin x} = \\sec x + \\tan x$. Multiply top and bottom by the conjugate $1+\\sin x$.", m: "\\frac{\\cos x(1+\\sin x)}{(1-\\sin x)(1+\\sin x)}" },
            { t: "The denominator is a difference of two squares.", m: "= \\frac{\\cos x(1+\\sin x)}{1 - \\sin^2 x} = \\frac{\\cos x(1+\\sin x)}{\\cos^2 x}" },
            { t: "Cancel one factor of $\\cos x$.", m: "= \\frac{1+\\sin x}{\\cos x}" },
            { t: "Split the fraction.", m: "= \\frac{1}{\\cos x} + \\frac{\\sin x}{\\cos x} = \\sec x + \\tan x \\ \\blacksquare" },
          ],
        },
      ],
    },
    {
      id: "using-identities",
      heading: "Using identities to find values",
      body: [
        {
          k: "p",
          t: "Given one ratio and a quadrant, the identities produce all the others without ever finding the angle.",
        },
        {
          k: "steps",
          items: [
            { t: "Given $\\sin\\theta = \\tfrac35$ with $\\theta$ obtuse, find $\\cos\\theta$ and $\\tan\\theta$. Start from the Pythagorean identity.", m: "\\cos^2\\theta = 1 - \\left(\\tfrac35\\right)^2 = \\tfrac{16}{25}" },
            { t: "Take the square root — **both** signs are possible at this stage.", m: "\\cos\\theta = \\pm\\tfrac45" },
            { t: "Obtuse means the second quadrant, where cosine is negative.", m: "\\cos\\theta = -\\tfrac45" },
            { t: "Now use the quotient relation.", m: "\\tan\\theta = \\frac{3/5}{-4/5} = -\\tfrac34" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "The quadrant information is not decoration — it is what chooses the sign. Ignoring it gives a half-correct answer and half the marks.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Pythagorean identity", latex: "\\sin^2 A + \\cos^2 A = 1", given: true },
    { name: "Secant form", latex: "\\sec^2 A = 1 + \\tan^2 A", given: true },
    { name: "Cosecant form", latex: "\\operatorname{cosec}^2 A = 1 + \\cot^2 A", given: true },
    { name: "Quotient relations", latex: "\\tan A = \\frac{\\sin A}{\\cos A}, \\qquad \\cot A = \\frac{\\cos A}{\\sin A}", given: false },
    { name: "Difference of squares (used constantly)", latex: "(1-\\sin A)(1+\\sin A) = \\cos^2 A", given: false },
  ],
  examples: [
    {
      id: "id-ex1",
      title: "A short proof",
      difficulty: "easy",
      prompt: "Prove that $\\cos\\theta\\cot\\theta + \\sin\\theta = \\operatorname{cosec}\\theta$.",
      steps: [
        { t: "Take the left side and write $\\cot\\theta$ in terms of sine and cosine.", m: "\\cos\\theta \\cdot \\frac{\\cos\\theta}{\\sin\\theta} + \\sin\\theta" },
        { t: "Put over a common denominator.", m: "= \\frac{\\cos^2\\theta + \\sin^2\\theta}{\\sin\\theta}" },
        { t: "Apply the Pythagorean identity.", m: "= \\frac{1}{\\sin\\theta}" },
        { t: "Recognise the reciprocal function.", m: "= \\operatorname{cosec}\\theta \\ \\blacksquare" },
      ],
      answer: "Shown: both sides equal $\\dfrac{1}{\\sin\\theta}$.",
    },
    {
      id: "id-ex2",
      title: "Values from one ratio",
      difficulty: "medium",
      prompt: "Given that $\\tan\\theta = -\\dfrac{5}{12}$ and $270^\\circ < \\theta < 360^\\circ$, find the exact values of $\\sin\\theta$ and $\\sec\\theta$.",
      steps: [
        { t: "Use the secant identity to avoid separate work for cosine.", m: "\\sec^2\\theta = 1 + \\tan^2\\theta = 1 + \\frac{25}{144} = \\frac{169}{144}" },
        { t: "Take the square root, keeping both signs for now.", m: "\\sec\\theta = \\pm\\frac{13}{12}" },
        { t: "In the fourth quadrant cosine is positive, so secant is positive.", m: "\\sec\\theta = \\frac{13}{12}, \\qquad \\cos\\theta = \\frac{12}{13}" },
        { t: "Find sine from the quotient relation.", m: "\\sin\\theta = \\tan\\theta\\cos\\theta = -\\frac{5}{12}\\times\\frac{12}{13}" },
        { t: "Simplify. Sine is negative in the fourth quadrant, as expected.", m: "\\sin\\theta = -\\frac{5}{13}" },
      ],
      answer: "$\\sin\\theta = -\\dfrac{5}{13}$, $\\sec\\theta = \\dfrac{13}{12}$.",
    },
    {
      id: "id-ex3",
      title: "A proof needing the conjugate",
      difficulty: "hard",
      prompt: "Prove that $\\dfrac{1}{\\sec\\theta - \\tan\\theta} = \\sec\\theta + \\tan\\theta$.",
      steps: [
        { t: "Take the left side and multiply top and bottom by the conjugate.", m: "\\frac{1}{\\sec\\theta - \\tan\\theta} \\times \\frac{\\sec\\theta + \\tan\\theta}{\\sec\\theta + \\tan\\theta}" },
        { t: "The denominator is a difference of two squares.", m: "= \\frac{\\sec\\theta + \\tan\\theta}{\\sec^2\\theta - \\tan^2\\theta}" },
        { t: "Use the given identity $\\sec^2\\theta = 1 + \\tan^2\\theta$, so the denominator is 1.", m: "\\sec^2\\theta - \\tan^2\\theta = 1" },
        { t: "Hence the whole expression reduces.", m: "= \\sec\\theta + \\tan\\theta \\ \\blacksquare" },
      ],
      answer: "Shown, using $\\sec^2\\theta - \\tan^2\\theta = 1$.",
      remark: "This identity is worth remembering in its own right: $\\sec\\theta - \\tan\\theta$ and $\\sec\\theta+\\tan\\theta$ are reciprocals.",
    },
    {
      id: "id-ex4",
      title: "Eliminating a parameter",
      difficulty: "olympiad",
      prompt: "A point moves so that $x = 3\\sec\\theta$ and $y = 2\\tan\\theta$. Find a relationship between $x$ and $y$ that does not involve $\\theta$.",
      steps: [
        { t: "Make the trigonometric functions the subjects.", m: "\\sec\\theta = \\frac{x}{3}, \\qquad \\tan\\theta = \\frac{y}{2}" },
        { t: "Choose the identity that links exactly those two functions.", m: "\\sec^2\\theta - \\tan^2\\theta = 1" },
        { t: "Substitute.", m: "\\left(\\frac{x}{3}\\right)^2 - \\left(\\frac{y}{2}\\right)^2 = 1" },
        { t: "Write it out.", m: "\\frac{x^2}{9} - \\frac{y^2}{4} = 1" },
      ],
      answer: "$\\dfrac{x^2}{9} - \\dfrac{y^2}{4} = 1$ — a hyperbola.",
      remark: "Parameter elimination is just identity selection: pick the identity whose two functions are the ones in front of you.",
    },
  ],
  examQuestions: [
    {
      id: "id-eq1",
      title: "Prove and then use",
      difficulty: "hard",
      marks: 8,
      paper: 1,
      prompt:
        "(a) Prove that $\\dfrac{\\tan\\theta}{1+\\sec\\theta} + \\dfrac{1+\\sec\\theta}{\\tan\\theta} = 2\\operatorname{cosec}\\theta$. [5]\n(b) Hence solve $\\dfrac{\\tan\\theta}{1+\\sec\\theta} + \\dfrac{1+\\sec\\theta}{\\tan\\theta} = 4$ for $0^\\circ < \\theta < 360^\\circ$. [3]",
      steps: [
        { t: "(a) Combine the left side over a common denominator.", m: "\\frac{\\tan^2\\theta + \\left(1+\\sec\\theta\\right)^2}{\\tan\\theta\\left(1+\\sec\\theta\\right)}" },
        { t: "Expand the numerator.", m: "= \\frac{\\tan^2\\theta + 1 + 2\\sec\\theta + \\sec^2\\theta}{\\tan\\theta(1+\\sec\\theta)}" },
        { t: "Replace $\\tan^2\\theta + 1$ with $\\sec^2\\theta$.", m: "= \\frac{2\\sec^2\\theta + 2\\sec\\theta}{\\tan\\theta(1+\\sec\\theta)}" },
        { t: "Factorise the numerator.", m: "= \\frac{2\\sec\\theta\\left(\\sec\\theta + 1\\right)}{\\tan\\theta(1+\\sec\\theta)} = \\frac{2\\sec\\theta}{\\tan\\theta}" },
        { t: "Write both in terms of sine and cosine and simplify.", m: "= \\frac{2}{\\cos\\theta}\\times\\frac{\\cos\\theta}{\\sin\\theta} = \\frac{2}{\\sin\\theta} = 2\\operatorname{cosec}\\theta \\ \\blacksquare" },
        { t: "(b) By part (a) the equation becomes a simple one.", m: "2\\operatorname{cosec}\\theta = 4 \\;\\Rightarrow\\; \\sin\\theta = \\tfrac12" },
        { t: "Solve in the given interval: sine is positive in the first and second quadrants.", m: "\\theta = 30^\\circ \\text{ or } 150^\\circ" },
        { t: "Check neither makes a denominator zero: $\\tan 30^\\circ$ and $\\tan 150^\\circ$ are both non-zero ✓." },
      ],
      answer: "(b) $\\theta = 30^\\circ$ or $150^\\circ$.",
    },
    {
      id: "id-eq2",
      title: "Identity into a quadratic",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt: "Show that the equation $2\\sin^2\\theta = 3\\cos\\theta$ can be written as a quadratic in $\\cos\\theta$, and solve it for $0 \\le \\theta \\le 2\\pi$. [6]",
      steps: [
        { t: "Replace $\\sin^2\\theta$ using the Pythagorean identity so that only cosine appears.", m: "2\\left(1 - \\cos^2\\theta\\right) = 3\\cos\\theta" },
        { t: "Expand and collect.", m: "2 - 2\\cos^2\\theta = 3\\cos\\theta \\;\\Rightarrow\\; 2\\cos^2\\theta + 3\\cos\\theta - 2 = 0" },
        { t: "Factorise, treating $\\cos\\theta$ as the variable.", m: "(2\\cos\\theta - 1)(\\cos\\theta + 2) = 0" },
        { t: "The second factor gives $\\cos\\theta = -2$, which is impossible since $|\\cos\\theta| \\le 1$. Reject it.", m: "\\cos\\theta = \\tfrac12" },
        { t: "Solve in $[0, 2\\pi]$: cosine is positive in the first and fourth quadrants.", m: "\\theta = \\frac{\\pi}{3} \\text{ or } \\frac{5\\pi}{3}" },
      ],
      answer: "$2\\cos^2\\theta + 3\\cos\\theta - 2 = 0$; $\\theta = \\dfrac{\\pi}{3}$ or $\\dfrac{5\\pi}{3}$.",
    },
  ],
  mistakes: [
    {
      wrong: "Moving terms from one side of the identity to the other during a proof.",
      why: "That assumes what you are trying to prove.",
      fix: "Work down one side only, and finish when it matches the other side exactly.",
    },
    {
      wrong: "Writing $\\sec^2 A = \\tan^2 A - 1$.",
      why: "The 1 is on the wrong side.",
      fix: "Derive it: divide $\\sin^2+\\cos^2=1$ by $\\cos^2$ to get $\\tan^2 A + 1 = \\sec^2 A$.",
    },
    {
      wrong: "Taking $\\cos\\theta = +\\frac45$ without checking the quadrant.",
      why: "A square root has two signs and the quadrant decides which is correct.",
      fix: "Read the given range, apply CAST, and state the sign explicitly.",
    },
    {
      wrong: "Keeping the root $\\cos\\theta = -2$.",
      why: "Sine and cosine are bounded by $\\pm1$.",
      fix: "Discard any root outside $[-1,1]$ and say why — the rejection is often worth a mark.",
    },
    {
      wrong: "Cancelling $\\sin\\theta$ from both sides of an equation.",
      why: "It throws away the solutions where $\\sin\\theta = 0$.",
      fix: "Factorise instead: $\\sin\\theta(\\ldots) = 0$ keeps both branches.",
    },
  ],
  tips: [
    "The default move is: convert everything to sine and cosine. It works far more often than any clever alternative.",
    "The three Pythagorean identities are given on the paper, but the quotient relations are not. Learn those two.",
    "A denominator of the form $1 \\pm \\sin$ or $1 \\pm \\cos$ is a signal to multiply by the conjugate.",
    "End a proof with a visible conclusion — “$= $ RHS” or a box — so the marker sees you finished.",
    "In a “hence” part, the previous result is the fast route. If you find yourself starting over, you have missed the link.",
  ],
  generators: ["id-simplify", "id-values-from-ratio", "id-quadratic-form"],
};
