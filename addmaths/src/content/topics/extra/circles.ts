import type { TopicExtra } from "@/lib/types";

export const circlesExtra: TopicExtra = {
  sections: [
    {
      id: "points-and-circles",
      heading: "Inside, on or outside",
      body: [
        { k: "p", t: "A point is on a circle when its distance from the centre equals the radius. Compare the squared distance with $r^2$ to place any point without square roots." },
        {
          k: "table",
          head: ["Squared distance from the centre", "The point is"],
          rows: [
            ["less than $r^2$", "inside the circle"],
            ["equal to $r^2$", "on the circle"],
            ["greater than $r^2$", "outside the circle"],
          ],
        },
        { k: "p", t: "With the equation in the form $(x - a)^2 + (y - b)^2 = r^2$, the left-hand side **is** the squared distance. So substituting the point and comparing with $r^2$ does the whole job." },
      ],
    },
    {
      id: "chords",
      heading: "Chords and the perpendicular from the centre",
      body: [
        { k: "p", t: "The perpendicular from the centre to a chord bisects the chord. That right angle gives a right-angled triangle with the radius as its hypotenuse." },
        { k: "math", t: "\\text{chord length} = 2\\sqrt{r^2 - d^2}" },
        { k: "p", t: "Here $d$ is the perpendicular distance from the centre to the chord. When $d = r$ the chord has length zero: the line is a tangent. When $d > r$ the line misses the circle." },
        {
          k: "plot",
          spec: {
            xRange: [-3, 9],
            yRange: [-4, 8],
            curves: [
              { f: (x) => 2 + Math.sqrt(Math.max(0, 25 - (x - 3) ** 2)), color: 0, domain: [-2, 8] },
              { f: (x) => 2 - Math.sqrt(Math.max(0, 25 - (x - 3) ** 2)), color: 0, domain: [-2, 8] },
              { f: () => 6, label: "chord y = 6", color: 1, domain: [0, 6] },
            ],
            points: [
              { x: 3, y: 2, label: "C(3, 2)" },
              { x: 0, y: 6, label: "(0, 6)" },
              { x: 6, y: 6, label: "(6, 6)" },
              { x: 3, y: 6 },
            ],
            yTick: 2,
            caption: "The centre is 4 below the chord and the radius is 5, so the half-chord is $\\sqrt{25 - 16} = 3$.",
          },
        },
      ],
    },
    {
      id: "circle-from-conditions",
      heading: "Finding a circle from conditions",
      body: [
        { k: "p", t: "Every circle question ends with a centre and a radius. The conditions in the question tell you how to find them." },
        {
          k: "ul",
          items: [
            "**A diameter $AB$ is given**: the centre is the midpoint of $AB$, and the radius is half of $AB$.",
            "**Two points on the circle are given**: the centre lies on the perpendicular bisector of the chord joining them.",
            "**A tangent and its point of contact are given**: the centre lies on the line through that point perpendicular to the tangent.",
          ],
        },
        { k: "note", tone: "tip", title: "Two lines meet at the centre", t: "Each condition above puts the centre on a line. Two such lines, solved simultaneously, pin down the centre." },
      ],
    },
  ],
  examples: [
    {
      id: "cir-x1",
      title: "Write the equation and test a point",
      difficulty: "easy",
      prompt: "Write down the equation of the circle with centre $(2, -3)$ and radius 5. Does the point $(5, 1)$ lie on it?",
      steps: [
        { t: "Substitute the centre and radius into the standard form.", m: "(x - 2)^2 + (y + 3)^2 = 25" },
        { t: "Test the point.", m: "(5 - 2)^2 + (1 + 3)^2 = 9 + 16 = 25 \\;\\checkmark" },
      ],
      answer: "$(x - 2)^2 + (y + 3)^2 = 25$; yes, $(5, 1)$ lies on it",
    },
    {
      id: "cir-x2",
      title: "Circle on a diameter",
      difficulty: "easy",
      prompt: "$A(-1, 2)$ and $B(5, 10)$ are the ends of a diameter of a circle. Find the equation of the circle.",
      steps: [
        { t: "The centre is the midpoint of $AB$.", m: "\\left(\\tfrac{-1 + 5}{2}, \\tfrac{2 + 10}{2}\\right) = (2, 6)" },
        { t: "The radius is half the length of $AB$.", m: "AB = \\sqrt{6^2 + 8^2} = 10 \\;\\Rightarrow\\; r = 5" },
      ],
      answer: "$(x - 2)^2 + (y - 6)^2 = 25$",
    },
    {
      id: "cir-x3",
      title: "Length of a chord",
      difficulty: "medium",
      prompt: "Find the length of the chord cut from the circle $x^2 + y^2 - 6x - 4y - 12 = 0$ by the line $y = 6$.",
      steps: [
        { t: "Complete the square to find the centre and radius.", m: "(x - 3)^2 + (y - 2)^2 = 25" },
        { t: "The line $y = 6$ is 4 units from the centre $(3, 2)$.", m: "d = 4" },
        { t: "Use the half-chord triangle.", m: "\\text{chord} = 2\\sqrt{25 - 16} = 6" },
        { t: "Check: substituting $y = 6$ gives $(x - 3)^2 = 9$, so $x = 0$ or $6$, which are 6 apart." },
      ],
      answer: "The chord has length $6$",
    },
    {
      id: "cir-x4",
      title: "A tangent at a point",
      difficulty: "medium",
      prompt: "Find the equation of the tangent to $(x - 3)^2 + (y - 2)^2 = 25$ at the point $P(6, 6)$.",
      steps: [
        { t: "Check $P$ is on the circle: $9 + 16 = 25$. ✓" },
        { t: "The radius from $C(3, 2)$ to $P$ has gradient $\\tfrac43$.", m: "m_{CP} = \\frac{6 - 2}{6 - 3} = \\frac43" },
        { t: "The tangent is perpendicular to the radius.", m: "m = -\\tfrac34" },
        { t: "Line through $P$.", m: "y - 6 = -\\tfrac34(x - 6) \\;\\Rightarrow\\; 3x + 4y = 42" },
      ],
      answer: "$3x + 4y = 42$",
    },
    {
      id: "cir-x5",
      title: "Centre on a given line",
      difficulty: "hard",
      prompt: "A circle passes through $A(1, 5)$ and $B(7, -1)$, and its centre lies on the line $y = 2x$. Find its equation.",
      steps: [
        { t: "The centre is on the perpendicular bisector of $AB$. The midpoint is $(4, 2)$ and $AB$ has gradient $-1$, so the bisector has gradient 1.", m: "y = x - 2" },
        { t: "Solve with $y = 2x$.", m: "2x = x - 2 \\;\\Rightarrow\\; x = -2,\\; y = -4" },
        { t: "Find $r^2$ using $A$.", m: "r^2 = (1 + 2)^2 + (5 + 4)^2 = 9 + 81 = 90" },
        { t: "Check with $B$: $(7 + 2)^2 + (-1 + 4)^2 = 81 + 9 = 90$. ✓" },
      ],
      answer: "$(x + 2)^2 + (y + 4)^2 = 90$",
    },
    {
      id: "cir-x6",
      title: "Tangents from an external point",
      difficulty: "olympiad",
      prompt: "$P$ is the point $(10, 7)$ and $C$ is the circle $(x - 3)^2 + (y - 2)^2 = 25$. The tangents from $P$ touch $C$ at $A$ and $B$. Find (a) the length $PA$, (b) the area of the quadrilateral $PACB$, where $C$ also names the centre.",
      steps: [
        { t: "(a) The radius $CA$ is perpendicular to the tangent $PA$, so triangle $CAP$ is right-angled at $A$.", m: "PA^2 = CP^2 - r^2 = (7^2 + 5^2) - 25 = 49" },
        { t: "So the tangent length is 7.", m: "PA = 7" },
        { t: "(b) The quadrilateral is two congruent right-angled triangles, each with legs 5 and 7.", m: "\\text{area} = 2 \\times \\tfrac12 \\times 5 \\times 7 = 35" },
      ],
      answer: "(a) $PA = 7$  (b) area $35$",
      remark: "No coordinates of $A$ or $B$ were needed. The right angle between radius and tangent did all the work.",
    },
  ],
  examQuestions: [
    {
      id: "cir-x7",
      title: "Centre, radius and a horizontal chord",
      difficulty: "easy",
      marks: 6,
      paper: 1,
      prompt: "A circle has equation $x^2 + y^2 + 4x - 10y + 4 = 0$.\n(a) Find the centre and radius of the circle. [3]\n(b) Find the coordinates of the points where the line $y = 2$ meets the circle. [3]",
      steps: [
        { t: "(a) Complete the square in $x$ and in $y$.", m: "(x + 2)^2 - 4 + (y - 5)^2 - 25 + 4 = 0" },
        { t: "Rearrange.", m: "(x + 2)^2 + (y - 5)^2 = 25 \\;\\Rightarrow\\; \\text{centre } (-2, 5),\\; r = 5" },
        { t: "(b) Substitute $y = 2$.", m: "x^2 + 4 + 4x - 20 + 4 = 0 \\;\\Rightarrow\\; x^2 + 4x - 12 = 0" },
        { t: "Factorise.", m: "(x + 6)(x - 2) = 0" },
      ],
      answer: "(a) centre $(-2, 5)$, radius $5$  (b) $(2, 2)$ and $(-6, 2)$",
      markScheme: [
        { part: "(a)", type: "M", marks: 1, criterion: "Completes the square in both variables" },
        { part: "(a)", type: "A", marks: 1, criterion: "Centre $(-2, 5)$", dependsOn: 0 },
        { part: "(a)", type: "A", marks: 1, criterion: "Radius 5", dependsOn: 0 },
        { part: "(b)", type: "M", marks: 1, criterion: "Substitutes $y = 2$ to obtain a quadratic in $x$" },
        { part: "(b)", type: "M", marks: 1, criterion: "Solves their quadratic" },
        { part: "(b)", type: "A", marks: 1, criterion: "$(2, 2)$ and $(-6, 2)$", dependsOn: 4 },
      ],
    },
    {
      id: "cir-x8",
      title: "Show a line is a tangent",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt: "(a) Show that the line $3x + 4y = 30$ is a tangent to the circle $x^2 + y^2 = 36$. [4]\n(b) Find the coordinates of the point of contact. [2]",
      steps: [
        { t: "(a) From the line, $y = \\tfrac{30 - 3x}{4}$. Substitute and multiply by 16.", m: "16x^2 + (30 - 3x)^2 = 576 \\;\\Rightarrow\\; 25x^2 - 180x + 324 = 0" },
        { t: "Find the discriminant.", m: "180^2 - 4(25)(324) = 32400 - 32400 = 0" },
        { t: "A zero discriminant means exactly one point of contact, so the line is a tangent." },
        { t: "(b) The repeated root is $x = \\tfrac{180}{50}$.", m: "x = 3.6,\\qquad y = \\frac{30 - 10.8}{4} = 4.8" },
      ],
      answer: "(a) discriminant $= 0$, so the line is a tangent  (b) $(3.6, 4.8)$",
      markScheme: [
        { part: "(a)", type: "M", marks: 1, criterion: "Substitutes to obtain an equation in one variable" },
        { part: "(a)", type: "A", marks: 1, criterion: "$25x^2 - 180x + 324 = 0$ or equivalent", dependsOn: 0 },
        { part: "(a)", type: "M", marks: 1, criterion: "Evaluates the discriminant of their quadratic" },
        { part: "(a)", type: "A", marks: 1, criterion: "Discriminant is 0, with a conclusion", dependsOn: 2 },
        { part: "(b)", type: "M", marks: 1, criterion: "Solves for $x$ and substitutes into the line" },
        { part: "(b)", type: "A", marks: 1, criterion: "$(3.6, 4.8)$", dependsOn: 4 },
      ],
    },
    {
      id: "cir-x9",
      title: "Two equal circles",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt: "Circle $C_1$ has equation $x^2 + y^2 = 25$ and circle $C_2$ has equation $(x - 8)^2 + y^2 = 25$.\n(a) Explain why the circles meet at two points. [2]\n(b) Find the coordinates of the points of intersection. [3]\n(c) Find the length of the common chord. [1]",
      steps: [
        { t: "(a) The centres are $(0, 0)$ and $(8, 0)$, 8 apart. The radii add to 10.", m: "0 < 8 < 5 + 5" },
        { t: "The centres are closer than the sum of the radii, and further apart than their difference, so the circles cross twice." },
        { t: "(b) Subtract the equations to remove the squared terms.", m: "x^2 - (x - 8)^2 = 0 \\;\\Rightarrow\\; 16x - 64 = 0 \\;\\Rightarrow\\; x = 4" },
        { t: "Substitute into $C_1$.", m: "16 + y^2 = 25 \\;\\Rightarrow\\; y = \\pm 3" },
        { t: "(c) The points are $(4, 3)$ and $(4, -3)$." },
      ],
      answer: "(b) $(4, 3)$ and $(4, -3)$  (c) length $6$",
      markScheme: [
        { part: "(a)", type: "B", marks: 1, criterion: "Distance between centres is 8" },
        { part: "(a)", type: "B", marks: 1, criterion: "Compares with $5 + 5 = 10$ and concludes" },
        { part: "(b)", type: "M", marks: 1, criterion: "Subtracts the equations, or substitutes, to find $x$" },
        { part: "(b)", type: "A", marks: 1, criterion: "$x = 4$", dependsOn: 2 },
        { part: "(b)", type: "A", marks: 1, criterion: "$y = \\pm 3$", dependsOn: 2 },
        { part: "(c)", type: "B", marks: 1, criterion: "6" },
      ],
    },
  ],
  mistakes: [
    {
      wrong: "Using the gradient of the radius as the gradient of the tangent.",
      why: "The tangent is perpendicular to the radius at the point of contact, not along it.",
      fix: "Find the radius gradient, then take its negative reciprocal.",
    },
    {
      wrong: "Giving the chord length as $\\sqrt{r^2 - d^2}$.",
      why: "That is only half the chord: the perpendicular from the centre bisects it.",
      fix: "Chord length $= 2\\sqrt{r^2 - d^2}$.",
    },
    {
      wrong: "Taking the length of a diameter $AB$ as the radius.",
      why: "The radius is half the diameter.",
      fix: "Centre = midpoint of $AB$; radius = $\\tfrac12 AB$.",
    },
  ],
  tips: [
    "Tangent questions almost always use one fact: the tangent is perpendicular to the radius at the point of contact.",
    "To test a point, substitute into $(x - a)^2 + (y - b)^2$ and compare with $r^2$. No square roots needed.",
    "Subtracting two circle equations removes $x^2$ and $y^2$ and leaves the line of the common chord.",
  ],
  summary: {
    bigIdea: "A circle is every point at distance $r$ from a centre. Its equation is Pythagoras, and almost every question is solved by finding the centre and radius, then using the right angle between a radius and a tangent.",
    mustKnow: [
      "$(x - a)^2 + (y - b)^2 = r^2$: centre $(a, b)$, radius $r$",
      "$x^2 + y^2 + 2gx + 2fy + c = 0$: centre $(-g, -f)$, $r = \\sqrt{g^2 + f^2 - c}$",
      "Tangent $\\perp$ radius at the point of contact",
      "Line meets circle: substitute and use the discriminant",
      "Chord length $= 2\\sqrt{r^2 - d^2}$",
    ],
    methods: [
      { name: "Centre and radius", steps: ["Group the $x$ terms and the $y$ terms.", "Complete the square in each.", "Collect the constants on the right."] },
      { name: "Tangent at a point", steps: ["Check the point is on the circle.", "Find the gradient of the radius to it.", "Take the negative reciprocal and write the line."] },
      { name: "Circle through three points", steps: ["Find two perpendicular bisectors of chords.", "Solve them for the centre.", "Find the radius from any point."] },
    ],
    traps: [
      "Reading the centre of $(x + 3)^2 + \\ldots$ as $(3, \\ldots)$.",
      "Giving $r^2$ as the radius.",
      "Using the radius gradient as the tangent gradient.",
      "Half a chord reported as the whole chord.",
    ],
  },
};
