import type { Topic } from "@/lib/types";

export const circles: Topic = {
  slug: "circles",
  unit: 8,
  title: "Coordinate geometry of the circle",
  short: "Circles",
  blurb:
    "Both forms of the circle equation, tangents without calculus, and how to decide whether a line cuts, touches or misses.",
  syllabus: [
    { code: "8.1", text: "Know and use the equation of a circle with radius $r$ and centre $(a,b)$; identify centre and radius from any form, including $x^2+y^2+2gx+2fy+c=0$." },
    { code: "8.2", text: "Solve problems involving the intersection of a circle and a straight line, including deciding whether a line is a tangent, a chord, or misses the circle." },
    { code: "8.3", text: "Solve problems involving tangents to a circle, including finding equations of tangents. No calculus is expected." },
    { code: "8.4", text: "Solve problems involving the intersection of two circles, including common chords and whether two circles intersect, touch or do not intersect." },
  ],
  prerequisites: ["straight-line-graphs", "quadratic-functions"],
  estimatedMinutes: 90,
  sections: [
    {
      id: "two-forms",
      heading: "The two forms of the equation",
      body: [
        { k: "p", t: "The **centre-radius form** is the useful one, and it is given on page 2 of the exam paper:" },
        { k: "math", t: "(x-a)^2 + (y-b)^2 = r^2 \\qquad \\text{centre } (a,b), \\text{ radius } r" },
        { k: "p", t: "The **general form** is what a question often hands you instead:" },
        { k: "math", t: "x^2 + y^2 + 2gx + 2fy + c = 0 \\qquad \\text{centre } (-g,-f), \\text{ radius } \\sqrt{g^2+f^2-c}" },
        {
          k: "note",
          tone: "tip",
          title: "Do not memorise — complete the square",
          t: "Rather than recall $(-g,-f)$, complete the square in $x$ and in $y$. It takes twenty seconds, works every time, and is self-checking.",
        },
        {
          k: "steps",
          items: [
            { t: "Find the centre and radius of $x^2 + y^2 - 6x + 10y + 9 = 0$. Group the $x$ terms and the $y$ terms.", m: "\\left(x^2 - 6x\\right) + \\left(y^2 + 10y\\right) + 9 = 0" },
            { t: "Complete the square in each bracket.", m: "(x-3)^2 - 9 + (y+5)^2 - 25 + 9 = 0" },
            { t: "Collect the constants on the right.", m: "(x-3)^2 + (y+5)^2 = 25" },
            { t: "Read off the answer.", m: "\\text{centre } (3,-5), \\quad r = 5" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "If the constants leave a **negative** number on the right, no such circle exists. If they leave zero, the “circle” is a single point.",
        },
      ],
    },
    {
      id: "line-and-circle",
      heading: "A line and a circle",
      body: [
        {
          k: "p",
          t: "There are two ways to decide whether a line cuts, touches or misses a circle. Both are examinable; the second is faster.",
        },
        {
          k: "columns",
          left: [
            { k: "p", t: "**Method 1 — substitute.**" },
            { k: "ol", items: ["Substitute the line into the circle.", "Form a quadratic in $x$.", "Discriminant $>0$: chord; $=0$: tangent; $<0$: no intersection."] },
          ],
          right: [
            { k: "p", t: "**Method 2 — compare distances.**" },
            { k: "ol", items: ["Find $d$, the perpendicular distance from the centre to the line.", "Compare with the radius $r$.", "$d<r$: chord; $d=r$: tangent; $d>r$: no intersection."] },
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-4, 8],
            yRange: [-4, 6],
            curves: [
              { f: (x: number) => 1 + Math.sqrt(Math.max(0, 9 - (x - 2) ** 2)), label: "(x−2)² + (y−1)² = 9" },
              { f: (x: number) => 1 - Math.sqrt(Math.max(0, 9 - (x - 2) ** 2)), color: 0 },
              { f: (x: number) => x - 1, label: "chord", color: 1 },
              { f: () => 4, label: "tangent y = 4", color: 2, dashed: true },
              { f: () => 5.4, label: "misses", color: 3, dashed: true },
            ],
            points: [{ x: 2, y: 1, label: "centre (2, 1)" }],
            caption: "Three lines against one circle. The tangent touches at exactly one point, where the distance from the centre equals the radius.",
            height: 360,
          },
        },
        {
          k: "note",
          tone: "key",
          title: "Distance from a point to a line",
          t: "For the line $Ax + By + C = 0$ and the point $(x_0, y_0)$: $d = \\dfrac{|Ax_0 + By_0 + C|}{\\sqrt{A^2+B^2}}$. This is not on the formula sheet but is often the quickest route.",
        },
      ],
    },
    {
      id: "tangents",
      heading: "Tangents without calculus",
      body: [
        {
          k: "note",
          tone: "key",
          title: "The one fact that replaces calculus",
          t: "A tangent is **perpendicular to the radius** at the point of contact. So the tangent gradient is the negative reciprocal of the radius gradient — no differentiation required, and the syllabus says none is expected.",
        },
        {
          k: "steps",
          items: [
            { t: "Find the tangent to $(x-2)^2 + (y+1)^2 = 25$ at the point $P(5, 3)$. First check $P$ is on the circle.", m: "9 + 16 = 25 \\ \\checkmark" },
            { t: "Find the gradient of the radius from the centre $(2,-1)$ to $P$.", m: "m_r = \\frac{3-(-1)}{5-2} = \\frac43" },
            { t: "The tangent is perpendicular to it.", m: "m_t = -\\frac34" },
            { t: "Use the point-gradient form at $P$.", m: "y - 3 = -\\tfrac34(x-5)" },
            { t: "Tidy.", m: "4y - 12 = -3x + 15 \\;\\Rightarrow\\; 3x + 4y = 27" },
          ],
        },
        {
          k: "p",
          t: "Two related standard results: the perpendicular from the centre to a chord **bisects** the chord, and the tangents drawn from an external point are equal in length.",
        },
      ],
    },
    {
      id: "two-circles",
      heading: "Two circles",
      body: [
        {
          k: "p",
          t: "Compare the distance $d$ between the centres with the two radii. This single comparison classifies every case.",
        },
        {
          k: "table",
          head: ["Condition", "Relationship"],
          rows: [
            ["$d > r_1 + r_2$", "Separate, no intersection"],
            ["$d = r_1 + r_2$", "Touch externally at one point"],
            ["$|r_1 - r_2| < d < r_1+r_2$", "Intersect at two points"],
            ["$d = |r_1 - r_2|$", "Touch internally at one point"],
            ["$d < |r_1-r_2|$", "One circle lies inside the other, no intersection"],
          ],
        },
        {
          k: "note",
          tone: "tip",
          title: "The common chord in one line",
          t: "For two circles in general form, **subtract** one equation from the other. The $x^2$ and $y^2$ terms cancel and what remains is the equation of the common chord (or of the common tangent, when they touch).",
        },
        {
          k: "steps",
          items: [
            { t: "Find the common chord of $x^2+y^2-4x-2y-11=0$ and $x^2+y^2-12x-8y+27=0$. Subtract the second from the first.", m: "(-4x + 12x) + (-2y + 8y) + (-11 - 27) = 0" },
            { t: "Simplify.", m: "8x + 6y - 38 = 0" },
            { t: "Divide by 2.", m: "4x + 3y - 19 = 0" },
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Circle, centre-radius form", latex: "(x-a)^2 + (y-b)^2 = r^2", given: true, note: "Printed in the List of formulas." },
    { name: "Circle, general form", latex: "x^2+y^2+2gx+2fy+c=0", given: false, note: "Centre $(-g,-f)$, radius $\\sqrt{g^2+f^2-c}$." },
    { name: "Tangent–radius property", latex: "m_{\\text{tangent}} \\times m_{\\text{radius}} = -1", given: false },
    { name: "Distance from a point to a line", latex: "d = \\frac{|Ax_0+By_0+C|}{\\sqrt{A^2+B^2}}", given: false },
    { name: "Two circles touching", latex: "d = r_1 + r_2 \\ \\text{(externally)}, \\quad d = |r_1-r_2| \\ \\text{(internally)}", given: false },
  ],
  examples: [
    {
      id: "cir-ex1",
      title: "Centre and radius from the general form",
      difficulty: "easy",
      prompt: "Find the centre and radius of the circle $x^2 + y^2 + 8x - 4y - 5 = 0$.",
      steps: [
        { t: "Group and complete the square in $x$.", m: "x^2 + 8x = (x+4)^2 - 16" },
        { t: "Do the same in $y$.", m: "y^2 - 4y = (y-2)^2 - 4" },
        { t: "Substitute both back.", m: "(x+4)^2 - 16 + (y-2)^2 - 4 - 5 = 0" },
        { t: "Collect the constants.", m: "(x+4)^2 + (y-2)^2 = 25" },
        { t: "Read off the centre and radius.", m: "\\text{centre } (-4, 2), \\quad r = 5" },
      ],
      answer: "Centre $(-4, 2)$, radius $5$.",
    },
    {
      id: "cir-ex2",
      title: "Is the line a tangent?",
      difficulty: "medium",
      prompt: "Determine whether the line $y = 2x + 10$ is a tangent to, a chord of, or misses the circle $x^2 + y^2 = 20$.",
      steps: [
        { t: "Use the distance method. Write the line in the form $Ax+By+C=0$.", m: "2x - y + 10 = 0" },
        { t: "The centre is the origin. Apply the distance formula.", m: "d = \\frac{|2(0) - (0) + 10|}{\\sqrt{4+1}} = \\frac{10}{\\sqrt5}" },
        { t: "Simplify.", m: "d = 2\\sqrt5" },
        { t: "The radius is $\\sqrt{20}$.", m: "r = \\sqrt{20} = 2\\sqrt5" },
        { t: "Since $d = r$, the line touches the circle exactly once." },
      ],
      answer: "It is a tangent, since the distance from the centre equals the radius, $2\\sqrt5$.",
      remark: "The substitution method gives the same conclusion: $x^2 + (2x+10)^2 = 20$ reduces to $5(x+4)^2 = 0$, a repeated root at $x=-4$.",
    },
    {
      id: "cir-ex3",
      title: "Circle through three points",
      difficulty: "hard",
      prompt: "Find the equation of the circle passing through $A(1, 1)$, $B(7, 1)$ and $C(1, 9)$.",
      steps: [
        { t: "$A$ and $B$ share a $y$-coordinate, so the perpendicular bisector of $AB$ is vertical through their midpoint.", m: "x = 4" },
        { t: "$A$ and $C$ share an $x$-coordinate, so the perpendicular bisector of $AC$ is horizontal through their midpoint.", m: "y = 5" },
        { t: "The centre is where the two bisectors meet.", m: "\\text{centre } (4, 5)" },
        { t: "Find the radius as the distance to any of the three points.", m: "r^2 = (4-1)^2 + (5-1)^2 = 9 + 16 = 25" },
        { t: "Write the equation.", m: "(x-4)^2 + (y-5)^2 = 25" },
        { t: "Check with $B$: $(7-4)^2 + (1-5)^2 = 9+16 = 25$ ✓." },
      ],
      answer: "$(x-4)^2 + (y-5)^2 = 25$",
      remark: "The angle at $A$ is a right angle, so $BC$ is a diameter — the centre is its midpoint, which is a one-line alternative.",
    },
    {
      id: "cir-ex4",
      title: "Tangent from an external point",
      difficulty: "olympiad",
      prompt: "Find the length of the tangents drawn from $P(9, 2)$ to the circle $x^2+y^2-4x-6y+4=0$.",
      steps: [
        { t: "Find the centre and radius by completing the square.", m: "(x-2)^2 + (y-3)^2 = 9 \\;\\Rightarrow\\; C(2,3),\\ r = 3" },
        { t: "The tangent, the radius to the point of contact, and $CP$ form a right-angled triangle, right-angled at the point of contact." },
        { t: "Find $CP^2$ by Pythagoras in coordinates.", m: "CP^2 = (9-2)^2 + (2-3)^2 = 49 + 1 = 50" },
        { t: "Apply Pythagoras in the triangle: $\\text{tangent}^2 = CP^2 - r^2$.", m: "t^2 = 50 - 9 = 41" },
        { t: "Take the positive root.", m: "t = \\sqrt{41}" },
      ],
      answer: "Each tangent has length $\\sqrt{41} \\approx 6.40$.",
      remark: "Substituting $P$ into the left side of the general form gives $81+4-36-12+4 = 41$ directly — the tangent length squared is exactly that value.",
    },
  ],
  examQuestions: [
    {
      id: "cir-eq1",
      title: "Circle, point and tangent",
      difficulty: "medium",
      marks: 9,
      paper: 1,
      prompt:
        "A circle has equation $x^2 + y^2 - 6x + 2y - 15 = 0$.\n(a) Find its centre and radius. [3]\n(b) Show that the point $P(7, 2)$ lies on the circle. [2]\n(c) Find the equation of the tangent to the circle at $P$. [4]",
      steps: [
        { t: "(a) Complete the square in both variables.", m: "(x-3)^2 - 9 + (y+1)^2 - 1 - 15 = 0" },
        { t: "Rearrange.", m: "(x-3)^2 + (y+1)^2 = 25" },
        { t: "Read off.", m: "\\text{centre } (3,-1), \\quad r = 5" },
        { t: "(b) Substitute $P$ into the left side of the centre-radius form.", m: "(7-3)^2 + (2+1)^2 = 16 + 9 = 25" },
        { t: "That equals $r^2$, so $P$ lies on the circle." },
        { t: "(c) Find the gradient of the radius $CP$.", m: "m_{CP} = \\frac{2-(-1)}{7-3} = \\frac34" },
        { t: "The tangent is perpendicular to the radius.", m: "m_t = -\\frac43" },
        { t: "Use the point-gradient form at $P$.", m: "y - 2 = -\\tfrac43(x-7)" },
        { t: "Tidy.", m: "3y - 6 = -4x + 28 ;\\Rightarrow; 4x + 3y = 34" },
      ],
      answer: "(a) centre $(3,-1)$, radius 5. (b) $16+9=25=r^2$. (c) $4x+3y=34$.",
    },
    {
      id: "cir-eq2",
      title: "Two circles",
      difficulty: "hard",
      marks: 8,
      paper: 2,
      prompt:
        "Circle $C_1$ has centre $(0,0)$ and radius 5. Circle $C_2$ has equation $x^2+y^2-12x-16y+75=0$.\n(a) Find the centre and radius of $C_2$. [3]\n(b) Show that the circles touch externally, and find the point of contact. [5]",
      steps: [
        { t: "(a) Complete the square.", m: "(x-6)^2 - 36 + (y-8)^2 - 64 + 75 = 0" },
        { t: "Rearrange.", m: "(x-6)^2 + (y-8)^2 = 25" },
        { t: "So the second circle has the same radius as the first.", m: "\\text{centre } (6,8), \\quad r_2 = 5" },
        { t: "(b) Find the distance between the centres.", m: "d = \\sqrt{6^2 + 8^2} = 10" },
        { t: "Compare with the sum of the radii.", m: "r_1 + r_2 = 5 + 5 = 10 = d" },
        { t: "Since $d = r_1+r_2$, the circles touch externally at exactly one point." },
        { t: "That point lies on the line joining the centres, at distance 5 from the origin — the midpoint here, since the radii are equal.", m: "(3, 4)" },
        { t: "Check in both equations: $9+16=25$ ✓ and $(3-6)^2+(4-8)^2 = 9+16=25$ ✓." },
      ],
      answer: "(a) centre $(6,8)$, radius 5. (b) $d = 10 = r_1+r_2$, so they touch externally at $(3,4)$.",
    },
  ],
  mistakes: [
    {
      wrong: "Reading $(x+3)^2 + (y-2)^2 = 16$ as centre $(3, -2)$, radius 16.",
      why: "Both signs flip, and the right-hand side is $r^2$.",
      fix: "Centre $(-3, 2)$, radius $\\sqrt{16} = 4$.",
    },
    {
      wrong: "Using calculus to find the gradient of a tangent to a circle.",
      why: "It is slower, error-prone with implicit differentiation, and the syllabus explicitly expects no calculus here.",
      fix: "Use the radius–tangent perpendicular property.",
    },
    {
      wrong: "Forgetting to check whether the given point lies on the circle before finding a tangent there.",
      why: "The method assumes it does; if it does not, the answer is meaningless.",
      fix: "Substitute the point into the equation first — it takes one line and is often worth a mark.",
    },
    {
      wrong: "Concluding two circles intersect because their equations have a common solution attempt.",
      why: "A pair of simultaneous equations can be inconsistent even when the algebra looks fine.",
      fix: "Compare $d$ with $r_1+r_2$ and $|r_1-r_2|$ — this settles every case immediately.",
    },
    {
      wrong: "Taking the radius as $g^2+f^2-c$.",
      why: "That expression is $r^2$.",
      fix: "$r = \\sqrt{g^2+f^2-c}$, and if the quantity under the root is negative there is no circle.",
    },
  ],
  tips: [
    "Complete the square rather than memorising $(-g,-f)$: fewer sign errors and it doubles as your working.",
    "The distance-from-centre method decides tangency in two lines. Learn the point-to-line distance formula.",
    "Perpendicular from the centre bisects a chord — that right angle unlocks most chord-length questions.",
    "Draw the circle. Even a rough sketch tells you whether an answer of radius 12 for a circle through $(1,1)$ is plausible.",
    "Subtracting two circle equations always kills the squared terms and hands you the common chord.",
  ],
  generators: ["cir-centre-radius", "cir-equation-from-points", "cir-tangent-at-point", "cir-line-intersection"],
};
