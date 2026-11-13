import type { Topic } from "@/lib/types";

export const permutationsCombinations: Topic = {
  slug: "permutations-combinations",
  unit: 11,
  title: "Permutations and combinations",
  short: "Perms & combs",
  blurb:
    "Counting arrangements and selections — and knowing, in one question, which of the two you are being asked for.",
  syllabus: [
    { code: "11.1", text: "Recognise the difference between permutations and combinations and know when each should be used." },
    { code: "11.2", text: "Know and use the notation $n!$ and the expressions for permutations and combinations of $n$ items taken $r$ at a time, including $0! = 1$." },
    {
      code: "11.3",
      text: "Solve problems on arrangement and selection using permutations or combinations.",
      notes: "Problems involving repetition of objects, objects arranged in a circle, or both permutations and combinations together are NOT included.",
    },
  ],
  prerequisites: [],
  estimatedMinutes: 70,
  sections: [
    {
      id: "factorials",
      heading: "Factorials",
      body: [
        { k: "p", t: "$n!$ is the number of ways of arranging $n$ distinct objects in a row." },
        { k: "math", t: "n! = n \\times (n-1) \\times (n-2) \\times \\cdots \\times 2 \\times 1, \\qquad 0! = 1" },
        {
          k: "note",
          tone: "key",
          title: "Why $0! = 1$",
          t: "There is exactly one way to arrange nothing: do nothing. The convention also keeps the permutation and combination formulas working at their edges, which is the practical reason it matters.",
        },
        {
          k: "p",
          t: "Factorials grow ferociously — $10! = 3\\,628\\,800$ — so simplify by cancelling before multiplying: $\\dfrac{10!}{8!} = 10 \\times 9 = 90$.",
        },
      ],
    },
    {
      id: "the-question",
      heading: "Permutation or combination?",
      body: [
        {
          k: "note",
          tone: "key",
          title: "The one question to ask",
          t: "**Does the order matter?** If yes, it is a permutation. If no, it is a combination. Nothing else about the problem changes the answer to that question.",
        },
        {
          k: "table",
          head: ["Situation", "Order matters?", "Use"],
          rows: [
            ["Arranging books on a shelf", "Yes", "$^nP_r$"],
            ["Choosing a committee of 4", "No", "$^nC_r$"],
            ["First, second and third prize", "Yes", "$^nP_r$"],
            ["Choosing 3 pizza toppings", "No", "$^nC_r$"],
            ["A 4-digit PIN from 10 digits, no repeats", "Yes", "$^nP_r$"],
            ["Dealing a hand of 5 cards", "No", "$^nC_r$"],
          ],
        },
        { k: "math", t: "^nP_r = \\frac{n!}{(n-r)!} \\qquad\\qquad ^nC_r = \\binom{n}{r} = \\frac{n!}{r!\\,(n-r)!}" },
        {
          k: "p",
          t: "The relationship between them says exactly what the difference is: $^nP_r = {}^nC_r \\times r!$. Choose the $r$ objects, then arrange them.",
        },
        {
          k: "note",
          tone: "tip",
          title: "Words that signal each",
          t: "Permutation words: *arrange, order, line up, code, timetable, ranked, first/second/third*. Combination words: *choose, select, committee, team, group, hand, subset*.",
        },
      ],
    },
    {
      id: "restrictions",
      heading: "Arrangements with restrictions",
      body: [
        {
          k: "p",
          t: "Almost every exam question adds a condition. Four techniques cover them all.",
        },
        {
          k: "ol",
          items: [
            "**Fill the restricted positions first.** For “5-digit numbers that are even”, choose the last digit first, then fill the rest.",
            "**Block method.** If two people must sit together, glue them into one block, arrange the blocks, then multiply by the arrangements *inside* the block.",
            "**Complement.** “At least one” problems are almost always faster as *total* minus *none*.",
            "**Split into cases.** When a condition creates genuinely different scenarios, count each and add — but check the cases do not overlap.",
          ],
        },
        {
          k: "steps",
          items: [
            { t: "How many arrangements of the 6 letters of $\\texttt{NUMBER}$ have the two vowels together? Treat $\\{$U, E$\\}$ as one block, so there are 5 objects to arrange.", m: "5! = 120" },
            { t: "The two vowels can be ordered within the block in two ways.", m: "2! = 2" },
            { t: "Multiply.", m: "120 \\times 2 = 240" },
          ],
        },
        {
          k: "steps",
          items: [
            { t: "A committee of 4 is chosen from 6 women and 5 men. How many contain at least one man? Count the total first.", m: "^{11}C_4 = 330" },
            { t: "Count the committees with **no** man — all four from the six women.", m: "^6C_4 = 15" },
            { t: "Subtract.", m: "330 - 15 = 315" },
          ],
        },
        {
          k: "note",
          tone: "warn",
          t: "Multiply when steps happen **and then** another step happens; add when the cases are alternatives (**or**). Getting this backwards is the most common structural error in the topic.",
        },
      ],
    },
    {
      id: "syllabus-limits",
      heading: "What is not examined",
      body: [
        {
          k: "p",
          t: "The 0606 syllabus is explicit about three exclusions, which is useful to know — you will never need these methods:",
        },
        {
          k: "ul",
          items: [
            "**Repetition of objects**, such as arrangements of the letters of $\\texttt{BANANA}$.",
            "**Circular arrangements**, such as people around a round table.",
            "Problems requiring **both** permutations and combinations in the same calculation.",
          ],
        },
        {
          k: "note",
          tone: "info",
          t: "If a problem seems to need one of these, re-read it: you have almost certainly misinterpreted the restriction.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Factorial", latex: "n! = n(n-1)(n-2)\\cdots 1, \\quad 0! = 1", given: false },
    { name: "Permutations", latex: "^nP_r = \\frac{n!}{(n-r)!}", given: true, note: "Given via the binomial section of the formula list." },
    { name: "Combinations", latex: "^nC_r = \\frac{n!}{r!(n-r)!}", given: true },
    { name: "Relationship", latex: "^nP_r = {}^nC_r \\times r!", given: false },
    { name: "Symmetry", latex: "^nC_r = {}^nC_{n-r}", given: false, note: "Choosing which $r$ to include is the same as choosing which $n-r$ to leave out." },
  ],
  examples: [
    {
      id: "pc-ex1",
      title: "Straight selection",
      difficulty: "easy",
      prompt: "A team of 5 is chosen from a squad of 12. How many different teams are possible?",
      steps: [
        { t: "Order within a team does not matter, so this is a combination.", m: "^{12}C_5 = \\frac{12!}{5!\\,7!}" },
        { t: "Cancel $7!$ from top and bottom.", m: "= \\frac{12\\times11\\times10\\times9\\times8}{5\\times4\\times3\\times2\\times1}" },
        { t: "Simplify.", m: "= \\frac{95040}{120} = 792" },
      ],
      answer: "$792$ teams.",
    },
    {
      id: "pc-ex2",
      title: "Digits with a restriction",
      difficulty: "medium",
      prompt: "How many 4-digit numbers greater than 5000 can be formed from the digits 1, 2, 3, 5, 7, 8 if no digit may be repeated?",
      steps: [
        { t: "The restriction is on the first digit, so fill that position first. To exceed 5000 it must be 5, 7 or 8.", m: "3 \\text{ choices}" },
        { t: "The remaining three positions are filled from the 5 unused digits, and order matters.", m: "^5P_3 = 5\\times4\\times3 = 60" },
        { t: "Multiply the two stages.", m: "3 \\times 60 = 180" },
      ],
      answer: "$180$ numbers.",
      remark: "Filling the restricted position first is what keeps the count clean. Doing it last forces awkward case-splitting.",
    },
    {
      id: "pc-ex3",
      title: "A committee with two conditions",
      difficulty: "hard",
      prompt:
        "A committee of 5 is chosen from 7 women and 4 men. Find the number of committees containing (a) exactly 2 men, (b) at least 3 women.",
      steps: [
        { t: "(a) Choose 2 of the 4 men, and the remaining 3 places from the 7 women.", m: "^4C_2 \\times {}^7C_3" },
        { t: "Evaluate each.", m: "= 6 \\times 35 = 210" },
        { t: "(b) “At least 3 women” means 3, 4 or 5 women. Count each case separately.", m: "^7C_3\\,{}^4C_2 + {}^7C_4\\,{}^4C_1 + {}^7C_5\\,{}^4C_0" },
        { t: "Evaluate the first two terms.", m: "35\\times6 = 210, \\qquad 35\\times4 = 140" },
        { t: "And the third, using $^4C_0 = 1$.", m: "21 \\times 1 = 21" },
        { t: "Add the three mutually exclusive cases.", m: "210 + 140 + 21 = 371" },
      ],
      answer: "(a) 210. (b) 371.",
    },
    {
      id: "pc-ex4",
      title: "Solving for $n$",
      difficulty: "olympiad",
      prompt: "Given that $^nC_2 = 45$, find $n$. Hence evaluate $^nP_3$.",
      steps: [
        { t: "Write the combination in full.", m: "\\frac{n!}{2!\\,(n-2)!} = 45" },
        { t: "The factorials cancel down to a product of two consecutive integers.", m: "\\frac{n(n-1)}{2} = 45" },
        { t: "Multiply up.", m: "n^2 - n - 90 = 0" },
        { t: "Factorise.", m: "(n-10)(n+9) = 0" },
        { t: "A count cannot be negative, so reject $n = -9$.", m: "n = 10" },
        { t: "Now evaluate the permutation.", m: "^{10}P_3 = 10\\times9\\times8 = 720" },
      ],
      answer: "$n = 10$ and $^{10}P_3 = 720$.",
    },
  ],
  examQuestions: [
    {
      id: "pc-eq1",
      title: "Arrangements of letters with conditions",
      difficulty: "medium",
      marks: 8,
      paper: 2,
      prompt:
        "The letters of the word $\\texttt{PROBLEMS}$ are to be arranged in a row. All eight letters are different.\n(a) How many arrangements are possible? [1]\n(b) How many begin and end with a vowel? [3]\n(c) How many have the two vowels next to each other? [4]",
      steps: [
        { t: "(a) Eight distinct letters in a row.", m: "8! = 40320" },
        { t: "(b) The vowels are O and E. Place them at the two ends — two ways round.", m: "2! = 2" },
        { t: "The remaining six consonants fill the six middle positions.", m: "6! = 720" },
        { t: "Multiply.", m: "2 \\times 720 = 1440" },
        { t: "(c) Glue the vowels into a block, giving seven objects to arrange.", m: "7! = 5040" },
        { t: "Order the two vowels inside the block.", m: "2! = 2" },
        { t: "Multiply.", m: "5040 \\times 2 = 10080" },
      ],
      answer: "(a) 40 320. (b) 1440. (c) 10 080.",
    },
    {
      id: "pc-eq2",
      title: "Selection with a complement",
      difficulty: "hard",
      marks: 7,
      paper: 2,
      prompt:
        "A box contains 5 red, 4 blue and 3 green counters, all distinguishable. Four counters are selected.\n(a) In how many ways can this be done? [2]\n(b) In how many of these are all four the same colour? [2]\n(c) In how many are at least one red and at least one blue selected? [3]",
      steps: [
        { t: "(a) Twelve counters, choose four, order irrelevant.", m: "^{12}C_4 = 495" },
        { t: "(b) Only red (5 counters) and blue (4 counters) have enough for four; green has only 3.", m: "^5C_4 + {}^4C_4 = 5 + 1 = 6" },
        { t: "(c) Use the complement. Let $A$ = “no red” and $B$ = “no blue”. Count selections with no red: choose 4 from the 7 non-red.", m: "^7C_4 = 35" },
        { t: "No blue: choose 4 from the 8 non-blue.", m: "^8C_4 = 70" },
        { t: "Neither red nor blue: all four green — impossible, as there are only 3.", m: "^3C_4 = 0" },
        { t: "By inclusion and exclusion, the number failing the condition is $35 + 70 - 0 = 105$.", m: "495 - 105 = 390" },
      ],
      answer: "(a) 495. (b) 6. (c) 390.",
    },
  ],
  mistakes: [
    {
      wrong: "Using $^nP_r$ for a committee or a team.",
      why: "A committee is a set: swapping two members gives the same committee.",
      fix: "Ask whether re-ordering the chosen items produces a genuinely different outcome. For a committee it does not, so use $^nC_r$.",
    },
    {
      wrong: "Adding when the steps should be multiplied.",
      why: "Sequential choices multiply; alternative cases add.",
      fix: "Read the structure as “and” (multiply) versus “or” (add).",
    },
    {
      wrong: "Forgetting the internal arrangements in the block method.",
      why: "Gluing two items together still leaves them orderable within the block.",
      fix: "Multiply by $2!$ for a block of two, $3!$ for a block of three, and so on.",
    },
    {
      wrong: "Counting “at least one” by adding overlapping cases.",
      why: "The cases usually double-count.",
      fix: "Use total minus none, which never overlaps.",
    },
    {
      wrong: "Filling the unrestricted positions first.",
      why: "It leaves an unknown number of choices for the restricted position.",
      fix: "Always deal with the constrained positions first.",
    },
  ],
  tips: [
    "Write “order matters: yes/no” at the top of the working. It converts most of the difficulty into a one-word decision.",
    "Cancel factorials before evaluating: $\\frac{20!}{18!}$ is $380$, not something your calculator should struggle with.",
    "“At least” almost always means “total − none”.",
    "$^nC_r = {}^nC_{n-r}$ halves the arithmetic: $^{20}C_{17}$ is just $^{20}C_3 = 1140$.",
    "This syllabus excludes repeated letters and circular arrangements, so if you find yourself needing them, re-read the question.",
  ],
  generators: ["pc-nCr-evaluate", "pc-arrangements", "pc-committee", "pc-solve-n"],
};
