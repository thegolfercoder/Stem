import type { TopicExtra } from "@/lib/types";

export const equationsInequalitiesGraphsExtra: TopicExtra = {
  sections: [
    {
      id: "squaring-method",
      heading: "A modulus on both sides: square it",
      body: [
        { k: "p", t: "When both sides of an equation or inequality are moduli, both are non-negative. Squaring then keeps the statement true in both directions, and the moduli disappear because $|A|^2 = A^2$." },
        { k: "math", t: "|x - 2| = |2x + 1| \\;\\Rightarrow\\; (x - 2)^2 = (2x + 1)^2" },
        { k: "p", t: "The result is a quadratic. It can also be factorised as a difference of two squares, which is often quicker:" },
        { k: "math", t: "(x - 2)^2 - (2x + 1)^2 = \\big[(x - 2) - (2x + 1)\\big]\\big[(x - 2) + (2x + 1)\\big] = (-x - 3)(3x - 1)" },
        { k: "note", tone: "warn", title: "Only when both sides are non-negative", t: "Squaring $|x - 2| < 2x + 1$ is not safe, because $2x + 1$ can be negative. Use the two-case method or a sketch instead." },
      ],
    },
    {
      id: "counting-solutions",
      heading: "Counting solutions with a sketch",
      body: [
        { k: "p", t: "The number of solutions of $|f(x)| = k$ is the number of times the horizontal line $y = k$ meets the graph of $y = |f(x)|$. A sketch answers “how many” and “for which $k$” questions at once." },
        {
          k: "plot",
          spec: {
            xRange: [-2, 7],
            yRange: [-1, 10],
            curves: [
              { f: (x) => Math.abs(x * x - 5 * x), label: "y = |x² − 5x|", color: 0 },
              { f: () => 6, label: "y = 6", color: 1, dashed: true },
            ],
            points: [
              { x: -1, y: 6 },
              { x: 2, y: 6 },
              { x: 3, y: 6 },
              { x: 6, y: 6 },
            ],
            yTick: 2,
            caption: "The line $y = 6$ meets $y = |x^2 - 5x|$ four times, because $6 < 6.25$, the height of the reflected hump.",
          },
        },
        { k: "p", t: "The reflected hump peaks at the vertex value $\\left|{-6.25}\\right| = 6.25$. So $|x^2 - 5x| = k$ has four solutions for $0 < k < 6.25$, three at $k = 6.25$, and two for $k > 6.25$." },
      ],
    },
    {
      id: "sums-of-moduli",
      heading: "Sums of moduli: split the number line",
      body: [
        { k: "p", t: "An expression such as $|x - 1| + |x - 3|$ changes formula at each point where a modulus switches sign, here $x = 1$ and $x = 3$. Split the number line at those points and remove the moduli in each piece." },
        {
          k: "table",
          head: ["Interval", "Value of |x − 1|", "Value of |x − 3|", "Sum"],
          rows: [
            ["$x \\le 1$", "$1 - x$", "$3 - x$", "$4 - 2x$"],
            ["$1 \\le x \\le 3$", "$x - 1$", "$3 - x$", "$2$"],
            ["$x \\ge 3$", "$x - 1$", "$x - 3$", "$2x - 4$"],
          ],
          caption: "Each formula is valid only on its own interval.",
        },
        { k: "note", tone: "key", title: "Check the interval", t: "A solution found from one row counts only if it lies in that row's interval." },
      ],
    },
  ],
  examples: [
    {
      id: "mod-x1",
      title: "Two cases",
      difficulty: "easy",
      prompt: "Solve $|3x - 2| = 7$.",
      steps: [
        { t: "Case 1: the inside equals $7$.", m: "3x - 2 = 7 \\;\\Rightarrow\\; x = 3" },
        { t: "Case 2: the inside equals $-7$.", m: "3x - 2 = -7 \\;\\Rightarrow\\; x = -\\tfrac53" },
      ],
      answer: "$x = 3$ or $x = -\\dfrac53$",
    },
    {
      id: "mod-x2",
      title: "A simple modulus inequality",
      difficulty: "easy",
      prompt: "Solve $|x - 4| \\le 3$.",
      steps: [
        { t: "A modulus at most 3 means the inside lies between $-3$ and $3$.", m: "-3 \\le x - 4 \\le 3" },
        { t: "Add 4 throughout.", m: "1 \\le x \\le 7" },
      ],
      answer: "$1 \\le x \\le 7$",
    },
    {
      id: "mod-x3",
      title: "Modulus equals modulus",
      difficulty: "medium",
      prompt: "Solve $|x - 2| = |2x + 1|$.",
      steps: [
        { t: "Both sides are non-negative, so square.", m: "x^2 - 4x + 4 = 4x^2 + 4x + 1" },
        { t: "Collect.", m: "3x^2 + 8x - 3 = 0 \\;\\Rightarrow\\; (3x - 1)(x + 3) = 0" },
        { t: "Check: $\\left|\\tfrac13 - 2\\right| = \\tfrac53 = \\left|\\tfrac23 + 1\\right|$ and $|-5| = 5 = |-5|$. ✓", m: "x = \\tfrac13 \\text{ or } x = -3" },
      ],
      answer: "$x = \\dfrac13$ or $x = -3$",
    },
    {
      id: "mod-x4",
      title: "Modulus less than modulus",
      difficulty: "medium",
      prompt: "Solve $|x - 2| < |2x + 1|$.",
      steps: [
        { t: "Square both sides, as in the equation.", m: "(x - 2)^2 < (2x + 1)^2 \\;\\Rightarrow\\; 0 < 3x^2 + 8x - 3" },
        { t: "The critical values are $x = -3$ and $x = \\tfrac13$. The quadratic is positive outside them.", m: "x < -3 \\text{ or } x > \\tfrac13" },
      ],
      answer: "$x < -3$ or $x > \\dfrac13$",
    },
    {
      id: "mod-x5",
      title: "Modulus of a quadratic",
      difficulty: "hard",
      prompt: "Solve $|x^2 - 5x| = 6$.",
      steps: [
        { t: "Case 1: the inside equals $6$.", m: "x^2 - 5x - 6 = 0 \\;\\Rightarrow\\; (x - 6)(x + 1) = 0 \\;\\Rightarrow\\; x = 6, -1" },
        { t: "Case 2: the inside equals $-6$.", m: "x^2 - 5x + 6 = 0 \\;\\Rightarrow\\; (x - 2)(x - 3) = 0 \\;\\Rightarrow\\; x = 2, 3" },
        { t: "All four satisfy the original equation. The sketch above shows why there are four." },
      ],
      answer: "$x = -1$, $x = 2$, $x = 3$ or $x = 6$",
    },
    {
      id: "mod-x6",
      title: "A sum of two moduli",
      difficulty: "olympiad",
      prompt: "(a) Solve $|x - 1| + |x - 3| = 4$. (b) Find the value of $k$ for which $|x - 1| + |x - 3| = k$ has infinitely many solutions.",
      steps: [
        { t: "(a) For $x \\le 1$ the sum is $4 - 2x$.", m: "4 - 2x = 4 \\;\\Rightarrow\\; x = 0 \\quad (\\text{and } 0 \\le 1 \\text{ ✓})" },
        { t: "For $1 \\le x \\le 3$ the sum is the constant 2, which never equals 4." },
        { t: "For $x \\ge 3$ the sum is $2x - 4$.", m: "2x - 4 = 4 \\;\\Rightarrow\\; x = 4 \\quad (\\text{and } 4 \\ge 3 \\text{ ✓})" },
        { t: "(b) The sum is constant on a whole interval, $1 \\le x \\le 3$, where it equals 2. That value of $k$ gives every point of the interval as a solution." },
      ],
      answer: "(a) $x = 0$ or $x = 4$  (b) $k = 2$",
      remark: "Geometrically, $|x - 1| + |x - 3|$ is the total distance from $x$ to 1 and to 3. Anywhere between them, that total is the gap, 2.",
    },
  ],
  examQuestions: [
    {
      id: "mod-x7",
      title: "Two moduli equal",
      difficulty: "medium",
      marks: 4,
      paper: 1,
      prompt: "Solve $|2x + 3| = |x - 6|$. [4]",
      steps: [
        { t: "Square both sides.", m: "4x^2 + 12x + 9 = x^2 - 12x + 36" },
        { t: "Collect and simplify.", m: "3x^2 + 24x - 27 = 0 \\;\\Rightarrow\\; x^2 + 8x - 9 = 0" },
        { t: "Factorise.", m: "(x + 9)(x - 1) = 0 \\;\\Rightarrow\\; x = -9 \\text{ or } x = 1" },
      ],
      answer: "$x = -9$ or $x = 1$",
      markScheme: [
        { type: "M", marks: 1, criterion: "Squares both sides, or forms both linear cases" },
        { type: "A", marks: 1, criterion: "$3x^2 + 24x - 27 = 0$ or equivalent", dependsOn: 0 },
        { type: "M", marks: 1, criterion: "Solves their three-term quadratic" },
        { type: "A", marks: 1, criterion: "$x = -9$ and $x = 1$", dependsOn: 2 },
      ],
    },
    {
      id: "mod-x8",
      title: "Sketch, then solve the inequality",
      difficulty: "medium",
      marks: 5,
      paper: 1,
      prompt: "(a) On the same axes, sketch $y = |2x - 4|$ and $y = x + 1$. [2]\n(b) Solve $|2x - 4| < x + 1$. [3]",
      steps: [
        { t: "(a) $y = |2x - 4|$ is a V with its vertex at $(2, 0)$, meeting the $y$-axis at $(0, 4)$. The line $y = x + 1$ passes through $(0, 1)$ and $(-1, 0)$." },
        { t: "(b) The right-hand branch meets the line where $2x - 4 = x + 1$.", m: "x = 5" },
        { t: "The left-hand branch meets the line where $-(2x - 4) = x + 1$.", m: "4 - 2x = x + 1 \\;\\Rightarrow\\; x = 1" },
        { t: "The V is below the line between these points.", m: "1 < x < 5" },
      ],
      answer: "(b) $1 < x < 5$",
      markScheme: [
        { part: "(a)", type: "B", marks: 1, criterion: "V shape with vertex at $(2, 0)$ and $y$-intercept 4" },
        { part: "(a)", type: "B", marks: 1, criterion: "Line with positive gradient through $(0, 1)$" },
        { part: "(b)", type: "M", marks: 1, criterion: "Finds both critical values from two linear equations" },
        { part: "(b)", type: "A", marks: 1, criterion: "$x = 1$ and $x = 5$", dependsOn: 2 },
        { part: "(b)", type: "A", marks: 1, criterion: "$1 < x < 5$", dependsOn: 2 },
      ],
    },
    {
      id: "mod-x9",
      title: "A substitution with a square root",
      difficulty: "hard",
      marks: 5,
      paper: 1,
      prompt: "Using a suitable substitution, solve $2x - 7\\sqrt x + 3 = 0$. [5]",
      steps: [
        { t: "Let $u = \\sqrt x$, so $x = u^2$.", m: "2u^2 - 7u + 3 = 0" },
        { t: "Factorise.", m: "(2u - 1)(u - 3) = 0 \\;\\Rightarrow\\; u = \\tfrac12 \\text{ or } u = 3" },
        { t: "Both values are positive, so both are valid square roots. Square to recover $x$.", m: "x = \\tfrac14 \\text{ or } x = 9" },
      ],
      answer: "$x = \\dfrac14$ or $x = 9$",
      markScheme: [
        { type: "B", marks: 1, criterion: "Correct substitution giving $2u^2 - 7u + 3 = 0$" },
        { type: "M", marks: 1, criterion: "Solves their quadratic in $u$" },
        { type: "A", marks: 1, criterion: "$u = \\tfrac12$ and $u = 3$", dependsOn: 1 },
        { type: "M", marks: 1, criterion: "Squares their values of $u$" },
        { type: "A", marks: 1, criterion: "$x = \\tfrac14$ and $x = 9$", dependsOn: 3 },
      ],
    },
  ],
  mistakes: [
    {
      wrong: "Solving $|x^2 - 5x| = 6$ from $x^2 - 5x = 6$ alone.",
      why: "The inside of a modulus can equal $-6$ just as well as $6$. Ignoring that branch loses half the solutions.",
      fix: "Always solve both: inside $= 6$ and inside $= -6$. A sketch shows how many solutions to expect.",
    },
    {
      wrong: "Squaring both sides of $|x - 2| < 2x + 1$.",
      why: "Squaring preserves an inequality only when both sides are non-negative, and $2x + 1$ need not be.",
      fix: "Square only when both sides are moduli or are known to be non-negative. Otherwise use the two cases or a sketch.",
    },
    {
      wrong: "Writing $|x - 4| \\le 3$ as $x - 4 \\le \\pm 3$.",
      why: "“$\\pm 3$” is not a single bound, so the statement has no clear meaning.",
      fix: "Write the double inequality $-3 \\le x - 4 \\le 3$, then solve it.",
    },
  ],
  tips: [
    "With a modulus on each side, square both sides. Both are non-negative, so nothing is gained or lost.",
    "Check every candidate in the original equation. It costs seconds and catches the roots that a modulus forbids.",
    "For a sum of moduli, split the number line at each critical value and work interval by interval.",
  ],
  summary: {
    bigIdea: "$|A|$ is the distance of $A$ from zero. Every modulus problem becomes ordinary algebra once you split into the case where $A$ is positive and the case where it is negative, or square away moduli on both sides.",
    mustKnow: [
      "$|A| = k \\iff A = k \\text{ or } A = -k$, for $k \\ge 0$",
      "$|A| < k \\iff -k < A < k$",
      "$|A| > k \\iff A > k \\text{ or } A < -k$",
      "$|A| = |B| \\iff A^2 = B^2$",
      "$y = |f(x)|$: reflect only the parts below the $x$-axis",
    ],
    methods: [
      { name: "Modulus equation", steps: ["Solve inside $=$ right-hand side.", "Solve inside $= -$(right-hand side).", "Check each root in the original."] },
      { name: "Modulus inequality", steps: ["Find the critical values from the equation.", "Sketch both sides.", "Read off where one graph is above the other."] },
      { name: "Hidden quadratic", steps: ["Substitute $u$ for the repeated piece, e.g. $u = \\sqrt x$.", "Solve for $u$ and reject impossible values.", "Convert back to $x$."] },
    ],
    traps: [
      "Keeping a root that makes the right-hand side negative.",
      "Writing $|A| > k$ as $-k > A > k$.",
      "Forgetting to convert back after a substitution.",
      "Reflecting the whole graph instead of the negative parts.",
    ],
  },
};
