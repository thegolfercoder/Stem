import type { Topic } from "@/lib/types";

export const progressions: Topic = {
  slug: "progressions",
  unit: 12,
  title: "Arithmetic and geometric progressions",
  short: "Progressions",
  blurb:
    "Sequences that add a constant or multiply by a constant — the $n$th term, the sum, and when an infinite sum exists.",
  syllabus: [
    { code: "12.3", text: "Recognise arithmetic and geometric progressions and understand the difference between them." },
    { code: "12.4", text: "Use the formulas for the $n$th term and for the sum of the first $n$ terms to solve problems, including problems in context.", notes: "Formulas are given in the List of formulas." },
    { code: "12.5", text: "Use the condition for convergence of a geometric progression and the formula for the sum to infinity, including explaining why a particular progression does or does not have a sum to infinity." },
  ],
  prerequisites: ["quadratic-functions"],
  estimatedMinutes: 90,
  sections: [
    {
      id: "which-is-which",
      heading: "Telling them apart",
      body: [
        {
          k: "p",
          t: "An **arithmetic progression** adds the same number each time; a **geometric progression** multiplies by the same number each time. Test a sequence by taking differences, then ratios.",
        },
        {
          k: "table",
          head: ["", "Arithmetic", "Geometric"],
          rows: [
            ["Step", "add $d$", "multiply by $r$"],
            ["Test", "$u_2-u_1 = u_3-u_2$", "$\\dfrac{u_2}{u_1} = \\dfrac{u_3}{u_2}$"],
            ["$n$th term", "$u_n = a + (n-1)d$", "$u_n = ar^{n-1}$"],
            ["Sum of $n$ terms", "$S_n = \\frac n2\\left[2a + (n-1)d\\right]$", "$S_n = \\dfrac{a(1-r^n)}{1-r}$"],
            ["Infinite sum", "never (unless $d=0$)", "$S_\\infty = \\dfrac{a}{1-r}$ when $|r|<1$"],
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "The $n-1$",
          t: "Both $n$th-term formulas contain $n-1$, not $n$: the first term has had **no** steps applied to it. Putting $n=1$ into either formula must return $a$ — use that as your check.",
        },
      ],
    },
    {
      id: "arithmetic",
      heading: "Arithmetic progressions",
      body: [
        { k: "math", t: "u_n = a + (n-1)d, \\qquad S_n = \\frac{n}{2}\\left[2a + (n-1)d\\right] = \\frac{n}{2}(a + l)" },
        {
          k: "p",
          t: "The second form of $S_n$ — half the number of terms times the sum of the first and last — is often quicker when the last term $l$ is known.",
        },
        {
          k: "steps",
          items: [
            { t: "The 4th term of an AP is 13 and the 9th is 33. Find $a$ and $d$. Write both conditions.", m: "a + 3d = 13, \\qquad a + 8d = 33" },
            { t: "Subtract to eliminate $a$.", m: "5d = 20 \\;\\Rightarrow\\; d = 4" },
            { t: "Back-substitute.", m: "a = 13 - 12 = 1" },
            { t: "So the sum of the first 20 terms is:", m: "S_{20} = \\tfrac{20}{2}\\left[2(1) + 19(4)\\right] = 10(78) = 780" },
          ],
        },
      ],
    },
    {
      id: "geometric",
      heading: "Geometric progressions",
      body: [
        { k: "math", t: "u_n = ar^{n-1}, \\qquad S_n = \\frac{a\\left(1-r^n\\right)}{1-r} = \\frac{a\\left(r^n-1\\right)}{r-1}" },
        {
          k: "note",
          tone: "tip",
          t: "Use the first form when $|r|<1$ and the second when $|r|>1$ — it keeps the numerator and denominator positive and avoids sign slips. The two are algebraically identical.",
        },
        {
          k: "note",
          tone: "key",
          title: "Sum to infinity",
          t: "$S_\\infty = \\dfrac{a}{1-r}$ exists **if and only if** $|r| < 1$. When $|r| \\ge 1$ the terms do not shrink, so the sum grows without limit and no sum to infinity exists. A question asking you to “explain why” wants exactly that sentence, with the value of $r$ quoted.",
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 12],
            yRange: [0, 17],
            curves: [
              { f: (x: number) => 16 * (1 - 0.5 ** x), label: "Sₙ for a=8, r=0.5 → S∞ = 16" },
              { f: (x: number) => 2 * (1.35 ** x - 1) / 0.35, label: "Sₙ for a=2, r=1.35 → diverges", color: 1 },
            ],
            hLines: [{ y: 16, label: "S∞ = 16" }],
            caption: "With |r| < 1 the partial sums close on a limit; with r > 1 they run away.",
            height: 320,
          },
        },
        {
          k: "steps",
          items: [
            { t: "A GP has second term 6 and fifth term $\\tfrac{81}{4}$... in fact $ar = 6$ and $ar^4 = \\tfrac{81}{4}$. Divide the equations.", m: "\\frac{ar^4}{ar} = r^3 = \\frac{81/4}{6} = \\frac{27}{8}" },
            { t: "Take the cube root.", m: "r = \\tfrac32" },
            { t: "Back-substitute.", m: "a = \\frac{6}{3/2} = 4" },
            { t: "Since $|r| > 1$, there is no sum to infinity — the terms grow." },
          ],
        },
      ],
    },
    {
      id: "context",
      heading: "Progressions in context",
      body: [
        {
          k: "p",
          t: "Word problems are the main examination style. Two habits decide the marks:",
        },
        {
          k: "ul",
          items: [
            "**Identify the first term carefully.** “In the first year” usually means $n=1$, but “after one year” often means $n=2$.",
            "**Decide term or sum.** “How much in year 10?” is $u_{10}$. “How much altogether over 10 years?” is $S_{10}$.",
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Salary rising by 5% a year is geometric with $r = 1.05$, not arithmetic. A rise of \\$500 a year is arithmetic with $d = 500$. Read for the word “per cent”.",
        },
        {
          k: "p",
          t: "When solving $S_n > k$ for the number of terms, you will usually need logarithms (geometric) or a quadratic inequality (arithmetic), and the answer must be a whole number — round **up** for “how many are needed”.",
        },
      ],
    },
  ],
  formulas: [
    { name: "AP $n$th term", latex: "u_n = a + (n-1)d", given: true },
    { name: "AP sum", latex: "S_n = \\tfrac{n}{2}\\left[2a + (n-1)d\\right] = \\tfrac{n}{2}(a+l)", given: true },
    { name: "GP $n$th term", latex: "u_n = ar^{n-1}", given: true },
    { name: "GP sum", latex: "S_n = \\frac{a(1-r^n)}{1-r} = \\frac{a(r^n-1)}{r-1}, \\quad r \\ne 1", given: true },
    { name: "Sum to infinity", latex: "S_\\infty = \\frac{a}{1-r}, \\quad |r| < 1", given: true },
  ],
  examples: [
    {
      id: "prog-ex1",
      title: "Basic arithmetic progression",
      difficulty: "easy",
      prompt: "An arithmetic progression has first term 7 and common difference 5. Find the 30th term and the sum of the first 30 terms.",
      steps: [
        { t: "Apply the $n$th-term formula with $n=30$.", m: "u_{30} = 7 + 29(5) = 7 + 145 = 152" },
        { t: "Use the sum formula with the first and last terms.", m: "S_{30} = \\tfrac{30}{2}(7 + 152)" },
        { t: "Evaluate.", m: "= 15 \\times 159 = 2385" },
      ],
      answer: "$u_{30} = 152$, $S_{30} = 2385$.",
    },
    {
      id: "prog-ex2",
      title: "Sum to infinity",
      difficulty: "medium",
      prompt: "A geometric progression has first term 24 and sum to infinity 40. Find the common ratio and the fourth term.",
      steps: [
        { t: "Use the sum-to-infinity formula.", m: "40 = \\frac{24}{1-r}" },
        { t: "Rearrange.", m: "1 - r = \\frac{24}{40} = 0.6" },
        { t: "Solve.", m: "r = 0.4" },
        { t: "Check convergence: $|0.4| < 1$ ✓, so the infinite sum is valid." },
        { t: "Fourth term.", m: "u_4 = 24(0.4)^3 = 24 \\times 0.064 = 1.536" },
      ],
      answer: "$r = 0.4$ and $u_4 = 1.536$.",
    },
    {
      id: "prog-ex3",
      title: "A sequence that is both",
      difficulty: "hard",
      prompt:
        "The first, fourth and thirteenth terms of an arithmetic progression are the first three terms of a geometric progression. The AP has first term 5. Find the common difference of the AP and the common ratio of the GP, given that $d \\ne 0$.",
      steps: [
        { t: "Write the three AP terms.", m: "5, \\quad 5+3d, \\quad 5+12d" },
        { t: "For a GP the ratio of consecutive terms is equal.", m: "\\frac{5+3d}{5} = \\frac{5+12d}{5+3d}" },
        { t: "Cross-multiply.", m: "(5+3d)^2 = 5(5+12d)" },
        { t: "Expand both sides.", m: "25 + 30d + 9d^2 = 25 + 60d" },
        { t: "Collect.", m: "9d^2 - 30d = 0 \\;\\Rightarrow\\; 3d(3d - 10) = 0" },
        { t: "Reject $d=0$ as excluded by the question.", m: "d = \\tfrac{10}{3}" },
        { t: "Find the ratio from the first two GP terms.", m: "r = \\frac{5 + 10}{5} = 3" },
      ],
      answer: "$d = \\dfrac{10}{3}$ and $r = 3$.",
    },
    {
      id: "prog-ex4",
      title: "A recurring decimal as a series",
      difficulty: "olympiad",
      prompt: "Express $0.\\overline{27} = 0.272727\\ldots$ as an exact fraction, using a geometric series.",
      steps: [
        { t: "Write the decimal as a sum.", m: "0.27 + 0.0027 + 0.000027 + \\cdots" },
        { t: "Identify the first term and the ratio.", m: "a = 0.27, \\qquad r = 0.01" },
        { t: "Since $|r| < 1$ the sum to infinity exists.", m: "S_\\infty = \\frac{0.27}{1 - 0.01} = \\frac{0.27}{0.99}" },
        { t: "Multiply top and bottom by 100.", m: "= \\frac{27}{99}" },
        { t: "Cancel the common factor 9.", m: "= \\frac{3}{11}" },
      ],
      answer: "$\\dfrac{3}{11}$",
      remark: "Every recurring decimal is a geometric series, which is why every one of them is rational.",
    },
  ],
  examQuestions: [
    {
      id: "prog-eq1",
      title: "Progressions in context",
      difficulty: "medium",
      marks: 8,
      paper: 2,
      prompt:
        "A company's profit in its first year is \\$45 000. Model A predicts profit rising by \\$4000 each year; model B predicts profit rising by 7% each year.\n(a) Find the profit in year 10 under each model. [4]\n(b) Find the total profit over the first 10 years under model B. [4]",
      steps: [
        { t: "(a) Model A is arithmetic with $a = 45000$ and $d = 4000$.", m: "u_{10} = 45000 + 9(4000) = 81000" },
        { t: "Model B is geometric with $a = 45000$ and $r = 1.07$.", m: "u_{10} = 45000(1.07)^{9}" },
        { t: "Evaluate.", m: "= 45000 \\times 1.83846 = 82730.6" },
        { t: "(b) Use the geometric sum with $r>1$.", m: "S_{10} = \\frac{45000\\left(1.07^{10} - 1\\right)}{1.07 - 1}" },
        { t: "Compute the numerator: $1.07^{10} = 1.96715$.", m: "= \\frac{45000(0.96715)}{0.07}" },
        { t: "Evaluate.", m: "= \\frac{43521.8}{0.07} = 621740" },
      ],
      answer: "(a) A: \\$81 000; B: \\$82 700 (3 s.f.). (b) about \\$622 000.",
    },
    {
      id: "prog-eq2",
      title: "How many terms are needed",
      difficulty: "hard",
      marks: 7,
      paper: 2,
      prompt:
        "A geometric progression has first term 3 and common ratio 1.4.\n(a) Explain why this progression has no sum to infinity. [2]\n(b) Find the least number of terms whose sum exceeds 1000. [5]",
      steps: [
        { t: "(a) A sum to infinity requires $|r| < 1$." , m: "|r| = 1.4 > 1" },
        { t: "The terms increase in size rather than shrinking, so the partial sums grow without limit — no finite sum exists." },
        { t: "(b) Set up the inequality using the $r>1$ form.", m: "\\frac{3\\left(1.4^n - 1\\right)}{0.4} > 1000" },
        { t: "Multiply up and divide by 3.", m: "1.4^n - 1 > \\frac{400}{3} \\;\\Rightarrow\\; 1.4^n > 134.33" },
        { t: "Take logarithms.", m: "n \\lg 1.4 > \\lg 134.33" },
        { t: "Divide — $\\lg 1.4 > 0$, so the inequality direction is unchanged.", m: "n > \\frac{2.12817}{0.14613} = 14.56" },
        { t: "$n$ must be a whole number, so round **up**.", m: "n = 15" },
      ],
      answer: "(a) $|r| = 1.4 \\ge 1$, so the terms do not tend to zero. (b) 15 terms.",
    },
  ],
  mistakes: [
    { wrong: "Using $a + nd$ for the $n$th term.", why: "The first term has had no common difference added.", fix: "$u_n = a + (n-1)d$. Check by putting $n=1$." },
    { wrong: "Applying $S_\\infty$ when $|r| \\ge 1$.", why: "The series diverges, so the formula is meaningless — it can even return a negative 'sum'.", fix: "State the condition $|r|<1$ and check it before using the formula." },
    { wrong: "Treating a percentage increase as arithmetic.", why: "A 6% rise multiplies; it does not add a fixed amount.", fix: "Percentage change ⇒ geometric with $r = 1 + \\frac{p}{100}$." },
    { wrong: "Rounding $n$ down when solving $S_n > k$.", why: "Rounding down gives a sum that is still below the target.", fix: "For “how many are needed”, always round up, then verify with the two nearest integers." },
    { wrong: "Confusing $u_n$ with $S_n$ in a word problem.", why: "One is a single year's value, the other is the running total.", fix: "Underline “in year 10” (term) versus “over 10 years” (sum) before calculating." },
  ],
  tips: [
    "Two facts about a progression give two equations; dividing them (GP) or subtracting them (AP) removes $a$ immediately.",
    "All five formulas are printed on page 2 of the paper — but knowing which to use is not, so practise the identification step.",
    "For a GP with $r>1$ use $\\frac{a(r^n-1)}{r-1}$: both parts stay positive.",
    "“Explain why there is no sum to infinity” needs the value of $r$ and the words “$|r| \\ge 1$, so the terms do not tend to zero”.",
    "A sequence that is both an AP and a GP is a signal to set up a ratio equation and solve a quadratic.",
  ],
  generators: ["prog-ap-term", "prog-ap-sum", "prog-gp-term", "prog-gp-sum", "prog-sum-infinity"],
};
