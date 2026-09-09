import type { Topic } from "@/lib/types";

export const equationsInequalitiesGraphs: Topic = {
  slug: "equations-inequalities-graphs",
  unit: 4,
  title: "Equations, inequalities and graphs",
  short: "Modulus & cubics",
  blurb:
    "Modulus equations and inequalities, cubic sketches from factors, and the substitutions that turn a hard equation into a quadratic.",
  syllabus: [
    { code: "4.1", text: "Solve equations of the type $|ax+b|=c$, $|ax+b|=cx+d$, $|ax+b|=|cx+d|$ and $|ax^2+bx+c|=d$ algebraically or graphically." },
    { code: "4.2", text: "Solve inequalities of the type $k|ax+b|>c$, $k|ax+b|\\le|cx+d|$, $|ax+b|\\le cx+d$, $|ax^2+bx+c|>d$ and $|ax^2+bx+c|\\le d$." },
    { code: "4.3", text: "Use substitution to form and solve a quadratic equation in order to solve a related equation." },
    { code: "4.4", text: "Sketch the graphs of cubic polynomials and their moduli when given as a product of three linear factors." },
    { code: "4.5", text: "Solve cubic inequalities graphically for $f(x) \\gtrless d$ where $f$ is a product of three linear factors." },
  ],
  prerequisites: ["quadratic-functions", "factors-of-polynomials"],
  estimatedMinutes: 95,
  sections: [
    {
      id: "modulus-basics",
      heading: "What the modulus means",
      body: [
        { k: "p", t: "$|x|$ is the distance of $x$ from zero, so it is never negative:" },
        { k: "math", t: "|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}" },
        {
          k: "note",
          tone: "key",
          title: "Two facts that solve most questions",
          t: "$|A| = |B| \\iff A^2 = B^2$, and $|A| = k$ (with $k \\ge 0$) $\\iff A = k$ or $A = -k$. If $k < 0$ there are **no** solutions.",
        },
        {
          k: "p",
          t: "Squaring is the safest general method because it cannot lose or invent solutions when both sides are moduli. Splitting into cases is quicker, but every case must be checked against its own condition.",
        },
      ],
    },
    {
      id: "modulus-equations",
      heading: "Modulus equations",
      body: [
        { k: "p", t: "**Type 1: $|ax+b| = c$.** Split into two linear equations." },
        {
          k: "steps",
          items: [
            { t: "Solve $|3x - 7| = 5$. Write both branches.", m: "3x - 7 = 5 \\quad \\text{or} \\quad 3x - 7 = -5" },
            { t: "Solve each.", m: "x = 4 \\quad \\text{or} \\quad x = \\tfrac{2}{3}" },
          ],
        },
        { k: "p", t: "**Type 2: $|ax+b| = cx+d$.** The right-hand side can be negative, so every solution must be checked." },
        {
          k: "steps",
          items: [
            { t: "Solve $|2x - 1| = x + 4$. Square both sides to remove the modulus.", m: "(2x-1)^2 = (x+4)^2" },
            { t: "Expand.", m: "4x^2 - 4x + 1 = x^2 + 8x + 16" },
            { t: "Collect.", m: "3x^2 - 12x - 15 = 0 \\;\\Rightarrow\\; x^2 - 4x - 5 = 0" },
            { t: "Factorise.", m: "(x-5)(x+1) = 0 \\;\\Rightarrow\\; x = 5 \\text{ or } x = -1" },
            { t: "Check both: at $x=5$, LHS $=9$, RHS $=9$ ✓. At $x=-1$, LHS $=3$, RHS $=3$ ✓. Both are genuine." },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Squaring can create false solutions. If a check gives, say, LHS $=7$ and RHS $=-7$, that root is **rejected** — the modulus can never equal a negative number.",
        },
        { k: "p", t: "**Type 3: $|ax^2+bx+c| = d$.** Split into $f(x) = d$ and $f(x) = -d$, giving up to four roots." },
      ],
    },
    {
      id: "modulus-inequalities",
      heading: "Modulus inequalities",
      body: [
        {
          k: "note",
          tone: "key",
          title: "The two shapes",
          t: "For $k>0$: $|A| < k \\iff -k < A < k$ (one interval, **inside**). $|A| > k \\iff A > k$ or $A < -k$ (two pieces, **outside**).",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $|2x + 3| \\le 7$. It is a “less than”, so use the sandwich.", m: "-7 \\le 2x+3 \\le 7" },
            { t: "Subtract 3 throughout.", m: "-10 \\le 2x \\le 4" },
            { t: "Divide by 2 throughout.", m: "-5 \\le x \\le 2" },
          ],
        },
        {
          k: "p",
          t: "For $|ax+b| \\le |cx+d|$, square both sides — both are non-negative, so the inequality direction is preserved — and solve the resulting quadratic inequality.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-4, 6],
            yRange: [-1, 9],
            curves: [
              { f: (x: number) => Math.abs(2 * x - 4), label: "y = |2x − 4|" },
              { f: (x: number) => Math.abs(x + 2), label: "y = |x + 2|", color: 1 },
            ],
            points: [
              { x: 2 / 3, y: 8 / 3, label: "x = ⅔" },
              { x: 6, y: 8, label: "x = 6" },
            ],
            caption:
              "|2x − 4| ≤ |x + 2| holds exactly where the blue graph is below the red one: between the two crossing points, ⅔ ≤ x ≤ 6.",
            height: 320,
          },
        },
      ],
    },
    {
      id: "substitution",
      heading: "Hidden quadratics",
      body: [
        {
          k: "p",
          t: "Many equations that look nothing like quadratics become quadratics after one substitution. Spotting the substitution is the whole skill: look for an expression and its square.",
        },
        {
          k: "table",
          head: ["Equation", "Substitution", "Becomes"],
          rows: [
            ["$x^4 - 13x^2 + 36 = 0$", "$u = x^2$", "$u^2 - 13u + 36 = 0$"],
            ["$x - 5\\sqrt{x} + 6 = 0$", "$u = \\sqrt{x}$", "$u^2 - 5u + 6 = 0$"],
            ["$2(\\ln 5x)^2 + \\ln 5x - 6 = 0$", "$u = \\ln 5x$", "$2u^2 + u - 6 = 0$"],
            ["$3e^x = 12 - 5e^{-x}$", "$u = e^x$", "$3u^2 - 12u + 5 = 0$"],
            ["$x^{2/3} - x^{1/3} - 12 = 0$", "$u = x^{1/3}$", "$u^2 - u - 12 = 0$"],
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Always convert back, and always reject impossible values: $u = \\sqrt{x}$ cannot be negative, and $u = e^x$ cannot be zero or negative. Marks are lost here more often than in the algebra.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $3e^x = 12 - 5e^{-x}$. Multiply through by $e^x$ to clear the negative power.", m: "3e^{2x} = 12e^x - 5" },
            { t: "Let $u = e^x$, so $e^{2x} = u^2$.", m: "3u^2 - 12u + 5 = 0" },
            { t: "Use the quadratic formula.", m: "u = \\frac{12 \\pm \\sqrt{144 - 60}}{6} = \\frac{12 \\pm \\sqrt{84}}{6}" },
            { t: "Both roots are positive ($\\approx 3.53$ and $\\approx 0.472$), so both are valid values of $e^x$.", m: "x = \\ln(3.5275) \\text{ or } \\ln(0.47251)" },
            { t: "Evaluate to 3 significant figures.", m: "x = 1.26 \\quad \\text{or} \\quad x = -0.750" },
          ],
        },
      ],
    },
    {
      id: "cubic-graphs",
      heading: "Sketching cubics and their moduli",
      body: [
        {
          k: "p",
          t: "Given $y = (x-a)(x-b)(x-c)$ with $a<b<c$, the sketch follows from four observations: the roots are at $a$, $b$, $c$; the $y$-intercept is $-abc$; for large positive $x$ the curve rises (if the leading coefficient is positive); and it alternates above and below the axis between roots.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-3, 4],
            yRange: [-10, 10],
            curves: [
              { f: (x: number) => (x + 2) * (x - 1) * (x - 3), label: "y = (x+2)(x−1)(x−3)", dashed: true },
              { f: (x: number) => Math.abs((x + 2) * (x - 1) * (x - 3)), label: "y = |(x+2)(x−1)(x−3)|", color: 1 },
            ],
            points: [{ x: 0, y: 6, label: "(0, 6)" }],
            caption:
              "Taking the modulus reflects the two sections below the axis upward, leaving corners at each root.",
            height: 340,
          },
        },
        {
          k: "p",
          t: "For a cubic **inequality** such as $f(x) \\le d$, draw the horizontal line $y=d$ and read off the $x$-intervals where the curve is below it. Cambridge expects this to be done graphically for these questions.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Definition of modulus", latex: "|x| = \\sqrt{x^2}", given: false },
    { name: "Modulus equation", latex: "|A| = k \\ (k \\ge 0) \\iff A = \\pm k", given: false },
    { name: "Equal moduli", latex: "|A| = |B| \\iff A^2 = B^2", given: false },
    { name: "Less-than inequality", latex: "|A| < k \\iff -k < A < k", given: false },
    { name: "Greater-than inequality", latex: "|A| > k \\iff A > k \\text{ or } A < -k", given: false },
  ],
  examples: [
    {
      id: "mod-ex1",
      title: "A basic modulus equation",
      difficulty: "easy",
      prompt: "Solve $|4x + 1| = 9$.",
      steps: [
        { t: "The right side is positive, so there are two branches.", m: "4x + 1 = 9 \\quad \\text{or} \\quad 4x + 1 = -9" },
        { t: "Solve the first.", m: "4x = 8 \\;\\Rightarrow\\; x = 2" },
        { t: "Solve the second.", m: "4x = -10 \\;\\Rightarrow\\; x = -\\tfrac{5}{2}" },
      ],
      answer: "$x = 2$ or $x = -\\dfrac52$.",
    },
    {
      id: "mod-ex2",
      title: "Modulus equal to a linear expression",
      difficulty: "medium",
      prompt: "Solve $|x - 6| = 2x$, checking your solutions.",
      steps: [
        { t: "Square both sides to remove the modulus.", m: "(x-6)^2 = 4x^2" },
        { t: "Expand and collect.", m: "x^2 - 12x + 36 = 4x^2 \\;\\Rightarrow\\; 3x^2 + 12x - 36 = 0" },
        { t: "Divide by 3 and factorise.", m: "x^2 + 4x - 12 = 0 \\;\\Rightarrow\\; (x+6)(x-2) = 0" },
        { t: "Candidate roots.", m: "x = -6 \\quad \\text{or} \\quad x = 2" },
        { t: "Check $x=-6$: LHS $=|-12| = 12$, RHS $=-12$. A modulus cannot be negative, so **reject** it." },
        { t: "Check $x=2$: LHS $=|-4| = 4$, RHS $=4$ ✓." },
      ],
      answer: "$x = 2$ only.",
      remark: "This is exactly why squaring demands a check: it produced a root of the squared equation that does not solve the original.",
    },
    {
      id: "mod-ex3",
      title: "Modulus of a quadratic against a line",
      difficulty: "hard",
      prompt: "Solve $|x^2 - 4| = 3x$ for $x > 0$.",
      steps: [
        { t: "Split into the two cases the modulus allows.", m: "x^2 - 4 = 3x \\quad \\text{or} \\quad x^2 - 4 = -3x" },
        { t: "First case: collect and factorise.", m: "x^2 - 3x - 4 = 0 \\;\\Rightarrow\\; (x-4)(x+1) = 0" },
        { t: "Roots $x = 4$ and $x = -1$; only $x=4$ satisfies $x>0$. Check: $|16-4| = 12 = 3(4)$ ✓." },
        { t: "Second case: collect and factorise.", m: "x^2 + 3x - 4 = 0 \\;\\Rightarrow\\; (x+4)(x-1) = 0" },
        { t: "Roots $x=-4$ and $x=1$; only $x=1$ is positive. Check: $|1-4| = 3 = 3(1)$ ✓." },
      ],
      answer: "$x = 1$ and $x = 4$.",
      remark: "The graph of $y=|x^2-4|$ has a W shape; the line $y=3x$ cuts it twice for $x>0$, which matches the two answers.",
    },
    {
      id: "mod-ex4",
      title: "A quartic-in-disguise with a modulus",
      difficulty: "olympiad",
      prompt: "Find all real solutions of $\\left|x^2 - 5x\\right| = 6 - x^2$.",
      steps: [
        { t: "The left side is never negative, so the right side must not be either. This restricts the search.", m: "6 - x^2 \\ge 0 \\;\\Rightarrow\\; -\\sqrt{6} \\le x \\le \\sqrt{6}" },
        { t: "Case 1: $x^2 - 5x = 6 - x^2$.", m: "2x^2 - 5x - 6 = 0" },
        { t: "Apply the formula.", m: "x = \\frac{5 \\pm \\sqrt{25 + 48}}{4} = \\frac{5 \\pm \\sqrt{73}}{4}" },
        { t: "Numerically $x \\approx 3.386$ or $x \\approx -0.886$. Only the second lies in $[-\\sqrt6, \\sqrt6]$, and it also needs $x^2-5x \\ge 0$, which holds since $x<0$. Accept it." },
        { t: "Case 2: $-(x^2 - 5x) = 6 - x^2$, so the $x^2$ terms cancel.", m: "5x = 6 \\;\\Rightarrow\\; x = \\tfrac{6}{5}" },
        { t: "Check: this needs $x^2 - 5x \\le 0$, true for $0\\le x\\le5$ ✓, and $|1.44-6| = 4.56 = 6 - 1.44$ ✓." },
      ],
      answer: "$x = \\dfrac{5 - \\sqrt{73}}{4} \\approx -0.886$ and $x = \\dfrac{6}{5}$.",
      remark: "Bounding first — noticing $6-x^2 \\ge 0$ — turns four candidate roots into two before any checking.",
    },
  ],
  examQuestions: [
    {
      id: "mod-eq1",
      title: "Modulus inequality with a coefficient",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt:
        "(a) Solve the inequality $3|2x - 5| > 9$. [4]\n(b) Hence write down the solution of $3|2x-5| \\le 9$. [2]",
      steps: [
        { t: "(a) Divide by 3 first — it is positive, so the inequality is unchanged.", m: "|2x - 5| > 3" },
        { t: "A “greater than” splits into two outward pieces.", m: "2x - 5 > 3 \\quad \\text{or} \\quad 2x - 5 < -3" },
        { t: "Solve the first.", m: "2x > 8 \\;\\Rightarrow\\; x > 4" },
        { t: "Solve the second.", m: "2x < 2 \\;\\Rightarrow\\; x < 1" },
        { t: "(b) The remaining values are the complement, and the endpoints are now included.", m: "1 \\le x \\le 4" },
      ],
      answer: "(a) $x<1$ or $x>4$. (b) $1 \\le x \\le 4$.",
    },
    {
      id: "mod-eq2",
      title: "Substitution and a cubic sketch",
      difficulty: "hard",
      marks: 10,
      paper: 2,
      prompt:
        "(a) By using the substitution $u = x^{1/3}$, solve $x^{2/3} - 2x^{1/3} - 8 = 0$. [4]\n(b) The curve $y = (x+1)(x-2)(x-4)$ is sketched. State the coordinates of the points where it meets the axes, and use your sketch to solve $(x+1)(x-2)(x-4) < 0$. [6]",
      steps: [
        { t: "(a) With $u = x^{1/3}$, note $x^{2/3} = \\left(x^{1/3}\\right)^2 = u^2$.", m: "u^2 - 2u - 8 = 0" },
        { t: "Factorise.", m: "(u-4)(u+2) = 0 \\;\\Rightarrow\\; u = 4 \\text{ or } u = -2" },
        { t: "Cube to return to $x$. Unlike a square root, a cube root may be negative, so both are valid.", m: "x = 4^3 = 64 \\quad \\text{or} \\quad x = (-2)^3 = -8" },
        { t: "(b) The roots are read straight off the factors.", m: "(-1, 0),\\ (2, 0),\\ (4, 0)" },
        { t: "The $y$-intercept comes from $x=0$.", m: "y = (1)(-2)(-4) = 8 \\;\\Rightarrow\\; (0, 8)" },
        { t: "The leading coefficient is positive, so the curve comes from $-\\infty$ on the left, rises through $x=-1$, falls through $x=2$ and rises again through $x=4$." },
        { t: "It is below the axis on the far left and between the middle two roots.", m: "x < -1 \\quad \\text{or} \\quad 2 < x < 4" },
      ],
      answer: "(a) $x = 64$ or $x = -8$. (b) Axes at $(-1,0)$, $(2,0)$, $(4,0)$, $(0,8)$; the inequality holds for $x<-1$ or $2<x<4$.",
    },
  ],
  mistakes: [
    {
      wrong: "Solving $|2x-1| = x-5$ and keeping both roots.",
      why: "The right-hand side is negative for $x<5$, and a modulus is never negative.",
      fix: "Substitute every candidate back into the **original** equation and reject any that fail.",
    },
    {
      wrong: "Writing $|A| > k$ as $-k > A > k$.",
      why: "The “greater than” case is two separate outward pieces, not a sandwich.",
      fix: "$A > k$ **or** $A < -k$. Only the “less than” case gives a single interval.",
    },
    {
      wrong: "After substituting $u = \\sqrt{x}$, accepting a negative $u$.",
      why: "A square root is non-negative by definition, so that branch has no solution.",
      fix: "State the restriction on $u$ as soon as you introduce it, and reject accordingly. (For $u = x^{1/3}$ there is no such restriction.)",
    },
    {
      wrong: "Forgetting to convert back after a substitution.",
      why: "The question asked for $x$, not $u$.",
      fix: "Finish every substitution question with the line “and therefore $x = \\ldots$”.",
    },
    {
      wrong: "Drawing $y = |f(x)|$ by reflecting the whole curve.",
      why: "Only the parts below the $x$-axis are reflected.",
      fix: "Mark the roots first — they become the corners — then flip only the sections between them that lie below the axis.",
    },
  ],
  tips: [
    "For $|A| = |B|$, squaring is always safe and never needs a check. For $|A| = $ a linear expression, squaring is fine but the check is compulsory.",
    "A quick sketch of both sides turns a modulus inequality into a reading exercise — and it is an accepted method in this syllabus.",
    "When you see a squared bracket and the same bracket to the first power, a substitution is waiting.",
    "For cubic inequalities the syllabus expects the graphical method: draw, then read off intervals.",
    "Endpoints: $<$ and $>$ exclude them; $\\le$ and $\\ge$ include them. Copy the inequality sign from the question into your answer.",
  ],
  generators: ["mod-linear-equation", "mod-inequality", "sub-quadratic-hidden", "cubic-inequality-roots"],
};
