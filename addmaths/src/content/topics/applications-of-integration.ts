import type { Topic } from "@/lib/types";

export const applicationsOfIntegration: Topic = {
  slug: "applications-of-integration",
  unit: 14,
  title: "Applications of integration: areas",
  short: "Areas",
  blurb:
    "Area under a curve, between a line and a curve, between two curves, and the sums of areas that need splitting.",
  syllabus: [
    {
      code: "14.13",
      text: "Evaluate definite integrals and apply integration to the evaluation of plane areas.",
      notes: "Plane areas include: between a line and a curve, between two curves, and a sum of two areas.",
    },
  ],
  prerequisites: ["integration"],
  estimatedMinutes: 85,
  sections: [
    {
      id: "area-under",
      heading: "Area under a curve",
      body: [
        { k: "p", t: "For a curve above the $x$-axis between $x=a$ and $x=b$:" },
        { k: "math", t: "A = \\int_a^b y\\,\\mathrm{d}x" },
        {
          k: "plot",
          spec: {
            xRange: [-0.5, 4],
            yRange: [-1, 10],
            curves: [{ f: (x: number) => x * x + 1, label: "y = x² + 1" }],
            shade: { f: (x: number) => x * x + 1, from: 1, to: 3 },
            caption: "The shaded region has area ∫₁³ (x² + 1) dx = [x³/3 + x]₁³ = 12 − 4/3 = 32/3.",
            height: 320,
          },
        },
        {
          k: "note",
          tone: "warn",
          title: "Below the axis",
          t: "Where the curve dips below the $x$-axis the integral is **negative**. An area is not. If a region crosses the axis, split the integral at the crossing point and add the **absolute values** — integrating straight through would let the two parts cancel.",
        },
        {
          k: "p",
          t: "For an area measured from the $y$-axis, swap the roles: $A = \\displaystyle\\int_c^d x\\,\\mathrm{d}y$, having first made $x$ the subject.",
        },
      ],
    },
    {
      id: "between",
      heading: "Area between two curves",
      body: [
        {
          k: "note",
          tone: "key",
          title: "Top minus bottom",
          t: "$A = \\displaystyle\\int_a^b \\left(y_{\\text{upper}} - y_{\\text{lower}}\\right)\\mathrm{d}x$, where $a$ and $b$ are the $x$-coordinates of the intersections. Because the difference is always positive on the interval, this handles regions below the axis automatically — no splitting required.",
        },
        {
          k: "ol",
          items: [
            "Find the intersections by setting the two expressions equal — these are the limits.",
            "Decide which curve is on top **inside** the interval (test a convenient $x$ value, or sketch).",
            "Integrate the difference, top minus bottom.",
            "Evaluate. A negative answer means you had them the wrong way round.",
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-2, 4],
            yRange: [-2, 8],
            curves: [
              { f: (x: number) => x + 2, label: "y = x + 2" },
              { f: (x: number) => x * x, label: "y = x²", color: 1 },
            ],
            shade: { f: (x: number) => x + 2, g: (x: number) => x * x, from: -1, to: 2 },
            points: [
              { x: -1, y: 1 },
              { x: 2, y: 4 },
            ],
            caption: "They meet where x² = x + 2, at x = −1 and x = 2. The line is above, so A = ∫₋₁² (x + 2 − x²) dx = 4.5.",
            height: 340,
          },
        },
        {
          k: "steps",
          items: [
            { t: "Find the area between $y = x+2$ and $y = x^2$. First the intersections.", m: "x^2 = x + 2 \\;\\Rightarrow\\; x^2 - x - 2 = 0" },
            { t: "Factorise.", m: "(x-2)(x+1) = 0 \\;\\Rightarrow\\; x = -1, 2" },
            { t: "Test $x=0$: the line gives 2, the curve gives 0, so the line is on top.", m: "A = \\int_{-1}^{2}\\left(x + 2 - x^2\\right)\\mathrm dx" },
            { t: "Integrate.", m: "= \\left[\\frac{x^2}{2} + 2x - \\frac{x^3}{3}\\right]_{-1}^{2}" },
            { t: "Upper limit.", m: "2 + 4 - \\tfrac83 = \\tfrac{10}{3}" },
            { t: "Lower limit.", m: "\\tfrac12 - 2 + \\tfrac13 = -\\tfrac76" },
            { t: "Subtract.", m: "\\tfrac{10}{3} + \\tfrac76 = \\tfrac{27}{6} = 4.5" },
          ],
        },
      ],
    },
    {
      id: "sum-of-areas",
      heading: "A sum of two areas",
      body: [
        {
          k: "p",
          t: "The syllabus names this case explicitly. It arises when the boundary of a region changes part way across — typically a curve up to the point where a line takes over.",
        },
        {
          k: "ul",
          items: [
            "Find where the boundary changes: usually where the line meets the curve.",
            "Split the region there into two pieces.",
            "Compute each piece with its own limits and its own integrand — one of them is often a simple triangle, needing no integration at all.",
            "Add.",
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "If one piece is a triangle or a rectangle, use the ordinary area formula. Integrating a straight line is legitimate but slower, and it invites arithmetic errors.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Area under a curve", latex: "A = \\int_a^b y\\,\\mathrm dx", given: false },
    { name: "Area with respect to $y$", latex: "A = \\int_c^d x\\,\\mathrm dy", given: false },
    { name: "Area between curves", latex: "A = \\int_a^b\\left(y_{\\text{upper}} - y_{\\text{lower}}\\right)\\mathrm dx", given: false },
    { name: "Region crossing the axis", latex: "A = \\left|\\int_a^k y\\,\\mathrm dx\\right| + \\left|\\int_k^b y\\,\\mathrm dx\\right|", given: false },
  ],
  examples: [
    {
      id: "area-ex1",
      title: "Straightforward area under a curve",
      difficulty: "easy",
      prompt: "Find the area of the region bounded by $y = 4 - x^2$, the $x$-axis, and the lines $x=0$ and $x=2$.",
      steps: [
        { t: "The curve is above the axis on $0 \\le x \\le 2$ (it is 4 at $x=0$ and 0 at $x=2$), so a single integral suffices.", m: "A = \\int_0^2\\left(4 - x^2\\right)\\mathrm dx" },
        { t: "Integrate.", m: "= \\left[4x - \\frac{x^3}{3}\\right]_0^2" },
        { t: "Substitute the upper limit.", m: "= 8 - \\frac83 = \\frac{16}{3}" },
        { t: "The lower limit gives zero.", m: "A = \\frac{16}{3} \\approx 5.33" },
      ],
      answer: "$\\dfrac{16}{3}$ square units.",
    },
    {
      id: "area-ex2",
      title: "A region crossing the axis",
      difficulty: "medium",
      prompt: "Find the total area enclosed between the curve $y = x^3 - 4x$ and the $x$-axis.",
      steps: [
        { t: "Find where the curve meets the axis.", m: "x(x^2-4) = 0 \\;\\Rightarrow\\; x = -2, 0, 2" },
        { t: "The curve is above the axis on $(-2, 0)$ and below on $(0, 2)$, so the two parts must be handled separately." },
        { t: "First piece.", m: "\\int_{-2}^{0}\\left(x^3-4x\\right)\\mathrm dx = \\left[\\frac{x^4}{4} - 2x^2\\right]_{-2}^{0}" },
        { t: "Evaluate: at 0 it is zero; at $-2$ it is $4 - 8 = -4$.", m: "= 0 - (-4) = 4" },
        { t: "Second piece.", m: "\\int_0^2\\left(x^3-4x\\right)\\mathrm dx = (4-8) - 0 = -4" },
        { t: "Take the absolute value of the negative piece and add.", m: "A = 4 + |-4| = 8" },
      ],
      answer: "$8$ square units.",
      remark: "Integrating straight from $-2$ to $2$ would give zero — the two halves cancel exactly, by symmetry. That is why splitting matters.",
    },
    {
      id: "area-ex3",
      title: "Sum of two areas",
      difficulty: "hard",
      prompt:
        "The curve $y = \\sqrt{x}$ meets the line $y = x - 2$ at the point $P$. Find the area of the region bounded by the curve, the line and the $x$-axis.",
      steps: [
        { t: "Find $P$ by substituting.", m: "\\sqrt x = x - 2 \\;\\Rightarrow\\; x = (x-2)^2" },
        { t: "Expand and solve.", m: "x^2 - 5x + 4 = 0 \\;\\Rightarrow\\; (x-1)(x-4) = 0" },
        { t: "Check both: at $x=1$, $\\sqrt1 = 1$ but $1-2 = -1$, so reject. At $x=4$, $2 = 2$ ✓.", m: "P = (4, 2)" },
        { t: "The line meets the $x$-axis at $x=2$. So the region is bounded above by the curve throughout, and below by the axis up to $x=2$ and by the line from 2 to 4. Split there.", m: "A = \\int_0^2 \\sqrt x\\,\\mathrm dx + \\int_2^4\\left(\\sqrt x - (x-2)\\right)\\mathrm dx" },
        { t: "First piece.", m: "\\left[\\tfrac23 x^{3/2}\\right]_0^2 = \\tfrac23(2\\sqrt2) = \\tfrac{4\\sqrt2}{3}" },
        { t: "Second piece: integrate.", m: "\\left[\\tfrac23x^{3/2} - \\tfrac{x^2}{2} + 2x\\right]_2^4" },
        { t: "At $x=4$: $\\frac{16}{3} - 8 + 8 = \\frac{16}{3}$. At $x=2$: $\\frac{4\\sqrt2}{3} - 2 + 4 = \\frac{4\\sqrt2}{3}+2$.", m: "= \\tfrac{16}{3} - \\tfrac{4\\sqrt2}{3} - 2" },
        { t: "Add the two pieces — the $\\frac{4\\sqrt2}{3}$ terms cancel.", m: "A = \\tfrac{16}{3} - 2 = \\tfrac{10}{3}" },
      ],
      answer: "$\\dfrac{10}{3}$ square units.",
      remark: "The second piece could instead be found as (area under the curve from 2 to 4) minus (a triangle of base 2 and height 2), which avoids integrating the line.",
    },
    {
      id: "area-ex4",
      title: "Area with respect to $y$",
      difficulty: "olympiad",
      prompt: "Find the area of the region enclosed by the curve $y = x^2$ for $x \\ge 0$, the $y$-axis, and the line $y = 9$.",
      steps: [
        { t: "This region is bounded on the left by the $y$-axis, so integrating with respect to $y$ is natural. Make $x$ the subject.", m: "x = \\sqrt y" },
        { t: "The region runs from $y=0$ to $y=9$.", m: "A = \\int_0^9 \\sqrt y\\,\\mathrm dy" },
        { t: "Integrate.", m: "= \\left[\\tfrac23 y^{3/2}\\right]_0^9" },
        { t: "Evaluate: $9^{3/2} = 27$.", m: "= \\tfrac23(27) = 18" },
        { t: "Check by subtraction: the bounding rectangle is $3 \\times 9 = 27$, and the area under the curve from 0 to 3 is $\\left[\\frac{x^3}{3}\\right]_0^3 = 9$. Then $27 - 9 = 18$ ✓." },
      ],
      answer: "$18$ square units.",
      remark: "The check is worth learning in its own right: an area with respect to $y$ is always the rectangle minus the area with respect to $x$.",
    },
  ],
  examQuestions: [
    {
      id: "area-eq1",
      title: "Area between a line and a curve",
      difficulty: "medium",
      marks: 8,
      paper: 1,
      prompt:
        "The curve $y = 6x - x^2$ and the line $y = 2x$ intersect at two points.\n(a) Find the coordinates of the two points of intersection. [3]\n(b) Find the area of the region enclosed between the line and the curve. [5]",
      steps: [
        { t: "(a) Set the two expressions equal.", m: "6x - x^2 = 2x" },
        { t: "Collect and factorise.", m: "4x - x^2 = 0 \\;\\Rightarrow\\; x(4-x) = 0" },
        { t: "So $x=0$ and $x=4$; substitute into the line for the $y$-values.", m: "(0,0) \\text{ and } (4, 8)" },
        { t: "(b) Test $x=2$: the curve gives $12-4 = 8$, the line gives 4, so the curve is on top.", m: "A = \\int_0^4\\left(6x - x^2 - 2x\\right)\\mathrm dx" },
        { t: "Simplify the integrand.", m: "= \\int_0^4\\left(4x - x^2\\right)\\mathrm dx" },
        { t: "Integrate.", m: "= \\left[2x^2 - \\frac{x^3}{3}\\right]_0^4" },
        { t: "Substitute.", m: "= 32 - \\frac{64}{3}" },
        { t: "Simplify.", m: "= \\frac{32}{3} \\approx 10.7" },
      ],
      answer: "(a) $(0,0)$ and $(4,8)$. (b) $\\dfrac{32}{3}$ square units.",
    },
    {
      id: "area-eq2",
      title: "Curve, tangent and area",
      difficulty: "hard",
      marks: 10,
      paper: 1,
      prompt:
        "The curve $y = x^2 - 6x + 10$ has a tangent at the point $A(4, 2)$.\n(a) Find the equation of the tangent at $A$. [3]\n(b) The tangent meets the $x$-axis at $B$. Find the coordinates of $B$. [2]\n(c) Find the area of the region bounded by the curve, the tangent, and the $x$-axis between $x=3$ and $x=4$. [5]",
      steps: [
        { t: "(a) Differentiate and substitute.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = 2x - 6 \\;\\Rightarrow\\; m = 2 \\text{ at } x=4" },
        { t: "Point-gradient form.", m: "y - 2 = 2(x-4) \\;\\Rightarrow\\; y = 2x - 6" },
        { t: "(b) Set $y=0$.", m: "0 = 2x - 6 \\;\\Rightarrow\\; B(3, 0)" },
        { t: "(c) On $3 \\le x \\le 4$ the curve lies above the tangent (the tangent touches only at $x=4$). Area under the curve first.", m: "\\int_3^4\\left(x^2-6x+10\\right)\\mathrm dx = \\left[\\frac{x^3}{3} - 3x^2 + 10x\\right]_3^4" },
        { t: "At $x=4$: $\\frac{64}{3} - 48 + 40 = \\frac{64}{3} - 8$. At $x=3$: $9 - 27 + 30 = 12$.", m: "= \\frac{64}{3} - 8 - 12 = \\frac{64}{3} - 20 = \\frac43" },
        { t: "Now subtract the triangle under the tangent, with vertices $B(3,0)$, $(4,0)$ and $A(4,2)$.", m: "\\tfrac12 \\times 1 \\times 2 = 1" },
        { t: "The required region is the difference.", m: "A = \\frac43 - 1 = \\frac13" },
      ],
      answer: "(a) $y = 2x-6$. (b) $B(3,0)$. (c) $\\dfrac13$ square unit.",
    },
  ],
  mistakes: [
    { wrong: "Reporting a negative area.", why: "The integral is negative where the curve is below the axis; area is not.", fix: "Split at the crossing points and add the absolute values." },
    { wrong: "Integrating straight through a root when the curve crosses the axis.", why: "The positive and negative parts cancel, sometimes to zero.", fix: "Find the roots first, then integrate each piece separately." },
    { wrong: "Subtracting bottom from top the wrong way round.", why: "It changes the sign of the whole answer.", fix: "Test one $x$ value in the interval to see which curve is higher, and say which in your working." },
    { wrong: "Using the wrong limits for a region between curves.", why: "The limits are the intersection points, not the ends of the sketch.", fix: "Solve the two equations simultaneously to find the limits." },
    { wrong: "Forgetting the units.", why: "An area is in square units.", fix: "Write “square units”, or cm² if the question gives lengths in cm." },
  ],
  tips: [
    "Sketch the region before integrating. It settles which curve is on top and whether a split is needed.",
    "For a region between curves, “top minus bottom” never needs a modulus — the difference is positive throughout.",
    "If part of a boundary is a straight line, the triangle formula beats integrating it.",
    "A negative answer is a signal, not an error to hide: swap the order and say so.",
    "Check the size of your answer against the sketch. A region that clearly fits inside a $4\\times 3$ box cannot have area 30.",
  ],
  generators: ["area-under-curve", "area-between-curves", "area-definite-evaluate"],
};
