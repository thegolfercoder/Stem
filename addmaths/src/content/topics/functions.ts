import type { Topic } from "@/lib/types";

export const functions: Topic = {
  slug: "functions",
  unit: 1,
  title: "Functions",
  short: "Functions",
  blurb:
    "Domain, range, inverses and composition — the language every later topic is written in.",
  syllabus: [
    { code: "1.1", text: "Understand the terms function, domain, range (image set), one–one, many–one, inverse function and composition of functions." },
    { code: "1.2", text: "Find the domain and range of functions, including inverse and composite functions." },
    { code: "1.3", text: "Recognise and use function notation: $f(x)$, $f: x \\mapsto \\lg x$, $f^{-1}(x)$, $fg(x)$, $f^2(x)$." },
    { code: "1.4", text: "Understand the relationship between $y=f(x)$ and $y=|f(x)|$ for linear, quadratic, cubic or trigonometric $f$." },
    { code: "1.5", text: "Explain in words why a given function does not have an inverse." },
    { code: "1.6", text: "Find the inverse of a one–one function." },
    { code: "1.7", text: "Form and use composite functions, understanding that $fg \\ne gf$ in general." },
    { code: "1.8", text: "Use sketch graphs to show the relationship between a function and its inverse (reflection in $y=x$)." },
  ],
  prerequisites: [],
  estimatedMinutes: 90,
  sections: [
    {
      id: "what-is-a-function",
      heading: "What a function actually is",
      body: [
        {
          k: "p",
          t: "A **function** is a rule that takes each input from a set and gives back exactly **one** output. That word *exactly* is the whole idea. Feed $3$ into a function twice and you must get the same answer twice, and you must never get two answers at once.",
        },
        {
          k: "note",
          tone: "key",
          title: "Definition",
          t: "$f$ is a function from a domain $D$ if every $x \\in D$ has exactly one image $f(x)$. The **domain** is the set of allowed inputs; the **range** (or image set) is the set of values that actually come out.",
        },
        {
          k: "p",
          t: "The graphical test follows immediately. If a vertical line ever cuts a graph twice, that $x$ has two outputs, so the graph is not a function. This is the **vertical line test**.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-3.2, 3.2],
            yRange: [-3, 3],
            curves: [
              { f: (x: number) => Math.sqrt(Math.max(0, x)), label: "y = √x (a function)" },
              { f: (x: number) => -Math.sqrt(Math.max(0, x)), color: 0 },
              { f: (x: number) => 0.9 * x, label: "y = 0.9x (a function)", color: 2 },
            ],
            caption:
              "The blue curve is y² = x drawn as two branches: a vertical line at x = 2 meets it twice, so y² = x is not a function of x. Restricted to the upper branch, y = √x is.",
            height: 300,
          },
        },
        {
          k: "p",
          t: "Cambridge uses two notations interchangeably, and expects you to read both:",
        },
        {
          k: "ul",
          items: [
            "$f(x) = 2x + 5$ — the equation form.",
            "$f : x \\mapsto 2x + 5$ — read as “$f$ maps $x$ to $2x+5$”. The arrow $\\mapsto$ is *not* the same as $\\to$, which is used for sets: $f : \\mathbb{R} \\to \\mathbb{R}$.",
          ],
        },
        {
          k: "p",
          t: "A function is **one–one** if different inputs always give different outputs (a horizontal line cuts the graph at most once), and **many–one** if two or more inputs share an output. $f(x)=x^3$ is one–one; $f(x)=x^2$ on $\\mathbb{R}$ is many–one, since $(-3)^2 = 3^2$.",
        },
      ],
    },
    {
      id: "domain-and-range",
      heading: "Domain and range",
      body: [
        {
          k: "p",
          t: "Unless a question restricts it, the domain is every real number the rule can accept. Three things force a restriction:",
        },
        {
          k: "ol",
          items: [
            "**Division by zero.** For $f(x) = \\dfrac{1}{x-4}$, the domain is $x \\in \\mathbb{R},\\, x \\ne 4$.",
            "**Square roots of negatives.** For $f(x) = \\sqrt{2x-6}$, we need $2x - 6 \\ge 0$, so $x \\ge 3$.",
            "**Logarithms of non-positives.** For $f(x) = \\ln(x+5)$, we need $x + 5 > 0$, so $x > -5$.",
          ],
        },
        {
          k: "p",
          t: "Finding the **range** is the part students lose marks on. The reliable method: sketch the graph over the given domain, then read off the $y$-values that occur. For a quadratic, complete the square first — the turning point *is* the endpoint of the range.",
        },
        {
          k: "steps",
          items: [
            { t: "Take $f(x) = x^2 - 6x + 11$ for $x \\ge 4$. Complete the square." , m: "f(x) = (x-3)^2 + 2" },
            { t: "The vertex is at $x = 3$, which is **outside** the domain $x \\ge 4$. So the minimum on this domain sits at the endpoint $x = 4$.", m: "f(4) = (4-3)^2 + 2 = 3" },
            { t: "For $x \\ge 4$ the parabola only rises, so the range is everything from $3$ upwards.", m: "\\text{Range: } f(x) \\ge 3" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Write the range in terms of $f(x)$ or $y$, never $x$. “$x \\ge 3$” as an answer for a range is marked wrong even when the number is right.",
        },
      ],
    },
    {
      id: "composite",
      heading: "Composite functions",
      body: [
        {
          k: "p",
          t: "$fg(x)$ means “do $g$ first, then $f$”. Read it right to left, like nested brackets: $fg(x) = f(g(x))$.",
        },
        { k: "math", t: "f(x) = 3x - 1,\\quad g(x) = x^2 + 4" },
        {
          k: "columns",
          left: [
            { k: "p", t: "**$fg(x)$** — substitute $g$ into $f$:" },
            { k: "math", t: "fg(x) = 3(x^2+4) - 1 = 3x^2 + 11" },
          ],
          right: [
            { k: "p", t: "**$gf(x)$** — substitute $f$ into $g$:" },
            { k: "math", t: "gf(x) = (3x-1)^2 + 4 = 9x^2 - 6x + 5" },
          ],
        },
        {
          k: "p",
          t: "They are different, and that is the point: composition does not commute. $f^2(x)$ means $ff(x)$, **not** $[f(x)]^2$.",
        },
        {
          k: "note",
          tone: "key",
          title: "When does $fg$ exist?",
          t: "Everything $g$ produces must be something $f$ can accept: range of $g$ $\\subseteq$ domain of $f$. If $g(x) = x - 7$ and $f(x)=\\sqrt{x}$, then $fg(x) = \\sqrt{x-7}$ needs $x \\ge 7$ — the domain of $fg$ is smaller than the domain of $g$.",
        },
      ],
    },
    {
      id: "inverse",
      heading: "Inverse functions",
      body: [
        {
          k: "p",
          t: "$f^{-1}$ undoes $f$: if $f(a) = b$ then $f^{-1}(b) = a$. An inverse exists **only** when $f$ is one–one, because a many–one function would force $f^{-1}$ to send one input to two outputs — and that is not a function.",
        },
        {
          k: "note",
          tone: "warn",
          title: "The mark for explaining",
          t: "“Explain why $f$ has no inverse” wants the word **one–one**: e.g. “$f$ is many–one, so it is not one–one; two values of $x$ give the same $f(x)$, so the inverse would not be a function.” Writing only “because it's a parabola” earns nothing.",
        },
        {
          k: "p",
          t: "The method for finding $f^{-1}$ is mechanical:",
        },
        {
          k: "steps",
          items: [
            { t: "Write $y = f(x)$. Take $f(x) = \\dfrac{2x+1}{x-3}$, $x \\ne 3$.", m: "y = \\frac{2x+1}{x-3}" },
            { t: "Make $x$ the subject. Multiply up first.", m: "y(x-3) = 2x+1 ;\\Rightarrow; xy - 3y = 2x + 1" },
            { t: "Collect every $x$ on one side and factorise.", m: "xy - 2x = 3y + 1 ;\\Rightarrow; x(y-2) = 3y+1" },
            { t: "Divide, then swap the letter back to $x$.", m: "f^{-1}(x) = \\frac{3x+1}{x-2},\\quad x \\ne 2" },
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "The swap that saves you",
          t: "Domain of $f^{-1}$ $=$ range of $f$, and range of $f^{-1}$ $=$ domain of $f$. So the excluded value $x \\ne 2$ above is no accident — $y = 2$ is the horizontal asymptote of $f$, a value $f$ never reaches.",
        },
        {
          k: "p",
          t: "Graphically, $y = f^{-1}(x)$ is the reflection of $y = f(x)$ in the line $y = x$. This is worth a sketch mark on its own, and it explains why the domain and range trade places.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-1, 6],
            yRange: [-1, 6],
            curves: [
              { f: (x: number) => Math.exp(x - 1), label: "y = f(x) = e^(x−1)", domain: [-1, 2.9] },
              { f: (x: number) => 1 + Math.log(x), label: "y = f⁻¹(x) = 1 + ln x", domain: [0.02, 6], color: 1 },
              { f: (x: number) => x, label: "y = x", color: 3, dashed: true },
            ],
            caption: "A function and its inverse are mirror images in the line y = x.",
            height: 340,
          },
        },
      ],
    },
    {
      id: "modulus",
      heading: "The modulus of a function",
      body: [
        {
          k: "p",
          t: "$|f(x)|$ is $f(x)$ with any negative output made positive. Graphically: **anything below the $x$-axis is reflected up**. Everything on or above the axis stays exactly where it was.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-1, 5],
            yRange: [-3.2, 5],
            curves: [
              { f: (x: number) => x * x - 4 * x + 1, label: "y = x² − 4x + 1", dashed: true },
              { f: (x: number) => Math.abs(x * x - 4 * x + 1), label: "y = |x² − 4x + 1|", color: 1 },
            ],
            caption:
              "The dip below the axis flips upward. The two roots become sharp corners — points where the modulus graph is not smooth.",
            height: 320,
          },
        },
        {
          k: "ul",
          items: [
            "The $x$-intercepts of $y=f(x)$ are unchanged: they become the corners of $y=|f(x)|$.",
            "A minimum of $f$ below the axis becomes a **maximum** of $|f|$.",
            "$|f(x)|$ is never negative, so its range starts at $0$ (or at the lowest value the curve reaches above the axis).",
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Composite function", latex: "fg(x) = f\\big(g(x)\\big)", given: false, note: "Apply g first." },
    { name: "Inverse: defining property", latex: "ff^{-1}(x) = f^{-1}f(x) = x", given: false },
    { name: "Domain and range swap", latex: "\\text{dom } f^{-1} = \\text{ran } f,\\quad \\text{ran } f^{-1} = \\text{dom } f", given: false },
    { name: "Reflection property", latex: "y = f^{-1}(x) \\text{ is } y = f(x) \\text{ reflected in } y = x", given: false },
  ],
  examples: [
    {
      id: "fn-ex1",
      title: "Domain, range and inverse of a root function",
      difficulty: "easy",
      prompt:
        "The function $f$ is defined by $f(x) = \\sqrt{3x - 6} + 1$ for $x \\ge 2$. Find the range of $f$, and find $f^{-1}(x)$ stating its domain.",
      steps: [
        { t: "At the left end of the domain, $x = 2$, the root is zero.", m: "f(2) = \\sqrt{0} + 1 = 1" },
        { t: "As $x$ increases, $3x-6$ increases, so $\\sqrt{3x-6}$ increases without limit. The function only grows.", m: "\\text{Range: } f(x) \\ge 1" },
        { t: "For the inverse, set $y = f(x)$ and isolate the root.", m: "y = \\sqrt{3x-6} + 1 ;\\Rightarrow; y - 1 = \\sqrt{3x-6}" },
        { t: "Square both sides — legitimate here because $y - 1 \\ge 0$ on the range.", m: "(y-1)^2 = 3x - 6" },
        { t: "Make $x$ the subject and rename.", m: "x = \\frac{(y-1)^2 + 6}{3} ;\\Rightarrow; f^{-1}(x) = \\frac{(x-1)^2 + 6}{3}" },
        { t: "The domain of $f^{-1}$ is the range of $f$.", m: "x \\ge 1" },
      ],
      answer: "Range $f(x) \\ge 1$; $f^{-1}(x) = \\dfrac{(x-1)^2+6}{3}$ for $x \\ge 1$.",
      remark:
        "The restriction $x \\ge 1$ is doing real work: without it, $f^{-1}$ would be a many–one parabola and could not be the inverse of anything.",
    },
    {
      id: "fn-ex2",
      title: "Composition, and solving with a composite",
      difficulty: "medium",
      prompt:
        "$f(x) = 2x - 3$ and $g(x) = \\dfrac{5}{x+1}$ for $x \\ne -1$. (a) Find $gf(x)$ and state its domain. (b) Solve $fg(x) = g(x)$.",
      steps: [
        { t: "(a) $gf$ means substitute $f$ into $g$.", m: "gf(x) = \\frac{5}{(2x-3)+1} = \\frac{5}{2x-2}" },
        { t: "The denominator must not vanish: $2x - 2 = 0$ at $x = 1$.", m: "\\text{Domain: } x \\in \\mathbb{R},\\ x \\ne 1" },
        { t: "(b) Build $fg(x)$ by substituting $g$ into $f$.", m: "fg(x) = 2\\left(\\frac{5}{x+1}\\right) - 3 = \\frac{10}{x+1} - 3" },
        { t: "Set it equal to $g(x)$ and clear the fractions by multiplying by $x+1$.", m: "\\frac{10}{x+1} - 3 = \\frac{5}{x+1} ;\\Rightarrow; 10 - 3(x+1) = 5" },
        { t: "Expand and solve the linear equation.", m: "10 - 3x - 3 = 5 ;\\Rightarrow; -3x = -2" },
        { t: "Check the solution is in the domain ($x \\ne -1$): it is.", m: "x = \\tfrac{2}{3}" },
      ],
      answer: "(a) $gf(x)=\\dfrac{5}{2x-2}$, $x\\ne 1$.  (b) $x = \\dfrac{2}{3}$.",
    },
    {
      id: "fn-ex3",
      title: "Restricting a domain so an inverse exists",
      difficulty: "hard",
      prompt:
        "$f(x) = x^2 - 8x + 21$ for $x \\ge k$. (a) Find the least value of $k$ for which $f$ has an inverse. (b) Using this $k$, find $f^{-1}(x)$ and state its domain.",
      steps: [
        { t: "(a) Complete the square to locate the vertex.", m: "f(x) = (x-4)^2 + 5" },
        { t: "The parabola is many–one on any interval containing $x = 4$ in its interior; it becomes one–one exactly when the domain starts at the vertex.", m: "k = 4" },
        { t: "(b) With $x \\ge 4$ the range starts at the minimum value.", m: "f(x) \\ge 5" },
        { t: "Invert the completed-square form — this is far cleaner than the quadratic formula.", m: "y = (x-4)^2 + 5 ;\\Rightarrow; (x-4)^2 = y - 5" },
        { t: "Take the square root. Choose $+$, because $x \\ge 4$ forces $x - 4 \\ge 0$.", m: "x - 4 = +\\sqrt{y-5}" },
        { t: "Write the inverse, with its domain equal to the range of $f$.", m: "f^{-1}(x) = 4 + \\sqrt{x-5},\\quad x \\ge 5" },
      ],
      answer: "(a) $k = 4$.  (b) $f^{-1}(x) = 4 + \\sqrt{x-5}$ for $x \\ge 5$.",
      remark:
        "The sign choice is where the marks are. If the domain had been $x \\le 4$ the answer would be $4 - \\sqrt{x-5}$.",
    },
    {
      id: "fn-ex4",
      title: "A functional equation",
      difficulty: "olympiad",
      prompt:
        "A function $f$ satisfies $f(x) + 2f\\!\\left(\\dfrac{1}{x}\\right) = 3x$ for all $x \\ne 0$. Find $f(x)$.",
      steps: [
        { t: "Call the given statement equation (1).", m: "f(x) + 2f\\!\\left(\\tfrac{1}{x}\\right) = 3x \\quad (1)" },
        { t: "The equation is true for **every** non-zero input, so replace $x$ by $1/x$ throughout. Note $1/(1/x) = x$.", m: "f\\!\\left(\\tfrac{1}{x}\\right) + 2f(x) = \\frac{3}{x} \\quad (2)" },
        { t: "Now (1) and (2) are simultaneous equations in the two unknowns $f(x)$ and $f(1/x)$. Take $2\\times(2) - (1)$.", m: "2f\\!\\left(\\tfrac{1}{x}\\right) + 4f(x) - f(x) - 2f\\!\\left(\\tfrac{1}{x}\\right) = \\frac{6}{x} - 3x" },
        { t: "The $f(1/x)$ terms cancel.", m: "3f(x) = \\frac{6}{x} - 3x" },
        { t: "Divide by 3.", m: "f(x) = \\frac{2}{x} - x" },
        { t: "Check in (1): $\\left(\\tfrac2x - x\\right) + 2\\left(2x - \\tfrac1x\\right) = \\tfrac2x - x + 4x - \\tfrac2x = 3x$. ✓" },
      ],
      answer: "$f(x) = \\dfrac{2}{x} - x$",
      remark:
        "The trick — substitute to generate a second equation, then eliminate — is the same simultaneous-equation idea from unit 5, applied to functions instead of numbers.",
    },
  ],
  examQuestions: [
    {
      id: "fn-eq1",
      title: "Functions with a modulus sketch",
      difficulty: "medium",
      marks: 8,
      paper: 1,
      prompt:
        "The function $f$ is defined by $f(x) = 3\\sin 2x$ for $0 \\le x \\le \\pi$.\n(a) State the amplitude and period of $f$. [2]\n(b) Sketch $y = |f(x)|$ for $0 \\le x \\le \\pi$. [3]\n(c) State the number of solutions of $|f(x)| = 2$ in this interval. [3]",
      steps: [
        { t: "(a) For $a\\sin bx$ the amplitude is $|a|$ and the period is $\\dfrac{2\\pi}{b}$.", m: "\\text{amplitude } = 3,\\qquad \\text{period } = \\frac{2\\pi}{2} = \\pi" },
        { t: "(b) $y = 3\\sin 2x$ completes one full cycle on $0 \\le x \\le \\pi$: up to $3$ at $x=\\pi/4$, back to $0$ at $x = \\pi/2$, down to $-3$ at $x = 3\\pi/4$, back to $0$ at $x=\\pi$." },
        { t: "Taking the modulus reflects the negative hump upward, giving two identical humps of height $3$, with a corner at $x = \\pi/2$.", m: "y = |3\\sin 2x| \\text{: two arches on } [0,\\pi]" },
        { t: "(c) A horizontal line $y = 2$ cuts each arch twice, since $2 < 3$." },
        { t: "Two arches, two crossings each.", m: "4 \\text{ solutions}" },
      ],
      answer: "(a) amplitude 3, period $\\pi$. (b) two arches of height 3 with a corner at $x=\\pi/2$. (c) 4 solutions.",
    },
    {
      id: "fn-eq2",
      title: "Inverse and composite with a stated domain",
      difficulty: "hard",
      marks: 10,
      paper: 2,
      prompt:
        "$f(x) = e^{2x} + 3$ for $x \\in \\mathbb{R}$ and $g(x) = \\ln(x - 1)$ for $x > 1$.\n(a) Find the range of $f$. [2]\n(b) Find $f^{-1}(x)$ and state its domain. [4]\n(c) Solve $gf(x) = 2$. [4]",
      steps: [
        { t: "(a) $e^{2x} > 0$ for every real $x$, and it approaches $0$ but never reaches it.", m: "f(x) > 3" },
        { t: "(b) Set $y = e^{2x}+3$ and isolate the exponential.", m: "y - 3 = e^{2x}" },
        { t: "Take natural logs of both sides. This is valid because $y - 3 > 0$ on the range.", m: "\\ln(y-3) = 2x" },
        { t: "Divide by 2 and rename the variable.", m: "f^{-1}(x) = \\tfrac{1}{2}\\ln(x-3)" },
        { t: "Its domain is the range of $f$.", m: "x > 3" },
        { t: "(c) $gf(x) = g\\big(e^{2x}+3\\big) = \\ln\\big(e^{2x} + 3 - 1\\big)$.", m: "\\ln\\!\\left(e^{2x} + 2\\right) = 2" },
        { t: "Undo the log by exponentiating.", m: "e^{2x} + 2 = e^{2}" },
        { t: "Isolate and take logs again.", m: "e^{2x} = e^2 - 2 ;\\Rightarrow; 2x = \\ln(e^2 - 2)" },
        { t: "Divide by 2 and evaluate.", m: "x = \\tfrac{1}{2}\\ln(e^2-2) \\approx 0.836" },
      ],
      answer: "(a) $f(x) > 3$. (b) $f^{-1}(x) = \\tfrac12\\ln(x-3)$, $x > 3$. (c) $x = \\tfrac12\\ln(e^2-2) \\approx 0.836$.",
    },
  ],
  mistakes: [
    {
      wrong: "Writing $f^2(x) = [f(x)]^2$.",
      why: "In this syllabus the superscript means repeated composition, not a power.",
      fix: "$f^2(x) = f(f(x))$. If a question wants the square it writes $[f(x)]^2$ or $(f(x))^2$.",
    },
    {
      wrong: "Reading $fg(x)$ as “$f$ first, then $g$”.",
      why: "The notation nests like brackets, so the function next to $x$ acts first.",
      fix: "$fg(x) = f(g(x))$ — always work outward from $x$.",
    },
    {
      wrong: "Giving a range in terms of $x$, e.g. “range: $x \\ge 5$”.",
      why: "The range is a set of outputs, and outputs are $y$ or $f(x)$ values.",
      fix: "Write $f(x) \\ge 5$ or $y \\ge 5$.",
    },
    {
      wrong: "Finding $f^{-1}$ for a function that is many–one, with no domain restriction.",
      why: "The inverse of a many–one function is not a function; it fails the vertical line test.",
      fix: "Restrict the domain to one side of the turning point first, then invert, then pick the sign that matches.",
    },
    {
      wrong: "Forgetting to state the domain of $f^{-1}$.",
      why: "It is worth its own mark, and it is not the same as the domain of $f$.",
      fix: "Domain of $f^{-1}$ = range of $f$. Find the range first and copy it across.",
    },
    {
      wrong: "Treating $|f(x)|$ as though the whole graph were reflected.",
      why: "Only the parts below the $x$-axis move; the rest is untouched.",
      fix: "Draw $y=f(x)$ lightly, then flip only the sections under the axis and mark the corners at the roots.",
    },
  ],
  tips: [
    "Sketch first, algebra second. A three-second sketch tells you the range, the number of solutions and whether an inverse can exist.",
    "For a composite domain, ask “what does the inner function feed the outer one?” and exclude anything the outer function rejects.",
    "When inverting, completing the square beats the quadratic formula every time — it also makes the sign choice obvious.",
    "If the question says “explain in words”, the mark is for the words. Use the terms one–one, many–one and range.",
    "$f^{-1}(a)$ can often be found without inverting at all: just solve $f(x) = a$.",
  ],
  generators: ["fn-domain", "fn-composite", "fn-inverse-linear-rational", "fn-inverse-quadratic", "fn-range-quadratic"],
};
