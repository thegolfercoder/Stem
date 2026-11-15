import type { Topic } from "@/lib/types";

export const binomialExpansion: Topic = {
  slug: "binomial-expansion",
  unit: 12,
  title: "Binomial expansion",
  short: "Binomial",
  blurb:
    "Expanding $(a+b)^n$ for positive integer $n$, and picking out one term without expanding the rest.",
  syllabus: [
    { code: "12.1", text: "Use the binomial theorem for expansion of $(a+b)^n$ for positive integer $n$, including simplification of coefficients.", notes: "The formula is given in the List of formulas." },
    { code: "12.2", text: "Use the general term $\\binom{n}{r}a^{n-r}b^r$, $0 \\le r \\le n$, e.g. to find the term independent of $x$.", notes: "Greatest term and properties of the coefficients are not required." },
  ],
  prerequisites: ["permutations-combinations", "indices-and-surds"],
  estimatedMinutes: 75,
  sections: [
    {
      id: "theorem",
      heading: "The theorem",
      body: [
        { k: "p", t: "Multiplying out $(a+b)^n$ by hand is hopeless past $n=3$. The binomial theorem writes the answer down directly." },
        { k: "math", t: "(a+b)^n = a^n + \\binom{n}{1}a^{n-1}b + \\binom{n}{2}a^{n-2}b^2 + \\cdots + \\binom{n}{r}a^{n-r}b^r + \\cdots + b^n" },
        {
          k: "note",
          tone: "key",
          title: "Read the pattern",
          t: "The powers of $a$ count **down** from $n$ to $0$; the powers of $b$ count **up** from $0$ to $n$. In every term the two powers add to $n$ — the fastest check there is. There are $n+1$ terms in total.",
        },
        {
          k: "p",
          t: "The coefficients $\\binom{n}{r} = {}^nC_r$ are the entries of Pascal's triangle. For small $n$ the triangle is quicker than the formula:",
        },
        {
          k: "table",
          head: ["$n$", "Coefficients"],
          rows: [
            ["$0$", "1"],
            ["$1$", "1  1"],
            ["$2$", "1  2  1"],
            ["$3$", "1  3  3  1"],
            ["$4$", "1  4  6  4  1"],
            ["$5$", "1  5  10  10  5  1"],
            ["$6$", "1  6  15  20  15  6  1"],
          ],
        },
      ],
    },
    {
      id: "brackets",
      heading: "Expanding carefully",
      body: [
        {
          k: "note",
          tone: "warn",
          title: "Bracket everything",
          t: "When $b$ is $-2x$ or $\\frac{3}{x}$, put it in brackets before raising to a power. $(-2x)^3 = -8x^3$, not $-2x^3$, and $\\left(\\frac{3}{x}\\right)^2 = \\frac{9}{x^2}$.",
        },
        {
          k: "steps",
          items: [
            { t: "Expand $(2 - 3x)^4$. Use Pascal's row 1, 4, 6, 4, 1 with $a=2$ and $b=-3x$.", m: "\\sum \\binom{4}{r}(2)^{4-r}(-3x)^r" },
            { t: "Term by term, keeping every bracket.", m: "2^4 + 4(2)^3(-3x) + 6(2)^2(-3x)^2 + 4(2)(-3x)^3 + (-3x)^4" },
            { t: "Evaluate each power.", m: "= 16 + 4(8)(-3x) + 6(4)(9x^2) + 8(-27x^3) + 81x^4" },
            { t: "Simplify.", m: "= 16 - 96x + 216x^2 - 216x^3 + 81x^4" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "The signs must alternate when $b$ is negative. If they do not, a bracket has been dropped.",
        },
      ],
    },
    {
      id: "general-term",
      heading: "The general term",
      body: [
        {
          k: "p",
          t: "Most exam questions want **one** term, not the whole expansion. The general term is the tool:",
        },
        { k: "math", t: "T_{r+1} = \\binom{n}{r} a^{n-r} b^{r}" },
        {
          k: "ol",
          items: [
            "Write the general term with the actual $a$ and $b$ substituted.",
            "Collect the powers of $x$ into a single index.",
            "Set that index equal to the power you want — $0$ for “the term independent of $x$”.",
            "Solve for $r$, then substitute back to get the coefficient.",
          ],
        },
        {
          k: "steps",
          items: [
            { t: "Find the term independent of $x$ in $\\left(2x + \\dfrac{1}{x^2}\\right)^{9}$. Write the general term.", m: "T_{r+1} = \\binom{9}{r}(2x)^{9-r}\\left(x^{-2}\\right)^{r}" },
            { t: "Separate the constants from the powers of $x$.", m: "= \\binom{9}{r} 2^{9-r} x^{9-r} x^{-2r}" },
            { t: "Add the indices.", m: "= \\binom{9}{r}2^{9-r} x^{9-3r}" },
            { t: "Independent of $x$ means the index is zero.", m: "9 - 3r = 0 \\;\\Rightarrow\\; r = 3" },
            { t: "Substitute $r=3$.", m: "\\binom{9}{3}2^{6} = 84 \\times 64" },
            { t: "Evaluate.", m: "= 5376" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "If solving for $r$ gives a fraction or a value outside $0 \\le r \\le n$, that term does not exist — and saying so is the correct answer.",
        },
      ],
    },
    {
      id: "products",
      heading: "Coefficients in a product",
      body: [
        {
          k: "p",
          t: "A common question multiplies an expansion by a short bracket: “find the coefficient of $x^2$ in $(1+3x)(2-x)^6$”. Expand only as far as you need, then collect the pairs of terms whose powers add to the one you want.",
        },
        {
          k: "steps",
          items: [
            { t: "Expand $(2-x)^6$ as far as $x^2$.", m: "2^6 + \\binom{6}{1}2^5(-x) + \\binom{6}{2}2^4(-x)^2 = 64 - 192x + 240x^2" },
            { t: "To get $x^2$ from the product, pair the $1$ with the $x^2$ term, and the $3x$ with the $x$ term.", m: "1\\times 240x^2 + 3x \\times (-192x)" },
            { t: "Combine.", m: "240 - 576 = -336" },
          ],
        },
      ],
    },
  ],
  formulas: [
    { name: "Binomial theorem", latex: "(a+b)^n = \\sum_{r=0}^{n}\\binom{n}{r}a^{n-r}b^r", given: true, note: "Printed in the List of formulas, with $\\binom{n}{r} = \\frac{n!}{(n-r)!\\,r!}$." },
    { name: "General term", latex: "T_{r+1} = \\binom{n}{r}a^{n-r}b^r", given: false, note: "Note the $r+1$: $r=0$ gives the first term." },
    { name: "Binomial coefficient", latex: "\\binom{n}{r} = \\frac{n!}{r!\\,(n-r)!}", given: true },
    { name: "Symmetry", latex: "\\binom{n}{r} = \\binom{n}{n-r}", given: false },
  ],
  examples: [
    {
      id: "bin-ex1",
      title: "A full expansion",
      difficulty: "easy",
      prompt: "Expand $(1 + 2x)^5$, simplifying the coefficients.",
      steps: [
        { t: "Pascal's row for $n=5$ is 1, 5, 10, 10, 5, 1, with $a=1$ and $b=2x$." },
        { t: "Write each term, bracketing $2x$.", m: "1 + 5(2x) + 10(2x)^2 + 10(2x)^3 + 5(2x)^4 + (2x)^5" },
        { t: "Evaluate the powers.", m: "= 1 + 10x + 10(4x^2) + 10(8x^3) + 5(16x^4) + 32x^5" },
        { t: "Simplify.", m: "= 1 + 10x + 40x^2 + 80x^3 + 80x^4 + 32x^5" },
      ],
      answer: "$1 + 10x + 40x^2 + 80x^3 + 80x^4 + 32x^5$",
    },
    {
      id: "bin-ex2",
      title: "One coefficient from a large expansion",
      difficulty: "medium",
      prompt: "Find the coefficient of $x^4$ in the expansion of $\\left(3x - \\dfrac{2}{x}\\right)^{8}$.",
      steps: [
        { t: "Write the general term.", m: "T_{r+1} = \\binom{8}{r}(3x)^{8-r}\\left(-\\frac{2}{x}\\right)^{r}" },
        { t: "Separate constants and powers.", m: "= \\binom{8}{r}3^{8-r}(-2)^r x^{8-r}x^{-r}" },
        { t: "Combine the indices.", m: "= \\binom{8}{r}3^{8-r}(-2)^r x^{8-2r}" },
        { t: "Set the index to 4.", m: "8 - 2r = 4 \\;\\Rightarrow\\; r = 2" },
        { t: "Substitute.", m: "\\binom{8}{2}3^{6}(-2)^2 = 28 \\times 729 \\times 4" },
        { t: "Evaluate.", m: "= 81648" },
      ],
      answer: "$81\\,648$",
    },
    {
      id: "bin-ex3",
      title: "Finding $n$ from a coefficient",
      difficulty: "hard",
      prompt: "In the expansion of $(1 + kx)^n$ the coefficient of $x$ is $12$ and the coefficient of $x^2$ is $60$. Find $n$ and $k$, given that $n$ is a positive integer.",
      steps: [
        { t: "Write the first three terms.", m: "1 + nkx + \\frac{n(n-1)}{2}k^2x^2 + \\cdots" },
        { t: "Match the two coefficients.", m: "nk = 12, \\qquad \\frac{n(n-1)}{2}k^2 = 60" },
        { t: "From the first, $k = \\frac{12}{n}$. Substitute into the second.", m: "\\frac{n(n-1)}{2}\\cdot\\frac{144}{n^2} = 60" },
        { t: "Simplify.", m: "\\frac{72(n-1)}{n} = 60" },
        { t: "Cross-multiply and solve.", m: "72n - 72 = 60n \\;\\Rightarrow\\; 12n = 72 \\;\\Rightarrow\\; n = 6" },
        { t: "Back-substitute.", m: "k = \\frac{12}{6} = 2" },
        { t: "Check: $(1+2x)^6$ has $x$ coefficient $12$ ✓ and $x^2$ coefficient $\\binom62 \\times 4 = 60$ ✓." },
      ],
      answer: "$n = 6$, $k = 2$.",
    },
    {
      id: "bin-ex4",
      title: "An approximation",
      difficulty: "olympiad",
      prompt: "By writing $1.02 = 1 + 0.02$, use the first three terms of a binomial expansion to estimate $1.02^{10}$, and comment on the accuracy.",
      steps: [
        { t: "Expand $(1+x)^{10}$ to three terms.", m: "1 + 10x + 45x^2 + \\cdots" },
        { t: "Substitute $x = 0.02$.", m: "1 + 10(0.02) + 45(0.0004)" },
        { t: "Evaluate.", m: "= 1 + 0.2 + 0.018 = 1.218" },
        { t: "The next term is $\\binom{10}{3}x^3 = 120(8\\times10^{-6}) = 0.00096$, so the true value is about $1.219$." },
        { t: "The estimate is therefore accurate to 3 decimal places at worst, because each successive term is roughly a fiftieth of the previous one.", m: "1.02^{10} \\approx 1.219" },
      ],
      answer: "$\\approx 1.218$ from three terms; the true value is $1.21899\\ldots$, so the error is under $0.1\\%$.",
      remark: "Truncating works because $x$ is small: the terms shrink geometrically, and the first omitted term bounds the error.",
    },
  ],
  examQuestions: [
    {
      id: "bin-eq1",
      title: "Expansion and a product",
      difficulty: "medium",
      marks: 7,
      paper: 1,
      prompt:
        "(a) Find the first three terms, in ascending powers of $x$, of the expansion of $(2 - x)^7$. [3]\n(b) Hence find the coefficient of $x^2$ in the expansion of $(3 + 4x)(2-x)^7$. [4]",
      steps: [
        { t: "(a) Use the general term for $r = 0, 1, 2$.", m: "2^7 + \\binom71 2^6(-x) + \\binom72 2^5(-x)^2" },
        { t: "Evaluate each.", m: "= 128 + 7(64)(-x) + 21(32)x^2" },
        { t: "Simplify.", m: "= 128 - 448x + 672x^2" },
        { t: "(b) The $x^2$ term comes from two products: $3 \\times 672x^2$ and $4x \\times (-448x)$." , m: "3(672) + 4(-448)" },
        { t: "Evaluate.", m: "= 2016 - 1792" },
        { t: "Combine.", m: "= 224" },
      ],
      answer: "(a) $128 - 448x + 672x^2$. (b) $224$.",
    },
    {
      id: "bin-eq2",
      title: "Term independent of $x$",
      difficulty: "hard",
      marks: 6,
      paper: 1,
      prompt: "Find the term independent of $x$ in the expansion of $\\left(x^2 - \\dfrac{3}{x}\\right)^{12}$. [6]",
      steps: [
        { t: "Write the general term.", m: "T_{r+1} = \\binom{12}{r}\\left(x^2\\right)^{12-r}\\left(-\\frac{3}{x}\\right)^r" },
        { t: "Split into constants and powers of $x$.", m: "= \\binom{12}{r}(-3)^r x^{24-2r}x^{-r}" },
        { t: "Combine indices.", m: "= \\binom{12}{r}(-3)^r x^{24-3r}" },
        { t: "Set the index to zero.", m: "24 - 3r = 0 \\;\\Rightarrow\\; r = 8" },
        { t: "Substitute. Note $(-3)^8$ is positive.", m: "\\binom{12}{8}(-3)^8 = 495 \\times 6561" },
        { t: "Evaluate.", m: "= 3247695" },
      ],
      answer: "$3\\,247\\,695$",
    },
  ],
  mistakes: [
    { wrong: "Writing $(-2x)^3$ as $-2x^3$.", why: "The index applies to the whole bracket, including the coefficient.", fix: "$(-2x)^3 = -8x^3$. Always bracket before raising." },
    { wrong: "Using $T_r$ instead of $T_{r+1}$.", why: "The general term with index $r$ is the $(r+1)$th term, since $r$ starts at 0.", fix: "For the 5th term, use $r=4$." },
    { wrong: "Forgetting that powers of $a$ decrease while powers of $b$ increase.", why: "Swapping them gives a completely wrong term.", fix: "Check that the two indices add to $n$ in every term." },
    { wrong: "Expanding the whole bracket when only one coefficient is wanted.", why: "It wastes several minutes and multiplies the chances of an arithmetic slip.", fix: "Use the general term and solve for $r$." },
    { wrong: "Losing the sign when $r$ is odd.", why: "$(-3)^7$ is negative but $(-3)^8$ is positive.", fix: "Compute the sign separately: negative base to an odd power is negative." },
  ],
  tips: [
    "For $n \\le 6$, Pascal's triangle is faster than the formula and less error-prone.",
    "Write the general term before doing anything else in a “find the coefficient” question.",
    "Check every term: the powers of $a$ and $b$ must sum to $n$.",
    "The term independent of $x$ is the one where the total index of $x$ is zero — say so in your working.",
    "For a product of brackets, expand only to the power you need. Anything beyond it is wasted time.",
  ],
  generators: ["bin-coefficient", "bin-term-independent", "bin-expand-three"],
};
