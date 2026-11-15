import { s, v } from "./lib";

const roots = (a: number, b: number, c: number) => {
  const d = Math.sqrt(b * b - 4 * a * c);
  return [(-b - d) / (2 * a), (-b + d) / (2 * a)].sort((p, q) => p - q);
};
const vertex = (a: number, b: number, c: number) => {
  const x = -b / (2 * a);
  return [x, a * x * x + b * x + c];
};
const scan = (f: (x: number) => number, lo: number, hi: number) => {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i <= 400000; i++) {
    const y = f(lo + ((hi - lo) * i) / 400000);
    mn = Math.min(mn, y);
    mx = Math.max(mx, y);
  }
  return [mn, mx];
};

{
  const [r1, r2] = roots(1, -2, -15);
  const [vx, vy] = vertex(1, -2, -15);
  v("qf-x1", s("x = -3", r1!, -3), s("x = 5", r2!, 5), s("vertex $(1, -16)$", vx! * 100 + vy!, 100 - 16));
}
{
  const [mn, mx] = scan((x) => (x * x - x + 1) / (x * x + x + 1), -200, 200);
  v("qf-x2", s("\\tfrac13 \\le y", mn!, 1 / 3), s("y \\le 3", mx!, 3));
}
{
  const f = (x: number) => 2 * x * x - 12 * x + 23;
  const [vx, vy] = vertex(2, -12, 23);
  v("qf-x3", s("2(x - 3)^2 + 5", f(1.7), 2 * (1.7 - 3) ** 2 + 5), s("minimum value $5$", vy!, 5), s("x = 3", vx!, 3));
}
{
  // Equal roots: k^2 - 36 = 0.
  const [k1, k2] = roots(1, 0, -36);
  v("qf-x4", s("k = -6", k1!, -6), s("k = 6", k2!, 6));
}
{
  // Discriminant 16 - 4k(k - 3) = -4k^2 + 12k + 16; its roots bound the region.
  const [k1, k2] = roots(-4, 12, 16);
  v("qf-x5", s("-1 < k", k1!, -1), s("k < 4", k2!, 4));
}
{
  const [vx, vy] = vertex(-2, 60, 0);
  v("qf-x6", s("450\\text{ m}^2", vy!, 450), s("x = 15", vx!, 15));
}
{
  const f = (x: number) => 3 * x * x + 12 * x + 5;
  const [vx, vy] = vertex(3, 12, 5);
  v("qf-x7", s("3(x + 2)^2 - 7", f(-0.3), 3 * (-0.3 + 2) ** 2 - 7), s("minimum $-7$", vy!, -7), s("x = -2", vx!, -2));
}
{
  // Tangency: the discriminant of x^2 - 6x + (7 - k) is zero, so 7 - k = 9.
  const k = 7 - 36 / 4;
  const [x] = roots(1, -6, 7 - k);
  v("qf-x8", s("k = -2", k, -2), s("(3, 4)", x! * 10 + (2 * x! + k), 34));
}
{
  // m^2 - 16 = 0 at the boundary.
  const [m1, m2] = roots(1, 0, -16);
  v("qf-x9", s("m < -4", m1!, -4), s("m > 4", m2!, 4));
}
