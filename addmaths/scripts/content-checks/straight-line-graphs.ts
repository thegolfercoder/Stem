import { s, v } from "./lib";

/** Foot of the perpendicular from (px, py) to y = mx + c, by projection. */
function foot(px: number, py: number, m: number, c: number): [number, number] {
  // Direction (1, m) from the point (0, c).
  const t = (px * 1 + (py - c) * m) / (1 + m * m);
  return [t, c + m * t];
}

v("line-x1", s("Length $10$", Math.hypot(6, 8), 10), s("$(4, 6)$", (1 + 7) / 2 * 10 + (2 + 10) / 2, 46), s("\\tfrac43", (10 - 2) / (7 - 1), 4 / 3));
{
  // The shown line 3x + 2y = 4 must pass through (2, -1) with gradient -3/2.
  const through = 3 * 2 + 2 * -1;
  v("line-x2", s("3x + 2y = 4", through, 4));
}
{
  const [fx, fy] = foot(5, 6, 2, -1);
  v("line-x3", s("(3.8, 6.6)", fx * 10 + fy, 44.6), s("\\dfrac{3\\sqrt5}{5}", Math.hypot(5 - fx, 6 - fy), (3 * Math.sqrt(5)) / 5), s("1.34", Math.hypot(5 - fx, 6 - fy)));
}
v("line-x4", s("(2, 3)", (-2 + (10 + 2) / 3) * 10 + (1 + (7 - 1) / 3), 23));
{
  const [fx, fy] = foot(5, 6, 2, -1);
  v("line-x5", s("(2.6, 7.2)", (2 * fx - 5) * 10 + (2 * fy - 6), 33.2));
}
{
  // Minimise PA + PB over P on the x-axis by a fine search.
  let best = Infinity, bx = 0;
  for (let i = 0; i <= 600000; i++) {
    const x = -10 + (20 * i) / 600000;
    const d = Math.hypot(x - 1, 2) + Math.hypot(x - 5, 4);
    if (d < best) [best, bx] = [d, x];
  }
  v("line-x6", s("\\tfrac73", bx, 7 / 3), s("2\\sqrt{13}", best, 2 * Math.sqrt(13)), s("7.21", best));
}
{
  // Perpendicular bisector: points equidistant from A and B. Check C on it and the shoelace area.
  const A = [-1, 3], B = [5, -1];
  const C = [0, -2];
  const eq = Math.hypot(C[0]! - A[0]!, C[1]! - A[1]!) - Math.hypot(C[0]! - B[0]!, C[1]! - B[1]!);
  const area = 0.5 * Math.abs(A[0]! * (B[1]! - C[1]!) + B[0]! * (C[1]! - A[1]!) + C[0]! * (A[1]! - B[1]!));
  // The shown line 3x - 2y = 4 must contain the midpoint (2, 1) and C.
  v("line-x7", s("3x - 2y = 4", 3 * 2 - 2 * 1 + (Math.abs(eq) < 1e-12 ? 0 : NaN), 4), s("area $13$", area, 13));
}
{
  const m = (1.8 - 0.9) / 3, c = 0.9 - m;
  v("line-x8", s("3.98", 10 ** c), s("2.00", 10 ** m), s("251", 10 ** (c + 6 * m)));
}
{
  const [rx, ry] = foot(0, 0, -2 / 3, 4);
  const t = (6 - rx) / 6;
  v("line-x9", s("\\tfrac{24}{13}", rx, 24 / 13), s("\\tfrac{36}{13}", ry, 36 / 13), s("9 : 4", t / (1 - t), 9 / 4));
}
