import type { Generator } from "../engine";
import { frac, quadratic, signed, tol3sf } from "../engine";

const nCr = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 0; i < k; i += 1) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
};

/** Generators for units 12-14: series, vectors and calculus. */
export const calculusGenerators: Generator[] = [
  {
    id: "bin-coefficient",
    topic: "binomial-expansion",
    title: "Coefficient in an expansion",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const n = r.int(4, 8);
      const a = r.int(1, 3);
      const b = r.nz(-3, 3);
      const term = r.int(1, n - 1);
      // Coefficient of x^term in (a + b x)^n  ->  C(n, term) a^(n-term) b^term
      const value = nCr(n, term) * a ** (n - term) * b ** term;
      return {
        prompt: `Find the coefficient of $x^{${term}}$ in the expansion of $\\left(${a} ${signed(b, "x")}\\right)^{${n}}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Write the general term.", m: `T_{r+1} = \\binom{${n}}{r}(${a})^{${n}-r}\\left(${b}x\\right)^{r}` },
          { t: `The power of $x$ is $r$, so set $r = ${term}$.`, m: `\\binom{${n}}{${term}}(${a})^{${n - term}}(${b})^{${term}}` },
          { t: "Evaluate each factor.", m: `= ${nCr(n, term)} \\times ${a ** (n - term)} \\times ${b ** term}` },
          { t: "Multiply.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "bin-term-independent",
    topic: "binomial-expansion",
    title: "Term independent of $x$",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      // (a x^p + b x^-q)^n, independent term needs n p = r (p + q)
      const p = r.int(1, 2);
      const q = r.int(1, 2);
      const mult = r.int(1, 3);
      const n = mult * (p + q);
      const rIdx = (n * p) / (p + q);
      const a = r.int(1, 3);
      const b = r.nz(-3, 3);
      const value = nCr(n, rIdx) * a ** (n - rIdx) * b ** rIdx;
      const left = a === 1 ? (p === 1 ? "x" : `x^{${p}}`) : `${a}x^{${p}}`;
      const right = `\\frac{${b}}{x^{${q}}}`;
      return {
        prompt: `Find the term independent of $x$ in the expansion of $\\left(${left} + ${right}\\right)^{${n}}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Write the general term.", m: `T_{r+1} = \\binom{${n}}{r}\\left(${left}\\right)^{${n}-r}\\left(${right}\\right)^{r}` },
          { t: "Collect the powers of $x$ into one index.", m: `x^{${p}(${n}-r)}\\,x^{-${q}r} = x^{${p * n} - ${p + q}r}` },
          { t: "“Independent of $x$” means that index is zero.", m: `${p * n} - ${p + q}r = 0 \\;\\Rightarrow\\; r = ${rIdx}` },
          { t: "Substitute back into the general term.", m: `\\binom{${n}}{${rIdx}}(${a})^{${n - rIdx}}(${b})^{${rIdx}} = ${value}` },
        ],
      };
    },
  },
  {
    id: "bin-expand-three",
    topic: "binomial-expansion",
    title: "First three coefficients",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const n = r.int(4, 9);
      const b = r.nz(-4, 4);
      // (1 + b x)^n: coefficient of x² is C(n,2) b²
      const value = nCr(n, 2) * b * b;
      return {
        prompt: `Find the coefficient of $x^2$ in the expansion of $\\left(1 ${signed(b, "x")}\\right)^{${n}}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Write the first three terms of the expansion.", m: `1 + \\binom{${n}}{1}(${b}x) + \\binom{${n}}{2}(${b}x)^2 + \\cdots` },
          { t: "Focus on the $x^2$ term, bracketing the whole of $" + b + "x$ before squaring.", m: `\\binom{${n}}{2}(${b})^2 = ${nCr(n, 2)} \\times ${b * b}` },
          { t: "Multiply.", m: `= ${value}` },
        ],
      };
    },
  },

  {
    id: "prog-ap-term",
    topic: "progressions",
    title: "Term of an arithmetic progression",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const a = r.int(-12, 20);
      const d = r.nz(-9, 9);
      const n = r.int(8, 40);
      const value = a + (n - 1) * d;
      return {
        prompt: `An arithmetic progression has first term ${a} and common difference ${d}. Find the ${n}th term.`,
        answer: { kind: "numeric", value, tolerance: 1e-9, display: `$${value}$` },
        solution: [
          { t: "Use the $n$th-term formula. Note the $n-1$: the first term has had no difference added.", m: `u_n = a + (n-1)d` },
          { t: "Substitute.", m: `u_{${n}} = ${a} + ${n - 1}(${d})` },
          { t: "Evaluate.", m: `= ${a} ${signed((n - 1) * d)} = ${value}` },
        ],
      };
    },
  },
  {
    id: "prog-ap-sum",
    topic: "progressions",
    title: "Sum of an arithmetic progression",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(-10, 25);
      const d = r.nz(-8, 8);
      const n = r.int(10, 40);
      const value = (n / 2) * (2 * a + (n - 1) * d);
      return {
        prompt: `Find the sum of the first ${n} terms of the arithmetic progression with first term ${a} and common difference ${d}.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Use the sum formula, which is given on the exam paper.", m: `S_n = \\frac{n}{2}\\left[2a + (n-1)d\\right]` },
          { t: "Substitute.", m: `S_{${n}} = \\frac{${n}}{2}\\left[2(${a}) + ${n - 1}(${d})\\right]` },
          { t: "Evaluate the bracket.", m: `= \\frac{${n}}{2}\\left[${2 * a + (n - 1) * d}\\right]` },
          { t: "Multiply.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "prog-gp-term",
    topic: "progressions",
    title: "Term of a geometric progression",
    difficulty: "easy",
    marks: 3,
    paper: 2,
    build: (r) => {
      const a = r.int(2, 40);
      const ratio = r.pick([0.5, 1.5, 2, 3, 0.8, 1.2, -2] as const);
      const n = r.int(4, 9);
      const value = a * ratio ** (n - 1);
      return {
        prompt: `A geometric progression has first term ${a} and common ratio ${ratio}. Find the ${n}th term, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Use the $n$th-term formula.", m: `u_n = ar^{n-1}` },
          { t: "Substitute.", m: `u_{${n}} = ${a} \\times (${ratio})^{${n - 1}}` },
          { t: "Evaluate the power first.", m: `(${ratio})^{${n - 1}} = ${(ratio ** (n - 1)).toPrecision(6)}` },
          { t: "Multiply.", m: `= ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "prog-gp-sum",
    topic: "progressions",
    title: "Sum of a geometric progression",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const a = r.int(2, 30);
      const ratio = r.pick([0.5, 1.5, 2, 3, 0.8, 1.25] as const);
      const n = r.int(5, 12);
      const value = (a * (1 - ratio ** n)) / (1 - ratio);
      return {
        prompt: `Find the sum of the first ${n} terms of the geometric progression with first term ${a} and common ratio ${ratio}, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: ratio > 1 ? "Since $r > 1$, use the form that keeps both parts positive." : "Since $|r| < 1$, use this form.", m: ratio > 1 ? `S_n = \\frac{a\\left(r^n - 1\\right)}{r - 1}` : `S_n = \\frac{a\\left(1 - r^n\\right)}{1 - r}` },
          { t: "Substitute.", m: `S_{${n}} = \\frac{${a}\\left(${ratio > 1 ? `${ratio}^{${n}} - 1` : `1 - ${ratio}^{${n}}`}\\right)}{${ratio > 1 ? `${ratio} - 1` : `1 - ${ratio}`}}` },
          { t: "Evaluate the power.", m: `${ratio}^{${n}} = ${(ratio ** n).toPrecision(6)}` },
          { t: "Complete the arithmetic.", m: `= ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "prog-sum-infinity",
    topic: "progressions",
    title: "Sum to infinity",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(2, 40);
      const num = r.int(1, 4);
      const den = r.int(num + 1, 9);
      const ratio = num / den;
      const value = a / (1 - ratio);
      return {
        prompt: `A geometric progression has first term ${a} and common ratio $${frac(num, den)}$. Find its sum to infinity, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "First check convergence: the sum to infinity exists only when $|r| < 1$.", m: `\\left|${frac(num, den)}\\right| = ${ratio.toFixed(4)} < 1 \\ \\checkmark` },
          { t: "Apply the formula.", m: `S_\\infty = \\frac{a}{1-r} = \\frac{${a}}{1 - ${frac(num, den)}}` },
          { t: "Simplify the denominator.", m: `1 - ${frac(num, den)} = ${frac(den - num, den)}` },
          { t: "Divide.", m: `S_\\infty = ${a} \\times ${frac(den, den - num)} = ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "vec-magnitude",
    topic: "vectors",
    title: "Magnitude of a vector",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const trip = r.pick([
        [3, 4, 5],
        [6, 8, 10],
        [5, 12, 13],
        [8, 15, 17],
        [7, 24, 25],
        [9, 12, 15],
      ] as const);
      const [p, q, mag] = trip;
      const sx = r.sign();
      const sy = r.sign();
      return {
        prompt: `Find the magnitude of the vector $\\begin{pmatrix}${sx * p}\\\\${sy * q}\\end{pmatrix}$.`,
        answer: { kind: "numeric", value: mag, tolerance: 1e-6, display: `$${mag}$` },
        solution: [
          { t: "Square each component and add.", m: `(${sx * p})^2 + (${sy * q})^2 = ${p * p} + ${q * q} = ${p * p + q * q}` },
          { t: "Take the square root.", m: `\\sqrt{${p * p + q * q}} = ${mag}` },
          { t: "Signs disappear on squaring, so the magnitude is always positive." },
        ],
      };
    },
  },
  {
    id: "vec-displacement",
    topic: "vectors",
    title: "Displacement between two points",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const ax = r.int(-8, 8);
      const ay = r.int(-8, 8);
      const bx = r.int(-8, 8);
      const by = r.int(-8, 8);
      const value = Math.hypot(bx - ax, by - ay);
      return {
        prompt: `$A$ has position vector $\\begin{pmatrix}${ax}\\\\${ay}\\end{pmatrix}$ and $B$ has position vector $\\begin{pmatrix}${bx}\\\\${by}\\end{pmatrix}$. Find $\\left|\\overrightarrow{AB}\\right|$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value || 1), display: `$${value.toFixed(3)}$` },
        solution: [
          { t: "Displacement is destination minus start.", m: `\\overrightarrow{AB} = \\mathbf b - \\mathbf a = \\begin{pmatrix}${bx - ax}\\\\${by - ay}\\end{pmatrix}` },
          { t: "Take its magnitude.", m: `\\left|\\overrightarrow{AB}\\right| = \\sqrt{(${bx - ax})^2 + (${by - ay})^2}` },
          { t: "Evaluate.", m: `= \\sqrt{${(bx - ax) ** 2 + (by - ay) ** 2}} = ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "vec-unit-vector",
    topic: "vectors",
    title: "Unit vector",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const trip = r.pick([
        [3, 4, 5],
        [5, 12, 13],
        [8, 15, 17],
        [6, 8, 10],
      ] as const);
      const [p, q, mag] = trip;
      const sx = r.sign();
      const value = (sx * p) / mag;
      return {
        prompt: `Find the $\\mathbf{i}$ component of the unit vector in the direction of $${sx * p}\\mathbf{i} + ${q}\\mathbf{j}$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${frac(sx * p, mag)} = ${value.toFixed(4)}$` },
        solution: [
          { t: "Find the magnitude first.", m: `\\sqrt{${p * p} + ${q * q}} = ${mag}` },
          { t: "Divide the vector by its magnitude.", m: `\\hat{\\mathbf a} = \\frac{1}{${mag}}\\begin{pmatrix}${sx * p}\\\\${q}\\end{pmatrix}` },
          { t: "The $\\mathbf i$ component is therefore:", m: `${frac(sx * p, mag)} = ${value.toFixed(4)}` },
          { t: "Check: the components squared sum to 1, as they must for a unit vector." },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "vec-collision",
    topic: "vectors",
    title: "Time of collision",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      const t = r.int(2, 6);
      const px = r.int(-6, 6);
      const py = r.int(-6, 6);
      const vpx = r.nz(-5, 5);
      const vpy = r.nz(-5, 5);
      const vqx = r.nz(-5, 5);
      const vqy = r.nz(-5, 5);
      // Q starts wherever it must, so that both are at the same point at time t.
      // The two horizontal velocities must differ, or the i components never meet.
      const vqx2 = vpx === vqx ? vqx + 1 : vqx;
      const qy = py + t * vpy - t * vqy;
      const qx2 = px + t * vpx - t * vqx2;
      return {
        prompt: `Particle $P$ starts at $\\begin{pmatrix}${px}\\\\${py}\\end{pmatrix}$ with velocity $\\begin{pmatrix}${vpx}\\\\${vpy}\\end{pmatrix}$. Particle $Q$ starts at $\\begin{pmatrix}${qx2}\\\\${qy}\\end{pmatrix}$ with velocity $\\begin{pmatrix}${vqx2}\\\\${vqy}\\end{pmatrix}$. They collide. Find the time $t$ at which this happens.`,
        answer: { kind: "numeric", value: t, tolerance: 1e-6, display: `$t = ${t}$` },
        solution: [
          { t: "Write each position at time $t$ using $\\mathbf r = \\mathbf r_0 + t\\mathbf v$.", m: `\\mathbf r_P = \\begin{pmatrix}${px} + ${vpx}t\\\\${py} + ${vpy}t\\end{pmatrix}, \\quad \\mathbf r_Q = \\begin{pmatrix}${qx2} + ${vqx2}t\\\\${qy} + ${vqy}t\\end{pmatrix}` },
          { t: "Equate the $\\mathbf i$ components.", m: `${px} + ${vpx}t = ${qx2} + ${vqx2}t` },
          { t: "Solve for $t$.", m: `${vpx - vqx2}t = ${qx2 - px} \\;\\Rightarrow\\; t = ${t}` },
          { t: "Check the $\\mathbf j$ components give the same time — without that check, the paths may cross without a collision.", m: `${py} + ${vpy}(${t}) = ${py + vpy * t}, \\qquad ${qy} + ${vqy}(${t}) = ${qy + vqy * t} \\ \\checkmark` },
        ],
      };
    },
  },

  {
    id: "diff-power-rule",
    topic: "differentiation",
    title: "Differentiate a power expression",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(-6, 6);
      const n = r.int(2, 5);
      const b = r.nz(-8, 8);
      const x0 = r.nz(1, 4);
      // y = a x^n + b x ; dy/dx = a n x^(n-1) + b
      const value = a * n * x0 ** (n - 1) + b;
      return {
        prompt: `Given $y = ${a}x^{${n}} ${signed(b, "x")}$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ when $x = ${x0}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Differentiate term by term with the power rule: multiply by the index, then reduce it by one.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${a * n}x^{${n - 1}} ${signed(b)}` },
          { t: `Substitute $x = ${x0}$.`, m: `= ${a * n}(${x0})^{${n - 1}} ${signed(b)}` },
          { t: "Evaluate the power.", m: `= ${a * n} \\times ${x0 ** (n - 1)} ${signed(b)}` },
          { t: "Complete the arithmetic.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "diff-chain-rule",
    topic: "differentiation",
    title: "Chain rule",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(-4, 4);
      const b = r.nz(-6, 6);
      const n = r.int(2, 5);
      const x0 = r.int(0, 4);
      const inside = a * x0 + b;
      const value = n * a * inside ** (n - 1);
      return {
        prompt: `Given $y = \\left(${quadratic(0, a, b)}\\right)^{${n}}$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ when $x = ${x0}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Differentiate the outside function, keeping the inside unchanged.", m: `${n}\\left(${quadratic(0, a, b)}\\right)^{${n - 1}}` },
          { t: "Multiply by the derivative of the inside.", m: `\\times\\ ${a}` },
          { t: "So the derivative is:", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${n * a}\\left(${quadratic(0, a, b)}\\right)^{${n - 1}}` },
          { t: `Substitute $x = ${x0}$, where the bracket is $${inside}$.`, m: `= ${n * a} \\times (${inside})^{${n - 1}} = ${value}` },
        ],
      };
    },
  },
  {
    id: "diff-product-rule",
    topic: "differentiation",
    title: "Product rule",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(-4, 4);
      const b = r.nz(-6, 6);
      const c = r.nz(-4, 4);
      const d = r.nz(-6, 6);
      const x0 = r.int(-3, 3);
      // y = (ax+b)(cx+d);  y' = a(cx+d) + c(ax+b)
      const value = a * (c * x0 + d) + c * (a * x0 + b);
      return {
        prompt: `Given $y = \\left(${quadratic(0, a, b)}\\right)\\left(${quadratic(0, c, d)}\\right)$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ when $x = ${x0}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Set out the parts before substituting anything.", m: `u = ${quadratic(0, a, b)}, \\quad v = ${quadratic(0, c, d)}` },
          { t: "Differentiate each.", m: `u' = ${a}, \\qquad v' = ${c}` },
          { t: "Apply the product rule $uv' + vu'$.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${a}\\left(${quadratic(0, c, d)}\\right) + ${c}\\left(${quadratic(0, a, b)}\\right)` },
          { t: `Substitute $x = ${x0}$.`, m: `= ${a}(${c * x0 + d}) + ${c}(${a * x0 + b}) = ${value}` },
        ],
      };
    },
  },
  {
    id: "diff-quotient-rule",
    topic: "differentiation",
    title: "Quotient rule",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const a = r.nz(-4, 4);
      const b = r.nz(-6, 6);
      const c = r.nz(1, 4);
      const d = r.nz(-6, 6);
      let x0 = r.int(-3, 3);
      for (let i = 0; i < 20 && c * x0 + d === 0; i += 1) x0 = r.int(-3, 3);
      const den = c * x0 + d;
      const value = (a * d - b * c) / (den * den);
      return {
        prompt: `Given $y = \\dfrac{${quadratic(0, a, b)}}{${quadratic(0, c, d)}}$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ when $x = ${x0}$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value || 1), display: `$${value.toFixed(4)}$` },
        solution: [
          { t: "Set out the parts.", m: `u = ${quadratic(0, a, b)}, \\quad v = ${quadratic(0, c, d)}, \\quad u' = ${a}, \\quad v' = ${c}` },
          { t: "Apply the quotient rule — bottom times derivative of top **first**.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = \\frac{${a}\\left(${quadratic(0, c, d)}\\right) - ${c}\\left(${quadratic(0, a, b)}\\right)}{\\left(${quadratic(0, c, d)}\\right)^2}` },
          { t: "The numerator simplifies to a constant here, since both parts are linear.", m: `= \\frac{${a * d - b * c}}{\\left(${quadratic(0, c, d)}\\right)^2}` },
          { t: `Substitute $x = ${x0}$, where the denominator is $${den}$.`, m: `= \\frac{${a * d - b * c}}{${den * den}} = ${value.toFixed(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "diff-trig-exp",
    topic: "differentiation",
    title: "Differentiate a trigonometric or exponential function",
    difficulty: "medium",
    marks: 3,
    paper: 2,
    build: (r) => {
      const kind = r.pick(["sin", "cos", "exp", "ln"] as const);
      const a = r.int(2, 5);
      const k = r.int(2, 6);
      const x0 = r.int(1, 3) / 2;
      let value: number;
      let derivative: string;
      let expr: string;
      if (kind === "sin") {
        expr = `${a}\\sin ${k}x`;
        derivative = `${a * k}\\cos ${k}x`;
        value = a * k * Math.cos(k * x0);
      } else if (kind === "cos") {
        expr = `${a}\\cos ${k}x`;
        derivative = `-${a * k}\\sin ${k}x`;
        value = -a * k * Math.sin(k * x0);
      } else if (kind === "exp") {
        expr = `${a}e^{${k}x}`;
        derivative = `${a * k}e^{${k}x}`;
        value = a * k * Math.exp(k * x0);
      } else {
        expr = `${a}\\ln ${k}x`;
        derivative = `\\frac{${a}}{x}`;
        value = a / x0;
      }
      return {
        prompt: `Given $y = ${expr}$, find $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x}$ when $x = ${x0}$ (radians), to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          {
            t:
              kind === "ln"
                ? "Split the logarithm first: $\\ln kx = \\ln k + \\ln x$, so the constant differentiates away."
                : "Differentiate the standard function and multiply by the derivative of the inside (the chain rule).",
            m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${derivative}`,
          },
          { t: `Substitute $x = ${x0}$, working in radians.`, m: `= ${value.toPrecision(6)}` },
          { t: "Round.", m: `\\approx ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures. Radian mode.",
      };
    },
  },

  {
    id: "app-tangent-normal",
    topic: "applications-of-differentiation",
    title: "Gradient of a tangent",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(1, 4);
      const b = r.nz(-8, 8);
      const c = r.int(-6, 6);
      const x0 = r.int(-4, 4);
      const wantNormal = r.next() < 0.4;
      const grad = 2 * a * x0 + b;
      const value = wantNormal ? (grad === 0 ? 0 : -1 / grad) : grad;
      const safe = wantNormal && grad === 0 ? 1 : x0;
      const gradSafe = 2 * a * safe + b;
      const valueSafe = wantNormal ? -1 / gradSafe : gradSafe;
      return {
        prompt: `Find the gradient of the ${wantNormal ? "normal" : "tangent"} to the curve $y = ${quadratic(a, b, c)}$ at the point where $x = ${safe}$${wantNormal ? ", to 3 significant figures" : ""}.`,
        answer: { kind: "numeric", value: valueSafe, tolerance: wantNormal ? tol3sf(valueSafe) : 1e-9, display: `$${wantNormal ? valueSafe.toFixed(4) : valueSafe}$` },
        solution: [
          { t: "Differentiate the curve.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${2 * a}x ${signed(b)}` },
          { t: `Substitute $x = ${safe}$ to get the numerical gradient of the tangent.`, m: `m = ${2 * a}(${safe}) ${signed(b)} = ${gradSafe}` },
          wantNormal
            ? { t: "The normal is perpendicular to the tangent, so take the negative reciprocal.", m: `m_\\perp = -\\frac{1}{${gradSafe}} = ${valueSafe.toFixed(4)}` }
            : { t: "That is the gradient of the tangent.", m: `m = ${gradSafe}` },
          { t: `(Unused value check: the raw tangent gradient at $x=${x0}$ would be $${value === 0 ? 0 : grad}$.)` },
        ],
      };
    },
  },
  {
    id: "app-stationary-points",
    topic: "applications-of-differentiation",
    title: "Find a stationary point",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const p = r.nz(-4, 4);
      let q = r.nz(-4, 4);
      for (let i = 0; i < 20 && q === p; i += 1) q = r.nz(-4, 4);
      // y' = 3(x - p)(x - q) = 3x² - 3(p+q)x + 3pq  ->  y = x³ - 1.5(p+q)x² + 3pq x
      const b = -3 * (p + q);
      const c = 3 * p * q;
      const roots = [p, q].sort((x, y) => x - y);
      return {
        prompt: `Find the $x$-coordinates of the stationary points of $y = x^3 ${signed(b / 2, "x^2")} ${signed(c, "x")}$. Give both, separated by a comma.`,
        answer: { kind: "set", values: roots, tolerance: 1e-6, display: `$x = ${roots.join(",\\ ")}$` },
        solution: [
          { t: "Differentiate.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = 3x^2 ${signed(b, "x")} ${signed(c)}` },
          { t: "Stationary points have zero gradient.", m: `3x^2 ${signed(b, "x")} ${signed(c)} = 0` },
          { t: "Divide by 3 and factorise.", m: `(x ${signed(-p)})(x ${signed(-q)}) = 0` },
          { t: "Read off the roots.", m: `x = ${roots.join(",\\ ")}` },
        ],
      };
    },
  },
  {
    id: "app-nature-test",
    topic: "applications-of-differentiation",
    title: "Nature of a stationary point",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(-3, 3);
      const b = r.nz(-8, 8);
      const x0 = -b / (2 * a);
      const second = 2 * a;
      const options = ["A maximum", "A minimum"];
      const correct = second < 0 ? 1 : 2;
      return {
        prompt: `The curve $y = ${quadratic(a, b, 0)}$ has a stationary point at $x = ${frac(-b, 2 * a)}$. Use the second derivative to determine its nature.\n\nType 1 for a maximum, 2 for a minimum.`,
        answer: { kind: "mcq", options, correct, display: options[correct - 1]! },
        solution: [
          { t: "Differentiate once.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${2 * a}x ${signed(b)}` },
          { t: "Differentiate again.", m: `\\frac{\\mathrm d^2y}{\\mathrm dx^2} = ${second}` },
          { t: `This is constant and ${second < 0 ? "negative" : "positive"}.` },
          {
            t:
              second < 0
                ? "A negative second derivative means the curve bends downward, so the point is a **maximum**."
                : "A positive second derivative means the curve bends upward, so the point is a **minimum**.",
            m: `x = ${x0.toFixed(4)}`,
          },
        ],
        hint: "Type 1 or 2.",
      };
    },
  },
  {
    id: "app-rates-of-change",
    topic: "applications-of-differentiation",
    title: "Connected rates of change",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      const rate = r.int(1, 9) / 10;
      const rad = r.int(2, 12);
      const shape = r.pick(["sphere-volume", "circle-area", "cube-volume"] as const);
      let value: number;
      let formula: string;
      let derivative: string;
      let label: string;
      if (shape === "sphere-volume") {
        formula = "V = \\tfrac43\\pi r^3";
        derivative = "\\frac{\\mathrm dV}{\\mathrm dr} = 4\\pi r^2";
        value = 4 * Math.PI * rad * rad * rate;
        label = "volume of a sphere, in cm³ s⁻¹,";
      } else if (shape === "circle-area") {
        formula = "A = \\pi r^2";
        derivative = "\\frac{\\mathrm dA}{\\mathrm dr} = 2\\pi r";
        value = 2 * Math.PI * rad * rate;
        label = "area of a circle, in cm² s⁻¹,";
      } else {
        formula = "V = x^3";
        derivative = "\\frac{\\mathrm dV}{\\mathrm dx} = 3x^2";
        value = 3 * rad * rad * rate;
        label = "volume of a cube, in cm³ s⁻¹,";
      }
      const varName = shape === "cube-volume" ? "side" : "radius";
      return {
        prompt: `The ${varName} of ${shape === "cube-volume" ? "a cube" : shape === "circle-area" ? "a circle" : "a sphere"} increases at ${rate} cm s⁻¹. Find the rate of increase of the ${label} at the instant when the ${varName} is ${rad} cm. Give your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Write down what you are given and what you want.", m: `\\frac{\\mathrm d${shape === "cube-volume" ? "x" : "r"}}{\\mathrm dt} = ${rate}` },
          { t: "State the connecting equation.", m: formula },
          { t: "Differentiate it.", m: derivative },
          { t: "Chain the rates together and substitute last.", m: `= ${(value / rate).toPrecision(6)} \\times ${rate} = ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "app-small-increments",
    topic: "applications-of-differentiation",
    title: "Small increments",
    difficulty: "medium",
    marks: 3,
    paper: 2,
    build: (r) => {
      const a = r.int(1, 5);
      const n = r.int(2, 4);
      const x0 = r.int(2, 6);
      const dx = r.int(1, 5) / 100;
      const value = a * n * x0 ** (n - 1) * dx;
      return {
        prompt: `Given $y = ${a}x^{${n}}$, use calculus to find the approximate change in $y$ when $x$ increases from ${x0} to ${x0 + dx}. Give your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Differentiate.", m: `\\frac{\\mathrm dy}{\\mathrm dx} = ${a * n}x^{${n - 1}}` },
          { t: `Evaluate at $x = ${x0}$.`, m: `= ${a * n} \\times ${x0 ** (n - 1)} = ${a * n * x0 ** (n - 1)}` },
          { t: "Use the small-increment approximation.", m: `\\delta y \\approx \\frac{\\mathrm dy}{\\mathrm dx}\\,\\delta x = ${a * n * x0 ** (n - 1)} \\times ${dx}` },
          { t: "Evaluate.", m: `= ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "int-power-rule",
    topic: "integration",
    title: "Integrate a power expression",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(-6, 6);
      const n = r.int(2, 5);
      const b = r.nz(-6, 6);
      const lo = r.int(0, 2);
      const hi = lo + r.int(1, 3);
      const F = (x: number) => (a * x ** (n + 1)) / (n + 1) + (b * x * x) / 2;
      const value = F(hi) - F(lo);
      return {
        prompt: `Evaluate $\\displaystyle\\int_{${lo}}^{${hi}}\\left(${a}x^{${n}} ${signed(b, "x")}\\right)\\mathrm{d}x$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value || 1), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Integrate term by term: add one to the index and divide by the new index.", m: `\\left[\\frac{${a}x^{${n + 1}}}{${n + 1}} ${signed(b / 2, "x^2")}\\right]_{${lo}}^{${hi}}` },
          { t: "Substitute the upper limit.", m: `= ${F(hi).toPrecision(6)}` },
          { t: "Substitute the lower limit.", m: `= ${F(lo).toPrecision(6)}` },
          { t: "Subtract. The constant cancels in a definite integral, so it is omitted.", m: `= ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "int-linear-inside",
    topic: "integration",
    title: "Integrate a function of $ax+b$",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(2, 5);
      const b = r.nz(-6, 6);
      const n = r.int(2, 4);
      const lo = r.int(0, 2);
      const hi = lo + r.int(1, 2);
      const F = (x: number) => (a * x + b) ** (n + 1) / (a * (n + 1));
      const value = F(hi) - F(lo);
      return {
        prompt: `Evaluate $\\displaystyle\\int_{${lo}}^{${hi}}\\left(${quadratic(0, a, b)}\\right)^{${n}}\\,\\mathrm{d}x$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value || 1), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Add one to the index and divide by the new index.", m: `\\frac{\\left(${quadratic(0, a, b)}\\right)^{${n + 1}}}{${n + 1}}` },
          { t: "Then divide by the coefficient of $x$ inside — this reverses the chain rule.", m: `\\left[\\frac{\\left(${quadratic(0, a, b)}\\right)^{${n + 1}}}{${a * (n + 1)}}\\right]_{${lo}}^{${hi}}` },
          { t: "Substitute both limits.", m: `= ${F(hi).toPrecision(6)} - (${F(lo).toPrecision(6)})` },
          { t: "Subtract.", m: `= ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "int-definite",
    topic: "integration",
    title: "Definite integral with a reciprocal",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const k = r.int(2, 9);
      const a = r.int(1, 4);
      const b = r.int(1, 5);
      const lo = r.int(0, 2);
      const hi = lo + r.int(1, 4);
      const F = (x: number) => (k / a) * Math.log(Math.abs(a * x + b));
      const value = F(hi) - F(lo);
      return {
        prompt: `Evaluate $\\displaystyle\\int_{${lo}}^{${hi}} \\frac{${k}}{${quadratic(0, a, b)}}\\,\\mathrm{d}x$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "The integral of $\\frac{1}{ax+b}$ is $\\frac1a\\ln|ax+b|$.", m: `\\left[\\frac{${k}}{${a}}\\ln\\left|${quadratic(0, a, b)}\\right|\\right]_{${lo}}^{${hi}}` },
          { t: "Substitute the upper limit.", m: `= ${frac(k, a)}\\ln ${a * hi + b}` },
          { t: "Substitute the lower limit.", m: `- ${frac(k, a)}\\ln ${a * lo + b}` },
          { t: "Combine with the quotient law and evaluate.", m: `= ${frac(k, a)}\\ln\\frac{${a * hi + b}}{${a * lo + b}} = ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "int-find-constant",
    topic: "integration",
    title: "Find the curve from its gradient",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(-5, 5);
      const b = r.nz(-8, 8);
      const x0 = r.int(-3, 3);
      const y0 = r.int(-9, 9);
      // dy/dx = 2a x + b  ->  y = a x² + b x + c
      const c = y0 - (a * x0 * x0 + b * x0);
      return {
        prompt: `A curve has $\\dfrac{\\mathrm{d}y}{\\mathrm{d}x} = ${quadratic(0, 2 * a, b)}$ and passes through $(${x0}, ${y0})$. Find the constant term of the equation of the curve.`,
        answer: { kind: "numeric", value: c, tolerance: 1e-6, display: `$c = ${c}$` },
        solution: [
          { t: "Integrate the gradient function, remembering the arbitrary constant.", m: `y = ${quadratic(a, b, 0)} + c` },
          { t: "Substitute the given point.", m: `${y0} = ${a}(${x0})^2 ${signed(b)}(${x0}) + c` },
          { t: "Evaluate the known terms.", m: `${y0} = ${a * x0 * x0 + b * x0} + c` },
          { t: "Solve for $c$.", m: `c = ${c}` },
        ],
      };
    },
  },
  {
    id: "int-trig-exp",
    topic: "integration",
    title: "Integrate a trigonometric or exponential function",
    difficulty: "hard",
    marks: 4,
    paper: 2,
    build: (r) => {
      const kind = r.pick(["sin", "cos", "exp"] as const);
      const a = r.int(2, 5);
      const k = r.int(2, 4);
      const hi = r.int(1, 3) / 2;
      let value: number;
      let anti: string;
      let expr: string;
      if (kind === "sin") {
        expr = `${a}\\sin ${k}x`;
        anti = `-\\frac{${a}}{${k}}\\cos ${k}x`;
        value = (-a / k) * Math.cos(k * hi) - (-a / k) * Math.cos(0);
      } else if (kind === "cos") {
        expr = `${a}\\cos ${k}x`;
        anti = `\\frac{${a}}{${k}}\\sin ${k}x`;
        value = (a / k) * Math.sin(k * hi);
      } else {
        expr = `${a}e^{${k}x}`;
        anti = `\\frac{${a}}{${k}}e^{${k}x}`;
        value = (a / k) * Math.exp(k * hi) - a / k;
      }
      return {
        prompt: `Evaluate $\\displaystyle\\int_{0}^{${hi}} ${expr}\\,\\mathrm{d}x$ (radians), to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Integrate the standard function, then divide by the coefficient of $x$ inside.", m: `\\left[${anti}\\right]_{0}^{${hi}}` },
          { t: `Substitute the upper limit $x = ${hi}$, in radians.` },
          { t: "Subtract the value at the lower limit.", m: `= ${value.toPrecision(6)}` },
          { t: "Round.", m: `\\approx ${value.toPrecision(4)}` },
        ],
        hint: "3 significant figures. Radian mode.",
      };
    },
  },

  {
    id: "area-under-curve",
    topic: "applications-of-integration",
    title: "Area under a curve",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.int(1, 4);
      const b = r.int(0, 6);
      const lo = r.int(0, 2);
      const hi = lo + r.int(1, 3);
      const F = (x: number) => (a * x ** 3) / 3 + (b * x * x) / 2;
      const value = F(hi) - F(lo);
      return {
        prompt: `Find the area of the region bounded by the curve $y = ${quadratic(a, b, 0)}$, the $x$-axis, and the lines $x = ${lo}$ and $x = ${hi}$. Give your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: `On $${lo} \\le x \\le ${hi}$ the curve is above the axis (both coefficients are positive), so one integral suffices.`, m: `A = \\int_{${lo}}^{${hi}}\\left(${quadratic(a, b, 0)}\\right)\\mathrm dx` },
          { t: "Integrate.", m: `= \\left[\\frac{${a}x^3}{3} ${signed(b / 2, "x^2")}\\right]_{${lo}}^{${hi}}` },
          { t: "Substitute both limits.", m: `= ${F(hi).toPrecision(6)} - ${F(lo).toPrecision(6)}` },
          { t: "Subtract.", m: `= ${value.toPrecision(4)} \\text{ square units}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "area-between-curves",
    topic: "applications-of-integration",
    title: "Area between a line and a curve",
    difficulty: "hard",
    marks: 6,
    paper: 1,
    build: (r) => {
      const [x1, x2] = r.pair(-4, 4);
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      const m = r.nz(-3, 3);
      const k = r.int(-4, 4);
      // Curve y = x² + bx + c meets line y = mx + k at lo and hi.
      const b = m - (lo + hi);
      const c = k + lo * hi;
      // Area = ∫ (line - curve) = ∫ -(x - lo)(x - hi) dx = (hi - lo)³ / 6
      const value = (hi - lo) ** 3 / 6;
      return {
        prompt: `Find the area enclosed between the line $y = ${quadratic(0, m, k)}$ and the curve $y = ${quadratic(1, b, c)}$. Give your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Find the intersections — these are the limits.", m: `${quadratic(1, b, c)} = ${quadratic(0, m, k)}` },
          { t: "Collect and factorise.", m: `(x ${signed(-lo)})(x ${signed(-hi)}) = 0 \\;\\Rightarrow\\; x = ${lo}, ${hi}` },
          { t: "Between the roots the line is above the parabola, so integrate line minus curve.", m: `A = \\int_{${lo}}^{${hi}}\\left[\\left(${quadratic(0, m, k)}\\right) - \\left(${quadratic(1, b, c)}\\right)\\right]\\mathrm dx` },
          { t: "The integrand is $-(x - a)(x - b)$, whose integral over the roots is $\\frac{(b-a)^3}{6}$.", m: `A = \\frac{(${hi} - (${lo}))^3}{6} = \\frac{${(hi - lo) ** 3}}{6}` },
          { t: "Evaluate.", m: `= ${value.toPrecision(4)} \\text{ square units}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "area-definite-evaluate",
    topic: "applications-of-integration",
    title: "Region crossing the axis",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const p = r.int(1, 4);
      // y = x(x - p)² is zero at 0 and p; alternatively use y = x³ - p² x, which crosses.
      const F = (x: number) => x ** 4 / 4 - (p * p * x * x) / 2;
      const areaRight = Math.abs(F(p) - F(0));
      const value = 2 * areaRight;
      return {
        prompt: `Find the total area enclosed between the curve $y = x^3 - ${p * p}x$ and the $x$-axis. Give your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "Find where the curve meets the axis.", m: `x\\left(x^2 - ${p * p}\\right) = 0 \\;\\Rightarrow\\; x = ${-p}, 0, ${p}` },
          { t: "The curve is above the axis on one side and below on the other, so the two pieces must be handled separately." },
          { t: `Integrate from 0 to ${p}.`, m: `\\left[\\frac{x^4}{4} - \\frac{${p * p}x^2}{2}\\right]_{0}^{${p}} = ${(F(p) - F(0)).toPrecision(6)}` },
          { t: "Take the absolute value, and use symmetry: the other piece has the same area.", m: `A = 2 \\times ${areaRight.toPrecision(6)}` },
          { t: "Total.", m: `= ${value.toPrecision(4)} \\text{ square units}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "kin-differentiate",
    topic: "kinematics",
    title: "Velocity and acceleration from displacement",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(1, 4);
      const b = r.nz(-9, 9);
      const c = r.nz(-9, 9);
      const t0 = r.int(1, 5);
      const wantAcc = r.next() < 0.5;
      const v = 3 * a * t0 * t0 + 2 * b * t0 + c;
      const acc = 6 * a * t0 + 2 * b;
      const value = wantAcc ? acc : v;
      return {
        prompt: `A particle has displacement $s = ${a}t^3 ${signed(b, "t^2")} ${signed(c, "t")}$ metres. Find its ${wantAcc ? "acceleration, in m s⁻²," : "velocity, in m s⁻¹,"} when $t = ${t0}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Differentiate the displacement to get the velocity.", m: `v = \\frac{\\mathrm ds}{\\mathrm dt} = ${3 * a}t^2 ${signed(2 * b, "t")} ${signed(c)}` },
          wantAcc
            ? { t: "Differentiate again for the acceleration.", m: `a = \\frac{\\mathrm dv}{\\mathrm dt} = ${6 * a}t ${signed(2 * b)}` }
            : { t: `Substitute $t = ${t0}$.`, m: `v = ${3 * a}(${t0})^2 ${signed(2 * b)}(${t0}) ${signed(c)}` },
          { t: `Substitute $t = ${t0}$ and evaluate.`, m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "kin-integrate",
    topic: "kinematics",
    title: "Displacement from velocity",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.nz(1, 5);
      const b = r.nz(-8, 8);
      const t0 = r.int(2, 6);
      // v = 2a t + b, starting at the origin, so s = a t² + b t
      const value = a * t0 * t0 + b * t0;
      return {
        prompt: `A particle starts at the origin with velocity $v = ${quadratic(0, 2 * a, b)}$ m s⁻¹. Find its displacement, in metres, when $t = ${t0}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Integrate the velocity to get displacement, remembering the constant.", m: `s = ${a}t^2 ${signed(b, "t")} + c` },
          { t: "The particle starts at the origin, so $s = 0$ when $t = 0$.", m: `c = 0` },
          { t: `Substitute $t = ${t0}$.`, m: `s = ${a}(${t0})^2 ${signed(b)}(${t0})` },
          { t: "Evaluate.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "kin-at-rest",
    topic: "kinematics",
    title: "When is the particle at rest?",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const t1 = r.int(1, 5);
      let t2 = r.int(1, 7);
      for (let i = 0; i < 20 && t2 === t1; i += 1) t2 = r.int(1, 7);
      const a = r.int(1, 3);
      // v = a(t - t1)(t - t2)
      const b = -a * (t1 + t2);
      const c = a * t1 * t2;
      const roots = [t1, t2].sort((x, y) => x - y);
      return {
        prompt: `A particle has velocity $v = ${quadratic(a, b, c)}$ m s⁻¹ for $t \\ge 0$. Find the times, in seconds, at which it is instantaneously at rest. Give both, separated by a comma.`,
        answer: { kind: "set", values: roots, tolerance: 1e-6, display: `$t = ${roots.join(",\\ ")}$` },
        solution: [
          { t: "“At rest” means the velocity is zero.", m: `${quadratic(a, b, c)} = 0` },
          { t: `Divide by ${a} and factorise.`, m: `(t - ${t1})(t - ${t2}) = 0` },
          { t: "Both roots are non-negative, so both are valid times.", m: `t = ${roots.join(" \\quad \\text{and} \\quad t = ")}` },
          { t: "Between these two times the velocity has the opposite sign, so the particle is travelling backwards." },
        ],
      };
    },
  },
  {
    id: "kin-distance-travelled",
    topic: "kinematics",
    title: "Distance travelled",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      const T = r.int(4, 9);
      const turn = r.int(1, T - 1);
      // v = k(turn - t) so the particle reverses at t = turn.
      const k = r.int(1, 4);
      const S = (t: number) => k * (turn * t - (t * t) / 2);
      const leg1 = Math.abs(S(turn) - S(0));
      const leg2 = Math.abs(S(T) - S(turn));
      const value = leg1 + leg2;
      const displacement = Math.abs(S(T) - S(0));
      return {
        prompt: `A particle starts at the origin with velocity $v = ${k * turn} - ${k}t$ m s⁻¹. Find the total distance travelled, in metres, in the first ${T} seconds.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toPrecision(4)}$` },
        solution: [
          { t: "First find where the velocity changes sign — the particle turns round there.", m: `${k * turn} - ${k}t = 0 \\;\\Rightarrow\\; t = ${turn}` },
          { t: "Integrate the velocity for displacement, with $s = 0$ at $t=0$.", m: `s = ${k * turn}t - ${frac(k, 2)}t^2` },
          { t: "Displacement over the first leg.", m: `s(${turn}) = ${S(turn).toPrecision(6)}` },
          { t: "Displacement change over the second leg, taken as a positive distance.", m: `|s(${T}) - s(${turn})| = ${leg2.toPrecision(6)}` },
          { t: "Add the legs.", m: `${leg1.toPrecision(6)} + ${leg2.toPrecision(6)} = ${value.toPrecision(4)}` },
          { t: `Note the displacement is only $${displacement.toPrecision(4)}$ m — distance and displacement differ whenever the particle turns round.` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
];
