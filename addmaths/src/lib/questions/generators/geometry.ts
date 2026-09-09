import type { Generator } from "../engine";
import { frac, quadratic, signed, tol3sf } from "../engine";

const PI = Math.PI;

/** Generators for units 7-11: lines, circles, circular measure, trigonometry, counting. */
export const geometryGenerators: Generator[] = [
  {
    id: "line-gradient-equation",
    topic: "straight-line-graphs",
    title: "Equation of a line through two points",
    difficulty: "easy",
    marks: 3,
    paper: 1,
    build: (r) => {
      const x1 = r.int(-6, 6);
      const y1 = r.int(-6, 6);
      const dx = r.nz(1, 5);
      const m = r.nz(-4, 4);
      const x2 = x1 + dx;
      const y2 = y1 + m * dx;
      const c = y1 - m * x1;
      return {
        prompt: `Find the gradient of the line through $(${x1}, ${y1})$ and $(${x2}, ${y2})$.`,
        answer: { kind: "numeric", value: m, tolerance: 1e-9, display: `$m = ${m}$` },
        solution: [
          { t: "Gradient is the change in $y$ over the change in $x$.", m: `m = \\frac{${y2} - (${y1})}{${x2} - (${x1})}` },
          { t: "Evaluate both differences.", m: `= \\frac{${y2 - y1}}{${dx}}` },
          { t: "Simplify.", m: `= ${m}` },
          { t: "For the full equation, use the point-gradient form.", m: `y = ${quadratic(0, m, c)}` },
        ],
      };
    },
  },
  {
    id: "line-perpendicular",
    topic: "straight-line-graphs",
    title: "Perpendicular gradient",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const p = r.nz(1, 6);
      const q = r.nz(1, 6);
      const m = p / q;
      const perp = -q / p;
      return {
        prompt: `A line has gradient $${frac(p, q)}$. Find the gradient of any line perpendicular to it.`,
        answer: { kind: "numeric", value: perp, tolerance: 1e-6, display: `$${frac(-q, p)}$` },
        solution: [
          { t: "Perpendicular gradients multiply to $-1$.", m: `m_1 m_2 = -1` },
          { t: "So take the negative reciprocal: flip the fraction and change the sign.", m: `m_2 = -\\frac{1}{${frac(p, q)}} = ${frac(-q, p)}` },
          { t: "Check the product.", m: `${frac(p, q)} \\times ${frac(-q, p)} = -1 \\ \\checkmark` },
          { t: `As a decimal that is $${perp.toFixed(4)}$, against the original $${m.toFixed(4)}$.` },
        ],
      };
    },
  },
  {
    id: "line-midpoint-length",
    topic: "straight-line-graphs",
    title: "Length of a line segment",
    difficulty: "easy",
    marks: 3,
    paper: 2,
    build: (r) => {
      const x1 = r.int(-8, 8);
      const y1 = r.int(-8, 8);
      const dx = r.nz(-9, 9);
      const dy = r.nz(-9, 9);
      const length = Math.hypot(dx, dy);
      return {
        prompt: `Find the distance between $A(${x1}, ${y1})$ and $B(${x1 + dx}, ${y1 + dy})$, to 3 significant figures.`,
        answer: { kind: "numeric", value: length, tolerance: tol3sf(length), display: `$${length.toFixed(3)}$` },
        solution: [
          { t: "Use Pythagoras on the differences.", m: `|AB| = \\sqrt{(${dx})^2 + (${dy})^2}` },
          { t: "Square each.", m: `= \\sqrt{${dx * dx} + ${dy * dy}}` },
          { t: "Add.", m: `= \\sqrt{${dx * dx + dy * dy}}` },
          { t: "Evaluate.", m: `= ${length.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "line-perp-bisector",
    topic: "straight-line-graphs",
    title: "Perpendicular bisector",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const mx = r.int(-5, 5);
      const my = r.int(-5, 5);
      const dx = r.nz(1, 4) * 2;
      const dy = r.nz(-4, 4) * 2;
      const A: [number, number] = [mx - dx / 2, my - dy / 2];
      const B: [number, number] = [mx + dx / 2, my + dy / 2];
      const mAB = dy / dx;
      const perp = -1 / mAB;
      const intercept = my - perp * mx;
      return {
        prompt: `Find the $y$-intercept of the perpendicular bisector of $A(${A[0]}, ${A[1]})$ and $B(${B[0]}, ${B[1]})$, to 3 significant figures.`,
        answer: { kind: "numeric", value: intercept, tolerance: tol3sf(intercept || 1), display: `$c = ${intercept.toFixed(3)}$` },
        solution: [
          { t: "Find the midpoint — the bisector passes through it.", m: `M = \\left(${mx}, ${my}\\right)` },
          { t: "Find the gradient of $AB$.", m: `m_{AB} = \\frac{${dy}}{${dx}} = ${frac(dy, dx)}` },
          { t: "Take the negative reciprocal.", m: `m_\\perp = ${frac(-dx, dy)}` },
          { t: "Use the point-gradient form through $M$ and rearrange to $y = mx + c$.", m: `c = ${my} - \\left(${frac(-dx, dy)}\\right)(${mx}) = ${intercept.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "line-straight-form",
    topic: "straight-line-graphs",
    title: "Reducing to straight-line form",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const n = r.int(2, 5) / 2;
      const lgA = r.int(2, 12) / 10;
      const A = 10 ** lgA;
      return {
        prompt: `Variables $x$ and $y$ satisfy $y = Ax^{n}$. Plotting $\\lg y$ against $\\lg x$ gives a straight line of gradient $${n}$ passing through $(0, ${lgA})$. Find $A$, to 3 significant figures.`,
        answer: { kind: "numeric", value: A, tolerance: tol3sf(A), display: `$A = ${A.toFixed(3)}$` },
        solution: [
          { t: "Take logarithms of the relationship.", m: `\\lg y = n\\lg x + \\lg A` },
          { t: "Compare with $Y = mX + c$: the gradient is $n$ and the intercept is $\\lg A$.", m: `n = ${n}, \\qquad \\lg A = ${lgA}` },
          { t: "Undo the logarithm — the intercept is $\\lg A$, **not** $A$.", m: `A = 10^{${lgA}}` },
          { t: "Evaluate.", m: `A = ${A.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "cir-centre-radius",
    topic: "circles",
    title: "Centre and radius from the general form",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const a = r.int(-6, 6);
      const b = r.int(-6, 6);
      const rad = r.int(2, 9);
      // (x-a)² + (y-b)² = r² expands to x² + y² - 2ax - 2by + (a²+b²-r²) = 0
      const g = -2 * a;
      const f = -2 * b;
      const c = a * a + b * b - rad * rad;
      return {
        prompt: `Find the radius of the circle $x^2 + y^2 ${signed(g, "x")} ${signed(f, "y")} ${signed(c)} = 0$.`,
        answer: { kind: "numeric", value: rad, tolerance: 1e-6, display: `$r = ${rad}$` },
        solution: [
          { t: "Complete the square in $x$.", m: `x^2 ${signed(g, "x")} = (x ${signed(-a)})^2 - ${a * a}` },
          { t: "Complete the square in $y$.", m: `y^2 ${signed(f, "y")} = (y ${signed(-b)})^2 - ${b * b}` },
          { t: "Substitute both and move the constants to the right.", m: `(x ${signed(-a)})^2 + (y ${signed(-b)})^2 = ${rad * rad}` },
          { t: "Read off the centre and radius.", m: `\\text{centre } (${a}, ${b}), \\quad r = ${rad}` },
        ],
      };
    },
  },
  {
    id: "cir-equation-from-points",
    topic: "circles",
    title: "Circle on a given diameter",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const cx = r.int(-5, 5);
      const cy = r.int(-5, 5);
      const dx = r.nz(1, 5);
      const dy = r.nz(-5, 5);
      const rad2 = dx * dx + dy * dy;
      return {
        prompt: `$A(${cx - dx}, ${cy - dy})$ and $B(${cx + dx}, ${cy + dy})$ are the ends of a diameter of a circle. Find $r^2$ for that circle.`,
        answer: { kind: "numeric", value: rad2, tolerance: 1e-6, display: `$r^2 = ${rad2}$` },
        solution: [
          { t: "The centre is the midpoint of the diameter.", m: `C = (${cx}, ${cy})` },
          { t: "The radius is the distance from the centre to either end.", m: `r^2 = (${dx})^2 + (${dy})^2` },
          { t: "Evaluate.", m: `r^2 = ${rad2}` },
          { t: "So the equation is:", m: `(x ${signed(-cx)})^2 + (y ${signed(-cy)})^2 = ${rad2}` },
        ],
      };
    },
  },
  {
    id: "cir-tangent-at-point",
    topic: "circles",
    title: "Tangent to a circle",
    difficulty: "hard",
    marks: 5,
    paper: 1,
    build: (r) => {
      const trip = r.pick([
        [3, 4, 5],
        [4, 3, 5],
        [6, 8, 10],
        [5, 12, 13],
        [12, 5, 13],
      ] as const);
      const [dx, dy, rad] = trip;
      const cx = r.int(-4, 4);
      const cy = r.int(-4, 4);
      const px = cx + dx;
      const py = cy + dy;
      const mRadius = dy / dx;
      const mTangent = -dx / dy;
      return {
        prompt: `The point $P(${px}, ${py})$ lies on the circle with centre $(${cx}, ${cy})$ and radius ${rad}. Find the gradient of the tangent to the circle at $P$.`,
        answer: { kind: "numeric", value: mTangent, tolerance: 1e-6, display: `$${frac(-dx, dy)}$` },
        solution: [
          { t: "Find the gradient of the radius from the centre to $P$.", m: `m_{CP} = \\frac{${py} - (${cy})}{${px} - (${cx})} = ${frac(dy, dx)}` },
          { t: "A tangent is perpendicular to the radius at the point of contact.", m: `m_t = -\\frac{1}{${frac(dy, dx)}}` },
          { t: "Simplify.", m: `m_t = ${frac(-dx, dy)}` },
          { t: `As a decimal, $${mTangent.toFixed(4)}$; the radius gradient was $${mRadius.toFixed(4)}$, and their product is $-1$ ✓.` },
        ],
      };
    },
  },
  {
    id: "cir-line-intersection",
    topic: "circles",
    title: "Does the line meet the circle?",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      const rad = r.int(3, 8);
      const A = r.nz(1, 4);
      const B = r.nz(1, 4);
      const kind = r.pick(["tangent", "chord", "miss"] as const);
      const norm = Math.hypot(A, B);
      const dTarget = kind === "tangent" ? rad : kind === "chord" ? rad * 0.5 : rad * 1.6;
      const C = -dTarget * norm;
      const d = Math.abs(C) / norm;
      const options = ["A tangent", "A chord (two points)", "It does not meet the circle"];
      const correct = kind === "tangent" ? 1 : kind === "chord" ? 2 : 3;
      return {
        prompt: `The circle $x^2 + y^2 = ${rad * rad}$ and the line $${A}x + ${B}y ${signed(Math.round(C * 1000) / 1000)} = 0$ are given. Is the line a tangent, a chord, or does it miss the circle?\n\nType 1 for tangent, 2 for chord, 3 for no intersection.`,
        answer: { kind: "mcq", options, correct, display: options[correct - 1]! },
        solution: [
          { t: "Find the perpendicular distance from the centre $(0,0)$ to the line.", m: `d = \\frac{|A(0) + B(0) + C|}{\\sqrt{A^2+B^2}} = \\frac{${Math.abs(C).toFixed(3)}}{\\sqrt{${A * A + B * B}}}` },
          { t: "Evaluate.", m: `d = ${d.toFixed(3)}` },
          { t: "Compare with the radius.", m: `r = ${rad}` },
          {
            t:
              kind === "tangent"
                ? "The distance equals the radius, so the line touches the circle exactly once."
                : kind === "chord"
                  ? "The distance is less than the radius, so the line cuts the circle twice."
                  : "The distance exceeds the radius, so the line misses the circle entirely.",
          },
        ],
        hint: "Type 1, 2 or 3.",
      };
    },
  },

  {
    id: "rad-convert",
    topic: "circular-measure",
    title: "Degrees and radians",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const deg = r.pick([15, 30, 45, 60, 75, 90, 120, 135, 150, 210, 225, 240, 270, 300, 330] as const);
      const value = (deg * PI) / 180;
      return {
        prompt: `Convert $${deg}^\\circ$ to radians, giving your answer to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toFixed(4)}$ rad` },
        solution: [
          { t: "Multiply by $\\frac{\\pi}{180}$.", m: `${deg} \\times \\frac{\\pi}{180}` },
          { t: "Simplify the fraction.", m: `= \\frac{${deg}\\pi}{180} = ${frac(deg, 180)}\\pi` },
          { t: "Evaluate.", m: `= ${value.toFixed(4)}` },
        ],
        hint: "3 significant figures, or an exact multiple of pi (e.g. pi/3).",
      };
    },
  },
  {
    id: "rad-arc-sector",
    topic: "circular-measure",
    title: "Arc length and sector area",
    difficulty: "easy",
    marks: 3,
    paper: 2,
    build: (r) => {
      const rad = r.int(3, 15);
      const theta = r.int(3, 25) / 10;
      const wantArea = r.next() < 0.5;
      const arc = rad * theta;
      const area = 0.5 * rad * rad * theta;
      const value = wantArea ? area : arc;
      return {
        prompt: `A sector of a circle has radius ${rad} cm and angle ${theta} radians. Find its ${wantArea ? "area, in cm²" : "arc length, in cm"}, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toFixed(3)}$` },
        solution: [
          { t: wantArea ? "Use the sector-area formula — not on the formula sheet." : "Use the arc-length formula — not on the formula sheet.", m: wantArea ? "A = \\tfrac12 r^2\\theta" : "s = r\\theta" },
          { t: "Substitute.", m: wantArea ? `A = \\tfrac12(${rad})^2(${theta})` : `s = ${rad} \\times ${theta}` },
          { t: "Evaluate.", m: `= ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "rad-segment",
    topic: "circular-measure",
    title: "Area of a segment",
    difficulty: "hard",
    marks: 4,
    paper: 2,
    build: (r) => {
      const rad = r.int(4, 14);
      const theta = r.int(8, 28) / 10;
      const value = 0.5 * rad * rad * (theta - Math.sin(theta));
      return {
        prompt: `A chord subtends an angle of ${theta} radians at the centre of a circle of radius ${rad} cm. Find the area of the minor segment, in cm², to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toFixed(3)}$` },
        solution: [
          { t: "A segment is the sector minus the triangle.", m: "A = \\tfrac12 r^2\\theta - \\tfrac12 r^2\\sin\\theta = \\tfrac12 r^2\\left(\\theta - \\sin\\theta\\right)" },
          { t: "Substitute, with the calculator in radian mode.", m: `= \\tfrac12(${rad})^2\\left(${theta} - \\sin ${theta}\\right)` },
          { t: `Evaluate the sine first: $\\sin ${theta} = ${Math.sin(theta).toFixed(5)}$.`, m: `= ${0.5 * rad * rad} \\times ${(theta - Math.sin(theta)).toFixed(5)}` },
          { t: "Multiply.", m: `= ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures. Radian mode.",
      };
    },
  },
  {
    id: "rad-perimeter",
    topic: "circular-measure",
    title: "Perimeter of a sector",
    difficulty: "medium",
    marks: 3,
    paper: 2,
    build: (r) => {
      const rad = r.int(4, 16);
      const theta = r.int(4, 30) / 10;
      const value = rad * theta + 2 * rad;
      return {
        prompt: `Find the perimeter, in cm, of a sector of radius ${rad} cm and angle ${theta} radians, to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toFixed(3)}$` },
        solution: [
          { t: "The boundary is the arc plus the two straight radii.", m: "P = r\\theta + 2r" },
          { t: "Compute the arc.", m: `r\\theta = ${rad} \\times ${theta} = ${(rad * theta).toFixed(3)}` },
          { t: "Add the two radii.", m: `+ 2(${rad}) = ${2 * rad}` },
          { t: "Total.", m: `P = ${value.toFixed(3)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "trig-amplitude-period",
    topic: "trigonometric-functions",
    title: "Amplitude and period",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const a = r.int(1, 6);
      const b = r.int(1, 5);
      const c = r.int(-4, 4);
      const isTan = r.next() < 0.25;
      const fn = isTan ? "\\tan" : r.next() < 0.5 ? "\\sin" : "\\cos";
      const period = isTan ? PI / b : (2 * PI) / b;
      return {
        prompt: `For $y = ${a}${fn} ${b}x ${signed(c)}$, find the period in radians, to 3 significant figures.`,
        answer: { kind: "numeric", value: period, tolerance: tol3sf(period), display: `$${period.toFixed(4)}$` },
        solution: [
          {
            t: isTan
              ? "The tangent function repeats every $\\pi$, so the period of $\\tan bx$ is $\\frac{\\pi}{b}$."
              : "Sine and cosine repeat every $2\\pi$, so the period of the transformed function is $\\frac{2\\pi}{b}$.",
            m: isTan ? `\\text{period} = \\frac{\\pi}{${b}}` : `\\text{period} = \\frac{2\\pi}{${b}}`,
          },
          { t: "Evaluate.", m: `= ${period.toFixed(4)}` },
          {
            t: isTan
              ? "Note that a tangent graph has no amplitude — it is unbounded."
              : `The amplitude is the coefficient in front, $${a}$, and the centre line is $y = ${c}$.`,
          },
        ],
        hint: "3 significant figures, or an exact multiple of pi.",
      };
    },
  },
  {
    id: "trig-exact-value",
    topic: "trigonometric-functions",
    title: "Exact trigonometric value",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const angles = [
        { deg: 150, tex: "150^\\circ", sin: 0.5, cos: -Math.sqrt(3) / 2 },
        { deg: 210, tex: "210^\\circ", sin: -0.5, cos: -Math.sqrt(3) / 2 },
        { deg: 300, tex: "300^\\circ", sin: -Math.sqrt(3) / 2, cos: 0.5 },
        { deg: 135, tex: "135^\\circ", sin: Math.SQRT1_2, cos: -Math.SQRT1_2 },
        { deg: 225, tex: "225^\\circ", sin: -Math.SQRT1_2, cos: -Math.SQRT1_2 },
        { deg: 240, tex: "240^\\circ", sin: -Math.sqrt(3) / 2, cos: -0.5 },
        { deg: 330, tex: "330^\\circ", sin: -0.5, cos: Math.sqrt(3) / 2 },
      ] as const;
      const pick = r.pick(angles);
      const useSin = r.next() < 0.5;
      const value = useSin ? pick.sin : pick.cos;
      const quadrant = pick.deg < 180 ? 2 : pick.deg < 270 ? 3 : 4;
      const ref = quadrant === 2 ? 180 - pick.deg : quadrant === 3 ? pick.deg - 180 : 360 - pick.deg;
      return {
        prompt: `Find the exact value of $\\${useSin ? "sin" : "cos"} ${pick.tex}$, as a decimal to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${value.toFixed(4)}$` },
        solution: [
          { t: `$${pick.tex}$ lies in quadrant ${quadrant}.` },
          {
            t: `By CAST, ${quadrant === 2 ? "only sine is positive there" : quadrant === 3 ? "only tangent is positive there" : "only cosine is positive there"}, so $\\${useSin ? "sin" : "cos"}$ is ${value >= 0 ? "positive" : "negative"}.`,
          },
          { t: `The reference angle is $${ref}^\\circ$.`, m: `\\${useSin ? "sin" : "cos"} ${ref}^\\circ = ${Math.abs(value).toFixed(4)}` },
          { t: "Apply the sign.", m: `\\${useSin ? "sin" : "cos"} ${pick.tex} = ${value.toFixed(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "trig-range-transformed",
    topic: "trigonometric-functions",
    title: "Range of a transformed graph",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(2, 7);
      const b = r.int(1, 4);
      const c = r.int(-5, 5);
      const wantMax = r.next() < 0.5;
      const value = wantMax ? c + a : c - a;
      return {
        prompt: `Find the ${wantMax ? "greatest" : "least"} value of $y = ${a}\\sin ${b}x ${signed(c)}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-9, display: `$${value}$` },
        solution: [
          { t: "The sine of anything lies between $-1$ and $1$.", m: `-1 \\le \\sin ${b}x \\le 1` },
          { t: `Multiply through by the amplitude $${a}$.`, m: `${-a} \\le ${a}\\sin ${b}x \\le ${a}` },
          { t: `Add the vertical shift $${c}$.`, m: `${c - a} \\le y \\le ${c + a}` },
          { t: `The ${wantMax ? "greatest" : "least"} value is therefore:`, m: `${value}` },
        ],
      };
    },
  },
  {
    id: "trig-solutions-count",
    topic: "trigonometric-functions",
    title: "Counting solutions from a graph",
    difficulty: "hard",
    marks: 3,
    paper: 1,
    build: (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 4);
      const k = r.int(1, a - 1);
      const count = 2 * b;
      return {
        prompt: `How many solutions does $${a}\\sin ${b}x = ${k}$ have for $0 \\le x \\le 2\\pi$?`,
        answer: { kind: "numeric", value: count, tolerance: 1e-9, display: `$${count}$` },
        solution: [
          { t: `The curve $y = ${a}\\sin ${b}x$ has period $\\frac{2\\pi}{${b}}$, so it completes ${b} full cycle${b > 1 ? "s" : ""} on $[0, 2\\pi]$.` },
          { t: `Each full cycle crosses any horizontal line $y = k$ with $0 < k < ${a}$ exactly twice — once rising, once falling.` },
          { t: `Here $k = ${k}$, which satisfies $0 < ${k} < ${a}$.` },
          { t: "Multiply cycles by crossings.", m: `${b} \\times 2 = ${count}` },
        ],
      };
    },
  },

  {
    id: "id-simplify",
    topic: "trigonometric-identities",
    title: "Simplify with an identity",
    difficulty: "easy",
    marks: 2,
    paper: 1,
    build: (r) => {
      const cases = [
        { expr: "1 - \\sin^2\\theta", result: "\\cos^2\\theta", options: ["$\\cos^2\\theta$", "$\\sin^2\\theta$", "$\\tan^2\\theta$", "$\\sec^2\\theta$"], correct: 1, why: "Rearranging $\\sin^2 + \\cos^2 = 1$." },
        { expr: "\\sec^2\\theta - 1", result: "\\tan^2\\theta", options: ["$\\tan^2\\theta$", "$\\cot^2\\theta$", "$\\cos^2\\theta$", "$1$"], correct: 1, why: "From $\\sec^2 A = 1 + \\tan^2 A$." },
        { expr: "\\operatorname{cosec}^2\\theta - \\cot^2\\theta", result: "1", options: ["$1$", "$0$", "$\\tan^2\\theta$", "$\\sec^2\\theta$"], correct: 1, why: "From $\\operatorname{cosec}^2 A = 1 + \\cot^2 A$." },
        { expr: "\\sin\\theta\\cot\\theta", result: "\\cos\\theta", options: ["$\\cos\\theta$", "$\\sin\\theta$", "$\\tan\\theta$", "$1$"], correct: 1, why: "Because $\\cot\\theta = \\frac{\\cos\\theta}{\\sin\\theta}$, the sines cancel." },
        { expr: "\\frac{\\tan\\theta}{\\sec\\theta}", result: "\\sin\\theta", options: ["$\\sin\\theta$", "$\\cos\\theta$", "$\\cot\\theta$", "$1$"], correct: 1, why: "Write both in terms of sine and cosine: $\\frac{\\sin/\\cos}{1/\\cos} = \\sin$." },
      ] as const;
      const pick = r.pick(cases);
      // Shuffle so the answer is not always first.
      const order = [0, 1, 2, 3];
      for (let i = 3; i > 0; i -= 1) {
        const j = r.int(0, i);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const options = order.map((i) => pick.options[i]!);
      const correct = order.indexOf(0) + 1;
      return {
        prompt: `Simplify $${pick.expr}$.\n\nType the number of the correct option:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
        answer: { kind: "mcq", options, correct, display: `$${pick.result}$` },
        solution: [
          { t: "Identify which Pythagorean or quotient relation applies here." },
          { t: pick.why },
          { t: "So the expression simplifies to:", m: pick.result },
        ],
        hint: "Type 1, 2, 3 or 4.",
      };
    },
  },
  {
    id: "id-values-from-ratio",
    topic: "trigonometric-identities",
    title: "Other ratios from one",
    difficulty: "medium",
    marks: 4,
    paper: 1,
    build: (r) => {
      const trip = r.pick([
        [3, 4, 5],
        [5, 12, 13],
        [8, 15, 17],
        [7, 24, 25],
      ] as const);
      const [opp, adj, hyp] = trip;
      const quadrant = r.pick([1, 2, 3, 4] as const);
      const sinSign = quadrant === 1 || quadrant === 2 ? 1 : -1;
      const cosSign = quadrant === 1 || quadrant === 4 ? 1 : -1;
      const sin = (sinSign * opp) / hyp;
      const cos = (cosSign * adj) / hyp;
      const wantSin = r.next() < 0.5;
      const value = wantSin ? sin : cos;
      const ranges: Record<number, string> = {
        1: "0^\\circ < \\theta < 90^\\circ",
        2: "90^\\circ < \\theta < 180^\\circ",
        3: "180^\\circ < \\theta < 270^\\circ",
        4: "270^\\circ < \\theta < 360^\\circ",
      };
      const tan = sin / cos;
      return {
        prompt: `Given that $\\tan\\theta = ${frac(sinSign * opp, cosSign * adj)}$ and $${ranges[quadrant]}$, find the exact value of $\\${wantSin ? "sin" : "cos"}\\theta$ as a decimal to 3 significant figures.`,
        answer: { kind: "numeric", value, tolerance: tol3sf(value), display: `$${frac(wantSin ? sinSign * opp : cosSign * adj, hyp)} = ${value.toFixed(4)}$` },
        solution: [
          { t: "Use the identity that links tangent to the function you want.", m: `\\sec^2\\theta = 1 + \\tan^2\\theta = 1 + \\frac{${opp * opp}}{${adj * adj}} = \\frac{${hyp * hyp}}{${adj * adj}}` },
          { t: "Take the square root, keeping both signs for now.", m: `\\sec\\theta = \\pm\\frac{${hyp}}{${adj}}` },
          { t: `In quadrant ${quadrant}, cosine is ${cosSign > 0 ? "positive" : "negative"} and sine is ${sinSign > 0 ? "positive" : "negative"}.`, m: `\\cos\\theta = ${frac(cosSign * adj, hyp)}` },
          { t: "Find the other from the quotient relation.", m: `\\sin\\theta = \\tan\\theta\\cos\\theta = ${frac(sinSign * opp, hyp)}` },
          { t: `The requested value is therefore $${value.toFixed(4)}$ (and $\\tan\\theta = ${tan.toFixed(4)}$ ✓).` },
        ],
        hint: "3 significant figures.",
      };
    },
  },
  {
    id: "id-quadratic-form",
    topic: "trigonometric-identities",
    title: "Reduce to a quadratic in one ratio",
    difficulty: "hard",
    marks: 4,
    paper: 1,
    build: (r) => {
      // p sin²θ = q cos θ  ->  p(1 - c²) = q c  ->  p c² + q c - p = 0
      const p = r.int(1, 4);
      const q = r.int(1, 6);
      const disc = q * q + 4 * p * p;
      const c = (-q + Math.sqrt(disc)) / (2 * p);
      return {
        prompt: `The equation $${p}\\sin^2\\theta = ${q}\\cos\\theta$ can be written as a quadratic in $\\cos\\theta$. Find the value of $\\cos\\theta$ that lies in $[-1, 1]$, to 3 significant figures.`,
        answer: { kind: "numeric", value: c, tolerance: tol3sf(c), display: `$\\cos\\theta = ${c.toFixed(4)}$` },
        solution: [
          { t: "Replace $\\sin^2\\theta$ using the Pythagorean identity so only cosine appears.", m: `${p}\\left(1 - \\cos^2\\theta\\right) = ${q}\\cos\\theta` },
          { t: "Expand and collect.", m: `${p}\\cos^2\\theta + ${q}\\cos\\theta - ${p} = 0` },
          { t: "Apply the quadratic formula in $\\cos\\theta$.", m: `\\cos\\theta = \\frac{-${q} \\pm \\sqrt{${q * q} + ${4 * p * p}}}{${2 * p}}` },
          { t: "Evaluate both roots and discard any outside $[-1,1]$.", m: `\\cos\\theta = ${c.toFixed(4)}` },
        ],
        hint: "3 significant figures.",
      };
    },
  },

  {
    id: "teq-basic",
    topic: "trigonometric-equations",
    title: "Solve over one revolution",
    difficulty: "easy",
    marks: 3,
    paper: 2,
    build: (r) => {
      const useSin = r.next() < 0.5;
      const k = r.int(-9, 9) / 10;
      const principal = useSin ? (Math.asin(k) * 180) / PI : (Math.acos(k) * 180) / PI;
      const first = useSin ? (principal >= 0 ? principal : principal + 360) : principal;
      const second = useSin ? 180 - principal : 360 - principal;
      const sols = [first, second].map((v) => ((v % 360) + 360) % 360).sort((a, b) => a - b);
      return {
        prompt: `Solve $\\${useSin ? "sin" : "cos"}\\theta = ${k}$ for $0^\\circ \\le \\theta \\le 360^\\circ$. Give both solutions in degrees to 1 decimal place, separated by a comma.`,
        answer: { kind: "set", values: sols, tolerance: 0.15, display: `$\\theta = ${sols.map((s) => s.toFixed(1)).join("^\\circ,\\ ")}^\\circ$` },
        solution: [
          { t: "Take the inverse function for the principal value.", m: `\\alpha = \\${useSin ? "arcsin" : "arccos"}(${k}) = ${principal.toFixed(2)}^\\circ` },
          {
            t: useSin
              ? "For sine, the partner solution in a revolution is $180^\\circ - \\alpha$."
              : "For cosine, the partner solution in a revolution is $360^\\circ - \\alpha$.",
            m: useSin ? `180 - (${principal.toFixed(2)}) = ${(180 - principal).toFixed(2)}^\\circ` : `360 - ${principal.toFixed(2)} = ${(360 - principal).toFixed(2)}^\\circ`,
          },
          { t: "Adjust any negative angle by adding $360^\\circ$ to bring it into the interval." },
          { t: "The solutions are:", m: `\\theta = ${sols.map((s) => s.toFixed(1)).join("^\\circ,\\ ")}^\\circ` },
        ],
        hint: "Degrees, 1 d.p., comma separated.",
      };
    },
  },
  {
    id: "teq-multiple-angle",
    topic: "trigonometric-equations",
    title: "Multiple angle: how many solutions?",
    difficulty: "medium",
    marks: 3,
    paper: 1,
    build: (r) => {
      const n = r.int(2, 4);
      const k = r.int(2, 8) / 10;
      const count = 2 * n;
      return {
        prompt: `How many solutions does $\\sin ${n}\\theta = ${k}$ have for $0^\\circ \\le \\theta \\le 360^\\circ$?`,
        answer: { kind: "numeric", value: count, tolerance: 1e-9, display: `$${count}$` },
        solution: [
          { t: `Transform the interval first: multiplying $\\theta$ by ${n} multiplies the endpoints by ${n}.`, m: `0^\\circ \\le ${n}\\theta \\le ${360 * n}^\\circ` },
          { t: `That is ${n} complete revolutions.` },
          { t: `A sine equation with $0 < k < 1$ has two solutions per revolution.`, m: `${n} \\times 2 = ${count}` },
          { t: "Each of those is then divided by the multiplier to give a value of $\\theta$ in the original interval." },
        ],
      };
    },
  },
  {
    id: "teq-quadratic",
    topic: "trigonometric-equations",
    title: "Quadratic trigonometric equation",
    difficulty: "hard",
    marks: 5,
    paper: 2,
    build: (r) => {
      // (a sinθ - p)(sinθ + q) = 0 with only the first branch valid.
      const a = r.int(2, 4);
      const p = r.int(1, a - 1);
      const q = r.int(2, 4);
      const sinValue = p / a;
      const first = (Math.asin(sinValue) * 180) / PI;
      const second = 180 - first;
      const sols = [first, second].sort((x, y) => x - y);
      return {
        prompt: `Solve $${a}\\sin^2\\theta ${signed(a * q - p, "\\sin\\theta")} ${signed(-p * q)} = 0$ for $0^\\circ \\le \\theta \\le 360^\\circ$. Give the solutions in degrees to 1 decimal place, separated by a comma.`,
        answer: { kind: "set", values: sols, tolerance: 0.15, display: `$\\theta = ${sols.map((s) => s.toFixed(1)).join("^\\circ,\\ ")}^\\circ$` },
        solution: [
          { t: "Treat $\\sin\\theta$ as the variable and factorise.", m: `\\left(${a}\\sin\\theta - ${p}\\right)\\left(\\sin\\theta + ${q}\\right) = 0` },
          { t: `The second factor gives $\\sin\\theta = ${-q}$, which is impossible since $|\\sin\\theta| \\le 1$. Reject it.` },
          { t: "The first factor gives the usable value.", m: `\\sin\\theta = ${frac(p, a)} = ${sinValue.toFixed(4)}` },
          { t: "Principal value.", m: `\\alpha = ${first.toFixed(2)}^\\circ` },
          { t: "Sine is also positive in the second quadrant.", m: `\\theta = ${first.toFixed(1)}^\\circ, \\ ${second.toFixed(1)}^\\circ` },
        ],
        hint: "Degrees, 1 d.p., comma separated.",
      };
    },
  },
  {
    id: "teq-tan-equation",
    topic: "trigonometric-equations",
    title: "Tangent equation",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const k = r.nz(-40, 40) / 10;
      const principal = (Math.atan(k) * 180) / PI;
      const first = principal < 0 ? principal + 180 : principal;
      const second = first + 180;
      const sols = [first, second];
      return {
        prompt: `Solve $\\tan\\theta = ${k}$ for $0^\\circ \\le \\theta \\le 360^\\circ$. Give both solutions in degrees to 1 decimal place, separated by a comma.`,
        answer: { kind: "set", values: sols, tolerance: 0.15, display: `$\\theta = ${sols.map((s) => s.toFixed(1)).join("^\\circ,\\ ")}^\\circ$` },
        solution: [
          { t: "Take the inverse tangent for the principal value.", m: `\\alpha = \\arctan(${k}) = ${principal.toFixed(2)}^\\circ` },
          { t: principal < 0 ? "It is negative, so add $180^\\circ$ to reach the first solution inside the interval." : "It already lies inside the interval.", m: `\\theta_1 = ${first.toFixed(2)}^\\circ` },
          { t: "The tangent function repeats every $180^\\circ$, so add that for the next solution.", m: `\\theta_2 = ${second.toFixed(2)}^\\circ` },
          { t: "Both lie in $[0^\\circ, 360^\\circ]$.", m: `\\theta = ${sols.map((s) => s.toFixed(1)).join("^\\circ,\\ ")}^\\circ` },
        ],
        hint: "Degrees, 1 d.p., comma separated.",
      };
    },
  },

  {
    id: "pc-nCr-evaluate",
    topic: "permutations-combinations",
    title: "Evaluate a combination or permutation",
    difficulty: "easy",
    marks: 2,
    paper: 2,
    build: (r) => {
      const n = r.int(5, 12);
      const k = r.int(2, Math.min(5, n - 1));
      const isC = r.next() < 0.5;
      let perm = 1;
      for (let i = 0; i < k; i += 1) perm *= n - i;
      let fact = 1;
      for (let i = 2; i <= k; i += 1) fact *= i;
      const value = isC ? perm / fact : perm;
      return {
        prompt: `Evaluate $^{${n}}${isC ? "C" : "P"}_{${k}}$.`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: isC ? "Use the combination formula." : "Use the permutation formula.", m: isC ? `^{${n}}C_{${k}} = \\frac{${n}!}{${k}!\\,(${n}-${k})!}` : `^{${n}}P_{${k}} = \\frac{${n}!}{(${n}-${k})!}` },
          { t: "Cancel the factorials — only the top $" + k + "$ factors survive.", m: `= \\frac{${Array.from({ length: k }, (_, i) => n - i).join(" \\times ")}}{${isC ? Array.from({ length: k }, (_, i) => i + 1).join(" \\times ") : "1"}}` },
          { t: "Evaluate.", m: `= ${value}` },
        ],
      };
    },
  },
  {
    id: "pc-arrangements",
    topic: "permutations-combinations",
    title: "Arrangements with a restriction",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const n = r.int(5, 8);
      const blockSize = r.int(2, 3);
      let outer = 1;
      for (let i = 2; i <= n - blockSize + 1; i += 1) outer *= i;
      let inner = 1;
      for (let i = 2; i <= blockSize; i += 1) inner *= i;
      const value = outer * inner;
      return {
        prompt: `In how many ways can ${n} different books be arranged in a row if ${blockSize} particular books must be kept together?`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: `Treat the ${blockSize} books that must stay together as a single block.`, m: `${n} - ${blockSize} + 1 = ${n - blockSize + 1} \\text{ objects to arrange}` },
          { t: "Arrange those objects.", m: `${n - blockSize + 1}! = ${outer}` },
          { t: `Now arrange the ${blockSize} books inside the block.`, m: `${blockSize}! = ${inner}` },
          { t: "Multiply the two stages.", m: `${outer} \\times ${inner} = ${value}` },
        ],
      };
    },
  },
  {
    id: "pc-committee",
    topic: "permutations-combinations",
    title: "Committee selection",
    difficulty: "medium",
    marks: 4,
    paper: 2,
    build: (r) => {
      const women = r.int(4, 8);
      const men = r.int(3, 7);
      const size = r.int(3, 5);
      const menWanted = r.int(1, Math.min(2, men));
      const womenWanted = size - menWanted;
      const nCr = (n: number, k: number) => {
        if (k < 0 || k > n) return 0;
        let out = 1;
        for (let i = 0; i < k; i += 1) out = (out * (n - i)) / (i + 1);
        return Math.round(out);
      };
      const value = nCr(men, menWanted) * nCr(women, womenWanted);
      return {
        prompt: `A committee of ${size} is chosen from ${women} women and ${men} men. How many committees contain exactly ${menWanted} man${menWanted === 1 ? "" : "men"}?`,
        answer: { kind: "numeric", value, tolerance: 1e-6, display: `$${value}$` },
        solution: [
          { t: "Order does not matter in a committee, so use combinations." },
          { t: `Choose the ${menWanted} man${menWanted === 1 ? "" : "men"} from ${men}.`, m: `^{${men}}C_{${menWanted}} = ${nCr(men, menWanted)}` },
          { t: `Choose the remaining ${womenWanted} place${womenWanted === 1 ? "" : "s"} from the ${women} women.`, m: `^{${women}}C_{${womenWanted}} = ${nCr(women, womenWanted)}` },
          { t: "The two choices happen together, so multiply.", m: `${nCr(men, menWanted)} \\times ${nCr(women, womenWanted)} = ${value}` },
        ],
      };
    },
  },
  {
    id: "pc-solve-n",
    topic: "permutations-combinations",
    title: "Solve for $n$",
    difficulty: "hard",
    marks: 4,
    paper: 1,
    build: (r) => {
      const n = r.int(5, 14);
      const value = (n * (n - 1)) / 2;
      return {
        prompt: `Given that $^{n}C_{2} = ${value}$, find $n$.`,
        answer: { kind: "numeric", value: n, tolerance: 1e-6, display: `$n = ${n}$` },
        solution: [
          { t: "Write the combination in full.", m: `\\frac{n!}{2!(n-2)!} = ${value}` },
          { t: "The factorials cancel to a product of two consecutive integers.", m: `\\frac{n(n-1)}{2} = ${value}` },
          { t: "Multiply up and rearrange.", m: `n^2 - n - ${2 * value} = 0` },
          { t: "Factorise.", m: `(n - ${n})(n + ${n - 1}) = 0` },
          { t: "A count cannot be negative, so reject the negative root.", m: `n = ${n}` },
        ],
      };
    },
  },
];
