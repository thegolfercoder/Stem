import type { Topic } from "@/lib/types";

export const quadraticFunctions: Topic = {
  slug: "quadratic-functions",
  unit: 2,
  title: "Quadratic functions",
  short: "Quadratics",
  blurb:
    "Completing the square, the discriminant, and the line-meets-curve questions that turn up in every paper.",
  syllabus: [
    { code: "2.1", text: "Find the maximum or minimum value of $f(x)=ax^2+bx+c$ by completing the square or by differentiation." },
    { code: "2.2", text: "Use the maximum or minimum value to sketch $y=f(x)$ or determine the range for a given domain." },
    { code: "2.3", text: "Know the conditions for $f(x)=0$ to have two real roots, two equal roots or no real roots, and the related conditions for a line to intersect, be tangent to, or miss a curve." },
    { code: "2.4", text: "Solve quadratic equations for real roots by factorisation, formula or completing the square." },
    { code: "2.5", text: "Find the solution set for quadratic inequalities, graphically or algebraically." },
  ],
  prerequisites: ["functions"],
  estimatedMinutes: 95,
  sections: [
    {
      id: "completing-the-square",
      heading: "Completing the square",
      body: [
        {
          k: "p",
          t: "Every quadratic can be written as $a(x+p)^2 + q$. This **completed-square form** hands you the turning point, the range, the line of symmetry and the sketch all at once — which is why it is worth doing even when a question does not ask for it.",
        },
        {
          k: "note",
          tone: "key",
          title: "What the form tells you",
          t: "For $y = a(x+p)^2 + q$: the vertex is $(-p,\\, q)$, the line of symmetry is $x = -p$, and the shape opens upward if $a>0$ (so $q$ is a **minimum**) or downward if $a<0$ (so $q$ is a **maximum**).",
        },
        {
          k: "p",
          t: "The method when $a \\ne 1$ is the part that goes wrong. Take the coefficient of $x^2$ out of the **first two terms only**:",
        },
        {
          k: "steps",
          items: [
            { t: "Start with $2x^2 - 12x + 23$. Factor $2$ from the $x^2$ and $x$ terms.", m: "2\\left(x^2 - 6x\\right) + 23" },
            { t: "Inside the bracket, halve the coefficient of $x$ and square: half of $-6$ is $-3$, and $(-3)^2 = 9$.", m: "x^2 - 6x = (x-3)^2 - 9" },
            { t: "Substitute back, keeping the $2$ outside.", m: "2\\left[(x-3)^2 - 9\\right] + 23" },
            { t: "Multiply out only the outer bracket.", m: "2(x-3)^2 - 18 + 23 = 2(x-3)^2 + 5" },
            { t: "Read off the answer: minimum value $5$ at $x = 3$.", m: "\\text{vertex } (3, 5),\\quad \\text{range } y \\ge 5" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "The $-9$ gets multiplied by the $2$. Forgetting that gives $2(x-3)^2 + 14$, which is a different curve.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-1, 7],
            yRange: [0, 22],
            curves: [{ f: (x: number) => 2 * (x - 3) ** 2 + 5, label: "y = 2(x − 3)² + 5" }],
            points: [{ x: 3, y: 5, label: "(3, 5) minimum" }],
            vLines: [{ x: 3 }],
            caption: "The dashed line x = 3 is the line of symmetry; the curve never goes below y = 5.",
            height: 320,
          },
        },
      ],
    },
    {
      id: "discriminant",
      heading: "The discriminant",
      body: [
        {
          k: "p",
          t: "The quantity under the square root in the quadratic formula decides everything about the roots without your having to find them.",
        },
        { k: "math", t: "\\Delta = b^2 - 4ac" },
        {
          k: "table",
          head: ["Discriminant", "Roots of $ax^2+bx+c=0$", "What the graph does"],
          rows: [
            ["$b^2 - 4ac > 0$", "Two distinct real roots", "Crosses the $x$-axis twice"],
            ["$b^2 - 4ac = 0$", "One repeated root", "Touches the $x$-axis — the axis is a tangent"],
            ["$b^2 - 4ac < 0$", "No real roots", "Misses the $x$-axis entirely"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "“Two equal roots”, “a repeated root”, “the curve touches the axis” and “the line is a tangent” are four ways of writing $b^2 - 4ac = 0$. Recognising the phrasing is half the question.",
        },
        {
          k: "p",
          t: "A very common variant asks for the values of $k$ that make a quadratic **always positive**. That needs two things: the curve opens upward ($a > 0$) *and* it never reaches the axis ($b^2-4ac<0$).",
        },
      ],
    },
    {
      id: "line-and-curve",
      heading: "Where a line meets a curve",
      body: [
        {
          k: "p",
          t: "This is the highest-value idea in the unit. To find where $y = mx + c$ meets $y = f(x)$, substitute one into the other and collect everything on one side. You get a quadratic, and its discriminant answers the question.",
        },
        {
          k: "ol",
          items: [
            "Substitute the line into the curve to eliminate $y$.",
            "Rearrange to $Ax^2 + Bx + C = 0$ with everything on one side.",
            "Compute $B^2 - 4AC$ and apply the table: $>0$ two intersections, $=0$ tangent, $<0$ no intersection.",
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-2, 5],
            yRange: [-3, 9],
            curves: [
              { f: (x: number) => x * x - 2 * x + 2, label: "y = x² − 2x + 2" },
              { f: (x: number) => 2 * x - 2, label: "y = 2x − 2 (tangent)", color: 1 },
              { f: (x: number) => 2 * x + 2, label: "y = 2x + 2 (two points)", color: 2, dashed: true },
              { f: (x: number) => 2 * x - 5, label: "y = 2x − 5 (misses)", color: 3, dashed: true },
            ],
            points: [{ x: 2, y: 2, label: "tangent point" }],
            caption:
              "Three parallel lines against the same parabola: one cuts it twice, one touches it once, one misses. Only the discriminant distinguishes them.",
            height: 340,
          },
        },
      ],
    },
    {
      id: "quadratic-inequalities",
      heading: "Quadratic inequalities",
      body: [
        {
          k: "p",
          t: "Never divide an inequality by an expression containing $x$ — its sign is unknown. Instead, get zero on one side, factorise, and read the answer from a sketch.",
        },
        {
          k: "steps",
          items: [
            { t: "Solve $x^2 + 2x > 15$. Move everything to one side.", m: "x^2 + 2x - 15 > 0" },
            { t: "Factorise to find the critical values.", m: "(x+5)(x-3) > 0 \\;\\Rightarrow\\; x = -5,\\ 3" },
            { t: "Sketch: an upward parabola cutting at $-5$ and $3$. It is **above** the axis outside the roots." },
            { t: "Write the solution set with the correct notation.", m: "x < -5 \\quad \\text{or} \\quad x > 3" },
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "The shape rule",
          t: "For an upward parabola: $>0$ means **outside** the roots (two separate pieces), $<0$ means **between** them (one piece). If the parabola opens downward, the two cases swap.",
        },
        {
          k: "note",
          tone: "warn",
          t: "Writing $3 < x < -5$ is meaningless — no number is both bigger than 3 and smaller than $-5$. When the answer is two pieces, it must be joined by **or**, never written as a double inequality.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Quadratic formula", latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", given: true, note: "Printed on page 2 of the paper." },
    { name: "Discriminant", latex: "\\Delta = b^2 - 4ac", given: false, note: "Not given as a separate formula — you must extract it." },
    { name: "Completed square", latex: "ax^2 + bx + c = a\\left(x + \\frac{b}{2a}\\right)^2 + c - \\frac{b^2}{4a}", given: false },
    { name: "Vertex", latex: "x = -\\frac{b}{2a}", given: false, note: "Also obtainable from $\\frac{\\mathrm{d}y}{\\mathrm{d}x} = 0$." },
  ],
  examples: [
    {
      id: "qf-ex1",
      title: "Completing the square and reading off the range",
      difficulty: "easy",
      prompt: "Express $f(x) = 3x^2 + 12x + 5$ in the form $a(x+p)^2 + q$, and hence state the range of $f$ for $x \\in \\mathbb{R}$.",
      steps: [
        { t: "Take the 3 out of the first two terms only.", m: "3(x^2 + 4x) + 5" },
        { t: "Complete the square inside the bracket: half of 4 is 2, and $2^2 = 4$.", m: "x^2 + 4x = (x+2)^2 - 4" },
        { t: "Substitute back.", m: "3\\left[(x+2)^2 - 4\\right] + 5" },
        { t: "Expand the outer bracket only. Note $3 \\times (-4) = -12$.", m: "3(x+2)^2 - 12 + 5 = 3(x+2)^2 - 7" },
        { t: "Since $3 > 0$ the least value of the squared term is 0, at $x=-2$.", m: "\\text{minimum } = -7,\\qquad \\text{range: } f(x) \\ge -7" },
      ],
      answer: "$f(x) = 3(x+2)^2 - 7$; range $f(x) \\ge -7$.",
    },
    {
      id: "qf-ex2",
      title: "Finding $k$ for a tangent",
      difficulty: "medium",
      prompt: "The line $y = 2x + k$ is a tangent to the curve $y = x^2 - 4x + 7$. Find the value of $k$ and the coordinates of the point of contact.",
      steps: [
        { t: "Set the two expressions for $y$ equal — at any intersection they agree.", m: "x^2 - 4x + 7 = 2x + k" },
        { t: "Collect everything on one side to form a quadratic in $x$.", m: "x^2 - 6x + (7 - k) = 0" },
        { t: "Tangent means exactly one solution, so the discriminant is zero.", m: "(-6)^2 - 4(1)(7-k) = 0" },
        { t: "Expand and solve for $k$.", m: "36 - 28 + 4k = 0 \\;\\Rightarrow\\; 4k = -8 \\;\\Rightarrow\\; k = -2" },
        { t: "With $k=-2$ the quadratic becomes a perfect square; solve it for the $x$-coordinate.", m: "x^2 - 6x + 9 = 0 \\;\\Rightarrow\\; (x-3)^2 = 0 \\;\\Rightarrow\\; x = 3" },
        { t: "Substitute into the line to get $y$.", m: "y = 2(3) - 2 = 4" },
      ],
      answer: "$k = -2$, point of contact $(3, 4)$.",
      remark: "Notice the repeated root: a tangency always produces a perfect square, which is a free check on your arithmetic.",
    },
    {
      id: "qf-ex3",
      title: "A quadratic that is always positive",
      difficulty: "hard",
      prompt: "Find the set of values of $k$ for which $kx^2 + (k+3)x + 4 > 0$ for all real $x$.",
      steps: [
        { t: "“For all real $x$” with a genuine quadratic needs two conditions: it opens upward, and it never touches the axis.", m: "k > 0 \\quad \\text{and} \\quad b^2 - 4ac < 0" },
        { t: "Write the discriminant with $a = k$, $b = k+3$, $c = 4$.", m: "(k+3)^2 - 16k < 0" },
        { t: "Expand and tidy.", m: "k^2 + 6k + 9 - 16k < 0 \\;\\Rightarrow\\; k^2 - 10k + 9 < 0" },
        { t: "Factorise to find the critical values.", m: "(k-1)(k-9) < 0" },
        { t: "An upward parabola is negative **between** its roots.", m: "1 < k < 9" },
        { t: "Check against the first condition $k>0$: every value in $1<k<9$ already satisfies it, so nothing is lost." },
      ],
      answer: "$1 < k < 9$",
      remark: "If $k=0$ the expression is linear, $3x+4$, which is negative for small $x$ — so excluding $k=0$ matters and is handled by $k>0$.",
    },
    {
      id: "qf-ex4",
      title: "Roots, symmetric functions and a hidden quadratic",
      difficulty: "olympiad",
      prompt: "The equation $x^2 - 5x + 2 = 0$ has roots $\\alpha$ and $\\beta$. Without solving it, find the value of $\\alpha^2 + \\beta^2$ and of $\\dfrac{1}{\\alpha} + \\dfrac{1}{\\beta}$.",
      steps: [
        { t: "Comparing $x^2 - 5x + 2$ with $(x-\\alpha)(x-\\beta) = x^2 - (\\alpha+\\beta)x + \\alpha\\beta$ gives the sum and product directly.", m: "\\alpha + \\beta = 5, \\qquad \\alpha\\beta = 2" },
        { t: "Square the sum — this is the identity that converts a sum into a sum of squares.", m: "(\\alpha+\\beta)^2 = \\alpha^2 + 2\\alpha\\beta + \\beta^2" },
        { t: "Rearrange and substitute.", m: "\\alpha^2 + \\beta^2 = (\\alpha+\\beta)^2 - 2\\alpha\\beta = 25 - 4 = 21" },
        { t: "For the reciprocals, put them over a common denominator.", m: "\\frac{1}{\\alpha} + \\frac{1}{\\beta} = \\frac{\\beta + \\alpha}{\\alpha\\beta}" },
        { t: "Substitute the sum and product.", m: "= \\frac{5}{2}" },
      ],
      answer: "$\\alpha^2+\\beta^2 = 21$ and $\\dfrac1\\alpha + \\dfrac1\\beta = \\dfrac52$.",
      remark:
        "Sum and product of roots sits just outside the 0606 syllabus, but the technique — comparing coefficients — is squarely inside it and often the fastest route.",
    },
  ],
  examQuestions: [
    {
      id: "qf-eq1",
      title: "Completed square, sketch and range",
      difficulty: "medium",
      marks: 9,
      paper: 1,
      prompt:
        "The function $f$ is defined by $f(x) = 5 + 4x - x^2$ for $x \\ge 2$.\n(a) Write $f(x)$ in the form $a - (x+b)^2$. [3]\n(b) Hence state the greatest value of $f$ and the value of $x$ at which it occurs. [2]\n(c) Explain why $f$ has an inverse, and find $f^{-1}(x)$. [4]",
      steps: [
        { t: "(a) Group the $x$ terms and factor out $-1$.", m: "5 - (x^2 - 4x)" },
        { t: "Complete the square inside.", m: "x^2 - 4x = (x-2)^2 - 4" },
        { t: "Substitute and simplify, watching the sign of the $-4$.", m: "5 - \\left[(x-2)^2 - 4\\right] = 9 - (x-2)^2" },
        { t: "(b) The squared term is at least 0 and is 0 when $x=2$, which is in the domain.", m: "\\text{greatest value } 9 \\text{ at } x = 2" },
        { t: "(c) On $x \\ge 2$ the curve only decreases, so no two inputs share an output: $f$ is one–one, hence invertible." },
        { t: "Set $y = 9 - (x-2)^2$ and isolate the square.", m: "(x-2)^2 = 9 - y" },
        { t: "Take the root, choosing $+$ because $x \\ge 2$ makes $x-2 \\ge 0$.", m: "x = 2 + \\sqrt{9-y}" },
        { t: "Rename, and note the domain is the range of $f$, namely $f(x) \\le 9$.", m: "f^{-1}(x) = 2 + \\sqrt{9-x},\\quad x \\le 9" },
      ],
      answer: "(a) $9-(x-2)^2$. (b) greatest value 9 at $x=2$. (c) one–one on $x\\ge2$; $f^{-1}(x) = 2+\\sqrt{9-x}$, $x \\le 9$.",
    },
    {
      id: "qf-eq2",
      title: "Line and curve, three cases",
      difficulty: "hard",
      marks: 8,
      paper: 1,
      prompt:
        "The line $y = mx - 3$ meets the curve $y = x^2 + x + 1$.\n(a) Show that the $x$-coordinates of any intersections satisfy $x^2 + (1-m)x + 4 = 0$. [2]\n(b) Find the values of $m$ for which the line is a tangent to the curve. [4]\n(c) State, with a reason, the set of values of $m$ for which the line and curve do not meet. [2]",
      steps: [
        { t: "(a) Equate the two expressions for $y$.", m: "x^2 + x + 1 = mx - 3" },
        { t: "Bring everything to the left.", m: "x^2 + x - mx + 4 = 0 \\;\\Rightarrow\\; x^2 + (1-m)x + 4 = 0" },
        { t: "(b) Tangent means a repeated root, so the discriminant vanishes.", m: "(1-m)^2 - 4(1)(4) = 0" },
        { t: "Expand.", m: "(1-m)^2 = 16" },
        { t: "Take square roots — both signs.", m: "1 - m = \\pm 4" },
        { t: "Solve each case.", m: "m = -3 \\quad \\text{or} \\quad m = 5" },
        { t: "(c) No intersection means a negative discriminant.", m: "(1-m)^2 < 16 \\;\\Rightarrow\\; -4 < 1-m < 4" },
        { t: "Solve the double inequality, remembering that multiplying by $-1$ reverses it.", m: "-3 < m < 5" },
      ],
      answer: "(b) $m = -3$ or $m = 5$. (c) $-3 < m < 5$, because then the discriminant is negative and there are no real roots.",
    },
  ],
  mistakes: [
    {
      wrong: "Completing the square as $2(x-3)^2 - 9 + 23$ instead of $2(x-3)^2 - 18 + 23$.",
      why: "The correction term is inside the bracket, so it must be multiplied by the factor outside.",
      fix: "Write $2[(x-3)^2 - 9] + 23$ in full before expanding, and multiply carefully.",
    },
    {
      wrong: "Using $b^2 - 4ac$ on an equation that has not been collected on one side.",
      why: "$a$, $b$ and $c$ only mean anything once the equation reads $\\ldots = 0$.",
      fix: "Always rearrange to $Ax^2+Bx+C=0$ first, then read off the coefficients — including signs.",
    },
    {
      wrong: "Answering a quadratic inequality with $-5 > x > 3$.",
      why: "That double inequality describes an empty set.",
      fix: "Two separate regions must be written with **or**: $x < -5$ or $x > 3$.",
    },
    {
      wrong: "Dividing an inequality by $x$ or by a bracket.",
      why: "If the divisor is negative the inequality reverses, and you cannot tell which case you are in.",
      fix: "Collect on one side, factorise, and use a sketch or a sign table.",
    },
    {
      wrong: "For “always positive”, using only $b^2-4ac<0$.",
      why: "A downward parabola with no roots is always **negative**.",
      fix: "State both conditions: $a>0$ and $b^2-4ac<0$.",
    },
    {
      wrong: "Giving both roots when the domain restricts the answer.",
      why: "A restricted domain or a physical context (a length, a time) often rules one root out.",
      fix: "Check each root against the domain and write a sentence rejecting the invalid one.",
    },
  ],
  tips: [
    "Completing the square answers four questions at once: vertex, range, symmetry and the sketch. Do it early.",
    "“Tangent”, “touches”, “equal roots”, “repeated root” — all four mean $b^2-4ac=0$. Train yourself to translate them instantly.",
    "On the non-calculator paper, leave surd answers exact: $\\frac{3\\pm\\sqrt{5}}{2}$ is the answer, not 2.618.",
    "After solving a tangency problem, substitute your value back — the quadratic should collapse to a perfect square.",
    "Sketch the parabola before writing an inequality answer. Ten seconds of drawing prevents the commonest sign error in the paper.",
  ],
  generators: ["qf-complete-square", "qf-discriminant-k", "qf-solve-quadratic", "qf-inequality", "qf-tangent-line"],
};
