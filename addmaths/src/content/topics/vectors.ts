import type { Topic } from "@/lib/types";

export const vectors: Topic = {
  slug: "vectors",
  unit: 13,
  title: "Vectors in two dimensions",
  short: "Vectors",
  blurb:
    "Position vectors, magnitude and direction, and the velocity problems where two particles either meet or miss.",
  syllabus: [
    { code: "13.1", text: "Understand and use vector notation, including $\\binom{a}{b}$, $\\overrightarrow{AB}$, $\\mathbf{p}$ and $a\\mathbf{i} - b\\mathbf{j}$." },
    { code: "13.2", text: "Know and use position vectors and unit vectors." },
    { code: "13.3", text: "Find the magnitude of a vector; add and subtract vectors and multiply by scalars, including equating like vectors and solving problems using vector geometry." },
    { code: "13.4", text: "Compose and resolve velocities; use a velocity vector to determine position and solve problems in context such as particles colliding." },
  ],
  prerequisites: ["indices-and-surds", "trigonometric-functions"],
  estimatedMinutes: 85,
  sections: [
    {
      id: "notation",
      heading: "Notation and the basics",
      body: [
        {
          k: "p",
          t: "A vector has both magnitude and direction. The same vector can be written in three ways, and the exam uses all of them:",
        },
        { k: "math", t: "\\mathbf{a} = \\begin{pmatrix} 3 \\\\ -4\\end{pmatrix} = 3\\mathbf{i} - 4\\mathbf{j} = \\overrightarrow{OA}" },
        {
          k: "ul",
          items: [
            "**Magnitude**: $|\\mathbf{a}| = \\sqrt{a_1^2 + a_2^2}$. For the vector above, $|\\mathbf a| = \\sqrt{9+16} = 5$.",
            "**Position vector**: $\\overrightarrow{OA}$, measured from the origin. The position vector of $A(3,-4)$ is $\\binom{3}{-4}$.",
            "**Displacement between points**: $\\overrightarrow{AB} = \\mathbf{b} - \\mathbf{a}$ — final position minus initial.",
            "**Unit vector**: $\\hat{\\mathbf a} = \\dfrac{\\mathbf a}{|\\mathbf a|}$, a vector of length 1 in the same direction.",
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "$\\overrightarrow{AB} = \\mathbf b - \\mathbf a$, not $\\mathbf a - \\mathbf b$. Getting this backwards reverses every direction in the question. Read it as “to minus from”.",
        },
        {
          k: "note",
          tone: "key",
          title: "Parallel vectors",
          t: "$\\mathbf{u}$ and $\\mathbf{v}$ are parallel exactly when $\\mathbf{u} = k\\mathbf{v}$ for some scalar $k$. If two vectors share a point and are parallel, the three points are **collinear** — that is how nearly every “show that $A$, $B$, $C$ lie on a straight line” question is answered.",
        },
      ],
    },
    {
      id: "algebra",
      heading: "Vector algebra and geometry",
      body: [
        {
          k: "p",
          t: "Adding vectors is nose-to-tail; subtracting reverses the second one. Multiplying by a scalar stretches (and, if negative, reverses).",
        },
        {
          k: "note",
          tone: "key",
          title: "Equating like vectors",
          t: "If $\\lambda\\mathbf{a} + \\mu\\mathbf{b} = \\alpha\\mathbf a + \\beta\\mathbf b$ and $\\mathbf a$, $\\mathbf b$ are not parallel, then $\\lambda = \\alpha$ and $\\mu = \\beta$. Comparing the coefficients gives simultaneous equations — this is the standard technique for finding where two lines in a figure cross.",
        },
        {
          k: "steps",
          items: [
            { t: "In triangle $OAB$, $\\overrightarrow{OA} = \\mathbf a$ and $\\overrightarrow{OB} = \\mathbf b$. $M$ is the midpoint of $AB$. Find $\\overrightarrow{OM}$ in terms of $\\mathbf a$ and $\\mathbf b$. First travel from $O$ to $A$.", m: "\\overrightarrow{OA} = \\mathbf a" },
            { t: "Then half way along $AB$, and $\\overrightarrow{AB} = \\mathbf b - \\mathbf a$.", m: "\\overrightarrow{AM} = \\tfrac12(\\mathbf b - \\mathbf a)" },
            { t: "Add the two journeys.", m: "\\overrightarrow{OM} = \\mathbf a + \\tfrac12\\mathbf b - \\tfrac12\\mathbf a" },
            { t: "Simplify — the midpoint is the average of the two position vectors.", m: "= \\tfrac12\\left(\\mathbf a + \\mathbf b\\right)" },
          ],
        },
      ],
    },
    {
      id: "direction",
      heading: "Magnitude and direction",
      body: [
        {
          k: "p",
          t: "A velocity of $\\binom{6}{8}$ has speed $\\sqrt{36+64} = 10$. Its direction is usually asked as a **bearing** — measured clockwise from north, as a three-figure number.",
        },
        {
          k: "steps",
          items: [
            { t: "Find the bearing of the velocity $\\binom{6}{-8}$, taking $\\mathbf i$ as east and $\\mathbf j$ as north.", m: "\\text{east } 6, \\quad \\text{south } 8" },
            { t: "Sketch: the vector points into the south-east quadrant. Find the acute angle from the south direction.", m: "\\tan\\theta = \\frac{6}{8} \\;\\Rightarrow\\; \\theta = 36.87^\\circ" },
            { t: "A bearing is measured clockwise from north, so go $180^\\circ$ to south and then back by $\\theta$.", m: "180 - 36.87 = 143.13^\\circ" },
            { t: "Write it as a three-figure bearing.", m: "143.1^\\circ" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "Always sketch the vector before computing a bearing. The calculator's inverse tangent cannot tell which quadrant you are in, and it is the sketch that decides.",
        },
      ],
    },
    {
      id: "kinematics",
      heading: "Position, velocity and collisions",
      body: [
        {
          k: "p",
          t: "A particle starting at $\\mathbf{r}_0$ and moving with constant velocity $\\mathbf{v}$ has position at time $t$:",
        },
        { k: "math", t: "\\mathbf{r}(t) = \\mathbf{r}_0 + t\\mathbf{v}" },
        {
          k: "note",
          tone: "key",
          title: "Collide or merely cross?",
          t: "Two particles **collide** only if they are at the same place at the same time. Set the position vectors equal, solve the $\\mathbf i$ component for $t$, then check the $\\mathbf j$ component gives the same $t$. If the two values of $t$ differ, the paths cross but the particles miss each other.",
        },
        {
          k: "steps",
          items: [
            { t: "$P$ starts at $\\binom{1}{2}$ with velocity $\\binom{3}{1}$; $Q$ starts at $\\binom{13}{-4}$ with velocity $\\binom{-1}{3}$. Do they collide? Write both positions.", m: "\\mathbf r_P = \\begin{pmatrix}1+3t\\\\2+t\\end{pmatrix}, \\quad \\mathbf r_Q = \\begin{pmatrix}13-t\\\\-4+3t\\end{pmatrix}" },
            { t: "Equate the $\\mathbf i$ components.", m: "1 + 3t = 13 - t \\;\\Rightarrow\\; 4t = 12 \\;\\Rightarrow\\; t = 3" },
            { t: "Test that time in the $\\mathbf j$ components.", m: "2 + 3 = 5, \\qquad -4 + 9 = 5" },
            { t: "They agree, so the particles are at the same point at the same instant.", m: "\\text{Collision at } t = 3 \\text{ at the point } (10, 5)" },
          ],
        },
        {
          k: "p",
          t: "**Relative velocity** answers “how does $Q$ appear to move from $P$'s point of view?”: $_P\\mathbf{v}_Q = \\mathbf{v}_Q - \\mathbf{v}_P$. The particles collide precisely when the initial displacement between them is parallel to this relative velocity and points the right way.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Magnitude", latex: "\\left|\\begin{pmatrix}a\\\\b\\end{pmatrix}\\right| = \\sqrt{a^2+b^2}", given: false },
    { name: "Displacement between points", latex: "\\overrightarrow{AB} = \\mathbf b - \\mathbf a", given: false },
    { name: "Unit vector", latex: "\\hat{\\mathbf a} = \\frac{\\mathbf a}{|\\mathbf a|}", given: false },
    { name: "Position at time $t$", latex: "\\mathbf r = \\mathbf r_0 + t\\mathbf v", given: false },
    { name: "Relative velocity", latex: "{}_P\\mathbf v_Q = \\mathbf v_Q - \\mathbf v_P", given: false },
    { name: "Parallel condition", latex: "\\mathbf u = k\\mathbf v", given: false },
  ],
  examples: [
    {
      id: "vec-ex1",
      title: "Magnitude and unit vector",
      difficulty: "easy",
      prompt: "Given $\\mathbf{a} = \\binom{-5}{12}$, find $|\\mathbf a|$ and the unit vector in the direction of $\\mathbf a$.",
      steps: [
        { t: "Apply the magnitude formula.", m: "|\\mathbf a| = \\sqrt{(-5)^2 + 12^2} = \\sqrt{25+144}" },
        { t: "Simplify.", m: "= \\sqrt{169} = 13" },
        { t: "Divide the vector by its magnitude.", m: "\\hat{\\mathbf a} = \\tfrac{1}{13}\\begin{pmatrix}-5\\\\12\\end{pmatrix}" },
        { t: "Check: $\\sqrt{\\left(\\tfrac{5}{13}\\right)^2 + \\left(\\tfrac{12}{13}\\right)^2} = 1$ ✓." },
      ],
      answer: "$|\\mathbf a| = 13$; $\\hat{\\mathbf a} = \\dfrac{1}{13}\\binom{-5}{12}$.",
    },
    {
      id: "vec-ex2",
      title: "Collinear points",
      difficulty: "medium",
      prompt: "$A$, $B$ and $C$ have position vectors $\\binom{1}{2}$, $\\binom{4}{8}$ and $\\binom{7}{14}$. Show that the three points are collinear.",
      steps: [
        { t: "Find $\\overrightarrow{AB}$ as final minus initial.", m: "\\overrightarrow{AB} = \\begin{pmatrix}4\\\\8\\end{pmatrix} - \\begin{pmatrix}1\\\\2\\end{pmatrix} = \\begin{pmatrix}3\\\\6\\end{pmatrix}" },
        { t: "Find $\\overrightarrow{BC}$.", m: "\\overrightarrow{BC} = \\begin{pmatrix}7\\\\14\\end{pmatrix} - \\begin{pmatrix}4\\\\8\\end{pmatrix} = \\begin{pmatrix}3\\\\6\\end{pmatrix}" },
        { t: "The two are equal, so they are parallel — and they share the point $B$.", m: "\\overrightarrow{BC} = 1 \\times \\overrightarrow{AB}" },
        { t: "Parallel vectors through a common point means the three points lie on one line." },
      ],
      answer: "$\\overrightarrow{AB} = \\overrightarrow{BC} = \\binom{3}{6}$, and they share the point $B$, so $A$, $B$, $C$ are collinear (with $B$ the midpoint of $AC$).",
    },
    {
      id: "vec-ex3",
      title: "Interception",
      difficulty: "hard",
      prompt:
        "At noon a ship $S$ is at $\\binom{2}{5}$ km and moves with constant velocity $\\binom{8}{6}$ km h⁻¹. A patrol boat $B$ leaves $\\binom{26}{5}$ km at noon and travels at a constant speed of $20$ km h⁻¹ in a straight line to intercept $S$. Find the time of interception.",
      steps: [
        { t: "Write the position of $S$ at time $t$ hours after noon.", m: "\\mathbf r_S = \\begin{pmatrix}2+8t\\\\5+6t\\end{pmatrix}" },
        { t: "$B$ must reach that point at that same time. The displacement it must cover is:", m: "\\mathbf d = \\mathbf r_S - \\begin{pmatrix}26\\\\5\\end{pmatrix} = \\begin{pmatrix}8t-24\\\\6t\\end{pmatrix}" },
        { t: "$B$ travels at $20$ km h⁻¹ for $t$ hours, so the distance covered is $20t$.", m: "|\\mathbf d| = 20t" },
        { t: "Square both sides to remove the root.", m: "(8t-24)^2 + (6t)^2 = 400t^2" },
        { t: "Expand.", m: "64t^2 - 384t + 576 + 36t^2 = 400t^2" },
        { t: "Collect.", m: "300t^2 + 384t - 576 = 0 \\;\\Rightarrow\\; 25t^2 + 32t - 48 = 0" },
        { t: "Apply the quadratic formula.", m: "t = \\frac{-32 \\pm \\sqrt{1024 + 4800}}{50} = \\frac{-32 \\pm 76.32}{50}" },
        { t: "Reject the negative root — time cannot run backwards.", m: "t = 0.8864 \\text{ h} \\approx 53 \\text{ minutes}" },
      ],
      answer: "Interception occurs about 53 minutes after noon, at roughly 12:53.",
    },
    {
      id: "vec-ex4",
      title: "Ratio of division",
      difficulty: "olympiad",
      prompt:
        "In triangle $OAB$, $\\overrightarrow{OA}=\\mathbf a$ and $\\overrightarrow{OB}=\\mathbf b$. $P$ divides $AB$ with $AP:PB = 2:1$, and $Q$ is the midpoint of $OA$. The lines $OP$ and $BQ$ meet at $X$. Find $\\overrightarrow{OX}$ in terms of $\\mathbf a$ and $\\mathbf b$.",
      steps: [
        { t: "Find $\\overrightarrow{OP}$: travel to $A$ then two-thirds of the way along $AB$.", m: "\\overrightarrow{OP} = \\mathbf a + \\tfrac23(\\mathbf b - \\mathbf a) = \\tfrac13\\mathbf a + \\tfrac23\\mathbf b" },
        { t: "$X$ lies on $OP$, so it is some multiple $\\lambda$ of that.", m: "\\overrightarrow{OX} = \\tfrac{\\lambda}{3}\\mathbf a + \\tfrac{2\\lambda}{3}\\mathbf b" },
        { t: "$X$ also lies on $BQ$. Write that route: from $O$ to $B$, then a fraction $\\mu$ of the way to $Q = \\tfrac12\\mathbf a$.", m: "\\overrightarrow{OX} = \\mathbf b + \\mu\\left(\\tfrac12\\mathbf a - \\mathbf b\\right) = \\tfrac{\\mu}{2}\\mathbf a + (1-\\mu)\\mathbf b" },
        { t: "Since $\\mathbf a$ and $\\mathbf b$ are not parallel, equate coefficients.", m: "\\tfrac{\\lambda}{3} = \\tfrac{\\mu}{2}, \\qquad \\tfrac{2\\lambda}{3} = 1 - \\mu" },
        { t: "From the first, $\\mu = \\tfrac{2\\lambda}{3}$. Substitute into the second.", m: "\\tfrac{2\\lambda}{3} = 1 - \\tfrac{2\\lambda}{3} \\;\\Rightarrow\\; \\tfrac{4\\lambda}{3} = 1" },
        { t: "Solve and substitute back.", m: "\\lambda = \\tfrac34 \\;\\Rightarrow\\; \\overrightarrow{OX} = \\tfrac14\\mathbf a + \\tfrac12\\mathbf b" },
      ],
      answer: "$\\overrightarrow{OX} = \\dfrac14\\mathbf a + \\dfrac12\\mathbf b$",
      remark: "Two routes to the same point, then compare coefficients — the whole method of vector geometry in one line.",
    },
  ],
  examQuestions: [
    {
      id: "vec-eq1",
      title: "Do they collide?",
      difficulty: "medium",
      marks: 7,
      paper: 2,
      prompt:
        "Particle $A$ has position vector $\\binom{-2}{7}$ at $t=0$ and velocity $\\binom{4}{-2}$. Particle $B$ has position vector $\\binom{10}{-5}$ at $t=0$ and velocity $\\binom{-2}{4}$.\n(a) Write down the position vector of each particle at time $t$. [2]\n(b) Determine whether the particles collide, and if so where. [5]",
      steps: [
        { t: "(a) Apply $\\mathbf r = \\mathbf r_0 + t\\mathbf v$ to each.", m: "\\mathbf r_A = \\begin{pmatrix}-2+4t\\\\7-2t\\end{pmatrix}, \\quad \\mathbf r_B = \\begin{pmatrix}10-2t\\\\-5+4t\\end{pmatrix}" },
        { t: "(b) Equate the $\\mathbf i$ components.", m: "-2 + 4t = 10 - 2t \\;\\Rightarrow\\; 6t = 12 \\;\\Rightarrow\\; t = 2" },
        { t: "Test the same $t$ in the $\\mathbf j$ components.", m: "7 - 4 = 3, \\qquad -5 + 8 = 3" },
        { t: "Both give 3, so the two particles are at the same point at the same time." },
        { t: "Find the meeting point by substituting $t=2$.", m: "\\mathbf r = \\begin{pmatrix}6\\\\3\\end{pmatrix}" },
      ],
      answer: "(b) They collide at $t=2$ at the point $(6, 3)$.",
    },
    {
      id: "vec-eq2",
      title: "Speed, bearing and displacement",
      difficulty: "hard",
      marks: 8,
      paper: 2,
      prompt:
        "A boat travels with velocity $\\mathbf v = (12\\mathbf i - 5\\mathbf j)$ km h⁻¹, where $\\mathbf i$ is east and $\\mathbf j$ is north.\n(a) Find the speed of the boat. [2]\n(b) Find the bearing on which it is travelling. [3]\n(c) The boat starts at the point with position vector $(3\\mathbf i + 20\\mathbf j)$ km. Find its position vector after 4 hours. [3]",
      steps: [
        { t: "(a) The speed is the magnitude of the velocity.", m: "|\\mathbf v| = \\sqrt{144 + 25} = \\sqrt{169} = 13 \\text{ km h}^{-1}" },
        { t: "(b) The motion is 12 east and 5 south, so the direction lies in the south-east quadrant. Find the angle from south.", m: "\\tan\\theta = \\frac{12}{5} \\;\\Rightarrow\\; \\theta = 67.38^\\circ" },
        { t: "Measure clockwise from north: $180^\\circ$ takes you to south, then come back by $\\theta$.", m: "180 - 67.38 = 112.62^\\circ" },
        { t: "Write as a three-figure bearing.", m: "112.6^\\circ" },
        { t: "(c) Apply $\\mathbf r = \\mathbf r_0 + t\\mathbf v$ with $t = 4$.", m: "\\mathbf r = \\begin{pmatrix}3\\\\20\\end{pmatrix} + 4\\begin{pmatrix}12\\\\-5\\end{pmatrix}" },
        { t: "Evaluate.", m: "= \\begin{pmatrix}51\\\\0\\end{pmatrix}" },
      ],
      answer: "(a) 13 km h⁻¹. (b) $112.6^\\circ$. (c) $(51\\mathbf i)$ km.",
    },
  ],
  mistakes: [
    { wrong: "Writing $\\overrightarrow{AB} = \\mathbf a - \\mathbf b$.", why: "The displacement runs from $A$ to $B$, so it is the destination minus the start.", fix: "$\\overrightarrow{AB} = \\mathbf b - \\mathbf a$ — “to minus from”." },
    { wrong: "Concluding two particles collide because their paths cross.", why: "Crossing paths only means the same place, not the same time.", fix: "Solve one component for $t$ and verify the other component gives the same $t$." },
    { wrong: "Giving a bearing straight from $\\arctan$.", why: "The inverse tangent returns an angle in $(-90^\\circ, 90^\\circ)$ and cannot know the quadrant.", fix: "Sketch first, then convert to a clockwise-from-north three-figure bearing." },
    { wrong: "Adding magnitudes instead of vectors.", why: "$|\\mathbf a + \\mathbf b| \\ne |\\mathbf a| + |\\mathbf b|$ unless they point the same way.", fix: "Add components first, then take the magnitude." },
    { wrong: "Forgetting to divide by the magnitude for a unit vector.", why: "A unit vector must have length exactly 1.", fix: "$\\hat{\\mathbf a} = \\frac{\\mathbf a}{|\\mathbf a|}$, then check its length is 1." },
  ],
  tips: [
    "Draw the diagram. Vector geometry becomes routine once the routes are visible.",
    "Two different routes to the same point, then compare coefficients of $\\mathbf a$ and $\\mathbf b$ — that solves nearly every ratio problem.",
    "Collinear = parallel vectors sharing a point. Say both parts when you write the conclusion.",
    "For collisions, always check the second component. The mark is for the check, not for finding $t$.",
    "Keep column vectors in columns. Writing them inline is where sign errors breed.",
  ],
  generators: ["vec-magnitude", "vec-displacement", "vec-collision", "vec-unit-vector"],
};
