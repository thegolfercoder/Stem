import { realRoots, s, v } from "./lib";

/** Synthetic evaluation from coefficients, highest power first. */
const P = (c: number[]) => (x: number) => c.reduce((acc, k) => acc * x + k, 0);

/** Polynomial long division, highest power first; returns [quotient, remainder]. */
function divide(num: number[], den: number[]): [number[], number[]] {
  const n = [...num];
  const q: number[] = [];
  while (n.length >= den.length) {
    const k = n[0]! / den[0]!;
    q.push(k);
    for (let i = 0; i < den.length; i++) n[i]! -= k * den[i]!;
    n.shift();
  }
  return [q, n];
}

v("poly-x1", s("$7$", P([1, 2, -5, 1])(2), 7));
{
  const f = P([1, 0, -7, -6]);
  const t = 0.7;
  v("poly-x2", s("(x + 1)(x + 2)(x - 3)", f(t), (t + 1) * (t + 2) * (t - 3)));
}
{
  const [, rem] = divide([2, -3, 0, 4], [2, -1]);
  v("poly-x3", s("\\dfrac{7}{2}", rem[0]!, 3.5));
}
{
  const r = realRoots(P([1, -2, -5, 6]), -10, 10);
  v("poly-x4", s("-2 < x", r[0]!, -2), s("x < 1", r[1]!, 1), s("x > 3", r[2]!, 3));
}
{
  // 2a + b = -1 and 2a - b = 1, by Cramer's rule.
  const det = 2 * -1 - 1 * 2;
  const a = (-1 * -1 - 1 * 1) / det, b = (2 * 1 - 2 * -1) / det;
  const r = realRoots(P([1, a, b, -6]), -50, 50);
  v("poly-x5", s("$a = 0$", a, 0), s("$b = -1$", b, -1), s("x = 2", r.length === 1 ? r[0]! : NaN, 2));
}
{
  // A concrete P with P(1) = 3 and P(2) = 5: x^3 - 5x + 7. Divide by x^2 - 3x + 2.
  const p = P([1, 0, -5, 7]);
  if (p(1) !== 3 || p(2) !== 5) throw new Error("poly-x6 test polynomial is wrong");
  const [, rem] = divide([1, 0, -5, 7], [1, -3, 2]);
  v("poly-x6", s("2x + 1", P(rem)(10), 2 * 10 + 1));
}
{
  const f = P([2, 3, -11, -6]);
  const r = realRoots(f, -10, 10);
  const t = 0.4;
  v(
    "poly-x7",
    s("(x - 2)(2x + 1)(x + 3)", f(t), (t - 2) * (2 * t + 1) * (t + 3)),
    s("x = -3", r[0]!, -3),
    s("x = -\\tfrac12", r[1]!, -0.5),
    s("x = 2", r[2]!, 2),
  );
}
{
  // a + b = 3 and 2a - b = 6.
  const a = (3 + 6) / 3, b = 3 - a;
  const f = P([1, a, b, -4]);
  const [q] = divide([1, a, b, -4], [1, 1, -2]);
  v("poly-x8", s("$a = 3$", a, 3), s("$b = 0$", b, 0), s("$(x + 2)$", -q[1]! / q[0]!, -2));
  void f;
}
{
  const r = realRoots(P([1, -5, 3, 1]), -10, 10);
  v("poly-x9", s("x = 1", r[1]!, 1), s("4.24", r[2]!), s("-0.236", r[0]!));
}
