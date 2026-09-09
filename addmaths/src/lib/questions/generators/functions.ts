import type { Generator } from "../engine";
import { coef, frac, gcd, quadratic, signed, tol3sf } from "../engine";

export const functionGenerators: Generator[] = [
  {
    id: "fn-domain",
    topic: "functions",
    title: "Largest possible domain",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const kind = r.pick(["root", "recip", "log"] as const);
      const a = r.int(2, 5);
      const b = r.nz(-9, 9);
      if (kind === "recip") {
        const excluded = -b / a;
        return {
          prompt: `The function $f$ is given by $f(x) = \\dfrac{1}{${quadratic(0, a, b)}}$. State the value of $x$ that must be excluded from the domain.`,
          answer: {
            kind: "numeric",
            value: excluded,
            tolerance: 1e-6,
            display: `$x = ${frac(-b, a)}$`,
          },
          solution: [
            { t: "A fraction is undefined where its denominator is zero, so solve the denominator equal to zero.", m: `${quadratic(0, a, b)} = 0` },
            { t: "Rearrange.", m: `x = ${frac(-b, a)}` },
            { t: "Every other real number is allowed, so the domain is all reals except this value." },
          ],
        };
      }
      if (kind === "root") {
        const bound = -b / a;
        return {
          prompt: `The function $f$ is given by $f(x) = \\sqrt{${quadratic(0, a, b)}}$. Find the smallest value of $x$ in its largest possible domain.`,
          answer: {
            kind: "numeric",
            value: bound,
            tolerance: 1e-6,
            display: `$x = ${frac(-b, a)}$`,
          },
          solution: [
            { t: "A square root needs a non-negative argument.", m: `${quadratic(0, a, b)} \\ge 0` },
            { t: "Solve the inequality. Dividing by the positive number $" + a + "$ keeps the inequality the same way round.", m: `x \\ge ${frac(-b, a)}` },
            { t: "So the least permitted value of $x$ is the boundary itself.", m: `x = ${frac(-b, a)}` },
          ],
        };
      }
      const bound = -b / a;
      return {
        prompt: `The function $f$ is given by $f(x) = \\ln(${quadratic(0, a, b)})$. Find the exact lower bound of its largest possible domain (the value $x$ must stay above).`,
        answer: {
          kind: "numeric",
          value: bound,
          tolerance: 1e-6,
          display: `$x > ${frac(-b, a)}$`,
        },
        solution: [
          { t: "A logarithm needs a strictly positive argument.", m: `${quadratic(0, a, b)} > 0` },
          { t: "Solve for $x$.", m: `x > ${frac(-b, a)}` },
          { t: "The bound itself is excluded, because $\\ln 0$ is undefined." },
        ],
      };
    },
  },

  {
    id: "fn-composite",
    topic: "functions",
    title: "Evaluate a composite function",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(-4, 5);
      const b = r.nz(-8, 8);
      const c = r.nz(-3, 4);
      const d = r.nz(-7, 7);
      const x0 = r.int(-3, 4);
      const order = r.pick(["fg", "gf"] as const);
      const f = (x: number) => a * x + b;
      const g = (x: number) => c * x * x + d;
      const inner = order === "fg" ? g(x0) : f(x0);
      const value = order === "fg" ? f(inner) : g(inner);
      return {
        prompt: `Given $f(x) = ${quadratic(0, a, b)}$ and $g(x) = ${quadratic(c, 0, d)}$, find $${order}(${x0})$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          {
            t: `$${order}(x)$ means apply $${order[1]}$ first, then $${order[0]}$. Start with the inner function.`,
            m:
              order === "fg"
                ? `g(${x0}) = ${c}(${x0})^2 ${signed(d)} = ${inner}`
                : `f(${x0}) = ${a}(${x0}) ${signed(b)} = ${inner}`,
          },
          {
            t: "Now feed that number into the outer function.",
            m:
              order === "fg"
                ? `f(${inner}) = ${a}(${inner}) ${signed(b)} = ${value}`
                : `g(${inner}) = ${c}(${inner})^2 ${signed(d)} = ${value}`,
          },
        ],
      };
    },
  },

  {
    id: "fn-inverse-linear-rational",
    topic: "functions",
    title: "Inverse of a rational function",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(1, 5);
      const b = r.nz(-7, 7);
      const c = r.nz(1, 4);
      const d = r.nz(-7, 7);
      // f(x) = (ax + b)/(cx + d). Rather than invert symbolically, the question
      // asks for one value of the inverse, which is a solve.
      let target = r.int(2, 6);
      for (let i = 0; i < 20 && c * target - a === 0; i += 1) target = r.int(2, 6);
      const den2 = c * target - a;
      const val2 = (b - d * target) / den2;
      return {
        prompt: `The function $f$ is defined by $f(x) = \\dfrac{${quadratic(0, a, b)}}{${quadratic(0, c, d)}}$ for $x \\ne ${frac(-d, c)}$. Find $f^{-1}(${target})$, giving your answer to 3 significant figures if it is not exact.`,
        answer: { kind: "numeric", value: val2, tolerance: tol3sf(val2), display: `$${val2.toFixed(3)}$` },
        solution: [
          { t: "Rather than invert the whole function, use the definition: $f^{-1}(k)$ is the value of $x$ with $f(x)=k$.", m: `\\frac{${quadratic(0, a, b)}}{${quadratic(0, c, d)}} = ${target}` },
          { t: "Multiply both sides by the denominator.", m: `${quadratic(0, a, b)} = ${target}\\left(${quadratic(0, c, d)}\\right)` },
          { t: "Expand and gather the $x$ terms on one side.", m: `${a}x ${signed(b)} = ${target * c}x ${signed(target * d)}` },
          { t: "Collect and solve.", m: `x = \\dfrac{${b - target * d}}{${target * c - a}} = ${val2.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "fn-inverse-quadratic",
    topic: "functions",
    title: "Inverse of a restricted quadratic",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const h = r.int(-5, 5);
      const k = r.int(-6, 6);
      // f(x) = (x - h)² + k for x ≥ h, so f⁻¹(x) = h + √(x − k)
      const t = r.int(1, 6);
      const input = k + t * t;
      const value = h + t;
      return {
        prompt: `The function $f$ is defined by $f(x) = (x ${signed(-h)})^2 ${signed(k)}$ for $x \\ge ${h}$. Find $f^{-1}(${input})$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "The domain starts at the vertex, so $f$ is one–one and an inverse exists. Set $f(x)$ equal to the required value.", m: `(x ${signed(-h)})^2 ${signed(k)} = ${input}` },
          { t: "Isolate the square.", m: `(x ${signed(-h)})^2 = ${input - k}` },
          { t: `Take the square root. Because $x \\ge ${h}$, the bracket is non-negative, so take the positive root only.`, m: `x ${signed(-h)} = ${t}` },
          { t: "Solve for $x$.", m: `x = ${value}` },
        ],
      };
    },
  },

  {
    id: "fn-range-quadratic",
    topic: "functions",
    title: "Range of a quadratic on a restricted domain",
    difficulty: "hard",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.pick([1, 1, 2, -1] as const);
      const h = r.int(-4, 4);
      const k = r.int(-6, 6);
      // f(x) = a(x - h)² + k on [lo, hi]; ask for the greatest value.
      const lo = h + r.int(1, 3);
      const hi = lo + r.int(1, 4);
      const fx = (x: number) => a * (x - h) * (x - h) + k;
      // The vertex is left of the interval, so f is monotonic on [lo, hi].
      const values = [fx(lo), fx(hi)];
      const greatest = Math.max(...values);
      const b = -2 * a * h;
      const c = a * h * h + k;
      return {
        prompt: `The function $f$ is defined by $f(x) = ${quadratic(a, b, c)}$ for $${lo} \\le x \\le ${hi}$. Find the greatest value of $f$ on this domain.`,
        answer: { kind: "numeric", value: greatest, tolerance: 1e-6, display: `$${greatest}$` },
        solution: [
          { t: "Complete the square to find the vertex.", m: `f(x) = ${coef(a, `(x ${signed(-h)})^2`)} ${signed(k)}` },
          { t: `The vertex is at $x = ${h}$, which lies outside the interval $[${lo}, ${hi}]$, so $f$ is ${a > 0 ? "increasing" : "decreasing"} across the whole domain.` },
          { t: "So the extreme values occur at the endpoints. Evaluate both.", m: `f(${lo}) = ${fx(lo)}, \\qquad f(${hi}) = ${fx(hi)}` },
          { t: "Take the larger.", m: `\\text{greatest value} = ${greatest}` },
        ],
      };
    },
  },
];

/** Exported for the self-test, which checks the fraction helper stays reduced. */
export const _internals = { gcd };
