import type { Topic } from "@/lib/types";

export const applicationsOfDifferentiation: Topic = {
  slug: "applications-of-differentiation",
  unit: 14,
  title: "Applications of differentiation",
  short: "Applications",
  blurb:
    "Tangents and normals, stationary points and their nature, connected rates of change, small increments and maxima–minima problems.",
  syllabus: [
    { code: "14.5", text: "Use differentiation to find gradients, tangents and normals." },
    { code: "14.6", text: "Use differentiation to find stationary points.", notes: "Points of inflexion are not included." },
    { code: "14.7", text: "Apply differentiation to connected rates of change, small increments and approximations." },
    { code: "14.8", text: "Apply differentiation to practical problems involving maxima and minima." },
    { code: "14.9", text: "Use the first and second derivative tests to discriminate between maxima and minima. Full justification of conclusions is expected." },
  ],
  prerequisites: ["differentiation", "straight-line-graphs"],
  estimatedMinutes: 105,
  sections: [
    {
      id: "tangents-normals",
      heading: "Tangents and normals",
      body: [
        {
          k: "ol",
          items: [
            "Differentiate to get $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$.",
            "Substitute the $x$-coordinate to get the **numerical** gradient $m$.",
            "Find the $y$-coordinate if it is not given.",
            "Tangent: $y - y_1 = m(x-x_1)$. Normal: use $-\\dfrac1m$ instead.",
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "The normal",
          t: "The normal is perpendicular to the tangent at the same point, so its gradient is $-\\dfrac{1}{m}$. If the tangent is horizontal, the normal is vertical, with equation $x = x_1$.",
        },
        {
          k: "note",
          tone: "warn",
          t: "Substitute the number **before** writing the line's equation. Leaving $x$ in the gradient produces a curve, not a line, and scores nothing.",
        },
      ],
    },
    {
      id: "stationary",
      heading: "Stationary points and their nature",
      body: [
        { k: "p", t: "A stationary point is where the tangent is horizontal: $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x} = 0$. Solving that equation gives the $x$-coordinates; substituting into the original equation gives the $y$-coordinates." },
        {
          k: "note",
          tone: "key",
          title: "Second derivative test",
          t: "At a stationary point: $\\dfrac{\\mathrm{d}^2y}{\\mathrm{d}x^2} < 0$ means a **maximum** (the gradient is decreasing, the curve is bending downward); $\\dfrac{\\mathrm{d}^2y}{\\mathrm{d}x^2} > 0$ means a **minimum**. If it is zero, the test fails and you must use the first derivative test.",
        },
        {
          k: "p",
          t: "**First derivative test**: examine the sign of $\\dfrac{\\mathrm dy}{\\mathrm dx}$ just either side of the point. A change from $+$ to $-$ is a maximum; from $-$ to $+$ is a minimum. Set the work out as a table:",
        },
        {
          k: "table",
          head: ["$x$", "$1.9$", "$2$", "$2.1$"],
          rows: [
            ["$\\frac{\\mathrm dy}{\\mathrm dx}$", "$+0.6$", "$0$", "$-0.6$"],
            ["Slope", "/", "—", "\\", ],
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "“Full justification of conclusions is expected.” Stating “it is a maximum” without showing $\\frac{\\mathrm d^2y}{\\mathrm dx^2} < 0$ or a sign table loses the mark, even when the answer is right.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-2, 4],
            yRange: [-8, 12],
            curves: [{ f: (x: number) => x ** 3 - 3 * x ** 2 + 2, label: "y = x³ − 3x² + 2" }],
            points: [
              { x: 0, y: 2, label: "max (0, 2)" },
              { x: 2, y: -2, label: "min (2, −2)" },
            ],
            caption: "dy/dx = 3x² − 6x = 3x(x − 2), zero at x = 0 and x = 2. The second derivative 6x − 6 is −6 then +6.",
            height: 340,
          },
        },
      ],
    },
    {
      id: "optimisation",
      heading: "Maxima and minima in context",
      body: [
        {
          k: "p",
          t: "Practical optimisation questions follow a fixed shape, and the marks are spread across the whole shape, not just the differentiation.",
        },
        {
          k: "ol",
          items: [
            "Write the quantity to be optimised — usually area, volume or cost — in terms of the variables.",
            "Use the **constraint** given in the question to eliminate one variable.",
            "Differentiate with respect to the single remaining variable and set the derivative to zero.",
            "Solve, rejecting values that make no physical sense (a negative length, for instance).",
            "Justify that it is the maximum or minimum required, with the second derivative.",
            "Answer the question actually asked — often the volume, not the value of $x$ that produces it.",
          ],
        },
        {
          k: "steps",
          items: [
            { t: "An open box is made from a square sheet of side 24 cm by cutting squares of side $x$ from the corners and folding up. Write the volume.", m: "V = x(24-2x)^2" },
            { t: "Expand so the power rule can be applied.", m: "V = x\\left(576 - 96x + 4x^2\\right) = 576x - 96x^2 + 4x^3" },
            { t: "Differentiate.", m: "\\frac{\\mathrm dV}{\\mathrm dx} = 576 - 192x + 12x^2" },
            { t: "Set to zero and divide by 12.", m: "x^2 - 16x + 48 = 0" },
            { t: "Factorise.", m: "(x-4)(x-12) = 0 \\;\\Rightarrow\\; x = 4 \\text{ or } 12" },
            { t: "Reject $x = 12$: it would remove the whole sheet, since $24-2(12) = 0$.", m: "x = 4" },
            { t: "Justify with the second derivative.", m: "\\frac{\\mathrm d^2V}{\\mathrm dx^2} = -192 + 24x = -96 < 0 \\Rightarrow \\text{maximum}" },
            { t: "Answer the question: the maximum volume.", m: "V = 4(16)^2 = 1024 \\text{ cm}^3" },
          ],
        },
      ],
    },
    {
      id: "rates",
      heading: "Connected rates of change",
      body: [
        {
          k: "p",
          t: "When two quantities both change with time, their rates are linked by the chain rule.",
        },
        { k: "math", t: "\\frac{\\mathrm{d}A}{\\mathrm{d}t} = \\frac{\\mathrm{d}A}{\\mathrm{d}r}\\times\\frac{\\mathrm{d}r}{\\mathrm{d}t}" },
        {
          k: "ol",
          items: [
            "Write down what you are **given** as a rate, and what you **want**, both in $\\frac{\\mathrm d\\ }{\\mathrm dt}$ notation.",
            "Find the equation connecting the two quantities.",
            "Differentiate it to get the missing link.",
            "Multiply the chain together and substitute the numbers **last**.",
          ],
        },
        {
          k: "steps",
          items: [
            { t: "A spherical balloon is inflated so that its radius increases at $0.2$ cm s⁻¹. Find the rate of increase of volume when $r = 5$ cm. Write what is given and wanted.", m: "\\frac{\\mathrm dr}{\\mathrm dt} = 0.2, \\qquad \\text{want } \\frac{\\mathrm dV}{\\mathrm dt}" },
            { t: "The connecting equation is the volume of a sphere.", m: "V = \\tfrac43\\pi r^3" },
            { t: "Differentiate with respect to $r$.", m: "\\frac{\\mathrm dV}{\\mathrm dr} = 4\\pi r^2" },
            { t: "Chain them together.", m: "\\frac{\\mathrm dV}{\\mathrm dt} = 4\\pi r^2 \\times 0.2" },
            { t: "Substitute $r=5$.", m: "= 4\\pi(25)(0.2) = 20\\pi \\approx 62.8 \\text{ cm}^3\\text{ s}^{-1}" },
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "Small increments",
          t: "For a small change $\\delta x$, the resulting change in $y$ is approximately $\\delta y \\approx \\dfrac{\\mathrm{d}y}{\\mathrm{d}x}\\,\\delta x$. A percentage change of $p\\%$ in $x$ means $\\delta x = \\frac{p}{100}x$.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Tangent", latex: "y - y_1 = m(x-x_1), \\quad m = \\left.\\frac{\\mathrm dy}{\\mathrm dx}\\right|_{x_1}", given: false },
    { name: "Normal", latex: "y - y_1 = -\\frac1m(x - x_1)", given: false },
    { name: "Stationary point", latex: "\\frac{\\mathrm dy}{\\mathrm dx} = 0", given: false },
    { name: "Second derivative test", latex: "f''(x) < 0 \\Rightarrow \\text{max}, \\qquad f''(x) > 0 \\Rightarrow \\text{min}", given: false },
    { name: "Connected rates", latex: "\\frac{\\mathrm dA}{\\mathrm dt} = \\frac{\\mathrm dA}{\\mathrm dr}\\cdot\\frac{\\mathrm dr}{\\mathrm dt}", given: false },
    { name: "Small increments", latex: "\\delta y \\approx \\frac{\\mathrm dy}{\\mathrm dx}\\,\\delta x", given: false },
  ],
  examples: [
    {
      id: "app-ex1",
      title: "Tangent and normal",
      difficulty: "easy",
      prompt: "Find the equations of the tangent and the normal to $y = x^2 - 4x + 7$ at the point where $x = 3$.",
      steps: [
        { t: "Find the $y$-coordinate.", m: "y = 9 - 12 + 7 = 4" },
        { t: "Differentiate.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = 2x - 4" },
        { t: "Substitute $x=3$ for the numerical gradient.", m: "m = 2" },
        { t: "Tangent through $(3,4)$.", m: "y - 4 = 2(x-3) \\;\\Rightarrow\\; y = 2x - 2" },
        { t: "Normal gradient is the negative reciprocal.", m: "-\\tfrac12" },
        { t: "Normal through the same point.", m: "y - 4 = -\\tfrac12(x-3) \\;\\Rightarrow\\; 2y + x = 11" },
      ],
      answer: "Tangent $y = 2x-2$; normal $x + 2y = 11$.",
    },
    {
      id: "app-ex2",
      title: "Stationary points with justification",
      difficulty: "medium",
      prompt: "Find the coordinates of the stationary points of $y = 2x^3 - 9x^2 + 12x - 3$ and determine their nature.",
      steps: [
        { t: "Differentiate.", m: "\\frac{\\mathrm dy}{\\mathrm dx} = 6x^2 - 18x + 12" },
        { t: "Set to zero and divide by 6.", m: "x^2 - 3x + 2 = 0" },
        { t: "Factorise.", m: "(x-1)(x-2) = 0 \\;\\Rightarrow\\; x = 1, 2" },
        { t: "Find the $y$-coordinates.", m: "y(1) = 2 - 9 + 12 - 3 = 2, \\qquad y(2) = 16 - 36 + 24 - 3 = 1" },
        { t: "Differentiate again for the test.", m: "\\frac{\\mathrm d^2y}{\\mathrm dx^2} = 12x - 18" },
        { t: "At $x=1$ it is negative, so that point is a maximum.", m: "12 - 18 = -6 < 0" },
        { t: "At $x=2$ it is positive, so that point is a minimum.", m: "24 - 18 = 6 > 0" },
      ],
      answer: "Maximum at $(1, 2)$; minimum at $(2, 1)$.",
    },
    {
      id: "app-ex3",
      title: "Optimisation with a constraint",
      difficulty: "hard",
      prompt:
        "A closed cylinder has volume $500\\pi$ cm³. Find the radius that minimises its total surface area, and state that minimum area in terms of $\\pi$.",
      steps: [
        { t: "Write both quantities.", m: "V = \\pi r^2 h = 500\\pi, \\qquad A = 2\\pi r^2 + 2\\pi r h" },
        { t: "Use the constraint to eliminate $h$.", m: "h = \\frac{500}{r^2}" },
        { t: "Substitute into the area.", m: "A = 2\\pi r^2 + 2\\pi r\\cdot\\frac{500}{r^2} = 2\\pi r^2 + \\frac{1000\\pi}{r}" },
        { t: "Differentiate, writing the second term as a negative power first.", m: "\\frac{\\mathrm dA}{\\mathrm dr} = 4\\pi r - 1000\\pi r^{-2}" },
        { t: "Set to zero.", m: "4\\pi r = \\frac{1000\\pi}{r^2} \\;\\Rightarrow\\; r^3 = 250" },
        { t: "Take the cube root.", m: "r = \\sqrt[3]{250} \\approx 6.30 \\text{ cm}" },
        { t: "Justify with the second derivative, which is positive for all $r>0$.", m: "\\frac{\\mathrm d^2A}{\\mathrm dr^2} = 4\\pi + 2000\\pi r^{-3} > 0 \\Rightarrow \\text{minimum}" },
        { t: "Compute the area, using $r^3 = 250$ so that $\\frac{1000}{r} = 4r^2$.", m: "A = 2\\pi r^2 + 4\\pi r^2 = 6\\pi r^2 = 6\\pi(250)^{2/3} \\approx 238\\pi" },
      ],
      answer: "$r = \\sqrt[3]{250} \\approx 6.30$ cm, giving a minimum area of $6\\pi\\sqrt[3]{250^2} \\approx 748$ cm².",
    },
    {
      id: "app-ex4",
      title: "Rates of change through a chain",
      difficulty: "olympiad",
      prompt:
        "Water flows into an inverted cone of semi-vertical angle $45^\\circ$ at a constant $30$ cm³ s⁻¹. Find the rate at which the depth is rising when the depth is 10 cm.",
      steps: [
        { t: "For a $45^\\circ$ semi-vertical angle, the radius of the water surface equals the depth.", m: "r = h" },
        { t: "So the volume depends on $h$ alone.", m: "V = \\tfrac13\\pi r^2 h = \\tfrac13\\pi h^3" },
        { t: "Differentiate with respect to $h$.", m: "\\frac{\\mathrm dV}{\\mathrm dh} = \\pi h^2" },
        { t: "Chain the rates, rearranged for the unknown.", m: "\\frac{\\mathrm dh}{\\mathrm dt} = \\frac{\\mathrm dV}{\\mathrm dt} \\div \\frac{\\mathrm dV}{\\mathrm dh} = \\frac{30}{\\pi h^2}" },
        { t: "Substitute $h = 10$.", m: "= \\frac{30}{100\\pi} = \\frac{3}{10\\pi}" },
        { t: "Evaluate.", m: "\\approx 0.0955 \\text{ cm s}^{-1}" },
      ],
      answer: "$\\dfrac{3}{10\\pi} \\approx 0.0955$ cm s⁻¹.",
      remark: "The rate falls as the depth grows — the surface widens, so the same inflow raises it more slowly.",
    },
  ],
  examQuestions: [
    {
      id: "app-eq1",
      title: "Normal meeting the axes",
      difficulty: "hard",
      marks: 9,
      paper: 1,
      prompt:
        "The curve $y = \\dfrac{8}{x}$ is given.\n(a) Find the equation of the normal to the curve at the point $P(2, 4)$. [5]\n(b) The normal meets the $x$-axis at $A$ and the $y$-axis at $B$. Find the area of triangle $OAB$, where $O$ is the origin. [4]",
      steps: [
        { t: "(a) Write the curve as a power and differentiate.", m: "y = 8x^{-1} \\;\\Rightarrow\\; \\frac{\\mathrm dy}{\\mathrm dx} = -8x^{-2}" },
        { t: "Substitute $x=2$.", m: "m_{\\text{tangent}} = -\\frac{8}{4} = -2" },
        { t: "The normal gradient is the negative reciprocal.", m: "m_{\\text{normal}} = \\tfrac12" },
        { t: "Use the point-gradient form at $P(2,4)$.", m: "y - 4 = \\tfrac12(x-2) \\;\\Rightarrow\\; y = \\tfrac12 x + 3" },
        { t: "(b) At $A$, $y = 0$.", m: "0 = \\tfrac12x + 3 \\;\\Rightarrow\\; x = -6, \\quad A(-6, 0)" },
        { t: "At $B$, $x = 0$.", m: "B(0, 3)" },
        { t: "The triangle has its right angle at the origin, so use base and height.", m: "\\text{Area} = \\tfrac12 \\times 6 \\times 3" },
        { t: "Evaluate — take the base as a length, hence positive.", m: "= 9 \\text{ square units}" },
      ],
      answer: "(a) $y = \\tfrac12x + 3$. (b) Area 9.",
    },
    {
      id: "app-eq2",
      title: "Small increments",
      difficulty: "medium",
      marks: 6,
      paper: 2,
      prompt:
        "The volume of a cube of side $x$ cm is $V$ cm³.\n(a) Find $\\dfrac{\\mathrm{d}V}{\\mathrm{d}x}$. [1]\n(b) Use calculus to find the approximate increase in volume when the side increases from 5 cm to 5.02 cm. [3]\n(c) Find the approximate percentage increase in $V$ when $x$ increases by 1%. [2]",
      steps: [
        { t: "(a) The volume of a cube.", m: "V = x^3 \\;\\Rightarrow\\; \\frac{\\mathrm dV}{\\mathrm dx} = 3x^2" },
        { t: "(b) Use the small-increment approximation with $\\delta x = 0.02$.", m: "\\delta V \\approx 3x^2\\,\\delta x = 3(25)(0.02)" },
        { t: "Evaluate.", m: "= 1.5 \\text{ cm}^3" },
        { t: "(c) A 1% increase means $\\delta x = 0.01x$.", m: "\\delta V \\approx 3x^2(0.01x) = 0.03x^3" },
        { t: "Compare with $V = x^3$: the change is 3% of the volume.", m: "\\frac{\\delta V}{V} = 0.03 = 3\\%" },
      ],
      answer: "(a) $3x^2$. (b) about $1.5$ cm³. (c) about 3%.",
    },
  ],
  mistakes: [
    { wrong: "Leaving $x$ in the gradient when writing a tangent.", why: "A line has one fixed gradient.", fix: "Substitute the $x$-coordinate into $\\frac{\\mathrm dy}{\\mathrm dx}$ first." },
    { wrong: "Stating the nature of a stationary point with no working.", why: "The syllabus demands full justification.", fix: "Show $\\frac{\\mathrm d^2y}{\\mathrm dx^2}$ evaluated at the point, or a sign table, and write the conclusion." },
    { wrong: "Keeping a negative or impossible root in an optimisation problem.", why: "Lengths and volumes cannot be negative.", fix: "Reject it explicitly in one sentence — that rejection is often a mark." },
    { wrong: "Answering with the value of $x$ when the question asked for the maximum volume.", why: "The optimising value is an intermediate step.", fix: "Re-read the question and substitute back." },
    { wrong: "Mixing up $\\frac{\\mathrm dV}{\\mathrm dt}$ and $\\frac{\\mathrm dV}{\\mathrm dr}$.", why: "One is a rate in time, the other a rate in space.", fix: "Write down what is given and what is wanted, with the variables, before starting." },
    { wrong: "Using $\\delta y = \\frac{\\mathrm dy}{\\mathrm dx}$ without multiplying by $\\delta x$.", why: "The derivative is a rate, not a change.", fix: "$\\delta y \\approx \\frac{\\mathrm dy}{\\mathrm dx}\\,\\delta x$." },
  ],
  tips: [
    "Sketch the curve. It tells you which stationary point is which before any algebra confirms it.",
    "In an optimisation question the constraint is the equation you have not used yet. Find it and substitute.",
    "For rates of change, write the chain as a sentence first: “I want dV/dt, I know dr/dt, so I need dV/dr”.",
    "Points of inflexion are excluded from this syllabus, so a zero second derivative means fall back on the sign test.",
    "Always finish by answering the question in the units it asked for — cm³ s⁻¹, not a bare number.",
  ],
  generators: ["app-tangent-normal", "app-stationary-points", "app-nature-test", "app-rates-of-change", "app-small-increments"],
};
