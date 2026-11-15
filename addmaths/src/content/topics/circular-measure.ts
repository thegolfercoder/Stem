import type { Topic } from "@/lib/types";

export const circularMeasure: Topic = {
  slug: "circular-measure",
  unit: 9,
  title: "Circular measure",
  short: "Radians",
  blurb:
    "Radians, arc length and sector area — and the compound-shape questions built from them. None of these formulas is given.",
  syllabus: [
    {
      code: "9.1",
      text: "Solve problems involving the arc length and sector area of a circle, including knowledge and use of radian measure.",
      notes: "Radian measure is expected; problems may involve compound shapes. Formulas are NOT given.",
    },
  ],
  prerequisites: ["indices-and-surds"],
  estimatedMinutes: 70,
  sections: [
    {
      id: "radians",
      heading: "What a radian is",
      body: [
        {
          k: "p",
          t: "One radian is the angle subtended at the centre of a circle by an arc equal in length to the radius. Since the whole circumference is $2\\pi r$, a full turn is $2\\pi$ radians.",
        },
        { k: "math", t: "2\\pi \\text{ rad} = 360^\\circ \\qquad \\pi \\text{ rad} = 180^\\circ \\qquad 1 \\text{ rad} = \\frac{180^\\circ}{\\pi} \\approx 57.3^\\circ" },
        {
          k: "table",
          head: ["Degrees", "$30^\\circ$", "$45^\\circ$", "$60^\\circ$", "$90^\\circ$", "$180^\\circ$", "$270^\\circ$", "$360^\\circ$"],
          rows: [["Radians", "$\\frac{\\pi}{6}$", "$\\frac{\\pi}{4}$", "$\\frac{\\pi}{3}$", "$\\frac{\\pi}{2}$", "$\\pi$", "$\\frac{3\\pi}{2}$", "$2\\pi$"]],
        },
        {
          k: "note",
          tone: "key",
          title: "Why radians at all",
          t: "Because calculus demands them. $\\dfrac{\\mathrm{d}}{\\mathrm{d}x}\\sin x = \\cos x$ is only true in radians — in degrees an awkward factor of $\\frac{\\pi}{180}$ appears. Every trigonometric derivative and integral in this syllabus assumes radians.",
        },
        {
          k: "note",
          tone: "warn",
          t: "An angle written without a degree symbol is in radians. $\\sin 2$ means the sine of 2 **radians** ($\\approx 0.909$), not of $2^\\circ$ ($\\approx 0.0349$). Set your calculator deliberately and check it every question.",
        },
      ],
    },
    {
      id: "arc-and-sector",
      heading: "Arc length and sector area",
      body: [
        {
          k: "p",
          t: "In radians the two formulas are as simple as they can be — and both are absent from the formula sheet, so they must be memorised.",
        },
        { k: "math", t: "s = r\\theta \\qquad\\qquad A = \\tfrac12 r^2\\theta" },
        {
          k: "p",
          t: "They come straight from proportion: the sector is the fraction $\\dfrac{\\theta}{2\\pi}$ of the whole circle, so its arc is $\\dfrac{\\theta}{2\\pi} \\times 2\\pi r = r\\theta$ and its area is $\\dfrac{\\theta}{2\\pi}\\times \\pi r^2 = \\tfrac12r^2\\theta$.",
        },
        {
          k: "note",
          tone: "key",
          title: "The third formula you need",
          t: "The **segment** — the region between a chord and its arc — is the sector minus the triangle: $A_{\\text{segment}} = \\tfrac12 r^2\\theta - \\tfrac12 r^2\\sin\\theta = \\tfrac12 r^2(\\theta - \\sin\\theta)$.",
        },
        {
          k: "table",
          head: ["Quantity", "Formula", "Given in the exam?"],
          rows: [
            ["Arc length", "$s = r\\theta$", "No"],
            ["Sector area", "$A = \\frac12 r^2\\theta$", "No"],
            ["Segment area", "$A = \\frac12 r^2(\\theta - \\sin\\theta)$", "No"],
            ["Chord length", "$c = 2r\\sin\\frac{\\theta}{2}$", "No"],
            ["Triangle area", "$\\frac12 ab\\sin C$", "Yes"],
          ],
        },
      ],
    },
    {
      id: "compound",
      heading: "Compound shapes",
      body: [
        {
          k: "p",
          t: "Nearly every exam question is a shaded region built from sectors, triangles and segments. The method never changes: name the pieces, find each, then add or subtract.",
        },
        {
          k: "ol",
          items: [
            "Redraw the diagram, marking every radius and every angle in **radians**.",
            "Split the shaded region into sectors and triangles.",
            "Compute each piece separately, keeping exact values as long as possible.",
            "Combine, and only then round — to 3 significant figures unless told otherwise.",
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "The **perimeter** of a shaded region includes arcs and straight edges. Students routinely forget the two radii on a sector, or count a shared edge twice. Trace the boundary with a finger before adding anything up.",
        },
      ],
    },
    {
      id: "exact-values",
      heading: "Exact values in radians",
      body: [
        {
          k: "table",
          head: ["$\\theta$", "$0$", "$\\frac{\\pi}{6}$", "$\\frac{\\pi}{4}$", "$\\frac{\\pi}{3}$", "$\\frac{\\pi}{2}$"],
          rows: [
            ["$\\sin\\theta$", "$0$", "$\\frac12$", "$\\frac{\\sqrt2}{2}$", "$\\frac{\\sqrt3}{2}$", "$1$"],
            ["$\\cos\\theta$", "$1$", "$\\frac{\\sqrt3}{2}$", "$\\frac{\\sqrt2}{2}$", "$\\frac12$", "$0$"],
            ["$\\tan\\theta$", "$0$", "$\\frac{1}{\\sqrt3}$", "$1$", "$\\sqrt3$", "undefined"],
          ],
        },
        {
          k: "p",
          t: "These come from two triangles: the half of an equilateral triangle of side 2 (giving $\\frac\\pi6$ and $\\frac\\pi3$), and the isosceles right-angled triangle with legs 1 (giving $\\frac\\pi4$). Reconstructing them takes ten seconds and beats memorising a table you might misremember.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Degrees to radians", latex: "\\theta_{\\text{rad}} = \\theta_{\\text{deg}} \\times \\frac{\\pi}{180}", given: false },
    { name: "Arc length", latex: "s = r\\theta", given: false, note: "$\\theta$ in radians. Not on the formula sheet." },
    { name: "Sector area", latex: "A = \\tfrac12 r^2 \\theta", given: false, note: "Not on the formula sheet." },
    { name: "Segment area", latex: "A = \\tfrac12 r^2\\left(\\theta - \\sin\\theta\\right)", given: false },
    { name: "Chord length", latex: "c = 2r\\sin\\tfrac{\\theta}{2}", given: false },
    { name: "Area of a triangle", latex: "A = \\tfrac12 ab \\sin C", given: true },
  ],
  examples: [
    {
      id: "rad-ex1",
      title: "Arc and sector from first principles",
      difficulty: "easy",
      prompt: "A sector of a circle has radius 9 cm and angle $\\dfrac{2\\pi}{3}$ radians. Find its arc length and area, leaving answers in terms of $\\pi$.",
      steps: [
        { t: "Use the arc-length formula.", m: "s = r\\theta = 9 \\times \\frac{2\\pi}{3}" },
        { t: "Simplify.", m: "s = 6\\pi \\text{ cm}" },
        { t: "Use the sector-area formula.", m: "A = \\tfrac12 r^2\\theta = \\tfrac12 \\times 81 \\times \\frac{2\\pi}{3}" },
        { t: "Simplify.", m: "A = 27\\pi \\text{ cm}^2" },
      ],
      answer: "Arc $6\\pi$ cm; area $27\\pi$ cm².",
    },
    {
      id: "rad-ex2",
      title: "Finding the angle, then the segment",
      difficulty: "medium",
      prompt:
        "A sector of a circle of radius 8 cm has area 48 cm². Find the angle of the sector in radians, and hence the area of the segment cut off by the chord joining the ends of the arc.",
      steps: [
        { t: "Start from the sector-area formula.", m: "48 = \\tfrac12 (8)^2 \\theta = 32\\theta" },
        { t: "Solve for the angle.", m: "\\theta = 1.5 \\text{ rad}" },
        { t: "The segment is the sector minus the triangle.", m: "A_{\\text{seg}} = \\tfrac12 r^2\\left(\\theta - \\sin\\theta\\right)" },
        { t: "Substitute, with the calculator in radian mode: $\\sin 1.5 = 0.99749\\ldots$", m: "= \\tfrac12(64)(1.5 - 0.99749)" },
        { t: "Evaluate.", m: "= 32 \\times 0.50251 = 16.1 \\text{ cm}^2" },
      ],
      answer: "$\\theta = 1.5$ rad; segment area $\\approx 16.1$ cm².",
    },
    {
      id: "rad-ex3",
      title: "A shaded compound region",
      difficulty: "hard",
      prompt:
        "In a circle of radius 10 cm, centre $O$, the points $A$ and $B$ lie on the circumference with angle $AOB = \\dfrac{\\pi}{3}$. The region $R$ is bounded by the arc $AB$, and by the two tangents to the circle at $A$ and at $B$, which meet at $T$. Find the area of $R$.",
      steps: [
        { t: "Each tangent is perpendicular to its radius, so $OATB$ has right angles at $A$ and $B$. Its angles sum to $2\\pi$, giving the angle at $T$.", m: "\\angle ATB = 2\\pi - \\tfrac{\\pi}{2} - \\tfrac{\\pi}{2} - \\tfrac{\\pi}{3} = \\tfrac{2\\pi}{3}" },
        { t: "The kite $OATB$ splits into two congruent right-angled triangles, each with angle $\\frac{\\pi}{6}$ at $O$.", m: "AT = 10\\tan\\tfrac{\\pi}{6} = \\frac{10}{\\sqrt3}" },
        { t: "Area of the kite is twice one triangle.", m: "2 \\times \\tfrac12 \\times 10 \\times \\frac{10}{\\sqrt3} = \\frac{100}{\\sqrt3}" },
        { t: "Subtract the sector $OAB$.", m: "A_{\\text{sector}} = \\tfrac12(10)^2\\left(\\tfrac{\\pi}{3}\\right) = \\frac{50\\pi}{3}" },
        { t: "The required region is what is left.", m: "R = \\frac{100}{\\sqrt3} - \\frac{50\\pi}{3}" },
        { t: "Evaluate to 3 significant figures.", m: "\\approx 57.735 - 52.360 = 5.38 \\text{ cm}^2" },
      ],
      answer: "$R = \\dfrac{100}{\\sqrt3} - \\dfrac{50\\pi}{3} \\approx 5.38$ cm².",
    },
    {
      id: "rad-ex4",
      title: "Optimising a sector",
      difficulty: "olympiad",
      prompt:
        "A sector of a circle has a fixed perimeter of 40 cm. Find the radius that maximises its area, and state that maximum area.",
      steps: [
        { t: "The perimeter is two radii plus the arc.", m: "2r + r\\theta = 40" },
        { t: "Make $\\theta$ the subject.", m: "\\theta = \\frac{40 - 2r}{r}" },
        { t: "Substitute into the area formula.", m: "A = \\tfrac12 r^2\\theta = \\tfrac12 r^2 \\cdot \\frac{40-2r}{r}" },
        { t: "Simplify to a quadratic in $r$.", m: "A = 20r - r^2" },
        { t: "Complete the square (or differentiate).", m: "A = 100 - (r - 10)^2" },
        { t: "The maximum occurs when the square vanishes.", m: "r = 10, \\quad A_{\\max} = 100 \\text{ cm}^2" },
        { t: "Check the angle is sensible: $\\theta = \\frac{40-20}{10} = 2$ radians, comfortably less than $2\\pi$. ✓" },
      ],
      answer: "$r = 10$ cm gives the maximum area $100$ cm² (with $\\theta = 2$ rad).",
      remark: "A neat coincidence worth noticing: at the optimum the arc length equals $r\\theta = 20$, exactly the same as the two straight edges together.",
    },
  ],
  examQuestions: [
    {
      id: "rad-eq1",
      title: "Perimeter and area of a shaded region",
      difficulty: "medium",
      marks: 8,
      paper: 2,
      prompt:
        "Two concentric circles have centre $O$ and radii 5 cm and 12 cm. A sector of angle $0.8$ radians is taken from each, forming an annular region $R$ between the two arcs and two straight edges.\n(a) Find the perimeter of $R$. [4]\n(b) Find the area of $R$. [4]",
      steps: [
        { t: "(a) The two arcs have lengths $r\\theta$ with the two radii.", m: "s_1 = 5(0.8) = 4, \\qquad s_2 = 12(0.8) = 9.6" },
        { t: "The two straight edges are each the difference of the radii.", m: "12 - 5 = 7 \\text{ cm each}" },
        { t: "Add all four boundary pieces.", m: "P = 4 + 9.6 + 7 + 7" },
        { t: "Total.", m: "P = 27.6 \\text{ cm}" },
        { t: "(b) Subtract the small sector from the large one.", m: "A = \\tfrac12(12)^2(0.8) - \\tfrac12(5)^2(0.8)" },
        { t: "Evaluate each.", m: "= 57.6 - 10" },
        { t: "Total.", m: "A = 47.6 \\text{ cm}^2" },
      ],
      answer: "(a) $27.6$ cm. (b) $47.6$ cm².",
    },
    {
      id: "rad-eq2",
      title: "Segment and triangle combined",
      difficulty: "hard",
      marks: 9,
      paper: 2,
      prompt:
        "The points $A$ and $B$ lie on a circle of centre $O$ and radius 6 cm, with $\\angle AOB = 1.2$ radians. The tangent at $A$ meets $OB$ extended at $C$.\n(a) Find the length $AC$. [3]\n(b) Find the area of the region bounded by $AC$, $BC$ and the arc $AB$. [6]",
      steps: [
        { t: "(a) The tangent at $A$ is perpendicular to $OA$, so triangle $OAC$ is right-angled at $A$.", m: "\\tan 1.2 = \\frac{AC}{6}" },
        { t: "Evaluate in radian mode: $\\tan 1.2 = 2.5722$.", m: "AC = 6\\tan 1.2 = 15.4 \\text{ cm}" },
        { t: "(b) Find $OC$, the hypotenuse of the same triangle.", m: "OC = \\frac{6}{\\cos 1.2} = \\frac{6}{0.36236} = 16.559" },
        { t: "Area of triangle $OAC$.", m: "\\tfrac12 \\times 6 \\times 15.433 = 46.30" },
        { t: "Area of sector $OAB$.", m: "\\tfrac12(6)^2(1.2) = 21.6" },
        { t: "The required region is the triangle minus the sector.", m: "46.30 - 21.6 = 24.70" },
        { t: "Round to 3 significant figures.", m: "\\approx 24.7 \\text{ cm}^2" },
      ],
      answer: "(a) $AC = 6\\tan 1.2 \\approx 15.4$ cm. (b) area $\\approx 24.7$ cm².",
    },
  ],
  mistakes: [
    {
      wrong: "Leaving the calculator in degree mode.",
      why: "$\\sin 1.2$ in degrees is $0.0209$; in radians it is $0.932$. Everything downstream is wrong.",
      fix: "Set radian mode at the start of any question containing $\\pi$ or a decimal angle, and verify with $\\sin\\frac\\pi2 = 1$.",
    },
    {
      wrong: "Using $s = r\\theta$ with $\\theta$ in degrees.",
      why: "The formula is only valid in radians.",
      fix: "Convert first: $\\theta_{\\text{rad}} = \\theta_{\\text{deg}} \\times \\frac{\\pi}{180}$.",
    },
    {
      wrong: "Giving the perimeter of a sector as just the arc.",
      why: "The boundary also includes the two radii.",
      fix: "Perimeter $= r\\theta + 2r$. Trace the boundary before adding.",
    },
    {
      wrong: "Computing a segment as sector minus $\\frac12 r^2\\theta$.",
      why: "That subtracts the sector from itself. The triangle has area $\\frac12 r^2\\sin\\theta$.",
      fix: "$A_{\\text{seg}} = \\frac12 r^2(\\theta - \\sin\\theta)$ — note the $\\sin$.",
    },
    {
      wrong: "Rounding at every intermediate step.",
      why: "Errors compound; a 3-significant-figure intermediate can shift the final answer.",
      fix: "Keep full accuracy in the calculator and round only the final answer.",
    },
  ],
  tips: [
    "None of the circular-measure formulas is given. Write $s=r\\theta$ and $A=\\frac12r^2\\theta$ on your rough paper before you start.",
    "Exact answers in terms of $\\pi$ are expected on Paper 1; 3 significant figures on Paper 2 unless told otherwise.",
    "Draw and label the diagram again yourself, even when one is printed. Marking radii and angles on your own copy prevents most errors.",
    "Segment = sector − triangle. Almost every shaded-region question reduces to that sentence.",
    "If an angle comes out larger than $2\\pi$ or a length larger than the diameter, you have a mode or formula error — check before continuing.",
  ],
  generators: ["rad-convert", "rad-arc-sector", "rad-segment", "rad-perimeter"],
};
