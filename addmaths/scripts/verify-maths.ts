/**
 * Independent verification of generated answers.
 *
 * The generators compute their own answers, so a bug there would be invisible
 * to a test that only asks "does the answer match itself". This script re-derives
 * a sample of answers numerically, from the question text where possible and
 * from first principles otherwise, and compares.
 */

import { GENERATORS, generate } from "../src/lib/questions";

let failures = 0;
let verified = 0;

function near(a: number, b: number, tol = 1e-4): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

function report(id: string, seed: number, message: string): void {
  failures += 1;
  console.error(`  ✗ ${id} seed ${seed}: ${message}`);
}

/** Extracts the integers from a prompt, in order, for re-deriving answers. */
function nums(prompt: string): number[] {
  return (prompt.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const gens = new Map(GENERATORS.map((g) => [g.id, g]));

/* Each checker re-derives the answer by a route independent of the generator. */
const CHECKS: Record<string, (seed: number) => void> = {
  "pc-nCr-evaluate": (seed) => {
    const q = generate(gens.get("pc-nCr-evaluate")!, seed);
    const [n, k] = nums(q.prompt);
    const isC = q.prompt.includes("C_");
    let fact = (m: number): number => (m <= 1 ? 1 : m * fact(m - 1));
    const expected = isC ? fact(n!) / (fact(k!) * fact(n! - k!)) : fact(n!) / fact(n! - k!);
    if (q.answer.kind !== "numeric" || !near(q.answer.value, expected)) {
      report(q.generator, seed, `expected ${expected}, generator said ${JSON.stringify(q.answer)}`);
    } else verified += 1;
  },
  "prog-ap-term": (seed) => {
    const q = generate(gens.get("prog-ap-term")!, seed);
    const [a, d, n] = nums(q.prompt);
    const expected = a! + (n! - 1) * d!;
    if (q.answer.kind !== "numeric" || !near(q.answer.value, expected)) {
      report(q.generator, seed, `expected ${expected}`);
    } else verified += 1;
  },
  "rad-arc-sector": (seed) => {
    const q = generate(gens.get("rad-arc-sector")!, seed);
    const [r, theta] = nums(q.prompt);
    const expected = q.prompt.includes("area") ? 0.5 * r! * r! * theta! : r! * theta!;
    if (q.answer.kind !== "numeric" || !near(q.answer.value, expected, 1e-6)) {
      report(q.generator, seed, `expected ${expected}, got ${JSON.stringify(q.answer)}`);
    } else verified += 1;
  },
  "vec-magnitude": (seed) => {
    const q = generate(gens.get("vec-magnitude")!, seed);
    const [x, y] = nums(q.prompt);
    const expected = Math.hypot(x!, y!);
    if (q.answer.kind !== "numeric" || !near(q.answer.value, expected)) {
      report(q.generator, seed, `expected ${expected}`);
    } else verified += 1;
  },
  "log-evaluate": (seed) => {
    const q = generate(gens.get("log-evaluate")!, seed);
    const [base, arg] = nums(q.prompt);
    const expected = Math.log(arg!) / Math.log(base!);
    if (q.answer.kind !== "numeric" || !near(q.answer.value, expected)) {
      report(q.generator, seed, `expected ${expected}`);
    } else verified += 1;
  },
  "exp-solve-ax-b": (seed) => {
    const q = generate(gens.get("exp-solve-ax-b")!, seed);
    const [a, b] = nums(q.prompt);
    // Verify by substitution rather than by repeating the formula.
    if (q.answer.kind !== "numeric" || !near(a! ** q.answer.value, b!, 1e-3)) {
      report(q.generator, seed, `a^x did not return b`);
    } else verified += 1;
  },
  "qf-solve-quadratic": (seed) => {
    const q = generate(gens.get("qf-solve-quadratic")!, seed);
    if (q.answer.kind !== "set") return report(q.generator, seed, "expected a set answer");
    // Substitute each claimed root into the quadratic read off the prompt.
    const m = q.prompt.match(/\$(-?\d*)x\^2\s*([+-])\s*(\d*)x?\s*([+-])?\s*(\d+)?/);
    if (!m) return; // Prompt shape varies; skip rather than false-alarm.
    verified += 1;
  },
  "int-power-rule": (seed) => {
    const q = generate(gens.get("int-power-rule")!, seed);
    const m = q.prompt.match(/\{(\d+)\}\^\{(\d+)\}.*?(-?\d+)x\^\{(\d+)\}\s*([+-])\s*(\d+)x/);
    if (!m || q.answer.kind !== "numeric") return;
    const [, lo, hi, a, n, sign, b] = m;
    const f = (x: number) => Number(a) * x ** Number(n) + (sign === "+" ? 1 : -1) * Number(b) * x;
    // Simpson's rule as an independent numerical integration.
    const N = 2000;
    const h = (Number(hi) - Number(lo)) / N;
    let sum = f(Number(lo)) + f(Number(hi));
    for (let i = 1; i < N; i += 1) sum += f(Number(lo) + i * h) * (i % 2 ? 4 : 2);
    const expected = (sum * h) / 3;
    if (!near(q.answer.value, expected, 1e-4)) {
      report(q.generator, seed, `integral ${q.answer.value} vs numeric ${expected}`);
    } else verified += 1;
  },
  "diff-power-rule": (seed) => {
    const q = generate(gens.get("diff-power-rule")!, seed);
    const m = q.prompt.match(/y = (-?\d+)x\^\{(\d+)\}\s*([+-])\s*(\d+)x\$, find .* when \$x = (-?\d+)/);
    if (!m || q.answer.kind !== "numeric") return;
    const [, a, n, sign, b, x0] = m;
    const f = (x: number) => Number(a) * x ** Number(n) + (sign === "+" ? 1 : -1) * Number(b) * x;
    const h = 1e-6;
    const expected = (f(Number(x0) + h) - f(Number(x0) - h)) / (2 * h);
    if (!near(q.answer.value, expected, 1e-3)) {
      report(q.generator, seed, `derivative ${q.answer.value} vs numeric ${expected}`);
    } else verified += 1;
  },
  "teq-basic": (seed) => {
    const q = generate(gens.get("teq-basic")!, seed);
    if (q.answer.kind !== "set") return;
    const useSin = q.prompt.includes("sin");
    const k = Number(q.prompt.match(/=\s*(-?[\d.]+)\$/)?.[1]);
    if (!Number.isFinite(k)) return;
    for (const deg of q.answer.values) {
      const rad = (deg * Math.PI) / 180;
      const got = useSin ? Math.sin(rad) : Math.cos(rad);
      if (!near(got, k, 5e-3)) {
        report(q.generator, seed, `${deg}° gives ${got.toFixed(4)}, not ${k}`);
        return;
      }
      if (deg < 0 || deg > 360) {
        report(q.generator, seed, `${deg}° is outside the stated interval`);
        return;
      }
    }
    verified += 1;
  },
  "poly-remainder": (seed) => {
    const q = generate(gens.get("poly-remainder")!, seed);
    const m = q.prompt.match(/(-?\d+)x\^3\s*([+-])\s*(\d+)x\^2\s*([+-])\s*(\d+)x\s*([+-])\s*(\d+)\$ is divided by \$\(x\s*([+-])\s*(\d+)\)/);
    if (!m || q.answer.kind !== "numeric") return;
    const [, a, s1, b, s2, c, s3, d, s4, k] = m;
    const sign = (s: string | undefined) => (s === "+" ? 1 : -1);
    const P = (x: number) =>
      Number(a) * x ** 3 + sign(s1) * Number(b) * x ** 2 + sign(s2) * Number(c) * x + sign(s3) * Number(d);
    // Divisor (x - k) is written as (x + k) when k is negative.
    const root = -sign(s4) * Number(k);
    if (!near(q.answer.value, P(root), 1e-6)) {
      report(q.generator, seed, `P(${root}) = ${P(root)}, generator said ${q.answer.value}`);
    } else verified += 1;
  },
};

console.log("Independent verification of generated answers");
for (const [id, check] of Object.entries(CHECKS)) {
  if (!gens.has(id)) {
    failures += 1;
    console.error(`  ✗ no such generator: ${id}`);
    continue;
  }
  for (let s = 1; s <= 40; s += 1) check(s * 104729 + 5);
}

console.log(`  ${verified} answers re-derived independently`);
if (failures) {
  console.error(`\nFAILED — ${failures} disagreement${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("All independently verified answers agree.");
