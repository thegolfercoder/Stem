import type { TopicExtra } from "@/lib/types";

export const simultaneousEquationsExtra: TopicExtra = {
  sections: [
    {
      id: "choosing-the-substitution",
      heading: "Choosing what to substitute",
      body: [
        { k: "p", t: "In a linear-and-non-linear pair, rearrange the **linear** equation and substitute into the other. Then choose which variable to make the subject: the one with coefficient 1, if there is one, so that no fractions appear." },
        { k: "math", t: "x + 2y = 7,\\; xy = 6 \\;\\Rightarrow\\; x = 7 - 2y \\;\\Rightarrow\\; (7 - 2y)y = 6" },
        { k: "p", t: "Making $y$ the subject here would give $y = \\tfrac{7 - x}{2}$ and a fraction in every later line. Both routes are correct, but one is far less error-prone." },
        { k: "note", tone: "tip", title: "Pair the answers", t: "Each value of one variable gives exactly one value of the other through the linear equation. Present the solutions as pairs: $x = 3, y = 2$ and $x = 4, y = \\tfrac32$." },
      ],
    },
    {
      id: "chords",
      heading: "Chords: length and midpoint",
      body: [
        { k: "p", t: "When a line cuts a curve at two points $A$ and $B$, the segment $AB$ is a chord. Solving the equations simultaneously gives the coordinates of $A$ and $B$, and from them the chord's length and midpoint." },
        { k: "math", t: "AB = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2},\\qquad M = \\left(\\tfrac{x_1 + x_2}{2}, \\tfrac{y_1 + y_2}{2}\\right)" },
        {
          k: "plot",
          spec: {
            xRange: [-3, 5],
            yRange: [-5, 9],
            curves: [
              { f: (x) => x * x - 3, label: "y = x² − 3", color: 0 },
              { f: (x) => 2 * x, label: "y = 2x", color: 1 },
            ],
            points: [
              { x: -1, y: -2, label: "A(−1, −2)" },
              { x: 3, y: 6, label: "B(3, 6)" },
            ],
            yTick: 2,
            caption: "The line $y = 2x$ cuts the curve at $A$ and $B$. The chord $AB$ has length $4\\sqrt5$.",
          },
        },
      ],
    },
    {
      id: "log-and-index-pairs",
      heading: "Pairs involving logarithms or indices",
      body: [
        { k: "p", t: "Simultaneous equations sometimes arrive disguised. Use the laws of logarithms or indices to turn each equation into an ordinary algebraic one, then solve as usual." },
        { k: "math", t: "\\lg x + \\lg y = 1 \\;\\Rightarrow\\; \\lg(xy) = 1 \\;\\Rightarrow\\; xy = 10" },
        { k: "note", tone: "warn", title: "Check the domain at the end", t: "A logarithm needs a positive argument. Any solution that makes $x$ or $y$ zero or negative must be rejected, with the reason stated." },
      ],
    },
  ],
  examples: [
    {
      id: "sim-x1",
      title: "A line and a circle centred at the origin",
      difficulty: "easy",
      prompt: "Solve the simultaneous equations $x + y = 5$ and $x^2 + y^2 = 13$.",
      steps: [
        { t: "From the linear equation, $y = 5 - x$. Substitute.", m: "x^2 + (5 - x)^2 = 13" },
        { t: "Expand and simplify.", m: "2x^2 - 10x + 12 = 0 \\;\\Rightarrow\\; x^2 - 5x + 6 = 0" },
        { t: "Factorise and pair each $x$ with its $y$.", m: "(x - 2)(x - 3) = 0" },
      ],
      answer: "$x = 2, y = 3$ or $x = 3, y = 2$",
    },
    {
      id: "sim-x2",
      title: "A line and a parabola",
      difficulty: "easy",
      prompt: "Solve $y = 2x - 1$ and $y = x^2 - 4$ simultaneously.",
      steps: [
        { t: "Equate the expressions for $y$.", m: "x^2 - 4 = 2x - 1 \\;\\Rightarrow\\; x^2 - 2x - 3 = 0" },
        { t: "Factorise.", m: "(x - 3)(x + 1) = 0" },
        { t: "Use the line to find $y$.", m: "x = 3 \\Rightarrow y = 5,\\qquad x = -1 \\Rightarrow y = -3" },
      ],
      answer: "$x = 3, y = 5$ or $x = -1, y = -3$",
    },
    {
      id: "sim-x3",
      title: "Length of a chord",
      difficulty: "medium",
      prompt: "The line $y = 2x$ meets the curve $y = x^2 - 3$ at $A$ and $B$. Find the exact length of $AB$.",
      steps: [
        { t: "Equate and solve.", m: "x^2 - 3 = 2x \\;\\Rightarrow\\; (x - 3)(x + 1) = 0" },
        { t: "The points are $A(-1, -2)$ and $B(3, 6)$." },
        { t: "Use the distance formula.", m: "AB = \\sqrt{4^2 + 8^2} = \\sqrt{80} = 4\\sqrt5" },
      ],
      answer: "$AB = 4\\sqrt{5}$",
    },
    {
      id: "sim-x4",
      title: "A product and a sum",
      difficulty: "medium",
      prompt: "Solve $xy = 6$ and $x + 2y = 7$.",
      steps: [
        { t: "Make $x$ the subject of the linear equation, avoiding fractions.", m: "x = 7 - 2y" },
        { t: "Substitute.", m: "(7 - 2y)y = 6 \\;\\Rightarrow\\; 2y^2 - 7y + 6 = 0" },
        { t: "Factorise.", m: "(2y - 3)(y - 2) = 0 \\;\\Rightarrow\\; y = \\tfrac32 \\text{ or } y = 2" },
        { t: "Find $x$ from the linear equation.", m: "y = 2 \\Rightarrow x = 3,\\qquad y = \\tfrac32 \\Rightarrow x = 4" },
      ],
      answer: "$x = 3, y = 2$ or $x = 4, y = \\tfrac32$",
    },
    {
      id: "sim-x5",
      title: "A pair with logarithms",
      difficulty: "hard",
      prompt: "Solve $\\lg x + \\lg y = 1$ and $x - y = 3$.",
      steps: [
        { t: "Combine the logarithms.", m: "\\lg(xy) = 1 \\;\\Rightarrow\\; xy = 10" },
        { t: "Substitute $x = y + 3$.", m: "(y + 3)y = 10 \\;\\Rightarrow\\; y^2 + 3y - 10 = 0" },
        { t: "Factorise.", m: "(y + 5)(y - 2) = 0" },
        { t: "$y = -5$ gives $\\lg y$ undefined, so reject it.", m: "y = 2,\\; x = 5" },
      ],
      answer: "$x = 5$, $y = 2$ only",
    },
    {
      id: "sim-x6",
      title: "A symmetric pair without substitution",
      difficulty: "olympiad",
      prompt: "Find all real solutions of $x^2 + y^2 = 10$ and $xy = 3$.",
      steps: [
        { t: "Use the identities for $(x + y)^2$ and $(x - y)^2$.", m: "(x + y)^2 = 10 + 2(3) = 16,\\qquad (x - y)^2 = 10 - 2(3) = 4" },
        { t: "So $x + y = \\pm 4$ and $x - y = \\pm 2$, with all four sign combinations possible." },
        { t: "Add and subtract each pair.", m: "(4, 2) \\to (3, 1),\\; (4, -2) \\to (1, 3),\\; (-4, 2) \\to (-1, -3),\\; (-4, -2) \\to (-3, -1)" },
      ],
      answer: "$(3, 1)$, $(1, 3)$, $(-1, -3)$, $(-3, -1)$",
      remark: "Symmetric systems are solved fastest through $x + y$ and $xy$, never by brute substitution.",
    },
  ],
  examQuestions: [
    {
      id: "sim-x7",
      title: "Linear and quadratic",
      difficulty: "medium",
      marks: 5,
      paper: 1,
      prompt: "Solve the simultaneous equations $y - 2x = 3$ and $x^2 + xy + y^2 = 7$. [5]",
      steps: [
        { t: "Substitute $y = 2x + 3$.", m: "x^2 + x(2x + 3) + (2x + 3)^2 = 7" },
        { t: "Expand and collect.", m: "7x^2 + 15x + 2 = 0" },
        { t: "Factorise.", m: "(7x + 1)(x + 2) = 0 \\;\\Rightarrow\\; x = -\\tfrac17 \\text{ or } x = -2" },
        { t: "Find $y$ from $y = 2x + 3$.", m: "x = -2 \\Rightarrow y = -1,\\qquad x = -\\tfrac17 \\Rightarrow y = \\tfrac{19}{7}" },
      ],
      answer: "$x = -2, y = -1$ or $x = -\\tfrac17, y = \\tfrac{19}{7}$",
      markScheme: [
        { type: "M", marks: 1, criterion: "Substitutes for one variable to get an equation in one unknown" },
        { type: "A", marks: 1, criterion: "$7x^2 + 15x + 2 = 0$", dependsOn: 0 },
        { type: "M", marks: 1, criterion: "Solves their three-term quadratic" },
        { type: "A", marks: 1, criterion: "$x = -2$ and $x = -\\tfrac17$", dependsOn: 2 },
        { type: "A", marks: 1, criterion: "$y = -1$ and $y = \\tfrac{19}{7}$, correctly paired", dependsOn: 2 },
      ],
    },
    {
      id: "sim-x8",
      title: "A chord of an ellipse",
      difficulty: "hard",
      marks: 7,
      paper: 2,
      prompt: "The line $y = 3 - x$ meets the curve $2x^2 + y^2 = 11$ at the points $A$ and $B$.\n(a) Find the coordinates of $A$ and $B$, giving your answers to 3 significant figures, with $A$ to the right of $B$. [5]\n(b) Find the length of $AB$. [2]",
      steps: [
        { t: "(a) Substitute.", m: "2x^2 + (3 - x)^2 = 11 \\;\\Rightarrow\\; 3x^2 - 6x - 2 = 0" },
        { t: "Use the formula.", m: "x = \\frac{6 \\pm \\sqrt{36 + 24}}{6} = 1 \\pm \\frac{\\sqrt{60}}{6}" },
        { t: "Evaluate, and find $y = 3 - x$.", m: "A(2.29, 0.709),\\qquad B(-0.291, 3.29)" },
        { t: "(b) Both coordinate differences are $\\tfrac{\\sqrt{60}}{3} \\approx 2.582$, because the line has gradient $-1$.", m: "AB = \\sqrt2 \\times 2.582 \\approx 3.65" },
      ],
      answer: "(a) $A(2.29, 0.709)$, $B(-0.291, 3.29)$  (b) $AB \\approx 3.65$",
      markScheme: [
        { part: "(a)", type: "M", marks: 1, criterion: "Substitutes to obtain an equation in one variable" },
        { part: "(a)", type: "A", marks: 1, criterion: "$3x^2 - 6x - 2 = 0$", dependsOn: 0 },
        { part: "(a)", type: "M", marks: 1, criterion: "Uses the quadratic formula correctly" },
        { part: "(a)", type: "A", marks: 1, criterion: "Both $x$-coordinates, 3 s.f.", dependsOn: 2 },
        { part: "(a)", type: "A", marks: 1, criterion: "Both $y$-coordinates, 3 s.f.", dependsOn: 2 },
        { part: "(b)", type: "M", marks: 1, criterion: "Uses the distance formula with their points" },
        { part: "(b)", type: "A", marks: 1, criterion: "$3.65$", dependsOn: 5 },
      ],
    },
    {
      id: "sim-x9",
      title: "Logarithmic pair",
      difficulty: "medium",
      marks: 5,
      paper: 1,
      prompt: "Solve the simultaneous equations $\\log_2 x + \\log_2 y = 3$ and $\\log_2(x + y) = \\log_2 6$. [5]",
      steps: [
        { t: "The first equation gives $xy = 2^3$.", m: "xy = 8" },
        { t: "The second gives $x + y = 6$. Substitute $y = 6 - x$.", m: "x(6 - x) = 8 \\;\\Rightarrow\\; x^2 - 6x + 8 = 0" },
        { t: "Factorise. Both solutions are positive, so both are valid.", m: "(x - 2)(x - 4) = 0" },
      ],
      answer: "$x = 2, y = 4$ or $x = 4, y = 2$",
      markScheme: [
        { type: "B", marks: 1, criterion: "$xy = 8$" },
        { type: "B", marks: 1, criterion: "$x + y = 6$" },
        { type: "M", marks: 1, criterion: "Substitutes to form a quadratic in one variable" },
        { type: "M", marks: 1, criterion: "Solves their quadratic" },
        { type: "A", marks: 1, criterion: "Both pairs, correctly matched", dependsOn: 3 },
      ],
    },
  ],
  mistakes: [
    {
      wrong: "Keeping $y = -5$ in a system that contains $\\lg y$.",
      why: "The logarithm of a negative number is undefined, so that pair does not satisfy the original equations.",
      fix: "After solving, check every value against the domain of each logarithm and reject the invalid ones with a reason.",
    },
    {
      wrong: "Finding only $(3, 1)$ and $(1, 3)$ from $x^2 + y^2 = 10$ and $xy = 3$.",
      why: "Square roots have two signs, so $x + y = \\pm 4$, not just $4$.",
      fix: "Keep $\\pm$ at every square root and follow every sign combination through.",
    },
    {
      wrong: "Making $y$ the subject of $x + 2y = 7$ when $x$ has coefficient 1.",
      why: "It is not wrong, but it brings fractions into every line and multiplies the chance of a slip.",
      fix: "Rearrange for the variable whose coefficient is 1.",
    },
  ],
  tips: [
    "Substitute from the linear equation into the non-linear one, never the other way round.",
    "Present answers as pairs. An unpaired list of $x$ values and $y$ values can lose the final mark.",
    "For a symmetric pair, work with $x + y$ and $xy$ instead of substituting.",
  ],
  summary: {
    bigIdea: "Two equations, two unknowns: use the simpler equation to remove one unknown from the other. The result is a single equation you already know how to solve, usually a quadratic.",
    mustKnow: [
      "Rearrange the linear equation and substitute into the non-linear one",
      "Each $x$ value gives its partner $y$ through the linear equation",
      "Number of intersections of a line and a curve = number of real roots of the substituted quadratic",
      "$(x + y)^2 = x^2 + y^2 + 2xy$ and $(x - y)^2 = x^2 + y^2 - 2xy$",
    ],
    methods: [
      { name: "Linear and non-linear", steps: ["Make one variable the subject of the linear equation.", "Substitute into the non-linear equation.", "Solve the quadratic.", "Find each partner value from the linear equation."] },
      { name: "Logarithmic pair", steps: ["Use the log laws to remove the logarithms.", "Solve the algebraic system.", "Reject any value outside a logarithm's domain."] },
    ],
    traps: [
      "Substituting back into the quadratic equation, which can give extra $y$ values.",
      "Forgetting the negative root.",
      "Unpaired answers.",
      "Dividing by a variable that could be zero.",
    ],
  },
};
