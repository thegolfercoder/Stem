import type { Topic } from "@/lib/types";

export const kinematics: Topic = {
  slug: "kinematics",
  unit: 14,
  title: "Kinematics",
  short: "Kinematics",
  blurb:
    "Displacement, velocity and acceleration linked by calculus — and the difference between distance and displacement.",
  syllabus: [
    { code: "14.14", text: "Apply differentiation and integration to kinematics problems involving displacement, velocity and acceleration of a particle moving in a straight line with variable or constant acceleration." },
    { code: "14.15", text: "Draw and use displacement–time, distance–time, velocity–time, speed–time and acceleration–time graphs." },
  ],
  prerequisites: ["differentiation", "integration"],
  estimatedMinutes: 80,
  sections: [
    {
      id: "the-chain",
      heading: "The chain of three quantities",
      body: [
        { k: "p", t: "Differentiating moves you one way along the chain; integrating moves you back." },
        { k: "math", t: "s \\ \\xrightarrow{\\ \\frac{\\mathrm{d}}{\\mathrm{d}t}\\ } \\ v \\ \\xrightarrow{\\ \\frac{\\mathrm{d}}{\\mathrm{d}t}\\ } \\ a \\qquad\\qquad a \\ \\xrightarrow{\\ \\int \\mathrm{d}t\\ } \\ v \\ \\xrightarrow{\\ \\int \\mathrm{d}t\\ } \\ s" },
        {
          k: "table",
          head: ["Quantity", "Symbol", "From displacement", "From acceleration"],
          rows: [
            ["Displacement", "$s$", "—", "$s = \\int v \\,\\mathrm dt$"],
            ["Velocity", "$v$", "$v = \\dfrac{\\mathrm ds}{\\mathrm dt}$", "$v = \\int a\\,\\mathrm dt$"],
            ["Acceleration", "$a$", "$a = \\dfrac{\\mathrm d^2s}{\\mathrm dt^2}$", "—"],
          ],
        },
        {
          k: "note",
          tone: "warn",
          title: "The constant matters here",
          t: "Every integration introduces a constant, and in kinematics it always has a meaning: the initial velocity or the initial displacement. Questions supply it in words — “starts from rest” means $v=0$ when $t=0$; “from the origin” means $s=0$ when $t=0$.",
        },
      ],
    },
    {
      id: "vocabulary",
      heading: "The vocabulary that decides the method",
      body: [
        {
          k: "table",
          head: ["Phrase", "Means"],
          rows: [
            ["At rest / instantaneously at rest", "$v = 0$"],
            ["Maximum or minimum velocity", "$a = 0$ (differentiate $v$ and solve)"],
            ["Returns to the starting point", "$s = 0$ again"],
            ["Changes direction", "$v$ changes sign, so solve $v = 0$"],
            ["Moving with constant velocity", "$a = 0$ throughout"],
            ["Decelerating", "$a$ has the opposite sign to $v$"],
          ],
        },
        {
          k: "note",
          tone: "key",
          title: "Distance is not displacement",
          t: "**Displacement** is position relative to the start and can be negative. **Distance travelled** counts every metre regardless of direction. If the particle changes direction inside the interval, split at that instant and add the absolute distances — exactly as with areas that cross the axis.",
        },
        {
          k: "p",
          t: "Likewise, **speed** is $|v|$: a velocity of $-6$ m s⁻¹ is a speed of 6 m s⁻¹. A speed–time graph therefore never dips below the axis, while a velocity–time graph may.",
        },
      ],
    },
    {
      id: "graphs",
      heading: "Reading the graphs",
      body: [
        {
          k: "ul",
          items: [
            "**Gradient of a displacement–time graph** = velocity. A horizontal section means the particle is stationary.",
            "**Gradient of a velocity–time graph** = acceleration. A straight line means constant acceleration.",
            "**Area under a velocity–time graph** = displacement (signed — areas below the axis count as negative).",
            "**Area under a speed–time graph** = distance travelled (always positive).",
          ],
        },
        {
          k: "plot",
          spec: {
            xRange: [0, 5],
            yRange: [-8, 10],
            curves: [
              { f: (t: number) => 3 * t * t - 12 * t + 9, label: "v = 3t² − 12t + 9" },
            ],
            points: [
              { x: 1, y: 0, label: "t = 1" },
              { x: 3, y: 0, label: "t = 3" },
            ],
            xLabel: "t",
            yLabel: "v",
            caption:
              "Velocity is zero at t = 1 and t = 3 — the particle changes direction twice. Between them v is negative, so it travels backwards.",
            height: 320,
          },
        },
      ],
    },
    {
      id: "method",
      heading: "The working method",
      body: [
        {
          k: "steps",
          items: [
            { t: "A particle has velocity $v = 3t^2 - 12t + 9$ m s⁻¹ and starts at the origin. Find the acceleration at $t=1$.", m: "a = \\frac{\\mathrm dv}{\\mathrm dt} = 6t - 12 \\;\\Rightarrow\\; a(1) = -6 \\text{ m s}^{-2}" },
            { t: "Find when the particle is instantaneously at rest.", m: "3t^2 - 12t + 9 = 0 \\;\\Rightarrow\\; t^2 - 4t + 3 = 0 \\;\\Rightarrow\\; t = 1, 3" },
            { t: "Find the displacement at time $t$ by integrating, using $s=0$ at $t=0$ to fix the constant.", m: "s = t^3 - 6t^2 + 9t" },
            { t: "For the **distance** travelled in the first 4 seconds, evaluate $s$ at each turning point.", m: "s(0) = 0, \\quad s(1) = 4, \\quad s(3) = 0, \\quad s(4) = 4" },
            { t: "Add the absolute changes leg by leg.", m: "|4-0| + |0-4| + |4-0| = 12 \\text{ m}" },
            { t: "The displacement, by contrast, is just the net change.", m: "s(4) - s(0) = 4 \\text{ m}" },
          ],
        },
        {
          k: "note",
          tone: "tip",
          t: "Distance 12 m against displacement 4 m — the gap is the whole point of the topic. Read the question word by word to see which is being asked for.",
        },
      ],
    },
  ],
  formulas: [
    { name: "Velocity from displacement", latex: "v = \\frac{\\mathrm ds}{\\mathrm dt}", given: false },
    { name: "Acceleration", latex: "a = \\frac{\\mathrm dv}{\\mathrm dt} = \\frac{\\mathrm d^2s}{\\mathrm dt^2}", given: false },
    { name: "Displacement from velocity", latex: "s = \\int v\\,\\mathrm dt", given: false },
    { name: "Velocity from acceleration", latex: "v = \\int a\\,\\mathrm dt", given: false },
    { name: "Distance travelled", latex: "d = \\int_a^b |v|\\,\\mathrm dt", given: false, note: "Split the integral wherever $v$ changes sign." },
    { name: "Speed", latex: "\\text{speed} = |v|", given: false },
  ],
  examples: [
    {
      id: "kin-ex1",
      title: "Differentiating down the chain",
      difficulty: "easy",
      prompt: "A particle moves so that its displacement is $s = 2t^3 - 9t^2 + 12t$ metres. Find its velocity and acceleration at $t = 3$ seconds.",
      steps: [
        { t: "Differentiate for velocity.", m: "v = \\frac{\\mathrm ds}{\\mathrm dt} = 6t^2 - 18t + 12" },
        { t: "Substitute $t=3$.", m: "v = 54 - 54 + 12 = 12 \\text{ m s}^{-1}" },
        { t: "Differentiate again for acceleration.", m: "a = 12t - 18" },
        { t: "Substitute $t=3$.", m: "a = 36 - 18 = 18 \\text{ m s}^{-2}" },
      ],
      answer: "$v = 12$ m s⁻¹ and $a = 18$ m s⁻².",
    },
    {
      id: "kin-ex2",
      title: "Integrating up the chain",
      difficulty: "medium",
      prompt:
        "A particle starts from rest at the origin and moves with acceleration $a = 6 - 2t$ m s⁻². Find expressions for $v$ and $s$, and the maximum velocity.",
      steps: [
        { t: "Integrate the acceleration.", m: "v = 6t - t^2 + c_1" },
        { t: "“Starts from rest” means $v = 0$ at $t=0$.", m: "c_1 = 0 \\;\\Rightarrow\\; v = 6t - t^2" },
        { t: "Integrate again.", m: "s = 3t^2 - \\frac{t^3}{3} + c_2" },
        { t: "“At the origin” means $s=0$ at $t=0$.", m: "c_2 = 0 \\;\\Rightarrow\\; s = 3t^2 - \\frac{t^3}{3}" },
        { t: "Maximum velocity occurs when the acceleration is zero.", m: "6 - 2t = 0 \\;\\Rightarrow\\; t = 3" },
        { t: "Substitute into $v$.", m: "v = 18 - 9 = 9 \\text{ m s}^{-1}" },
      ],
      answer: "$v = 6t - t^2$, $s = 3t^2 - \\dfrac{t^3}{3}$; maximum velocity 9 m s⁻¹ at $t=3$ s.",
    },
    {
      id: "kin-ex3",
      title: "Distance versus displacement",
      difficulty: "hard",
      prompt:
        "A particle has velocity $v = 4 - t$ m s⁻¹ for $0 \\le t \\le 8$ and starts at the origin. Find (a) its displacement after 8 s, (b) the total distance travelled.",
      steps: [
        { t: "(a) Integrate the velocity, with $s=0$ at $t=0$.", m: "s = 4t - \\frac{t^2}{2}" },
        { t: "Substitute $t=8$.", m: "s = 32 - 32 = 0 \\text{ m}" },
        { t: "So the particle has returned to its starting point — the displacement is zero." },
        { t: "(b) For the distance, find where the velocity changes sign.", m: "4 - t = 0 \\;\\Rightarrow\\; t = 4" },
        { t: "Displacement over the first leg.", m: "s(4) = 16 - 8 = 8 \\text{ m}" },
        { t: "Over the second leg it moves back the same amount.", m: "|s(8) - s(4)| = |0 - 8| = 8 \\text{ m}" },
        { t: "Add the two legs.", m: "8 + 8 = 16 \\text{ m}" },
      ],
      answer: "(a) $0$ m. (b) $16$ m.",
      remark: "A displacement of zero with a distance of 16 m: the particle went out 8 m and came back. Answering (b) with the integral straight from 0 to 8 would give 0.",
    },
    {
      id: "kin-ex4",
      title: "Two particles",
      difficulty: "olympiad",
      prompt:
        "Particle $P$ starts at the origin with velocity $v_P = 3t^2$ m s⁻¹. Particle $Q$ starts 16 m ahead, at rest, with acceleration $a_Q = 6t$ m s⁻². Find when $P$ overtakes $Q$.",
      steps: [
        { t: "Find $s_P$ by integrating, with $s_P = 0$ at $t=0$.", m: "s_P = t^3" },
        { t: "For $Q$, integrate the acceleration first; it starts at rest.", m: "v_Q = 3t^2 + c = 3t^2" },
        { t: "Integrate again, using $s_Q = 16$ at $t=0$.", m: "s_Q = t^3 + 16" },
        { t: "Overtaking requires equal displacements.", m: "t^3 = t^3 + 16" },
        { t: "This has no solution: the two are never in the same place.", m: "0 = 16 \\ \\text{(impossible)}" },
        { t: "The reason is visible in the velocities: $v_P = v_Q = 3t^2$ at every instant, so the 16 m gap never closes.", m: "s_Q - s_P = 16 \\text{ for all } t" },
      ],
      answer: "$P$ never overtakes $Q$: the two have identical velocities at all times, so the gap stays at 16 m.",
      remark: "Setting up the equations properly reveals the answer that guessing would miss — the impossibility is the result, not a mistake.",
    },
  ],
  examQuestions: [
    {
      id: "kin-eq1",
      title: "Full kinematics analysis",
      difficulty: "hard",
      marks: 10,
      paper: 2,
      prompt:
        "A particle moves in a straight line so that its velocity is $v = 3t^2 - 16t + 20$ m s⁻¹ for $t \\ge 0$. When $t=0$ the particle is at the origin.\n(a) Find the times at which the particle is instantaneously at rest. [3]\n(b) Find the acceleration when $t = 2$. [2]\n(c) Find the distance travelled in the first 4 seconds. [5]",
      steps: [
        { t: "(a) Set $v=0$.", m: "3t^2 - 16t + 20 = 0" },
        { t: "Factorise.", m: "(3t - 10)(t - 2) = 0" },
        { t: "Solve.", m: "t = 2 \\text{ s} \\quad \\text{and} \\quad t = \\tfrac{10}{3} \\text{ s}" },
        { t: "(b) Differentiate.", m: "a = 6t - 16 \\;\\Rightarrow\\; a(2) = -4 \\text{ m s}^{-2}" },
        { t: "(c) Integrate for displacement, with $s=0$ at $t=0$.", m: "s = t^3 - 8t^2 + 20t" },
        { t: "Evaluate at each key time.", m: "s(0)=0,\\quad s(2) = 16, \\quad s\\!\\left(\\tfrac{10}{3}\\right) = \\tfrac{1000}{27} - \\tfrac{800}{9} + \\tfrac{200}{3} = \\tfrac{400}{27}" },
        { t: "And at the end of the interval.", m: "s(4) = 64 - 128 + 80 = 16" },
        { t: "Add the absolute changes over the three legs.", m: "|16-0| + \\left|\\tfrac{400}{27} - 16\\right| + \\left|16 - \\tfrac{400}{27}\\right|" },
        { t: "Each of the last two is $\\frac{32}{27}$.", m: "16 + \\tfrac{32}{27} + \\tfrac{32}{27} = 16 + \\tfrac{64}{27} \\approx 18.4 \\text{ m}" },
      ],
      answer: "(a) $t=2$ s and $t=\\tfrac{10}{3}$ s. (b) $-4$ m s⁻². (c) about $18.4$ m.",
    },
    {
      id: "kin-eq2",
      title: "From acceleration to position",
      difficulty: "medium",
      marks: 7,
      paper: 2,
      prompt:
        "A particle moves with acceleration $a = 4\\sin 2t$ m s⁻². When $t=0$ its velocity is $2$ m s⁻¹ and it is at the origin.\n(a) Find $v$ in terms of $t$. [3]\n(b) Find $s$ in terms of $t$. [4]",
      steps: [
        { t: "(a) Integrate the acceleration, dividing by the coefficient inside.", m: "v = -2\\cos 2t + c_1" },
        { t: "Apply $v = 2$ at $t=0$, where $\\cos 0 = 1$.", m: "2 = -2 + c_1 \\;\\Rightarrow\\; c_1 = 4" },
        { t: "So the velocity is:", m: "v = 4 - 2\\cos 2t" },
        { t: "(b) Integrate again.", m: "s = 4t - \\sin 2t + c_2" },
        { t: "Apply $s=0$ at $t=0$, where $\\sin 0 = 0$.", m: "0 = 0 - 0 + c_2 \\;\\Rightarrow\\; c_2 = 0" },
        { t: "So the displacement is:", m: "s = 4t - \\sin 2t" },
      ],
      answer: "(a) $v = 4 - 2\\cos 2t$. (b) $s = 4t - \\sin 2t$.",
    },
  ],
  mistakes: [
    { wrong: "Omitting the constant when integrating acceleration or velocity.", why: "It carries the initial condition, which the question always supplies.", fix: "Write $+c$, then use “starts from rest” or “from the origin” to evaluate it." },
    { wrong: "Giving displacement when the question asks for distance travelled.", why: "They differ whenever the particle changes direction.", fix: "Solve $v=0$, split the interval, and add the absolute displacements of each leg." },
    { wrong: "Finding maximum velocity by setting $v=0$.", why: "$v=0$ is where the particle is at rest, not where it is fastest.", fix: "Maximum velocity is where $a = \\frac{\\mathrm dv}{\\mathrm dt} = 0$." },
    { wrong: "Treating a negative velocity as a negative speed.", why: "Speed is a magnitude and is never negative.", fix: "Speed $= |v|$. A velocity of $-5$ is a speed of 5." },
    { wrong: "Using the constant-acceleration formulas $v = u + at$ and so on.", why: "They are only valid when $a$ is constant, and in this topic it usually is not.", fix: "Use calculus. It works in both cases." },
  ],
  tips: [
    "Differentiate to go down the chain ($s \\to v \\to a$), integrate to come back up. Draw the arrows at the top of your page.",
    "Translate the question's wording first: “at rest” is $v=0$, “maximum velocity” is $a=0$, “returns to start” is $s=0$.",
    "For distance travelled, always check whether $v$ changes sign in the interval. If it does, you must split.",
    "The area under a velocity–time graph is displacement; under a speed–time graph, distance. That is the same split, drawn.",
    "Units earn marks: m s⁻¹ for velocity, m s⁻² for acceleration.",
  ],
  generators: ["kin-differentiate", "kin-integrate", "kin-at-rest", "kin-distance-travelled"],
};
