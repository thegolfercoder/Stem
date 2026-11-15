import type { Topic } from "@/lib/types";

export const factorsOfPolynomials: Topic = {
  slug: "factors-of-polynomials",
  unit: 3,
  title: "Factors of polynomials",
  short: "Polynomials",
  blurb:
    "The remainder and factor theorems, and how to take a cubic apart into a linear factor and a quadratic.",
  syllabus: [
    { code: "3.1", text: "Know and use the remainder and factor theorems." },
    { code: "3.2", text: "Find factors of polynomials — for a cubic, obtaining a product of a linear factor and a quadratic factor." },
    { code: "3.3", text: "Solve cubic equations." },
  ],
  prerequisites: ["quadratic-functions"],
  estimatedMinutes: 70,
  sections: [
    {
      id: "remainder-theorem",
      heading: "The remainder theorem",
      body: [
        {
          k: "p",
          t: "Divide a polynomial $P(x)$ by a linear expression and you get a quotient and a remainder, exactly as with numbers. The remainder theorem says you can find that remainder without doing the division at all.",
        },
        {
          k: "note",
          tone: "key",
          title: "Remainder theorem",
          t: "When $P(x)$ is divided by $(x - a)$, the remainder is $P(a)$. More generally, dividing by $(bx - a)$ leaves the remainder $P\\!\\left(\\dfrac{a}{b}\\right)$.",
        },
        {
          k: "p",
          t: "The reason is one line. Write $P(x) = (x-a)Q(x) + R$, where $R$ is a constant because the divisor is linear. Now put $x = a$: the first term dies and $P(a) = R$.",
        },
        {
          k: "note",
          tone: "warn",
          t: "The sign trips people constantly. For a divisor of $(x + 3)$, substitute $x = -3$, because $x+3 = x-(-3)$.",
        },
      ],
    },
    {
      id: "factor-theorem",
      heading: "The factor theorem",
      body: [
        {
          k: "p",
          t: "A remainder of zero means the division was exact — that is, the divisor is a factor.",
        },
        { k: "math", t: "(x - a) \\text{ is a factor of } P(x) \\iff P(a) = 0" },
        {
          k: "p",
          t: "This is the tool for two standard tasks: proving a given bracket is a factor, and finding unknown coefficients.",
        },
        {
          k: "steps",
          items: [
            { t: "Suppose $P(x) = 2x^3 + ax^2 + bx - 6$ has $(x-1)$ as a factor and leaves remainder $-20$ when divided by $(x+2)$. The factor gives one equation.", m: "P(1) = 2 + a + b - 6 = 0 \\;\\Rightarrow\\; a + b = 4" },
            { t: "The remainder gives another.", m: "P(-2) = -16 + 4a - 2b - 6 = -20 \\;\\Rightarrow\\; 4a - 2b = 2" },
            { t: "Solve the pair: from the first, $b = 4-a$; substitute.", m: "4a - 2(4-a) = 2 \\;\\Rightarrow\\; 6a = 10" },
            { t: "Hence the coefficients.", m: "a = \\tfrac{5}{3}, \\qquad b = \\tfrac{7}{3}" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "Which value of $a$ to try",
          t: "If a cubic with integer coefficients has a rational root $\\frac{p}{q}$, then $p$ divides the constant term and $q$ divides the leading coefficient. For $2x^3 - 3x^2 - 11x + 6$, that means trying $\\pm1, \\pm2, \\pm3, \\pm6, \\pm\\tfrac12, \\pm\\tfrac32$ — and $\\pm1$ first, always.",
        },
      ],
    },
    {
      id: "factorising-cubics",
      heading: "Factorising a cubic",
      body: [
        {
          k: "p",
          t: "The route is always the same: find one root by trial, extract the linear factor, then factorise what is left.",
        },
        {
          k: "ol",
          items: [
            "Test small values ($1$, $-1$, $2$, $-2$, then factors of the constant) until $P(a)=0$.",
            "Write down the factor $(x-a)$.",
            "Divide — by long division, or by comparing coefficients — to get the quadratic factor.",
            "Factorise the quadratic if it factorises; otherwise use the formula, or state that it has no real roots.",
          ],
        },
        {
          k: "p",
          t: "**Comparing coefficients** is usually faster than long division and less error-prone under pressure. To factorise $P(x)=2x^3 - 3x^2 - 11x + 6$, note $P(3) = 54 - 27 - 33 + 6 = 0$, so $(x-3)$ is a factor. Write:",
        },
        { k: "math", t: "2x^3 - 3x^2 - 11x + 6 = (x-3)(2x^2 + px - 2)" },
        {
          k: "ul",
          items: [
            "The leading term must give $2x^3$, so the quadratic starts with $2x^2$.",
            "The constant term must give $+6$, and $-3 \\times (-2) = 6$, so it ends with $-2$.",
            "Now compare the $x^2$ terms: on the right, $p x^2 - 6x^2$; on the left, $-3x^2$. So $p - 6 = -3$, giving $p = 3$.",
          ],
        },
        { k: "math", t: "2x^3 - 3x^2 - 11x + 6 = (x-3)(2x^2 + 3x - 2) = (x-3)(2x-1)(x+2)" },
        {
          k: "plot",
          spec: {
            xRange: [-3, 4],
            yRange: [-14, 14],
            curves: [{ f: (x: number) => 2 * x ** 3 - 3 * x ** 2 - 11 * x + 6, label: "y = 2x³ − 3x² − 11x + 6" }],
            points: [
              { x: -2, y: 0, label: "(−2, 0)" },
              { x: 0.5, y: 0, label: "(½, 0)" },
              { x: 3, y: 0, label: "(3, 0)" },
            ],
            caption: "Three real roots, three linear factors. The curve crosses the axis at each one.",
            height: 340,
          },
        },
      ],
    },
    {
      id: "solving-cubics",
      heading: "Solving cubic equations",
      body: [
        {
          k: "p",
          t: "Once factorised, set each factor to zero. A cubic has three roots counted with multiplicity, but they need not all be real: if the quadratic factor has a negative discriminant, only one real root exists.",
        },
        {
          k: "table",
          head: ["Quadratic factor", "Real roots of the cubic", "Shape"],
          rows: [
            ["Two distinct roots", "Three", "Crosses the axis three times"],
            ["A repeated root", "Two (one repeated)", "Crosses once, touches once"],
            ["No real roots", "One", "Crosses once, no turning points on the axis"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "A repeated factor $(x-a)^2$ makes the curve **touch** the axis at $x = a$; a triple factor $(x-a)^3$ makes it flatten and pass through. Sketch questions test exactly this.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Remainder theorem", latex: "P(x) \\div (x-a) \\text{ leaves } P(a)", given: false },
    { name: "Remainder for a general linear divisor", latex: "P(x) \\div (bx-a) \\text{ leaves } P\\!\\left(\\tfrac{a}{b}\\right)", given: false },
    { name: "Factor theorem", latex: "P(a) = 0 \\iff (x-a) \\mid P(x)", given: false },
    { name: "Cubic factorisation", latex: "P(x) = (x-a)\\left(Ax^2 + Bx + C\\right)", given: false, note: "Find $A$, $B$, $C$ by comparing coefficients." },
  ],
  examples: [
    {
      id: "poly-ex1",
      title: "Remainder without dividing",
      difficulty: "easy",
      prompt: "Find the remainder when $P(x) = x^3 - 4x^2 + 7x - 5$ is divided by $(x - 3)$.",
      steps: [
        { t: "The remainder theorem says to evaluate at the value that makes the divisor zero, here $x = 3$.", m: "P(3) = 3^3 - 4(3)^2 + 7(3) - 5" },
        { t: "Evaluate term by term.", m: "= 27 - 36 + 21 - 5" },
        { t: "Add up.", m: "= 7" },
      ],
      answer: "Remainder $7$.",
    },
    {
      id: "poly-ex2",
      title: "Full factorisation of a cubic",
      difficulty: "medium",
      prompt: "Factorise $P(x) = x^3 + 2x^2 - 5x - 6$ completely, and hence solve $P(x)=0$.",
      steps: [
        { t: "Try small values. $P(1) = 1 + 2 - 5 - 6 = -8$, not zero. Try $x = -1$.", m: "P(-1) = -1 + 2 + 5 - 6 = 0" },
        { t: "So $(x+1)$ is a factor. Write the cubic as $(x+1)$ times a quadratic.", m: "x^3 + 2x^2 - 5x - 6 = (x+1)(x^2 + px + q)" },
        { t: "Compare constants: $1 \\times q = -6$, so $q = -6$. Compare $x^2$ terms: $p + 1 = 2$, so $p = 1$.", m: "= (x+1)(x^2 + x - 6)" },
        { t: "Factorise the quadratic: two numbers multiplying to $-6$ and adding to $1$ are $3$ and $-2$.", m: "= (x+1)(x+3)(x-2)" },
        { t: "Set each factor to zero.", m: "x = -1,\\ -3,\\ 2" },
      ],
      answer: "$P(x) = (x+1)(x+3)(x-2)$; roots $x = -3, -1, 2$.",
    },
    {
      id: "poly-ex3",
      title: "Two unknown coefficients",
      difficulty: "hard",
      prompt:
        "The polynomial $P(x) = 2x^3 + ax^2 + bx + 12$ is divisible by $(x-2)$ and leaves a remainder of $30$ when divided by $(x+1)$. Find $a$ and $b$, and factorise $P(x)$ fully.",
      steps: [
        { t: "Divisible by $(x-2)$ means $P(2)=0$.", m: "16 + 4a + 2b + 12 = 0 \\;\\Rightarrow\\; 4a + 2b = -28 \\;\\Rightarrow\\; 2a + b = -14" },
        { t: "Remainder 30 on division by $(x+1)$ means $P(-1) = 30$.", m: "-2 + a - b + 12 = 30 \\;\\Rightarrow\\; a - b = 20" },
        { t: "Add the two equations to eliminate $b$.", m: "3a = 6 \\;\\Rightarrow\\; a = 2" },
        { t: "Back-substitute.", m: "b = a - 20 = -18" },
        { t: "So $P(x) = 2x^3 + 2x^2 - 18x + 12$, with $(x-2)$ a known factor. Compare coefficients.", m: "= (x-2)(2x^2 + px - 6)" },
        { t: "The $x^2$ terms give $p - 4 = 2$, so $p = 6$.", m: "= (x-2)(2x^2 + 6x - 6) = 2(x-2)(x^2+3x-3)" },
        { t: "The quadratic has discriminant $9 + 12 = 21 > 0$ but does not factorise over the integers, so leave it or use the formula.", m: "x = 2 \\quad \\text{or} \\quad x = \\frac{-3 \\pm \\sqrt{21}}{2}" },
      ],
      answer: "$a=2$, $b=-18$; $P(x) = 2(x-2)\\left(x^2+3x-3\\right)$.",
    },
    {
      id: "poly-ex4",
      title: "A factor of a quartic in disguise",
      difficulty: "olympiad",
      prompt: "Show that $(x^2 - 3x + 2)$ is a factor of $Q(x) = x^4 - 4x^3 + 6x^2 - 5x + 2$, and hence solve $Q(x) = 0$.",
      steps: [
        { t: "Factorise the proposed divisor: it is a product of two linear factors.", m: "x^2 - 3x + 2 = (x-1)(x-2)" },
        { t: "So it suffices to show both $x=1$ and $x=2$ are roots. Test $x=1$.", m: "Q(1) = 1 - 4 + 6 - 5 + 2 = 0 \\ \\checkmark" },
        { t: "Test $x=2$.", m: "Q(2) = 16 - 32 + 24 - 10 + 2 = 0 \\ \\checkmark" },
        { t: "Both give zero, so both linear factors divide $Q$, hence so does their product. Now write the quotient as a quadratic.", m: "Q(x) = (x^2 - 3x + 2)(x^2 + px + 1)" },
        { t: "The constant terms give $2 \\times 1 = 2$ ✓. Compare $x^3$ terms: $p - 3 = -4$, so $p = -1$.", m: "Q(x) = (x^2-3x+2)(x^2 - x + 1)" },
        { t: "The second quadratic has discriminant $1 - 4 = -3 < 0$, so it contributes no real roots." },
        { t: "The real roots come only from the first factor.", m: "x = 1 \\quad \\text{or} \\quad x = 2" },
      ],
      answer: "$Q(x) = (x-1)(x-2)(x^2-x+1)$; the real roots are $x=1$ and $x=2$.",
      remark: "Checking a quadratic factor by testing its roots one at a time is much quicker than dividing.",
    },
  ],
  examQuestions: [
    {
      id: "poly-eq1",
      title: "Factor theorem and cubic solution",
      difficulty: "medium",
      marks: 7,
      paper: 1,
      prompt:
        "$P(x) = 3x^3 - 14x^2 + 7x + 4$.\n(a) Show that $(x-4)$ is a factor of $P(x)$. [2]\n(b) Factorise $P(x)$ completely. [3]\n(c) Hence solve $P(x)=0$. [2]",
      steps: [
        { t: "(a) By the factor theorem, evaluate at $x=4$.", m: "P(4) = 3(64) - 14(16) + 28 + 4 = 192 - 224 + 32 = 0" },
        { t: "Since $P(4)=0$, $(x-4)$ is a factor." },
        { t: "(b) Write $P(x) = (x-4)(3x^2 + px - 1)$: the leading terms force $3x^2$, and the constants force $-1$ since $-4 \\times -1 = 4$." },
        { t: "Compare the $x^2$ coefficients: $p - 12 = -14$.", m: "p = -2" },
        { t: "Factorise the quadratic $3x^2 - 2x - 1$: it splits as $(3x+1)(x-1)$.", m: "P(x) = (x-4)(3x+1)(x-1)" },
        { t: "(c) Set each factor to zero.", m: "x = 4,\\quad x = -\\tfrac13,\\quad x = 1" },
      ],
      answer: "(b) $(x-4)(3x+1)(x-1)$. (c) $x = -\\tfrac13,\\ 1,\\ 4$.",
    },
    {
      id: "poly-eq2",
      title: "Simultaneous conditions on a cubic",
      difficulty: "hard",
      marks: 8,
      paper: 1,
      prompt:
        "The polynomial $P(x) = x^3 + ax^2 + bx - 8$ leaves the same remainder when divided by $(x-1)$ and by $(x+2)$, and $(x-2)$ is a factor.\n(a) Find $a$ and $b$. [6]\n(b) Find all real roots of $P(x) = 0$. [2]",
      steps: [
        { t: "(a) “Same remainder” means the two evaluations are equal.", m: "P(1) = P(-2)" },
        { t: "Compute both.", m: "1 + a + b - 8 = -8 + 4a - 2b - 8" },
        { t: "Simplify.", m: "a + b - 7 = 4a - 2b - 16 \\;\\Rightarrow\\; 3a - 3b = 9 \\;\\Rightarrow\\; a - b = 3" },
        { t: "The factor condition gives a second equation.", m: "P(2) = 8 + 4a + 2b - 8 = 0 \\;\\Rightarrow\\; 4a + 2b = 0 \\;\\Rightarrow\\; b = -2a" },
        { t: "Substitute into $a - b = 3$.", m: "a + 2a = 3 \\;\\Rightarrow\\; a = 1,\\quad b = -2" },
        { t: "(b) So $P(x) = x^3 + x^2 - 2x - 8$, with $(x-2)$ a factor. Compare coefficients.", m: "= (x-2)(x^2 + 3x + 4)" },
        { t: "The quadratic has discriminant $9 - 16 = -7 < 0$, so it gives no real roots.", m: "x = 2 \\text{ only}" },
      ],
      answer: "(a) $a=1$, $b=-2$. (b) $x=2$ is the only real root.",
    },
  ],
  mistakes: [
    {
      wrong: "Substituting $x = 3$ when dividing by $(x+3)$.",
      why: "The theorem uses the value that makes the divisor zero.",
      fix: "$x + 3 = 0$ gives $x = -3$. Write the little equation out rather than guessing the sign.",
    },
    {
      wrong: "Concluding “$(x-a)$ is a factor” from a non-zero remainder.",
      why: "Only a remainder of exactly zero proves a factor.",
      fix: "Show the substitution and the line $P(a)=0$ explicitly — the working is worth a mark.",
    },
    {
      wrong: "Stopping at $(x-a)(\\text{quadratic})$ when asked to factorise completely.",
      why: "If the quadratic factorises further, the answer is incomplete.",
      fix: "Always test the quadratic. Only stop when its discriminant is negative or it is genuinely irreducible over the integers.",
    },
    {
      wrong: "Losing the leading coefficient during long division or comparison.",
      why: "For $2x^3 + \\ldots$ the quadratic factor must begin $2x^2$, not $x^2$.",
      fix: "Match the highest and lowest terms first — both are one-step checks.",
    },
    {
      wrong: "Reporting three roots when the quadratic factor has no real roots.",
      why: "A cubic always has three roots in the complex numbers but need not have three real ones.",
      fix: "Check the discriminant of the quadratic factor and say so in words.",
    },
  ],
  tips: [
    "Try $x=1$ first — it is arithmetic-free: it is just the sum of the coefficients.",
    "For $ax^3 + \\ldots + d$, only test values $\\frac{p}{q}$ where $p$ divides $d$ and $q$ divides $a$. That is a short list.",
    "Comparing coefficients beats long division on a two-hour paper, and leaves a clearer trail for the marker.",
    "In a “show that” part, finish with a sentence: “since $P(4)=0$, $(x-4)$ is a factor”. The conclusion earns the mark.",
    "Repeated factor $\\Rightarrow$ the curve touches the axis. Use that to sanity-check any sketch you draw.",
  ],
  generators: ["poly-remainder", "poly-factor-check", "poly-find-coefficient", "poly-solve-cubic"],
};
