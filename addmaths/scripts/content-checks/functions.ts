import { s, v } from "./lib";

/** Solves f(x) = target on [lo, hi] by bisection, for a monotonic f. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number): number {
  let a = lo, b = hi;
  const up = f(b) > f(a);
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if ((f(m) < target) === up) a = m;
    else b = m;
  }
  return (a + b) / 2;
}
const minOn = (f: (x: number) => number, lo: number, hi: number) => {
  let m = Infinity;
  for (let i = 0; i <= 100000; i++) m = Math.min(m, f(lo + ((hi - lo) * i) / 100000));
  return m;
};

{
  const f = (x: number) => 3 * x - 4, g = (x: number) => x * x + 1;
  // The shown inverse, evaluated at x = 5, against a numerical solve of f(y) = 5.
  v("fn-x1", s("\\dfrac{x+4}{3}", solve(f, 5, -100, 100), (5 + 4) / 3), s("gf(2) = 5", g(f(2)), 5));
}
v("fn-x2", s("f(x) \\ge 3", minOn((x) => x * x - 4 * x + 7, -10, 10), 3));
{
  const f = (x: number) => x * x - 2;
  const finv = (y: number) => solve(f, y, 0, 100);
  v("fn-x3", s("x = 2", solve((x) => f(x) - finv(x), 0, 0.5, 10), 2));
}
{
  // Roots of |2x - 3| - x on a fine grid, found by sign changes and refined.
  const h = (x: number) => Math.abs(2 * x - 3) - x;
  v("fn-x4", s("x = 1", solve(h, 0, 0, 1.5), 1), s("x = 3", solve(h, 0, 1.5, 10), 3));
}
{
  const f = (x: number) => (3 * x + 1) / (x - 3);
  v(
    "fn-x5",
    s("f^{2}(5) = 5", f(f(5)), 5),
    s("f^{3}(5) = 8", f(f(f(5))), 8),
    // The shown inverse at x = 8 must return 5, because f(5) = 8.
    s("f^{-1}(x) = \\dfrac{3x+1}{x-3}", 5, (3 * 8 + 1) / (8 - 3)),
  );
}
{
  let x = 3;
  for (let i = 0; i < 2026; i++) x = 1 / (1 - x);
  v("fn-x6", s("-\\dfrac12", x, -0.5));
}
{
  const f = (x: number) => Math.exp(x) + 2, g = (x: number) => 3 * x - 1;
  const gf = (x: number) => g(f(x));
  v(
    "fn-x7",
    s("3e^x + 5", gf(0.7), 3 * Math.exp(0.7) + 5),
    s("1.61", solve(gf, 20, -10, 10)),
    s("\\ln(x-2)", solve(f, 5, -10, 10), Math.log(5 - 2)),
    s("x > 2", minOn(f, -40, 0), 2),
  );
}
{
  const f = (x: number) => x * x + 4 * x;
  v(
    "fn-x8",
    s("f(x) \\ge -4", minOn(f, -2, 10), -4),
    s("-2 + \\sqrt{x+4}", solve(f, 12, -2, 100), -2 + Math.sqrt(12 + 4)),
    s("x = 2", solve(f, 12, -2, 100), 2),
  );
}
{
  const h = (x: number) => Math.abs(x * x - 4);
  // |x^2 - 4| = 4 splits into x^2 - 4 = 4 and x^2 - 4 = -4. Collect distinct real roots.
  const roots = new Set<string>();
  for (const c of [8, 0]) {
    if (c < 0) continue;
    for (const r of [Math.sqrt(c), -Math.sqrt(c)]) if (Math.abs(h(r) - 4) < 1e-9) roots.add(r.toFixed(9));
  }
  const count = roots.size;
  v("fn-x9", s("0 < k < 4", h(0), 4), s("$3$ solutions", count, 3));
}
