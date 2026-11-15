import type { TopicExtra } from "@/lib/types";

export const straightLineGraphsExtra: TopicExtra = {
  sections: [
    {
      id: "foot-of-perpendicular",
      heading: "The foot of a perpendicular",
      body: [
        { k: "p", t: "The shortest distance from a point $P$ to a line is along the perpendicular. The point where that perpendicular meets the line is called the foot, $F$." },
        {
          k: "ol",
          items: [
            "Find the gradient of the line, and so the perpendicular gradient.",
            "Write the equation of the perpendicular through $P$.",
            "Solve it simultaneously with the line to find $F$.",
            "The distance $PF$ is the shortest distance from $P$ to the line.",
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 8],
            yRange: [0, 10],
            curves: [
              { f: (x) => 2 * x - 1, label: "y = 2x − 1", color: 0 },
              { f: (x) => -0.5 * x + 8.5, label: "perpendicular through P", color: 1, dashed: true },
            ],
            points: [
              { x: 5, y: 6, label: "P(5, 6)" },
              { x: 3.8, y: 6.6, label: "F" },
              { x: 2.6, y: 7.2, label: "P′" },
            ],
            yTick: 2,
            caption: "$F$ is the foot of the perpendicular from $P$. Going the same distance again gives $P'$, the reflection of $P$ in the line.",
          },
        },
      ],
    },
    {
      id: "dividing-a-segment",
      heading: "A point dividing a segment in a ratio",
      body: [
        { k: "p", t: "If $C$ lies on $AB$ with $AC : CB = m : n$, then $C$ is $\\tfrac{m}{m+n}$ of the way from $A$ to $B$. Move that fraction of the way in $x$ and in $y$." },
        { k: "math", t: "C = A + \\tfrac{m}{m+n}(B - A)" },
        { k: "p", t: "The midpoint is the case $m = n$, which gives the average of the coordinates." },
      ],
    },
    {
      id: "reflections",
      heading: "Reflecting a point in a line",
      body: [
        { k: "p", t: "The reflection $P'$ of a point $P$ in a line is as far beyond the line as $P$ is in front of it. The foot of the perpendicular $F$ is therefore the midpoint of $PP'$." },
        { k: "math", t: "F = \\tfrac12(P + P') \\;\\Rightarrow\\; P' = 2F - P" },
        { k: "note", tone: "tip", title: "Shortest paths", t: "To find the shortest route from $A$ to a line and on to $B$, reflect $A$ in the line. The straight line from the reflection to $B$ crosses the line at the best point." },
      ],
    },
  ],
  examples: [
    {
      id: "line-x1",
      title: "Length, midpoint and gradient",
      difficulty: "easy",
      prompt: "$A$ is $(1, 2)$ and $B$ is $(7, 10)$. Find the length of $AB$, its midpoint and its gradient.",
      steps: [
        { t: "The differences are $6$ in $x$ and $8$ in $y$.", m: "AB = \\sqrt{6^2 + 8^2} = 10" },
        { t: "Average the coordinates.", m: "M = (4, 6)" },
        { t: "Rise over run.", m: "m = \\frac86 = \\frac43" },
      ],
      answer: "Length $10$, midpoint $(4, 6)$, gradient $\\tfrac43$",
    },
    {
      id: "line-x2",
      title: "A parallel line",
      difficulty: "easy",
      prompt: "Find the equation of the line through $(2, -1)$ parallel to $3x + 2y = 7$, in the form $ax + by = c$.",
      steps: [
        { t: "Rearrange to find the gradient.", m: "y = -\\tfrac32x + \\tfrac72 \\;\\Rightarrow\\; m = -\\tfrac32" },
        { t: "Use the point-gradient form.", m: "y + 1 = -\\tfrac32(x - 2)" },
        { t: "Multiply by 2 and rearrange.", m: "2y + 2 = -3x + 6 \\;\\Rightarrow\\; 3x + 2y = 4" },
      ],
      answer: "$3x + 2y = 4$",
    },
    {
      id: "line-x3",
      title: "The foot of a perpendicular",
      difficulty: "medium",
      prompt: "Find the foot of the perpendicular from $P(5, 6)$ to the line $y = 2x - 1$, and the shortest distance from $P$ to the line.",
      steps: [
        { t: "The perpendicular gradient is $-\\tfrac12$. The perpendicular through $P$ is:", m: "y - 6 = -\\tfrac12(x - 5) \\;\\Rightarrow\\; y = -\\tfrac12x + 8.5" },
        { t: "Solve with $y = 2x - 1$.", m: "2x - 1 = -\\tfrac12x + 8.5 \\;\\Rightarrow\\; 2.5x = 9.5 \\;\\Rightarrow\\; x = 3.8" },
        { t: "So $y = 2(3.8) - 1 = 6.6$, and $F = (3.8, 6.6)$." },
        { t: "Find $PF$.", m: "PF = \\sqrt{1.2^2 + 0.6^2} = \\sqrt{1.8} = \\frac{3\\sqrt5}{5}" },
      ],
      answer: "Foot $(3.8, 6.6)$; distance $\\dfrac{3\\sqrt5}{5} \\approx 1.34$",
    },
    {
      id: "line-x4",
      title: "Dividing a segment",
      difficulty: "medium",
      prompt: "$A$ is $(-2, 1)$ and $B$ is $(10, 7)$. The point $C$ lies on $AB$ with $AC : CB = 1 : 2$. Find $C$.",
      steps: [
        { t: "$C$ is one third of the way from $A$ to $B$.", m: "B - A = (12, 6)" },
        { t: "Add a third of that to $A$.", m: "C = (-2 + 4,\\; 1 + 2)" },
      ],
      answer: "$C = (2, 3)$",
    },
    {
      id: "line-x5",
      title: "A reflection",
      difficulty: "hard",
      prompt: "Find the reflection of $P(5, 6)$ in the line $y = 2x - 1$.",
      steps: [
        { t: "From the previous example, the foot of the perpendicular is $F(3.8, 6.6)$." },
        { t: "$F$ is the midpoint of $P$ and its reflection, so $P' = 2F - P$.", m: "P' = (7.6 - 5,\\; 13.2 - 6)" },
        { t: "Check: the midpoint of $(5, 6)$ and $(2.6, 7.2)$ is $(3.8, 6.6)$, and it lies on $y = 2x - 1$. ✓" },
      ],
      answer: "$P' = (2.6, 7.2)$",
    },
    {
      id: "line-x6",
      title: "The shortest broken path",
      difficulty: "olympiad",
      prompt: "$A$ is $(1, 2)$ and $B$ is $(5, 4)$. The point $P$ moves along the $x$-axis. Find the position of $P$ that makes $PA + PB$ as small as possible, and the least value.",
      steps: [
        { t: "Reflect $A$ in the $x$-axis to get $A'(1, -2)$. Every point $P$ on the axis has $PA = PA'$, so we want to minimise $PA' + PB$." },
        { t: "That sum is least when $A'$, $P$ and $B$ are in a straight line. The line $A'B$ has gradient $\\tfrac{6}{4} = \\tfrac32$.", m: "y + 2 = \\tfrac32(x - 1)" },
        { t: "It meets the axis where $y = 0$.", m: "x = 1 + \\tfrac43 = \\tfrac73" },
        { t: "The least value is the length $A'B$.", m: "\\sqrt{4^2 + 6^2} = \\sqrt{52} = 2\\sqrt{13}" },
      ],
      answer: "$P\\left(\\tfrac73, 0\\right)$; least value $2\\sqrt{13} \\approx 7.21$",
      remark: "This is the path a light ray takes when it bounces off a mirror: the angles to the axis are equal.",
    },
  ],
  examQuestions: [
    {
      id: "line-x7",
      title: "Perpendicular bisector and a triangle",
      difficulty: "medium",
      marks: 7,
      paper: 1,
      prompt: "$A$ is $(-1, 3)$ and $B$ is $(5, -1)$.\n(a) Find the equation of the perpendicular bisector of $AB$. [4]\n(b) The perpendicular bisector meets the $y$-axis at $C$. Find the area of triangle $ABC$. [3]",
      steps: [
        { t: "(a) Midpoint and gradient of $AB$.", m: "M = (2, 1),\\qquad m_{AB} = \\frac{-4}{6} = -\\tfrac23" },
        { t: "The perpendicular gradient is $\\tfrac32$.", m: "y - 1 = \\tfrac32(x - 2) \\;\\Rightarrow\\; 3x - 2y = 4" },
        { t: "(b) At $x = 0$, $y = -2$, so $C = (0, -2)$." },
        { t: "Use the shoelace formula.", m: "\\tfrac12\\left|-1(-1 + 2) + 5(-2 - 3) + 0\\right| = \\tfrac12\\left|-26\\right| = 13" },
      ],
      answer: "(a) $3x - 2y = 4$  (b) area $13$",
      markScheme: [
        { part: "(a)", type: "B", marks: 1, criterion: "Midpoint $(2, 1)$" },
        { part: "(a)", type: "B", marks: 1, criterion: "Gradient of $AB$ is $-\\tfrac23$" },
        { part: "(a)", type: "M", marks: 1, criterion: "Uses the perpendicular gradient through their midpoint" },
        { part: "(a)", type: "A", marks: 1, criterion: "$3x - 2y = 4$ or equivalent", dependsOn: 2 },
        { part: "(b)", type: "B", marks: 1, criterion: "$C = (0, -2)$" },
        { part: "(b)", type: "M", marks: 1, criterion: "Correct area method with their three points" },
        { part: "(b)", type: "A", marks: 1, criterion: "$13$", dependsOn: 5 },
      ],
    },
    {
      id: "line-x8",
      title: "An exponential law from a straight line",
      difficulty: "hard",
      marks: 6,
      paper: 2,
      prompt: "Two variables are related by $y = Ab^x$. A graph of $\\lg y$ against $x$ is a straight line passing through $(1, 0.9)$ and $(4, 1.8)$.\n(a) Find $A$ and $b$. [5]\n(b) Find $y$ when $x = 6$. [1]",
      steps: [
        { t: "(a) Take logs: $\\lg y = \\lg A + x\\lg b$. So the gradient is $\\lg b$ and the intercept is $\\lg A$." },
        { t: "Gradient.", m: "\\lg b = \\frac{1.8 - 0.9}{4 - 1} = 0.3 \\;\\Rightarrow\\; b = 10^{0.3} \\approx 2.00" },
        { t: "Intercept: $0.9 = \\lg A + 0.3$.", m: "\\lg A = 0.6 \\;\\Rightarrow\\; A = 10^{0.6} \\approx 3.98" },
        { t: "(b) $\\lg y = 0.6 + 0.3(6) = 2.4$.", m: "y = 10^{2.4} \\approx 251" },
      ],
      answer: "(a) $A \\approx 3.98$, $b \\approx 2.00$  (b) $y \\approx 251$",
      markScheme: [
        { part: "(a)", type: "B", marks: 1, criterion: "$\\lg y = \\lg A + x\\lg b$" },
        { part: "(a)", type: "M", marks: 1, criterion: "Finds the gradient and equates it to $\\lg b$" },
        { part: "(a)", type: "A", marks: 1, criterion: "$b = 2.00$", dependsOn: 1 },
        { part: "(a)", type: "M", marks: 1, criterion: "Finds the intercept and equates it to $\\lg A$" },
        { part: "(a)", type: "A", marks: 1, criterion: "$A = 3.98$", dependsOn: 3 },
        { part: "(b)", type: "B", marks: 1, criterion: "$y = 251$" },
      ],
    },
    {
      id: "line-x9",
      title: "Where a perpendicular from the origin lands",
      difficulty: "hard",
      marks: 5,
      paper: 1,
      prompt: "The line $2x + 3y = 12$ meets the $x$-axis at $P$ and the $y$-axis at $Q$. The line through the origin perpendicular to $PQ$ meets $PQ$ at $R$.\n(a) Find the coordinates of $R$. [3]\n(b) Find the ratio $PR : RQ$. [2]",
      steps: [
        { t: "(a) $P = (6, 0)$ and $Q = (0, 4)$. $PQ$ has gradient $-\\tfrac23$, so the perpendicular has gradient $\\tfrac32$.", m: "y = \\tfrac32x" },
        { t: "Substitute into $2x + 3y = 12$.", m: "2x + \\tfrac92x = 12 \\;\\Rightarrow\\; x = \\tfrac{24}{13},\\; y = \\tfrac{36}{13}" },
        { t: "(b) $R$ is a fraction $t$ of the way from $P$ to $Q$. In $x$: $6 - 6t = \\tfrac{24}{13}$.", m: "t = \\tfrac{9}{13}" },
        { t: "So $PR$ is $\\tfrac{9}{13}$ of $PQ$ and $RQ$ is $\\tfrac{4}{13}$." },
      ],
      answer: "(a) $R\\left(\\tfrac{24}{13}, \\tfrac{36}{13}\\right)$  (b) $PR : RQ = 9 : 4$",
      markScheme: [
        { part: "(a)", type: "B", marks: 1, criterion: "$P(6, 0)$, $Q(0, 4)$ and perpendicular gradient $\\tfrac32$" },
        { part: "(a)", type: "M", marks: 1, criterion: "Solves their two line equations simultaneously" },
        { part: "(a)", type: "A", marks: 1, criterion: "$\\left(\\tfrac{24}{13}, \\tfrac{36}{13}\\right)$", dependsOn: 1 },
        { part: "(b)", type: "M", marks: 1, criterion: "Compares lengths, or uses a fraction of $PQ$" },
        { part: "(b)", type: "A", marks: 1, criterion: "$9 : 4$", dependsOn: 3 },
      ],
    },
  ],
  mistakes: [
    {
      wrong: "Taking the gradient perpendicular to $\\tfrac23$ as $\\tfrac32$.",
      why: "Flipping the fraction is only half the rule. Perpendicular gradients multiply to $-1$, and $\\tfrac23 \\times \\tfrac32 = 1$.",
      fix: "Flip **and** change the sign: the perpendicular gradient is $-\\tfrac32$.",
    },
    {
      wrong: "Reading the gradient of $3x + 2y = 7$ as $3$.",
      why: "The gradient is the coefficient of $x$ only when the equation is written as $y = mx + c$.",
      fix: "Rearrange first: $y = -\\tfrac32x + \\tfrac72$, so $m = -\\tfrac32$.",
    },
    {
      wrong: "Finding a midpoint by subtracting the coordinates.",
      why: "Subtracting gives the change from one point to the other, which is used for gradient and length.",
      fix: "Midpoint means average: add the coordinates and halve.",
    },
  ],
  tips: [
    "Always draw a quick sketch. It catches a wrong sign in a gradient before it costs every later mark.",
    "Give a final line equation in the form the question asks for. “Integer coefficients” means clear every fraction.",
    "To check a reflection, confirm the midpoint lies on the mirror line and the segment is perpendicular to it.",
  ],
  summary: {
    bigIdea: "Coordinate geometry turns pictures into algebra. Gradient measures direction, perpendicular means gradients multiply to $-1$, and any law that becomes linear after taking logs can be read from a straight-line graph.",
    mustKnow: [
      "Gradient $m = \\dfrac{y_2 - y_1}{x_2 - x_1}$",
      "Midpoint $\\left(\\tfrac{x_1 + x_2}{2}, \\tfrac{y_1 + y_2}{2}\\right)$ and length $\\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$",
      "Parallel: $m_1 = m_2$. Perpendicular: $m_1 m_2 = -1$",
      "Line through $(x_1, y_1)$: $y - y_1 = m(x - x_1)$",
      "$y = Ax^n \\Rightarrow \\lg y = n\\lg x + \\lg A$; $y = Ab^x \\Rightarrow \\lg y = x\\lg b + \\lg A$",
    ],
    methods: [
      { name: "Perpendicular bisector", steps: ["Find the midpoint.", "Find the gradient and take the negative reciprocal.", "Write the line through the midpoint."] },
      { name: "Straight-line form", steps: ["Take logs to make the relation linear.", "Match $Y = mX + c$.", "Gradient and intercept give the constants."] },
      { name: "Area of a polygon", steps: ["List the vertices in order around the shape.", "Apply the shoelace formula.", "Take half the modulus."] },
    ],
    traps: [
      "Run over rise for the gradient.",
      "Perpendicular gradient as $-m$ or as $\\tfrac1m$.",
      "Reporting the intercept $\\lg A$ as $A$.",
      "Reading a gradient straight from $ax + by = c$.",
    ],
  },
};
