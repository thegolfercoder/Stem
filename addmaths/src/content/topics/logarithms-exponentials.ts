import type { Topic } from "@/lib/types";

export const logarithmsExponentials: Topic = {
  slug: "logarithms-exponentials",
  unit: 6,
  title: "Logarithmic and exponential functions",
  short: "Logs & exponentials",
  blurb:
    "Logs are indices in disguise. Learn the three laws, the graphs and their asymptotes, and the equation types that follow.",
  syllabus: [
    { code: "6.1", text: "Know and use simple properties and graphs of the logarithmic and exponential functions including $\\ln x$ and $e^x$; state equations of asymptotes. Graphs limited to $y=ke^{nx}+a$ and $y=k\\ln(ax+b)$." },
    { code: "6.2", text: "Know and use the laws of logarithms, including change of base." },
    { code: "6.3", text: "Solve equations of the form $a^x = b$." },
  ],
  prerequisites: ["indices-and-surds", "functions"],
  estimatedMinutes: 100,
  sections: [
    {
      id: "definition",
      heading: "A logarithm is an index",
      body: [
        { k: "p", t: "One sentence contains the whole idea: a logarithm answers the question “what power?”." },
        { k: "math", t: "\\log_a b = c \\iff a^c = b \\qquad (a>0,\\ a \\ne 1,\\ b>0)" },
        {
          k: "note",
          tone: "key",
          title: "Read it aloud",
          t: "$\\log_2 32 = 5$ says “the power you raise 2 to, to get 32, is 5”. Every log question becomes easier when you read it that way.",
        },
        {
          k: "ul",
          items: [
            "$\\lg x$ means $\\log_{10} x$ — the notation Cambridge uses on the papers.",
            "$\\ln x$ means $\\log_e x$, where $e \\approx 2.71828$.",
            "$\\log_a 1 = 0$ and $\\log_a a = 1$, for any valid base.",
            "$a^{\\log_a x} = x$ and $\\log_a a^x = x$: the functions undo each other.",
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "The argument of a logarithm must be strictly positive. $\\ln 0$ and $\\ln(-3)$ do not exist — which is why solutions to log equations always need checking.",
        },
      ],
    },
    {
      id: "laws",
      heading: "The laws of logarithms",
      body: [
        {
          k: "table",
          head: ["Law", "Statement", "Where it comes from"],
          rows: [
            ["Product", "$\\log_a x + \\log_a y = \\log_a(xy)$", "$a^m a^n = a^{m+n}$"],
            ["Quotient", "$\\log_a x - \\log_a y = \\log_a\\!\\left(\\dfrac{x}{y}\\right)$", "$a^m \\div a^n = a^{m-n}$"],
            ["Power", "$\\log_a\\left(x^k\\right) = k\\log_a x$", "$\\left(a^m\\right)^k = a^{mk}$"],
            ["Change of base", "$\\log_a b = \\dfrac{\\log_c b}{\\log_c a}$", "Write $b = a^{\\log_a b}$ and take $\\log_c$"],
          ],
        },
        {
          k: "note",
          tone: "warn",
          title: "The three false laws",
          t: "$\\log(x+y) \\ne \\log x + \\log y$. $\\dfrac{\\log x}{\\log y} \\ne \\log\\dfrac{x}{y}$. $(\\log x)^2 \\ne 2\\log x$. Each of these is a standard exam trap, and each is easy to disprove with numbers.",
        },
        {
          k: "steps",
          items: [
            { t: "Write $3 + 2\\lg p - \\lg q$ as a single base-10 logarithm. First convert the 3 into a log: $3 = \\lg 1000$.", m: "\\lg 1000 + 2\\lg p - \\lg q" },
            { t: "Use the power law on the middle term.", m: "\\lg 1000 + \\lg p^2 - \\lg q" },
            { t: "Combine the additions with the product law.", m: "\\lg\\left(1000p^2\\right) - \\lg q" },
            { t: "Combine the subtraction with the quotient law.", m: "\\lg\\!\\left(\\frac{1000p^2}{q}\\right)" },
          ],
        },
      ],
    },
    {
      id: "graphs",
      heading: "The graphs and their asymptotes",
      body: [
        {
          k: "p",
          t: "$y = e^x$ and $y = \\ln x$ are inverses, so their graphs are reflections in $y=x$. Each has exactly one asymptote, and stating its equation is worth a mark.",
        },
        {
          k: "plot",
          spec: {
            xRange: [-3, 5],
            yRange: [-3, 5],
            curves: [
              { f: (x: number) => Math.exp(x), label: "y = eˣ", domain: [-3, 1.7] },
              { f: (x: number) => Math.log(x), label: "y = ln x", domain: [0.02, 5], color: 1 },
              { f: (x: number) => x, label: "y = x", color: 3, dashed: true },
            ],
            points: [
              { x: 0, y: 1, label: "(0, 1)" },
              { x: 1, y: 0, label: "(1, 0)" },
            ],
            caption:
              "y = eˣ has the horizontal asymptote y = 0 and passes through (0,1). y = ln x has the vertical asymptote x = 0 and passes through (1,0).",
            height: 360,
          },
        },
        {
          k: "table",
          head: ["Curve", "Asymptote", "Key point", "Domain and range"],
          rows: [
            ["$y = e^x$", "$y=0$", "$(0,1)$", "domain $\\mathbb{R}$, range $y>0$"],
            ["$y = \\ln x$", "$x=0$", "$(1,0)$", "domain $x>0$, range $\\mathbb{R}$"],
            ["$y = ke^{nx} + a$", "$y = a$", "$(0, k+a)$", "range $y>a$ if $k>0$"],
            ["$y = k\\ln(ax+b)$", "$x = -\\dfrac ba$", "cuts $y=0$ where $ax+b=1$", "domain $ax+b>0$"],
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [-2, 3],
            yRange: [-2, 12],
            curves: [{ f: (x: number) => 3 * Math.exp(x) - 2, label: "y = 3eˣ − 2" }],
            hLines: [{ y: -2, label: "y = −2" }],
            points: [{ x: 0, y: 1, label: "(0, 1)" }],
            caption: "Adding a constant shifts the asymptote: y = 3eˣ − 2 approaches y = −2, not y = 0.",
            height: 300,
          },
        },
      ],
    },
    {
      id: "solving",
      heading: "Solving equations",
      body: [
        { k: "p", t: "**Type 1: $a^x = b$.** Take logs of both sides and use the power law." },
        {
          k: "steps",
          items: [
            { t: "Solve $5^{x} = 40$.", m: "\\lg\\left(5^x\\right) = \\lg 40" },
            { t: "Bring the index down.", m: "x \\lg 5 = \\lg 40" },
            { t: "Divide.", m: "x = \\frac{\\lg 40}{\\lg 5} = 2.29 \\ (3\\text{ s.f.})" },
          ],
        },
        { k: "p", t: "**Type 2: logs on both sides.** Combine each side into a single log, then equate the arguments." },
        {
          k: "steps",
          items: [
            { t: "Solve $\\log_3(x+6) - \\log_3(x-2) = 2$. Combine the left with the quotient law.", m: "\\log_3\\!\\left(\\frac{x+6}{x-2}\\right) = 2" },
            { t: "Undo the log using the definition.", m: "\\frac{x+6}{x-2} = 3^2 = 9" },
            { t: "Cross-multiply.", m: "x + 6 = 9x - 18" },
            { t: "Solve.", m: "8x = 24 \\;\\Rightarrow\\; x = 3" },
            { t: "Check the arguments are positive: $x+6=9>0$ and $x-2=1>0$ ✓." },
          ],
        },
        { k: "p", t: "**Type 3: a hidden quadratic.** Any equation with $\\log x$ and $(\\log x)^2$, or $e^x$ and $e^{2x}$, is a quadratic waiting for a substitution." },
        {
          k: "note",
          tone: "tip",
          t: "$\\log_a b = \\dfrac{1}{\\log_b a}$ — a special case of change of base that turns $\\log_x 9 + \\log_9 x$ into a quadratic in one variable.",
        },
      ],
    },
    {
      id: "modelling",
      heading: "Exponential models",
      body: [
        {
          k: "p",
          t: "Growth and decay problems use $N = N_0 e^{kt}$: $N_0$ is the value at $t=0$, $k>0$ gives growth and $k<0$ decay.",
        },
        {
          k: "steps",
          items: [
            { t: "A culture starts at 500 bacteria and doubles in 3 hours. Find $k$, where $N = 500e^{kt}$.", m: "1000 = 500e^{3k}" },
            { t: "Divide.", m: "e^{3k} = 2" },
            { t: "Take natural logs.", m: "3k = \\ln 2" },
            { t: "Solve.", m: "k = \\tfrac13\\ln 2 \\approx 0.231" },
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Definition", latex: "\\log_a b = c \\iff a^c = b", given: false },
    { name: "Product law", latex: "\\log_a x + \\log_a y = \\log_a (xy)", given: false },
    { name: "Quotient law", latex: "\\log_a x - \\log_a y = \\log_a\\!\\left(\\tfrac{x}{y}\\right)", given: false },
    { name: "Power law", latex: "\\log_a\\left(x^k\\right) = k\\log_a x", given: false },
    { name: "Change of base", latex: "\\log_a b = \\frac{\\log_c b}{\\log_c a}", given: false },
    { name: "Reciprocal form", latex: "\\log_a b = \\frac{1}{\\log_b a}", given: false },
    { name: "Inverse pair", latex: "e^{\\ln x} = x, \\qquad \\ln\\left(e^x\\right) = x", given: false },
  ],
  examples: [
    {
      id: "log-ex1",
      title: "Evaluating without a calculator",
      difficulty: "easy",
      prompt: "Find the exact value of $\\log_2 40 - \\log_2 5$.",
      steps: [
        { t: "The quotient law combines the two logs.", m: "\\log_2\\!\\left(\\frac{40}{5}\\right)" },
        { t: "Simplify the argument.", m: "= \\log_2 8" },
        { t: "Ask “2 to what power gives 8?”.", m: "= 3" },
      ],
      answer: "$3$",
    },
    {
      id: "log-ex2",
      title: "An exponential equation",
      difficulty: "medium",
      prompt: "Solve $3^{2x+1} = 7^{x}$, giving your answer to 3 significant figures.",
      steps: [
        { t: "Take logarithms of both sides — any base works; use $\\lg$.", m: "\\lg\\left(3^{2x+1}\\right) = \\lg\\left(7^x\\right)" },
        { t: "Bring both indices down.", m: "(2x+1)\\lg 3 = x\\lg 7" },
        { t: "Expand the left side.", m: "2x\\lg 3 + \\lg 3 = x \\lg 7" },
        { t: "Gather the $x$ terms on one side.", m: "x\\left(2\\lg 3 - \\lg 7\\right) = -\\lg 3" },
        { t: "Divide. Note $2\\lg3 - \\lg7 = \\lg\\frac97 \\approx 0.10914$.", m: "x = \\frac{-\\lg 3}{\\lg\\frac97} \\approx \\frac{-0.47712}{0.10914}" },
        { t: "Evaluate.", m: "x \\approx -4.37" },
      ],
      answer: "$x \\approx -4.37$",
    },
    {
      id: "log-ex3",
      title: "A logarithmic quadratic",
      difficulty: "hard",
      prompt: "Solve $\\log_2 x + \\log_x 2 = \\dfrac{5}{2}$.",
      steps: [
        { t: "Change the second term to base 2 using the reciprocal rule.", m: "\\log_x 2 = \\frac{1}{\\log_2 x}" },
        { t: "Let $u = \\log_2 x$.", m: "u + \\frac{1}{u} = \\frac52" },
        { t: "Multiply through by $u$ (valid since $u \\ne 0$).", m: "2u^2 - 5u + 2 = 0" },
        { t: "Factorise.", m: "(2u - 1)(u - 2) = 0 \\;\\Rightarrow\\; u = \\tfrac12 \\text{ or } u = 2" },
        { t: "Convert back: $u = \\log_2 x$ means $x = 2^u$.", m: "x = 2^{1/2} = \\sqrt2 \\quad \\text{or} \\quad x = 2^2 = 4" },
        { t: "Both are positive and neither is 1, so both are valid bases and arguments." },
      ],
      answer: "$x = \\sqrt2$ or $x = 4$.",
    },
    {
      id: "log-ex4",
      title: "Comparing two exponentials",
      difficulty: "olympiad",
      prompt: "Without a calculator, determine which is larger: $2^{100}$ or $3^{60}$.",
      steps: [
        { t: "Direct comparison is hopeless; take logs, which preserve order because $\\lg$ is increasing.", m: "\\lg\\left(2^{100}\\right) = 100\\lg 2, \\qquad \\lg\\left(3^{60}\\right) = 60 \\lg 3" },
        { t: "Compare the two products. Divide both by 20 to keep the numbers small.", m: "5\\lg 2 \\quad \\text{versus} \\quad 3 \\lg 3" },
        { t: "Rewrite each as a single logarithm.", m: "\\lg 32 \\quad \\text{versus} \\quad \\lg 27" },
        { t: "Since $32 > 27$ and $\\lg$ is increasing, the first is larger.", m: "5\\lg 2 > 3\\lg 3" },
        { t: "Multiply back by 20 — a positive factor, so the inequality holds.", m: "2^{100} > 3^{60}" },
      ],
      answer: "$2^{100}$ is larger, because $2^{5}=32 > 27=3^3$ and both sides are twentieth powers of these.",
      remark: "Taking logs turns an impossible comparison into $32$ versus $27$. Reducing to a common exponent is the same trick without the logs.",
    },
  ],
  examQuestions: [
    {
      id: "log-eq1",
      title: "Log laws and a check",
      difficulty: "medium",
      marks: 6,
      paper: 1,
      prompt: "Solve $\\lg(x + 3) + \\lg x = 1$. [6]",
      steps: [
        { t: "Combine the left side with the product law.", m: "\\lg\\left(x(x+3)\\right) = 1" },
        { t: "Undo the base-10 log: $\\lg A = 1$ means $A = 10$.", m: "x^2 + 3x = 10" },
        { t: "Form a quadratic.", m: "x^2 + 3x - 10 = 0" },
        { t: "Factorise.", m: "(x+5)(x-2) = 0 \\;\\Rightarrow\\; x = -5 \\text{ or } x = 2" },
        { t: "Check $x = -5$: it makes $\\lg x = \\lg(-5)$, which does not exist. **Reject**." },
        { t: "Check $x = 2$: $\\lg 5 + \\lg 2 = \\lg 10 = 1$ ✓." },
      ],
      answer: "$x = 2$ only.",
    },
    {
      id: "log-eq2",
      title: "Exponential model with two conditions",
      difficulty: "hard",
      marks: 8,
      paper: 2,
      prompt:
        "The number of insects in a colony is modelled by $N = Ae^{kt}$, where $t$ is in weeks. When $t=2$, $N=800$; when $t=6$, $N=5000$.\n(a) Find $k$ and $A$. [5]\n(b) Find, to the nearest week, when the colony first exceeds 20 000. [3]",
      steps: [
        { t: "(a) Write both conditions.", m: "800 = Ae^{2k}, \\qquad 5000 = Ae^{6k}" },
        { t: "Divide the second by the first — $A$ cancels, which is why this is the first move.", m: "\\frac{5000}{800} = e^{4k} \\;\\Rightarrow\\; e^{4k} = 6.25" },
        { t: "Take natural logs.", m: "4k = \\ln 6.25 \\;\\Rightarrow\\; k = 0.45815\\ldots" },
        { t: "Substitute back to find $A$.", m: "A = \\frac{800}{e^{2(0.45815)}} = \\frac{800}{2.5} = 320" },
        { t: "(b) Solve $320e^{kt} = 20000$.", m: "e^{kt} = 62.5" },
        { t: "Take logs and divide.", m: "t = \\frac{\\ln 62.5}{0.45815} = 9.02\\ldots" },
        { t: "The population first exceeds 20 000 during week 10 — after 9.02 weeks, so by the nearest whole week it is week 9 that ends below and week 10 above.", m: "t \\approx 9 \\text{ weeks (first exceeded during week 10)}" },
      ],
      answer: "(a) $k = \\ln(2.5)/2 \\approx 0.458$, $A = 320$. (b) after about 9.0 weeks.",
    },
  ],
  mistakes: [
    {
      wrong: "$\\log(x+y) = \\log x + \\log y$.",
      why: "The product law applies to a product inside one log, not a sum.",
      fix: "$\\log x + \\log y = \\log(xy)$. There is no law for $\\log(x+y)$.",
    },
    {
      wrong: "$\\dfrac{\\log 8}{\\log 2} = \\log 4$.",
      why: "A quotient of logs is a change of base, not the log of a quotient.",
      fix: "$\\dfrac{\\log 8}{\\log 2} = \\log_2 8 = 3$.",
    },
    {
      wrong: "Keeping a negative root of a log equation.",
      why: "The argument of a logarithm must be positive, so some roots are not solutions of the original equation.",
      fix: "Substitute every root into the original equation and reject any that make an argument zero or negative.",
    },
    {
      wrong: "Writing the asymptote of $y = 3e^x - 2$ as $y = 0$.",
      why: "The vertical shift moves the asymptote with the curve.",
      fix: "For $y = ke^{nx} + a$ the asymptote is $y = a$.",
    },
    {
      wrong: "Solving $e^{2x} - 5e^x + 6 = 0$ by taking logs immediately.",
      why: "Logs cannot be applied term by term across a sum.",
      fix: "Substitute $u = e^x$, solve the quadratic, then take logs of each positive root.",
    },
    {
      wrong: "$\\ln(e^{2x}) = 2\\ln x$.",
      why: "The exponential and the log cancel completely.",
      fix: "$\\ln\\left(e^{2x}\\right) = 2x$.",
    },
  ],
  tips: [
    "Whenever an unknown sits in an index, take logs. Whenever it sits inside a log, exponentiate.",
    "Constants can be absorbed: $2 = \\lg 100 = \\ln e^2 = \\log_3 9$. Choose the base already in the question.",
    "Every log equation needs a validity check, and the check is worth a mark.",
    "$\\ln$ is the natural choice when $e$ appears; $\\lg$ when 10 appears. Mixing them costs nothing but time.",
    "Two data points in an exponential model? Divide one equation by the other — the constant cancels immediately.",
  ],
  generators: ["log-evaluate", "log-single", "log-solve-equation", "exp-solve-ax-b", "exp-growth-model"],
};
