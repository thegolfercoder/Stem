import { proof, s, v } from "./lib";
void proof;
const r3 = Math.sqrt(3), r5 = Math.sqrt(5), r2 = Math.sqrt(2), r6 = Math.sqrt(6);
const quadRoots = (a: number, b: number, c: number) => {
  const d = Math.sqrt(b * b - 4 * a * c);
  return [(-b - d) / (2 * a), (-b + d) / (2 * a)];
};

v("is-x1", s("5\\sqrt{3}", Math.sqrt(48) + Math.sqrt(27) - Math.sqrt(12), 5 * r3));
{
  const [u1, u2] = quadRoots(1, -6, 8);
  v("is-x2", s("x = 1", Math.log2(u1!), 1), s("x = 2", Math.log2(u2!), 2));
}
v("is-x3", s("\\dfrac{7}{2} + \\dfrac{3}{2}\\sqrt{5}", (3 + r5) / (3 - r5), 3.5 + 1.5 * r5));
{
  const [u1, u2] = quadRoots(3, -28, 9);
  v("is-x4", s("x = -1", Math.log(u1!) / Math.log(3), -1), s("x = 2", Math.log(u2!) / Math.log(3), 2));
}
v("is-x5", s("5 - \\sqrt{3}", Math.sqrt(28 - 10 * r3), 5 - r3));
{
  const x = 2 + r3;
  v("is-x6", s("(a) $4$", x + 1 / x, 4), s("(b) $14$", x ** 2 + x ** -2, 14), s("(c) $52$", x ** 3 + x ** -3, 52));
}
v(
  "is-x7",
  s("4 + 3\\sqrt{6}", (5 * r2 - 2 * r3) * (r2 + r3), 4 + 3 * r6),
  s("5\\sqrt{2} - 2\\sqrt{3}", (4 + 3 * r6) / (r2 + r3), 5 * r2 - 2 * r3),
);
{
  const [u1, u2] = quadRoots(8, -17, 2);
  const xs = [Math.log2(u1!), Math.log2(u2!)];
  v("is-x8", s("x = -3", xs[0]!, -3), s("x = 1", xs[1]!, 1));
}
{
  // 3x + 2y = 7, 3x - 2y = -1, by Cramer's rule.
  const det = 3 * -2 - 2 * 3;
  const x = (7 * -2 - 2 * -1) / det;
  const y = (3 * -1 - 3 * 7) / det;
  v("is-x9", s("x = 1", x, 1), s("y = 2", y, 2));
}
