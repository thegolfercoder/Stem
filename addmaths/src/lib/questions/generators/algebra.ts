import type { Generator } from "../engine";
import { frac, quadratic, signed, tol3sf } from "../engine";

/** Generators for units 2-6: quadratics, polynomials, modulus, simultaneous, indices, logs. */
export const algebraGenerators: Generator[] = [
  {
    id: "qf-complete-square",
    topic: "quadratic-functions",
    title: "Completing the square",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.pick([1, 1, 2, 3] as const);
      const p = r.nz(-6, 6);
      const q = r.int(-9, 9);
      const b = 2 * a * p;
      const c = a * p * p + q;
      return {
        prompt: `Write $${quadratic(a, b, c)}$ in the form $a(x+p)^2 + q$ and state the minimum value of the expression.`,
        answer: { kind: "numeric", value: q, tolerance: 1e-9, display: `$${q}$` },
        solution: [
          { t: `Take the factor $${a}$ out of the first two terms only.`, m: `${a}\\left(x^2 ${signed(b / a, "x")}\\right) ${signed(c)}` },
          { t: "Halve the coefficient of $x$ inside the bracket and square it.", m: `x^2 ${signed(b / a, "x")} = (x ${signed(p)})^2 - ${p * p}` },
          { t: "Substitute back and expand the outer bracket only.", m: `${a}(x ${signed(p)})^2 - ${a * p * p} ${signed(c)}` },
          { t: "Simplify.", m: `${a}(x ${signed(p)})^2 ${signed(q)}` },
          { t: `Since the coefficient of the square is positive, the least value occurs when the bracket is zero, at $x = ${-p}$.`, m: `\\text{minimum} = ${q}` },
        ],
      };
    },
  },
  {
    id: "qf-solve-quadratic",
    topic: "quadratic-functions",
    title: "Solve a quadratic equation",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const p = r.nz(-7, 7);
      let q = r.nz(-7, 7);
      for (let i = 0; i < 20 && q === p; i += 1) q = r.nz(-7, 7);
      const a = r.pick([1, 1, 2] as const);
      // a(x - p)(x - q) = a x² - a(p+q) x + a p q
      const b = -a * (p + q);
      const c = a * p * q;
      return {
        prompt: `Solve $${quadratic(a, b, c)} = 0$. Give both roots, separated by a comma.`,
        answer: { kind: "set", values: [p, q], tolerance: 1e-6, display: `$x = ${Math.min(p, q)}$ or $x = ${Math.max(p, q)}$` },
        solution: [
          { t: "Look for two numbers that multiply to give the product of the outer coefficients and add to the middle one — or factorise directly.", m: `${quadratic(a, b, c)} = ${a === 1 ? "" : a}(x ${signed(-p)})(x ${signed(-q)})` },
          { t: "Set each factor equal to zero.", m: `x ${signed(-p)} = 0 \\quad \\text{or} \\quad x ${signed(-q)} = 0` },
          { t: "Solve each.", m: `x = ${p} \\quad \\text{or} \\quad x = ${q}` },
        ],
      };
    },
  },
  {
    id: "qf-discriminant-k",
    topic: "quadratic-functions",
    title: "Discriminant condition",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.int(1, 4);
      const b = r.nz(-8, 8);
      // a x² + b x + k = 0 has equal roots when b² = 4ak, so k = b²/(4a).
      const k = (b * b) / (4 * a);
      return {
        prompt: `The equation $${quadratic(a, b, 0)} + k = 0$ has two equal roots. Find the value of $k$.`,
        answer: { kind: "numeric", value: k, tolerance: 1e-6, display: `$k = ${frac(b * b, 4 * a)}$` },
        solution: [
          { t: "Two equal roots means the discriminant is zero.", m: `b^2 - 4ac = 0` },
          { t: `Here $a = ${a}$, $b = ${b}$ and $c = k$.`, m: `(${b})^2 - 4(${a})k = 0` },
          { t: "Expand.", m: `${b * b} = ${4 * a}k` },
          { t: "Solve.", m: `k = ${frac(b * b, 4 * a)}` },
        ],
      };
    },
  },
  {
    id: "qf-inequality",
    topic: "quadratic-functions",
    title: "Quadratic inequality",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const [p0, q0] = r.pair(-6, 6);
      const p = Math.min(p0, q0);
      const q = Math.max(p0, q0);
      const b = -(p + q);
      const c = p * q;
      const lessThan = r.next() < 0.5;
      const options = [
        `$${p} < x < ${q}$`,
        `$x < ${p}$ or $x > ${q}$`,
        `$x < ${q}$ or $x > ${p}$`,
        `$${q} < x < ${p}$`,
      ];
      const correct = lessThan ? 0 : 1;
      return {
        prompt: `Solve the inequality $${quadratic(1, b, c)} ${lessThan ? "<" : ">"} 0$.\n\nChoose the correct solution set by typing its number:\n1. ${options[0]}\n2. ${options[1]}\n3. ${options[2]}\n4. ${options[3]}`,
        answer: { kind: "mcq", options, correct: correct + 1, display: options[correct]! },
        solution: [
          { t: "Factorise to find the critical values.", m: `(x ${signed(-p)})(x ${signed(-q)}) ${lessThan ? "<" : ">"} 0` },
          { t: "The roots are:", m: `x = ${p}, \\quad x = ${q}` },
          { t: "Sketch an upward parabola cutting the axis at these two points." },
          {
            t: lessThan
              ? "The curve is **below** the axis between the roots."
              : "The curve is **above** the axis outside the roots.",
            m: lessThan ? `${p} < x < ${q}` : `x < ${p} \\quad \\text{or} \\quad x > ${q}`,
          },
        ],
        hint: "Type 1, 2, 3 or 4.",
      };
    },
  },
  {
    id: "qf-tangent-line",
    topic: "quadratic-functions",
    title: "Line tangent to a curve",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const m = r.nz(-5, 5);
      const b = r.nz(-6, 6);
      const c = r.int(-5, 5);
      // y = x² + bx + c meets y = mx + k where x² + (b-m)x + (c-k) = 0.
      // Tangency: (b-m)² = 4(c-k), so k = c - (b-m)²/4.
      const k = c - ((b - m) * (b - m)) / 4;
      return {
        prompt: `The line $y = ${quadratic(0, m, 0)} + k$ is a tangent to the curve $y = ${quadratic(1, b, c)}$. Find the value of $k$.`,
        answer: { kind: "numeric", value: k, tolerance: 1e-6, display: `$k = ${frac(4 * c - (b - m) * (b - m), 4)}$` },
        solution: [
          { t: "Set the two expressions for $y$ equal.", m: `${quadratic(1, b, c)} = ${quadratic(0, m, 0)} + k` },
          { t: "Collect everything on one side.", m: `x^2 ${signed(b - m, "x")} ${signed(c)} - k = 0` },
          { t: "A tangent gives a repeated root, so the discriminant vanishes.", m: `(${b - m})^2 - 4(1)(${c} - k) = 0` },
          { t: "Expand.", m: `${(b - m) * (b - m)} - ${4 * c} + 4k = 0` },
          { t: "Solve for $k$.", m: `k = ${frac(4 * c - (b - m) * (b - m), 4)}` },
        ],
      };
    },
  },

  {
    id: "poly-remainder",
    topic: "factors-of-polynomials",
    title: "Remainder theorem",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const a = r.nz(-3, 3);
      const b = r.nz(-6, 6);
      const c = r.nz(-8, 8);
      const d = r.nz(-9, 9);
      const k = r.nz(-3, 3);
      const value = a * k ** 3 + b * k ** 2 + c * k + d;
      return {
        prompt: `Find the remainder when $P(x) = ${quadratic(0, 0, 0) === "0" ? "" : ""}${a}x^3 ${signed(b, "x^2")} ${signed(c, "x")} ${signed(d)}$ is divided by $(x ${signed(-k)})$.`,
        answer: { kind: "numeric", value, tolerance: 1e-9, display: `$${value}$` },
        solution: [
          { t: `The divisor is zero when $x = ${k}$, so the remainder is $P(${k})$.`, m: `P(${k}) = ${a}(${k})^3 ${signed(b)}(${k})^2 ${signed(c)}(${k}) ${signed(d)}` },
          { t: "Evaluate each term.", m: `= ${a * k ** 3} ${signed(b * k * k)} ${signed(c * k)} ${signed(d)}` },
          { t: "Add.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "poly-factor-check",
    topic: "factors-of-polynomials",
    title: "Is it a factor?",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const k = r.nz(-3, 3);
      const isFactor = r.next() < 0.5;
      const b = r.nz(-5, 5);
      const c = r.nz(-7, 7);
      // P(x) = (x - k)(x² + bx + c) + offset
      const offset = isFactor ? 0 : r.nz(1, 6);
      const p3 = 1;
      const p2 = b - k;
      const p1 = c - k * b;
      const p0 = -k * c + offset;
      const value = offset;
      const options = ["Yes, it is a factor", "No, it is not a factor"];
      return {
        prompt: `Is $(x ${signed(-k)})$ a factor of $P(x) = ${quadratic(0, 0, 0) === "0" ? "" : ""}${p3}x^3 ${signed(p2, "x^2")} ${signed(p1, "x")} ${signed(p0)}$?\n\nType 1 for yes, 2 for no.`,
        answer: { kind: "mcq", options, correct: isFactor ? 1 : 2, display: options[isFactor ? 0 : 1]! },
        solution: [
          { t: `By the factor theorem, evaluate $P(${k})$.`, m: `P(${k}) = ${value}` },
          {
            t: isFactor
              ? "The result is zero, so the bracket **is** a factor."
              : "The result is not zero, so the bracket is **not** a factor — it is the remainder.",
          },
        ],
        hint: "Type 1 or 2.",
      };
    },
  },
  {
    id: "poly-find-coefficient",
    topic: "factors-of-polynomials",
    title: "Find an unknown coefficient",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const k = r.nz(-3, 3);
      const b = r.nz(-6, 6);
      const d = r.nz(-9, 9);
      // P(x) = x³ + a x² + b x + d, with (x - k) a factor: k³ + a k² + b k + d = 0
      const a = -(k ** 3 + b * k + d) / (k * k);
      return {
        prompt: `$(x ${signed(-k)})$ is a factor of $P(x) = x^3 + ax^2 ${signed(b, "x")} ${signed(d)}$. Find $a$.`,
        answer: { kind: "numeric", value: a, tolerance: tol3sf(a || 1), display: `$a = ${frac(-(k ** 3 + b * k + d), k * k)}$` },
        solution: [
          { t: `By the factor theorem $P(${k}) = 0$.`, m: `(${k})^3 + a(${k})^2 ${signed(b)}(${k}) ${signed(d)} = 0` },
          { t: "Evaluate the known terms.", m: `${k ** 3} + ${k * k}a ${signed(b * k)} ${signed(d)} = 0` },
          { t: "Collect the constants.", m: `${k * k}a = ${-(k ** 3 + b * k + d)}` },
          { t: "Divide.", m: `a = ${frac(-(k ** 3 + b * k + d), k * k)}` },
        ],
      };
    },
  },
  {
    id: "poly-solve-cubic",
    topic: "factors-of-polynomials",
    title: "Solve a cubic",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const roots = [r.nz(-4, 4), r.nz(-4, 4), r.nz(-4, 4)];
      const [p, q, s] = roots as [number, number, number];
      const b = -(p + q + s);
      const c = p * q + q * s + p * s;
      const d = -(p * q * s);
      const unique = [...new Set(roots)].sort((x, y) => x - y);
      return {
        prompt: `Solve $x^3 ${signed(b, "x^2")} ${signed(c, "x")} ${signed(d)} = 0$. List the distinct roots, separated by commas.`,
        answer: { kind: "set", values: unique, tolerance: 1e-6, display: `$x = ${unique.join(",\\ ")}$` },
        solution: [
          { t: "Try small values until one gives zero. Testing works because any integer root divides the constant term." , m: `x = ${p} \\text{ gives } 0` },
          { t: `So $(x ${signed(-p)})$ is a factor. Divide, or compare coefficients, to obtain the quadratic factor.`, m: `x^3 ${signed(b, "x^2")} ${signed(c, "x")} ${signed(d)} = (x ${signed(-p)})\\left(x^2 ${signed(-(q + s), "x")} ${signed(q * s)}\\right)` },
          { t: "Factorise the quadratic.", m: `= (x ${signed(-p)})(x ${signed(-q)})(x ${signed(-s)})` },
          { t: "Set each factor to zero.", m: `x = ${unique.join(",\\ ")}` },
        ],
      };
    },
  },

  {
    id: "mod-linear-equation",
    topic: "equations-inequalities-graphs",
    title: "Modulus equation",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(2, 5);
      const b = r.nz(-9, 9);
      const c = r.int(1, 12);
      const x1 = (c - b) / a;
      const x2 = (-c - b) / a;
      return {
        prompt: `Solve $\\left|${quadratic(0, a, b)}\\right| = ${c}$. Give both solutions, separated by a comma.`,
        answer: { kind: "set", values: [x1, x2], tolerance: 1e-6, display: `$x = ${frac(c - b, a)}$ or $x = ${frac(-c - b, a)}$` },
        solution: [
          { t: `The right-hand side is positive, so there are two branches.`, m: `${quadratic(0, a, b)} = ${c} \\quad \\text{or} \\quad ${quadratic(0, a, b)} = ${-c}` },
          { t: "Solve the first.", m: `x = ${frac(c - b, a)}` },
          { t: "Solve the second.", m: `x = ${frac(-c - b, a)}` },
        ],
      };
    },
  },
  {
    id: "mod-inequality",
    topic: "equations-inequalities-graphs",
    title: "Modulus inequality",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.int(1, 4);
      const b = r.nz(-8, 8);
      const c = r.int(2, 10);
      const lo = (-c - b) / a;
      const hi = (c - b) / a;
      const less = r.next() < 0.5;
      const options = [
        `$${frac(-c - b, a)} < x < ${frac(c - b, a)}$`,
        `$x < ${frac(-c - b, a)}$ or $x > ${frac(c - b, a)}$`,
      ];
      return {
        prompt: `Solve $\\left|${quadratic(0, a, b)}\\right| ${less ? "<" : ">"} ${c}$.\n\nType 1 for ${options[0]}, or 2 for ${options[1]}.`,
        answer: { kind: "mcq", options, correct: less ? 1 : 2, display: options[less ? 0 : 1]! },
        solution: [
          {
            t: less
              ? "A “less than” modulus inequality becomes a single sandwich."
              : "A “greater than” modulus inequality splits into two outward pieces.",
            m: less
              ? `${-c} < ${quadratic(0, a, b)} < ${c}`
              : `${quadratic(0, a, b)} > ${c} \\quad \\text{or} \\quad ${quadratic(0, a, b)} < ${-c}`,
          },
          { t: "Solve, remembering that dividing by the positive coefficient keeps the direction.", m: less ? `${frac(-c - b, a)} < x < ${frac(c - b, a)}` : `x > ${frac(c - b, a)} \\quad \\text{or} \\quad x < ${frac(-c - b, a)}` },
          { t: `Numerically the critical values are $${lo.toFixed(3)}$ and $${hi.toFixed(3)}$.` },
        ],
        hint: "Type 1 or 2.",
      };
    },
  },
  {
    id: "sub-quadratic-hidden",
    topic: "equations-inequalities-graphs",
    title: "Hidden quadratic",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      const u1 = r.int(1, 5);
      const u2 = r.int(1, 5);
      const b = -(u1 + u2);
      const c = u1 * u2;
      const roots = [...new Set([u1 * u1, u2 * u2])].sort((a2, b2) => a2 - b2);
      return {
        prompt: `Solve $x ${signed(b, "\\sqrt{x}")} ${signed(c)} = 0$. Give all solutions for $x$, separated by commas.`,
        answer: { kind: "set", values: roots, tolerance: 1e-6, display: `$x = ${roots.join(",\\ ")}$` },
        solution: [
          { t: "Let $u = \\sqrt{x}$, so that $x = u^2$. Note $u \\ge 0$.", m: `u^2 ${signed(b, "u")} ${signed(c)} = 0` },
          { t: "Factorise.", m: `(u - ${u1})(u - ${u2}) = 0` },
          { t: "Both roots are non-negative, so both are valid values of $\\sqrt{x}$.", m: `u = ${u1} \\quad \\text{or} \\quad u = ${u2}` },
          { t: "Square to return to $x$.", m: `x = ${roots.join(" \\quad \\text{or} \\quad x = ")}` },
        ],
      };
    },
  },
  {
    id: "cubic-inequality-roots",
    topic: "equations-inequalities-graphs",
    title: "Roots of a factorised cubic",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.nz(-5, 5);
      let b = r.nz(-5, 5);
      let c = r.nz(-5, 5);
      for (let i = 0; i < 20 && b === a; i += 1) b = r.nz(-5, 5);
      for (let i = 0; i < 20 && (c === a || c === b); i += 1) c = r.nz(-5, 5);
      const yIntercept = -a * -b * -c;
      return {
        prompt: `The curve $y = (x ${signed(-a)})(x ${signed(-b)})(x ${signed(-c)})$ is sketched. Find the $y$-coordinate of the point where it crosses the $y$-axis.`,
        answer: { kind: "numeric", value: yIntercept, tolerance: 1e-9, display: `$${yIntercept}$` },
        solution: [
          { t: "The $y$-axis is where $x = 0$. Substitute.", m: `y = (0 ${signed(-a)})(0 ${signed(-b)})(0 ${signed(-c)})` },
          { t: "Evaluate each bracket.", m: `= (${-a})(${-b})(${-c})` },
          { t: "Multiply.", m: `= ${yIntercept}` },
        ],
      };
    },
  },

  {
    id: "sim-line-parabola",
    topic: "simultaneous-equations",
    title: "Line meets a parabola",
    difficulty: "medium",
    marks: 5,
    paper: 1,
    build: (r) => {
      const [x1, x2] = r.pair(-5, 5);
      const m = r.nz(-4, 4);
      const k = r.int(-6, 6);
      // Curve y = x² + bx + c meets y = mx + k at x1 and x2:
      // x² + (b-m)x + (c-k) = 0 with roots x1, x2.
      const b = m - (x1 + x2);
      const c = k + x1 * x2;
      const roots = [x1, x2].sort((p, q) => p - q);
      return {
        prompt: `Solve simultaneously $y = ${quadratic(1, b, c)}$ and $y = ${quadratic(0, m, k)}$. Give the two $x$-values, separated by a comma.`,
        answer: { kind: "set", values: roots, tolerance: 1e-6, display: `$x = ${roots.join(",\\ ")}$` },
        solution: [
          { t: "Both expressions equal $y$, so set them equal.", m: `${quadratic(1, b, c)} = ${quadratic(0, m, k)}` },
          { t: "Collect everything on one side.", m: `x^2 ${signed(b - m, "x")} ${signed(c - k)} = 0` },
          { t: "Factorise.", m: `(x ${signed(-x1)})(x ${signed(-x2)}) = 0` },
          { t: "Read off the roots, then substitute each into the linear equation for its $y$.", m: `x = ${roots[0]} \\quad \\text{or} \\quad x = ${roots[1]}` },
        ],
      };
    },
  },
  {
    id: "sim-line-circle",
    topic: "simultaneous-equations",
    title: "Line meets a circle",
    difficulty: "hard",
    marks: 6,
    paper: 1,
    build: (r) => {
      // Pick two lattice points on a circle centred at the origin.
      const trip = r.pick([
        [3, 4, 5],
        [6, 8, 10],
        [5, 12, 13],
        [8, 15, 17],
      ] as const);
      const [p, q, rad] = trip;
      const A: [number, number] = [p, q];
      const B: [number, number] = [-q, -p];
      // Both lie on x² + y² = rad² only if p²+q² = rad², true; and (-q)²+(-p)² = same.
      const m = (B[1] - A[1]) / (B[0] - A[0]);
      const k = A[1] - m * A[0];
      const roots = [A[0], B[0]].sort((x, y) => x - y);
      return {
        prompt: `Find the $x$-coordinates of the points where the line $y = ${m === 1 ? "x" : m === -1 ? "-x" : `${m}x`}${k === 0 ? "" : signed(k)}$ meets the circle $x^2 + y^2 = ${rad * rad}$. Give both, separated by a comma.`,
        answer: { kind: "set", values: roots, tolerance: 1e-6, display: `$x = ${roots.join(",\\ ")}$` },
        solution: [
          { t: "Substitute the line into the circle to eliminate $y$.", m: `x^2 + \\left(${m}x ${k === 0 ? "" : signed(k)}\\right)^2 = ${rad * rad}` },
          { t: "Expand and collect into a quadratic in $x$." },
          { t: "Solve the quadratic — it factorises, because the intersections are lattice points here.", m: `x = ${roots[0]} \\quad \\text{or} \\quad x = ${roots[1]}` },
          { t: "Check each in the circle equation before writing the coordinate pairs." },
        ],
      };
    },
  },
  {
    id: "sim-product-pair",
    topic: "simultaneous-equations",
    title: "Non-linear pair",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const x = r.nz(1, 6);
      const y = r.nz(1, 6);
      const prod = x * y;
      const sum = x + y;
      const roots = [x, y].sort((a, b) => a - b);
      return {
        prompt: `Solve simultaneously $xy = ${prod}$ and $x + y = ${sum}$, where $x$ and $y$ are positive. Give the two values, separated by a comma.`,
        answer: { kind: "set", values: [...new Set(roots)], tolerance: 1e-6, display: `$${[...new Set(roots)].join(", ")}$` },
        solution: [
          { t: "Make one variable the subject of the linear equation.", m: `y = ${sum} - x` },
          { t: "Substitute into the product equation.", m: `x(${sum} - x) = ${prod}` },
          { t: "Rearrange into a quadratic.", m: `x^2 - ${sum}x + ${prod} = 0` },
          { t: "Factorise.", m: `(x - ${x})(x - ${y}) = 0` },
          { t: "So the two numbers are these, in either order.", m: `x = ${roots[0]},\\ y = ${roots[1]} \\quad \\text{(or the reverse)}` },
        ],
      };
    },
  },

  {
    id: "ind-evaluate",
    topic: "indices-and-surds",
    title: "Evaluate an index expression",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const base = r.pick([4, 8, 9, 16, 25, 27, 32, 64] as const);
      const roots: Record<number, [number, number]> = {
        4: [2, 2],
        8: [2, 3],
        9: [3, 2],
        16: [2, 4],
        25: [5, 2],
        27: [3, 3],
        32: [2, 5],
        64: [2, 6],
      };
      const [b, k] = roots[base]!;
      const num = r.pick([1, 2, 3] as const);
      const negative = r.next() < 0.5;
      const exact = negative ? 1 / b ** num : b ** num;
      return {
        prompt: `Evaluate $${base}^{${negative ? "-" : ""}${num}/${k}}$ without a calculator.`,
        answer: { kind: "numeric", value: exact, tolerance: 1e-6, display: `$${negative ? frac(1, b ** num) : String(b ** num)}$` },
        solution: [
          negative
            ? { t: "A negative index means take the reciprocal first.", m: `${base}^{-${num}/${k}} = \\frac{1}{${base}^{${num}/${k}}}` }
            : { t: "Read the fractional index as root then power." },
          { t: `Take the ${k}th root of $${base}$ first — the numbers stay small.`, m: `\\sqrt[${k}]{${base}} = ${b}` },
          { t: `Now raise to the power ${num}.`, m: `${b}^{${num}} = ${b ** num}` },
          { t: "State the result.", m: `${negative ? frac(1, b ** num) : String(b ** num)}` },
        ],
      };
    },
  },
  {
    id: "ind-equation-same-base",
    topic: "indices-and-surds",
    title: "Index equation with a common base",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const base = r.pick([2, 3, 5] as const);
      const p = r.int(2, 3);
      const q = r.int(1, 3);
      const c1 = r.nz(-4, 4);
      const c2 = r.nz(-4, 4);
      // base^(p(x + c1)) = base^(q(x + c2))  ->  p x + p c1 = q x + q c2.
      // The two indices must differ, or the equation is an identity.
      const pp = p === q ? p + 1 : p;
      const xv = (q * c2 - pp * c1) / (pp - q);
      return {
        prompt: `Solve $${base ** pp}^{\\,x ${signed(c1)}} = ${base ** q}^{\\,x ${signed(c2)}}$.`,
        answer: { kind: "numeric", value: xv, tolerance: 1e-6, display: `$x = ${frac(q * c2 - pp * c1, pp - q)}$` },
        solution: [
          { t: `Write both sides as powers of ${base}.`, m: `\\left(${base}^{${pp}}\\right)^{x ${signed(c1)}} = \\left(${base}^{${q}}\\right)^{x ${signed(c2)}}` },
          { t: "Multiply the indices.", m: `${base}^{${pp}x ${signed(pp * c1)}} = ${base}^{${q}x ${signed(q * c2)}}` },
          { t: "Equal bases means equal indices.", m: `${pp}x ${signed(pp * c1)} = ${q}x ${signed(q * c2)}` },
          { t: "Collect and solve.", m: `${pp - q}x = ${q * c2 - pp * c1} \;\\Rightarrow\; x = ${frac(q * c2 - pp * c1, pp - q)}` },
        ],
      };
    },
  },
  {
    id: "surd-simplify",
    topic: "indices-and-surds",
    title: "Simplify a surd",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const k = r.int(2, 9);
      const inner = r.pick([2, 3, 5, 6, 7, 10] as const);
      const n = k * k * inner;
      return {
        prompt: `Write $\\sqrt{${n}}$ in the form $a\\sqrt{b}$ with $b$ as small as possible. Enter the value of $a$.`,
        answer: { kind: "numeric", value: k, tolerance: 1e-9, display: `$${k}\\sqrt{${inner}}$` },
        solution: [
          { t: "Find the largest square factor.", m: `${n} = ${k * k} \\times ${inner}` },
          { t: "Split the root over the product.", m: `\\sqrt{${n}} = \\sqrt{${k * k}}\\sqrt{${inner}}` },
          { t: "Take the exact root of the square factor.", m: `= ${k}\\sqrt{${inner}}` },
        ],
      };
    },
  },
  {
    id: "surd-rationalise",
    topic: "indices-and-surds",
    title: "Rationalise a denominator",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(2, 6);
      const b = r.pick([2, 3, 5, 7] as const);
      const num = r.int(2, 9);
      const denom = a * a - b;
      const value = (num * a) / denom;
      return {
        prompt: `Write $\\dfrac{${num}}{${a} - \\sqrt{${b}}}$ in the form $p + q\\sqrt{${b}}$. Enter the value of $p$ (to 3 significant figures if not exact).`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$p = ${frac(num * a, denom)}$` },
        solution: [
          { t: `Multiply top and bottom by the conjugate $${a} + \\sqrt{${b}}$.`, m: `\\frac{${num}\\left(${a}+\\sqrt{${b}}\\right)}{\\left(${a}-\\sqrt{${b}}\\right)\\left(${a}+\\sqrt{${b}}\\right)}` },
          { t: "The denominator is a difference of two squares, so the surd disappears.", m: `${a}^2 - ${b} = ${denom}` },
          { t: "Expand the numerator.", m: `= \\frac{${num * a} + ${num}\\sqrt{${b}}}{${denom}}` },
          { t: "Split into the requested form.", m: `p = ${frac(num * a, denom)}, \\qquad q = ${frac(num, denom)}` },
        ],
      };
    },
  },

  {
    id: "log-evaluate",
    topic: "logarithms-exponentials",
    title: "Evaluate a logarithm",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const base = r.pick([2, 3, 4, 5, 10] as const);
      const power = r.int(2, 5);
      const value = power;
      return {
        prompt: `Find the exact value of $\\log_{${base}} ${base ** power}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-9, display: `$${value}$` },
        solution: [
          { t: `Ask: ${base} to what power gives $${base ** power}$?`, m: `${base}^{?} = ${base ** power}` },
          { t: "Write the argument as a power of the base.", m: `${base ** power} = ${base}^{${power}}` },
          { t: "The logarithm returns that index.", m: `\\log_{${base}} ${base ** power} = ${power}` },
        ],
      };
    },
  },
  {
    id: "log-single",
    topic: "logarithms-exponentials",
    title: "Combine into a single logarithm",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(2, 6);
      const b = r.int(2, 6);
      const k = r.int(2, 3);
      const value = (a ** k) / b;
      return {
        prompt: `Write $${k}\\lg ${a} - \\lg ${b}$ as a single logarithm $\\lg N$. Enter the value of $N$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$N = ${frac(a ** k, b)}$` },
        solution: [
          { t: "Apply the power law to the first term.", m: `${k}\\lg ${a} = \\lg ${a}^{${k}} = \\lg ${a ** k}` },
          { t: "Now use the quotient law.", m: `\\lg ${a ** k} - \\lg ${b} = \\lg\\frac{${a ** k}}{${b}}` },
          { t: "Simplify.", m: `N = ${frac(a ** k, b)}` },
        ],
      };
    },
  },
  {
    id: "log-solve-equation",
    topic: "logarithms-exponentials",
    title: "Solve a logarithmic equation",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const base = r.pick([2, 3, 5] as const);
      const k = r.int(1, 3);
      const shift = r.int(1, 6);
      // log_base(x + shift) = k  ->  x = base^k - shift
      const value = base ** k - shift;
      return {
        prompt: `Solve $\\log_{${base}}\\left(x + ${shift}\\right) = ${k}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$x = ${value}$` },
        solution: [
          { t: "Undo the logarithm using its definition.", m: `x + ${shift} = ${base}^{${k}}` },
          { t: "Evaluate the power.", m: `x + ${shift} = ${base ** k}` },
          { t: "Solve.", m: `x = ${value}` },
          { t: `Check the argument is positive: $${value} + ${shift} = ${base ** k} > 0$ ✓.` },
        ],
      };
    },
  },
  {
    id: "exp-solve-ax-b",
    topic: "logarithms-exponentials",
    title: "Solve $a^x = b$",
    difficulty: "medium",
    marks: 3,
    paper: 2,
    build: (r) => {
      const a = r.int(2, 9);
      const b = r.int(3, 400);
      const value = Math.log(b) / Math.log(a);
      return {
        prompt: `Solve $${a}^{x} = ${b}$, giving your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$x = ${value.toFixed(3)}$` },
        solution: [
          { t: "Take logarithms of both sides.", m: `\\lg\\left(${a}^x\\right) = \\lg ${b}` },
          { t: "Bring the index down with the power law.", m: `x\\lg ${a} = \\lg ${b}` },
          { t: "Divide.", m: `x = \\frac{\\lg ${b}}{\\lg ${a}}` },
          { t: "Evaluate.", m: `x = ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "exp-growth-model",
    topic: "logarithms-exponentials",
    title: "Exponential growth model",
    difficulty: "hard",
    marks: 4,
    paper: 2,
    build: (r) => {
      const A = r.int(2, 9) * 100;
      const k = r.int(1, 9) / 20;
      const target = A * r.int(2, 8);
      const value = Math.log(target / A) / k;
      return {
        prompt: `A population is modelled by $N = ${A}e^{${k}t}$, where $t$ is in years. Find the value of $t$ when $N = ${target}$, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$t = ${value.toFixed(3)}$` },
        solution: [
          { t: "Substitute and isolate the exponential.", m: `${target} = ${A}e^{${k}t} \;\\Rightarrow\; e^{${k}t} = ${(target / A).toFixed(4)}` },
          { t: "Take natural logarithms of both sides.", m: `${k}t = \\ln ${(target / A).toFixed(4)}` },
          { t: "Divide.", m: `t = \\frac{\\ln ${(target / A).toFixed(4)}}{${k}}` },
          { t: "Evaluate.", m: `t = ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
];
