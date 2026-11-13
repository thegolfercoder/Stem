import type { Topic } from "@/lib/types";

export const simultaneousEquations: Topic = {
  slug: "simultaneous-equations",
  unit: 5,
  title: "Simultaneous equations",
  short: "Simultaneous",
  blurb:
    "One linear, one not: the substitution routine that handles every non-linear pair the syllabus can ask for.",
  syllabus: [
    { code: "5.1", text: "Solve simultaneous equations in two unknowns by elimination or substitution, including non-linear pairs such as $y-x+3=0$ with $x^2-3xy+y^2+19=0$, or $xy^2=4$ with $xy=3$." },
  ],
  prerequisites: ["quadratic-functions"],
  estimatedMinutes: 60,
  sections: [
    {
      id: "method",
      heading: "The method that always works",
      body: [
        {
          k: "p",
          t: "In this syllabus one of the two equations is almost always linear (or easily made so). That equation is the one you rearrange, because it produces no square roots and no extra cases.",
        },
        {
          k: "ol",
          items: [
            "Make the **simpler** variable the subject of the **linear** equation.",
            "Substitute into the second equation. You should be left with a quadratic in one variable.",
            "Solve it — factorise if you can, otherwise use the formula.",
            "Substitute each root back into the **linear** equation to get its partner.",
            "Present the answers as **pairs**: $(x_1, y_1)$ and $(x_2, y_2)$.",
          ],
        },
        {
          k: "note",
          tone: "warn",
          title: "Pair them up",
          t: "Substituting back into the *quadratic* equation is the classic error: it can give two $y$ values for one $x$, and you cannot tell which belongs to which. Always go back to the linear equation.",
        },
      ],
    },
    {
      id: "worked-routine",
      heading: "The routine in action",
      body: [
        {
          k: "steps",
          items: [
            { t: "Solve $y - x + 3 = 0$ together with $x^2 - 3xy + y^2 + 19 = 0$. Make $y$ the subject of the linear equation.", m: "y = x - 3" },
            { t: "Substitute into the second equation.", m: "x^2 - 3x(x-3) + (x-3)^2 + 19 = 0" },
            { t: "Expand each piece carefully.", m: "x^2 - 3x^2 + 9x + x^2 - 6x + 9 + 19 = 0" },
            { t: "Collect like terms.", m: "-x^2 + 3x + 28 = 0 \\;\\Rightarrow\\; x^2 - 3x - 28 = 0" },
            { t: "Factorise.", m: "(x-7)(x+4) = 0 \\;\\Rightarrow\\; x = 7 \\text{ or } x = -4" },
            { t: "Use $y = x-3$ for each.", m: "(7, 4) \\quad \\text{and} \\quad (-4, -7)" },
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-8, 10],
            yRange: [-10, 8],
            curves: [
              { f: (x: number) => x - 3, label: "y = x − 3" },
              {
                // The conic x² − 3xy + y² + 19 = 0, solved for y: quadratic in y.
                f: (x: number) => (3 * x + Math.sqrt(Math.max(0, 5 * x * x - 76))) / 2,
                label: "x² − 3xy + y² + 19 = 0",
                color: 1,
              },
              { f: (x: number) => (3 * x - Math.sqrt(Math.max(0, 5 * x * x - 76))) / 2, color: 1 },
            ],
            points: [
              { x: 7, y: 4, label: "(7, 4)" },
              { x: -4, y: -7, label: "(−4, −7)" },
            ],
            caption: "Geometrically, the solutions are the points where the line meets the conic.",
            height: 360,
          },
        },
      ],
    },
    {
      id: "both-non-linear",
      heading: "When neither equation is linear",
      body: [
        {
          k: "p",
          t: "Pairs like $xy^2 = 4$ and $xy = 3$ look harder but are usually easier: divide one by the other, and most of the algebra disappears.",
        },
        {
          k: "steps",
          items: [
            { t: "Divide the first equation by the second — legitimate because $xy = 3 \\ne 0$.", m: "\\frac{xy^2}{xy} = \\frac{4}{3} \\;\\Rightarrow\\; y = \\tfrac{4}{3}" },
            { t: "Substitute into $xy = 3$.", m: "x \\cdot \\tfrac43 = 3 \\;\\Rightarrow\\; x = \\tfrac94" },
            { t: "State the single solution pair.", m: "\\left(\\tfrac94, \\tfrac43\\right)" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "Other useful moves: if both equations contain $x^2$ and $y^2$, subtract them to eliminate a square; if one contains a fraction like $\\frac{2x}{y}$, multiply through by $y$ first and remember $y \\ne 0$.",
        },
      ],
    },
    {
      id: "interpreting",
      heading: "What the number of solutions means",
      body: [
        {
          k: "p",
          t: "Because the substitution produces a quadratic, the discriminant governs the geometry — exactly as in the line-and-curve work of unit 2.",
        },
        {
          k: "table",
          head: ["Discriminant of the resulting quadratic", "Solutions", "Geometry"],
          rows: [
            ["$>0$", "Two pairs", "The line cuts the curve twice"],
            ["$=0$", "One pair (repeated)", "The line is a tangent"],
            ["$<0$", "None", "The line misses the curve"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "A question that asks you to “show the line is a tangent” is asking you to substitute and show the discriminant is zero — the same two lines of work every time.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Substitution strategy", latex: "y = mx + c \\ \\longrightarrow\\ f(x, mx+c) = 0", given: false },
    { name: "Quadratic formula", latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", given: true },
    { name: "Tangency condition", latex: "b^2 - 4ac = 0", given: false },
  ],
  examples: [
    {
      id: "sim-ex1",
      title: "Line meets a parabola",
      difficulty: "easy",
      prompt: "Solve simultaneously $y = 2x - 1$ and $y = x^2 - 4x + 7$.",
      steps: [
        { t: "Both equal $y$, so set them equal.", m: "x^2 - 4x + 7 = 2x - 1" },
        { t: "Collect on one side.", m: "x^2 - 6x + 8 = 0" },
        { t: "Factorise.", m: "(x-2)(x-4) = 0" },
        { t: "Read off the $x$ values.", m: "x = 2 \\text{ or } x = 4" },
        { t: "Substitute each into the linear equation.", m: "x=2 \\Rightarrow y = 3; \\qquad x = 4 \\Rightarrow y = 7" },
      ],
      answer: "$(2, 3)$ and $(4, 7)$.",
    },
    {
      id: "sim-ex2",
      title: "A pair with a fraction",
      difficulty: "medium",
      prompt: "Solve $\\dfrac{2}{x} + \\dfrac{3}{y} = 4$ and $y = 2x$.",
      steps: [
        { t: "Substitute $y = 2x$ into the first equation.", m: "\\frac{2}{x} + \\frac{3}{2x} = 4" },
        { t: "Combine the left side over the common denominator $2x$.", m: "\\frac{4 + 3}{2x} = 4 \\;\\Rightarrow\\; \\frac{7}{2x} = 4" },
        { t: "Cross-multiply.", m: "7 = 8x \\;\\Rightarrow\\; x = \\tfrac78" },
        { t: "Find $y$ from the linear equation.", m: "y = 2 \\times \\tfrac78 = \\tfrac74" },
        { t: "Both are non-zero, so neither denominator was violated." },
      ],
      answer: "$\\left(\\dfrac78, \\dfrac74\\right)$",
    },
    {
      id: "sim-ex3",
      title: "Tangency giving a condition on $k$",
      difficulty: "hard",
      prompt: "The line $y = kx + 6$ is a tangent to the curve $xy = 8$. Find the possible values of $k$.",
      steps: [
        { t: "Substitute the line into the curve.", m: "x(kx + 6) = 8" },
        { t: "Expand and collect.", m: "kx^2 + 6x - 8 = 0" },
        { t: "Tangency means one repeated root, so the discriminant is zero. Note $k \\ne 0$, or the equation would be linear.", m: "36 - 4(k)(-8) = 0" },
        { t: "Solve.", m: "36 + 32k = 0 \\;\\Rightarrow\\; k = -\\tfrac{9}{8}" },
        { t: "Check the geometry: $xy=8$ is a hyperbola in the first and third quadrants, and a negative gradient is exactly what a tangent to the first-quadrant branch needs." },
      ],
      answer: "$k = -\\dfrac98$",
    },
    {
      id: "sim-ex4",
      title: "A symmetric system",
      difficulty: "olympiad",
      prompt: "Solve the simultaneous equations $x + y = 5$ and $x^3 + y^3 = 35$.",
      steps: [
        { t: "Use the identity for a sum of cubes in terms of the sum and product.", m: "x^3 + y^3 = (x+y)^3 - 3xy(x+y)" },
        { t: "Substitute the known sum.", m: "35 = 125 - 15xy" },
        { t: "Solve for the product.", m: "15xy = 90 \\;\\Rightarrow\\; xy = 6" },
        { t: "Now $x$ and $y$ are the roots of a quadratic with this sum and product.", m: "t^2 - 5t + 6 = 0" },
        { t: "Factorise.", m: "(t-2)(t-3) = 0" },
        { t: "So the pair is $\\{2, 3\\}$ in either order.", m: "(x,y) = (2,3) \\text{ or } (3,2)" },
      ],
      answer: "$(2,3)$ and $(3,2)$.",
      remark: "Turning a symmetric system into “sum and product” avoids cubing anything, and is a technique worth having.",
    },
  ],
  examQuestions: [
    {
      id: "sim-eq1",
      title: "Line and circle intersection",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt: "Find the coordinates of the points where the line $y = x + 1$ meets the curve $x^2 + y^2 = 25$. [6]",
      steps: [
        { t: "Substitute the line into the curve.", m: "x^2 + (x+1)^2 = 25" },
        { t: "Expand.", m: "x^2 + x^2 + 2x + 1 = 25" },
        { t: "Collect and simplify.", m: "2x^2 + 2x - 24 = 0 \\;\\Rightarrow\\; x^2 + x - 12 = 0" },
        { t: "Factorise.", m: "(x+4)(x-3) = 0" },
        { t: "Find each $x$ and its partner from the line.", m: "x = -4 \\Rightarrow y = -3; \\qquad x = 3 \\Rightarrow y = 4" },
        { t: "Check both satisfy $x^2+y^2=25$: $16+9=25$ ✓ and $9+16=25$ ✓." },
      ],
      answer: "$(-4, -3)$ and $(3, 4)$.",
    },
    {
      id: "sim-eq2",
      title: "Non-linear pair with a reciprocal",
      difficulty: "hard",
      marks: 7,
      paper: 1,
      prompt: "Solve the simultaneous equations $\\dfrac{y}{x} + \\dfrac{2x}{y} = 4$ and $y = x - 2$. [7]",
      steps: [
        { t: "Multiply the first equation by $xy$ to clear both fractions (noting $x \\ne 0$, $y \\ne 0$).", m: "y^2 + 2x^2 = 4xy" },
        { t: "Substitute $y = x - 2$.", m: "(x-2)^2 + 2x^2 = 4x(x-2)" },
        { t: "Expand every bracket.", m: "x^2 - 4x + 4 + 2x^2 = 4x^2 - 8x" },
        { t: "Collect on one side.", m: "-x^2 + 4x + 4 = 0 \\;\\Rightarrow\\; x^2 - 4x - 4 = 0" },
        { t: "It does not factorise, so use the formula.", m: "x = \\frac{4 \\pm \\sqrt{16 + 16}}{2} = 2 \\pm 2\\sqrt{2}" },
        { t: "Find the matching $y$ from the linear equation.", m: "y = x - 2 = \\pm 2\\sqrt2" },
        { t: "Neither $x$ nor $y$ is zero, so both pairs are valid.", m: "\\left(2 + 2\\sqrt2,\\ 2\\sqrt2\\right), \\quad \\left(2 - 2\\sqrt2,\\ -2\\sqrt2\\right)" },
      ],
      answer: "$\\left(2+2\\sqrt2,\\ 2\\sqrt2\\right)$ and $\\left(2-2\\sqrt2,\\ -2\\sqrt2\\right)$.",
    },
  ],
  mistakes: [
    {
      wrong: "Substituting the roots back into the quadratic equation instead of the linear one.",
      why: "The quadratic can produce a partner that does not satisfy both equations.",
      fix: "Always return to the linear equation, and pair each $x$ with its own $y$.",
    },
    {
      wrong: "Rearranging the quadratic equation and substituting into the linear one.",
      why: "It creates square roots and doubles the work for no gain.",
      fix: "Rearrange the *linear* equation. It is the one with no powers.",
    },
    {
      wrong: "Giving answers as two separate lists: “$x = 2, 4$ and $y = 3, 7$”.",
      why: "The marker cannot tell which pairs go together, and the pairing is part of the answer.",
      fix: "Write coordinate pairs, or “when $x = 2$, $y = 3$”.",
    },
    {
      wrong: "Multiplying by $x$ or $y$ without noting they cannot be zero.",
      why: "It can introduce a spurious solution at zero.",
      fix: "Say “$x \\ne 0$” when you multiply, and discard any root that violates it.",
    },
    {
      wrong: "Expanding $(x-3)^2$ as $x^2 - 9$.",
      why: "The middle term is missing — this single slip destroys the whole question.",
      fix: "$(x-3)^2 = x^2 - 6x + 9$. Expand in full, every time.",
    },
  ],
  tips: [
    "The linear equation is always the one to rearrange, whatever the question looks like.",
    "If both equations are non-linear, try dividing one by the other or subtracting them — a term usually cancels.",
    "Answers in surd form are exact and preferred on the non-calculator paper. Do not round unless asked.",
    "A quick substitution check into the original non-linear equation catches expansion slips in seconds.",
    "“Show that the line is a tangent” = substitute, form the quadratic, show $b^2-4ac=0$, and say so.",
  ],
  generators: ["sim-line-parabola", "sim-line-circle", "sim-product-pair"],
};
