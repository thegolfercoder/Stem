import type { Topic } from "@/lib/types";

export const straightLineGraphs: Topic = {
  slug: "straight-line-graphs",
  unit: 7,
  title: "Straight-line graphs",
  short: "Straight lines",
  blurb:
    "Gradients, perpendicular bisectors, and the transformation questions that turn a curved relationship into a straight line.",
  syllabus: [
    { code: "7.1", text: "Use the equation of a straight line." },
    { code: "7.2", text: "Know and use the condition for two lines to be parallel or perpendicular." },
    { code: "7.3", text: "Solve problems involving midpoint and length of a line, including finding and using the equation of a perpendicular bisector." },
    { code: "7.4", text: "Transform given relationships to and from straight-line form, determining unknown constants from the gradient or intercept of the transformed graph." },
  ],
  prerequisites: ["indices-and-surds", "logarithms-exponentials"],
  estimatedMinutes: 85,
  sections: [
    {
      id: "basics",
      heading: "Gradient, length and midpoint",
      body: [
        { k: "p", t: "Three formulas do most of the work in coordinate geometry, and none of them is given in the exam." },
        { k: "math", t: "m = \\frac{y_2-y_1}{x_2-x_1}, \\qquad |AB| = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}, \\qquad M = \\left(\\frac{x_1+x_2}{2}, \\frac{y_1+y_2}{2}\\right)" },
        {
          k: "p",
          t: "For the equation of a line, the point-gradient form is almost always faster than $y = mx+c$, because it needs no separate step to find $c$:",
        },
        { k: "math", t: "y - y_1 = m(x - x_1)" },
        {
          k: "note",
          tone: "key",
          title: "Parallel and perpendicular",
          t: "Parallel lines have **equal** gradients. Perpendicular lines have gradients whose product is $-1$: $m_1 m_2 = -1$, so $m_2 = -\\dfrac{1}{m_1}$ — flip and change the sign.",
        },
        {
          k: "note",
          tone: "warn",
          t: "A horizontal line has gradient 0 and its perpendicular is **vertical**, with equation $x = k$ and no gradient at all. The product rule does not apply to that pair.",
        },
      ],
    },
    {
      id: "perpendicular-bisector",
      heading: "The perpendicular bisector",
      body: [
        {
          k: "p",
          t: "The perpendicular bisector of $AB$ is the line through the midpoint of $AB$, at right angles to it. Every point on it is equidistant from $A$ and $B$ — which is exactly why circle questions use it to find centres.",
        },
        {
          k: "steps",
          items: [
            { t: "Find the perpendicular bisector of $A(-1, 2)$ and $B(5, 6)$. Start with the midpoint.", m: "M = \\left(\\frac{-1+5}{2}, \\frac{2+6}{2}\\right) = (2, 4)" },
            { t: "Find the gradient of $AB$.", m: "m_{AB} = \\frac{6-2}{5-(-1)} = \\frac{4}{6} = \\frac23" },
            { t: "Take the negative reciprocal.", m: "m_\\perp = -\\frac32" },
            { t: "Use the point-gradient form through $M$.", m: "y - 4 = -\\tfrac32(x - 2)" },
            { t: "Tidy into the requested form.", m: "2y - 8 = -3x + 6 \\;\\Rightarrow\\; 3x + 2y = 14" },
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-3, 8],
            yRange: [-1, 9],
            curves: [
              { f: (x: number) => (2 / 3) * x + 8 / 3, label: "AB" },
              { f: (x: number) => (14 - 3 * x) / 2, label: "perpendicular bisector", color: 1 },
            ],
            points: [
              { x: -1, y: 2, label: "A(−1, 2)" },
              { x: 5, y: 6, label: "B(5, 6)" },
              { x: 2, y: 4, label: "M(2, 4)" },
            ],
            caption: "The bisector passes through the midpoint at right angles; every point on it is the same distance from A as from B.",
            height: 340,
          },
        },
      ],
    },
    {
      id: "straight-line-form",
      heading: "Reducing a relationship to straight-line form",
      body: [
        {
          k: "p",
          t: "This is the highest-value idea in the unit and the one most often examined. A relationship like $y = Ax^n$ is not linear — but taking logs makes it linear, and a straight line's gradient and intercept can be measured from a graph.",
        },
        {
          k: "steps",
          items: [
            { t: "Start from the power law.", m: "y = Ax^n" },
            { t: "Take logs of both sides.", m: "\\lg y = \\lg A + \\lg\\left(x^n\\right)" },
            { t: "Bring the index down.", m: "\\lg y = n\\lg x + \\lg A" },
            { t: "Compare with $Y = mX + c$. Plotting $\\lg y$ against $\\lg x$ gives a straight line.", m: "Y = \\lg y,\\ X = \\lg x,\\ m = n,\\ c = \\lg A" },
          ],
        },
        {
          k: "table",
          head: ["Relationship", "Plot $Y$ against $X$", "Gradient", "Intercept"],
          rows: [
            ["$y = Ax^n$", "$\\lg y$ against $\\lg x$", "$n$", "$\\lg A$"],
            ["$y = Ab^x$", "$\\lg y$ against $x$", "$\\lg b$", "$\\lg A$"],
            ["$y = Ae^{kx}$", "$\\ln y$ against $x$", "$k$", "$\\ln A$"],
            ["$y^2 = Ax^3 + B$", "$y^2$ against $x^3$", "$A$", "$B$"],
            ["$y = \\dfrac{A}{x} + B$", "$y$ against $\\dfrac1x$", "$A$", "$B$"],
            ["$y^3 = A\\ln x + B$", "$y^3$ against $\\ln x$", "$A$", "$B$"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "Which log to take",
          t: "Take logs only when the unknown is in an **index** or an **exponent**. If the relationship is already a sum of powers, such as $y^2 = Ax^3+B$, no logs are needed — just choose the right variables to plot.",
        },
        {
          k: "note",
          tone: "warn",
          t: "The intercept is $\\lg A$, **not** $A$. Finishing the question means undoing the log: $A = 10^c$ (or $e^c$ for natural logs).",
        },
      ],
    },
    {
      id: "areas",
      heading: "Areas and shapes",
      body: [
        {
          k: "p",
          t: "Questions often end by asking for the area of a triangle or quadrilateral formed by lines and axes. Two reliable routes:",
        },
        {
          k: "ul",
          items: [
            "**Base and height**: if one side lies along an axis or a horizontal/vertical line, use $\\frac12 \\times$ base $\\times$ height.",
            "**The shoelace formula**: for vertices $(x_1,y_1)$, $(x_2,y_2)$, $(x_3,y_3)$, the area is $\\frac12\\left|x_1(y_2-y_3) + x_2(y_3-y_1) + x_3(y_1-y_2)\\right|$.",
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "To show a quadrilateral is a rhombus: show all four sides are equal. For a rectangle: show opposite sides are parallel and one angle is right (a gradient product of $-1$). Say which property you are using — the words carry the marks.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Gradient", latex: "m = \\frac{y_2-y_1}{x_2-x_1}", given: false },
    { name: "Length", latex: "|AB| = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}", given: false },
    { name: "Midpoint", latex: "\\left(\\frac{x_1+x_2}{2}, \\frac{y_1+y_2}{2}\\right)", given: false },
    { name: "Point-gradient form", latex: "y - y_1 = m(x - x_1)", given: false },
    { name: "Perpendicular condition", latex: "m_1 m_2 = -1", given: false },
    { name: "Power law linearised", latex: "y = Ax^n \\;\\Rightarrow\\; \\lg y = n\\lg x + \\lg A", given: false },
    { name: "Exponential law linearised", latex: "y = Ab^{x} \\;\\Rightarrow\\; \\lg y = (\\lg b)x + \\lg A", given: false },
  ],
  examples: [
    {
      id: "line-ex1",
      title: "Perpendicular line through a point",
      difficulty: "easy",
      prompt: "Find the equation of the line perpendicular to $2y = 3x - 8$ passing through $(6, -1)$.",
      steps: [
        { t: "Rearrange the given line into gradient-intercept form.", m: "y = \\tfrac32 x - 4 \\;\\Rightarrow\\; m = \\tfrac32" },
        { t: "The perpendicular gradient is the negative reciprocal.", m: "m_\\perp = -\\tfrac23" },
        { t: "Use the point-gradient form.", m: "y + 1 = -\\tfrac23(x - 6)" },
        { t: "Expand and tidy.", m: "3y + 3 = -2x + 12 \\;\\Rightarrow\\; 2x + 3y = 9" },
      ],
      answer: "$2x + 3y = 9$",
    },
    {
      id: "line-ex2",
      title: "Straight-line form from a power law",
      difficulty: "medium",
      prompt:
        "Variables $x$ and $y$ are related by $y = Ax^n$. When $\\lg y$ is plotted against $\\lg x$, a straight line of gradient $1.5$ passing through $(0, 0.6)$ is obtained. Find $A$ and $n$.",
      steps: [
        { t: "Linearise the relationship.", m: "\\lg y = n \\lg x + \\lg A" },
        { t: "Compare with $Y = mX + c$: the gradient is $n$.", m: "n = 1.5" },
        { t: "The point $(0, 0.6)$ is the intercept, so $\\lg A = 0.6$.", m: "A = 10^{0.6}" },
        { t: "Evaluate.", m: "A \\approx 3.98" },
      ],
      answer: "$n = 1.5$ and $A = 10^{0.6} \\approx 3.98$.",
      remark: "The commonest error here is answering $A = 0.6$. The intercept is the *logarithm* of $A$.",
    },
    {
      id: "line-ex3",
      title: "Perpendicular bisector and an equidistant point",
      difficulty: "hard",
      prompt:
        "$A$ is $(1, 7)$ and $B$ is $(9, 1)$. The point $C$ lies on the $x$-axis and is equidistant from $A$ and $B$. Find the coordinates of $C$ and the area of triangle $ABC$.",
      steps: [
        { t: "Equidistant from $A$ and $B$ means $C$ lies on the perpendicular bisector. Start with the midpoint.", m: "M = (5, 4)" },
        { t: "Gradient of $AB$.", m: "m_{AB} = \\frac{1-7}{9-1} = -\\tfrac34" },
        { t: "Perpendicular gradient.", m: "m_\\perp = \\tfrac43" },
        { t: "Equation of the bisector.", m: "y - 4 = \\tfrac43(x-5)" },
        { t: "On the $x$-axis, $y=0$.", m: "-4 = \\tfrac43(x-5) \\;\\Rightarrow\\; x - 5 = -3 \\;\\Rightarrow\\; x = 2" },
        { t: "So $C = (2, 0)$. Check: $CA^2 = 1 + 49 = 50$ and $CB^2 = 49+1 = 50$ ✓." },
        { t: "For the area, use the shoelace formula with $A(1,7)$, $B(9,1)$, $C(2,0)$.", m: "\\tfrac12\\left|1(1-0) + 9(0-7) + 2(7-1)\\right|" },
        { t: "Evaluate inside the modulus.", m: "= \\tfrac12\\left|1 - 63 + 12\\right| = \\tfrac12(50) = 25" },
      ],
      answer: "$C = (2, 0)$; area $= 25$ square units.",
    },
    {
      id: "line-ex4",
      title: "Choosing the plot yourself",
      difficulty: "olympiad",
      prompt:
        "The variables $x$ and $y$ satisfy $\\dfrac{1}{y} = \\dfrac{a}{x} + b$ where $a$ and $b$ are constants. Explain how a straight-line graph can be drawn, and how $a$ and $b$ are found from it. Two data points are $(x,y) = (2, 1)$ and $(5, \\tfrac{5}{4})$; find $a$ and $b$.",
      steps: [
        { t: "The relationship is already linear in the right variables: compare with $Y = mX + c$.", m: "Y = \\tfrac1y, \\quad X = \\tfrac1x, \\quad m = a, \\quad c = b" },
        { t: "So plot $\\frac1y$ against $\\frac1x$: the gradient is $a$ and the vertical intercept is $b$." },
        { t: "Convert the first data point.", m: "\\left(\\tfrac12, 1\\right)" },
        { t: "Convert the second.", m: "\\left(\\tfrac15, \\tfrac45\\right)" },
        { t: "The gradient of the line through them is $a$.", m: "a = \\frac{1 - \\tfrac45}{\\tfrac12 - \\tfrac15} = \\frac{\\tfrac15}{\\tfrac{3}{10}} = \\tfrac23" },
        { t: "Substitute one point to find $b$.", m: "1 = \\tfrac23\\cdot\\tfrac12 + b \\;\\Rightarrow\\; b = \\tfrac23" },
      ],
      answer: "Plot $\\frac1y$ against $\\frac1x$; gradient $a = \\frac23$, intercept $b = \\frac23$.",
      remark: "No logs needed: the unknowns are coefficients, not exponents. Reach for logs only when an unknown sits in a power.",
    },
  ],
  examQuestions: [
    {
      id: "line-eq1",
      title: "Rhombus in coordinate geometry",
      difficulty: "hard",
      marks: 9,
      paper: 1,
      prompt:
        "The points $A(-2, 3)$ and $C(6, 9)$ are opposite vertices of a rhombus $ABCD$.\n(a) Find the equation of the diagonal $BD$. [5]\n(b) Given that $B$ has $x$-coordinate $0$, find the coordinates of $B$ and $D$. [4]",
      steps: [
        { t: "(a) In a rhombus the diagonals bisect each other at right angles, so $BD$ is the perpendicular bisector of $AC$. Find the midpoint.", m: "M = (2, 6)" },
        { t: "Gradient of $AC$.", m: "m_{AC} = \\frac{9-3}{6-(-2)} = \\frac68 = \\tfrac34" },
        { t: "Perpendicular gradient.", m: "m_{BD} = -\\tfrac43" },
        { t: "Equation through $M$.", m: "y - 6 = -\\tfrac43(x-2)" },
        { t: "Tidy.", m: "3y - 18 = -4x + 8 \\;\\Rightarrow\\; 4x + 3y = 26" },
        { t: "(b) Put $x = 0$ into the diagonal.", m: "3y = 26 \\;\\Rightarrow\\; y = \\tfrac{26}{3}" },
        { t: "So $B = \\left(0, \\tfrac{26}{3}\\right)$. $D$ is the reflection of $B$ in $M$, so $M$ is the midpoint of $BD$.", m: "D = (2\\times2 - 0,\\ 2\\times6 - \\tfrac{26}{3})" },
        { t: "Evaluate.", m: "D = \\left(4, \\tfrac{10}{3}\\right)" },
      ],
      answer: "(a) $4x + 3y = 26$. (b) $B\\left(0, \\tfrac{26}{3}\\right)$ and $D\\left(4, \\tfrac{10}{3}\\right)$.",
    },
    {
      id: "line-eq2",
      title: "Experimental data reduced to a line",
      difficulty: "medium",
      marks: 7,
      paper: 2,
      prompt:
        "The variables $x$ and $y$ are related by $y = A b^{x}$. The table gives values of $x$ and $\\lg y$.\n\n$x$: 1, 3, 5\n$\\lg y$: 0.90, 1.50, 2.10\n(a) Explain why plotting $\\lg y$ against $x$ gives a straight line. [2]\n(b) Use the data to find $A$ and $b$. [5]",
      steps: [
        { t: "(a) Take logs of the model.", m: "\\lg y = \\lg A + x\\lg b" },
        { t: "This has the form $Y = mX + c$ with $Y = \\lg y$ and $X = x$, so the plot is a straight line of gradient $\\lg b$ and intercept $\\lg A$." },
        { t: "(b) Find the gradient from the data — the points are evenly spaced, so any pair works.", m: "m = \\frac{2.10 - 0.90}{5 - 1} = \\frac{1.20}{4} = 0.30" },
        { t: "So $\\lg b = 0.30$.", m: "b = 10^{0.3} \\approx 2.00" },
        { t: "Find the intercept by extending back to $x=0$ from $(1, 0.90)$.", m: "c = 0.90 - 0.30 = 0.60" },
        { t: "Undo the logarithm.", m: "A = 10^{0.6} \\approx 3.98" },
      ],
      answer: "(a) $\\lg y = (\\lg b)x + \\lg A$, linear in $x$. (b) $b \\approx 2.00$, $A \\approx 3.98$.",
    },
  ],
  mistakes: [
    {
      wrong: "Using $\\frac{x_2-x_1}{y_2-y_1}$ for the gradient.",
      why: "Gradient is rise over run, not run over rise.",
      fix: "$m = \\dfrac{\\Delta y}{\\Delta x}$. Say “change in $y$ over change in $x$” as you write it.",
    },
    {
      wrong: "Taking the perpendicular gradient as $-m$.",
      why: "Perpendicular means the **negative reciprocal**, not just a sign change.",
      fix: "$m_\\perp = -\\dfrac{1}{m}$. Check: the product must be $-1$.",
    },
    {
      wrong: "Reporting the intercept of a $\\lg y$ against $\\lg x$ plot as $A$.",
      why: "The intercept equals $\\lg A$.",
      fix: "Finish with $A = 10^{\\text{intercept}}$ (or $e^{\\text{intercept}}$ for $\\ln$).",
    },
    {
      wrong: "Taking logs of $y^2 = Ax^3 + B$.",
      why: "There is no log law for a sum, so logs achieve nothing here.",
      fix: "Plot $y^2$ against $x^3$: the relationship is already linear in those variables.",
    },
    {
      wrong: "Forgetting the modulus in the shoelace area formula.",
      why: "The signed area can come out negative depending on the vertex order.",
      fix: "Take the absolute value, and sanity-check against a sketch.",
    },
  ],
  tips: [
    "Sketch the points before doing any algebra — it catches sign errors instantly.",
    "Point-gradient form saves a step over $y=mx+c$; use it every time.",
    "For any “find the constants from a graph” question, write the linearised equation next to $Y=mX+c$ and label each part before touching numbers.",
    "Equidistant from two points $\\Rightarrow$ perpendicular bisector. That translation solves a whole family of questions.",
    "Leave lengths in exact surd form on Paper 1: $\\sqrt{50}$ becomes $5\\sqrt2$, not $7.07$.",
  ],
  generators: ["line-gradient-equation", "line-perpendicular", "line-midpoint-length", "line-straight-form", "line-perp-bisector"],
};
