import { realRoots, s, v } from "./lib";

v("cir-x1", s("(x - 2)^2 + (y + 3)^2 = 25", (5 - 2) ** 2 + (1 + 3) ** 2, 25));
{
  const cx = (-1 + 5) / 2, cy = (2 + 10) / 2, r = Math.hypot(6, 8) / 2;
  // The shown equation at the point A must give r^2 = 25.
  v("cir-x2", s("(x - 2)^2 + (y - 6)^2 = 25", r * r, (-1 - cx) ** 2 + (2 - cy) ** 2));
}
{
  const xs = realRoots((x) => x * x + 36 - 6 * x - 24 - 12, -20, 20);
  v("cir-x3", s("length $6$", xs[1]! - xs[0]!, 6));
}
{
  // Tangent at P: the line must pass through P and be perpendicular to CP.
  const through = 3 * 6 + 4 * 6;
  const dot = 3 * (6 - 3) * 0 + (-4 / 3) * (4 / 3) * 0; // placeholder for clarity
  void dot;
  const perp = (-3 / 4) * ((6 - 2) / (6 - 3));
  v("cir-x4", s("3x + 4y = 42", through + (Math.abs(perp + 1) < 1e-12 ? 0 : NaN), 42));
}
{
  // Centre equidistant from A and B, on y = 2x: solve |(t,2t) - A| = |(t,2t) - B|.
  const t = realRoots((t) => Math.hypot(t - 1, 2 * t - 5) - Math.hypot(t - 7, 2 * t + 1), -50, 50)[0]!;
  const r2 = (1 - t) ** 2 + (5 - 2 * t) ** 2;
  v("cir-x5", s("(x + 2)^2 + (y + 4)^2 = 90", r2 + 0 * t, (1 + 2) ** 2 + (5 + 4) ** 2));
  if (Math.abs(t + 2) > 1e-9) throw new Error("cir-x5 centre is wrong");
}
{
  const cp2 = 7 ** 2 + 5 ** 2;
  const pa = Math.sqrt(cp2 - 25);
  v("cir-x6", s("PA = 7", pa, 7), s("area $35$", 2 * 0.5 * 5 * pa, 35));
}
{
  const xs = realRoots((x) => x * x + 4 + 4 * x - 20 + 4, -20, 20);
  const r = Math.sqrt(4 + 25 - 4);
  v("cir-x7", s("radius $5$", r, 5), s("$(2, 2)$", xs[1]!, 2), s("$(-6, 2)$", xs[0]!, -6));
}
{
  const xs = realRoots((x) => 25 * x * x - 180 * x + 324 + 1e-9, -20, 20);
  // A tangent gives a double root; take the vertex of the quadratic and check it is on both curves.
  const x = 180 / 50, y = (30 - 3 * x) / 4;
  v("cir-x8", s("$(3.6, 4.8)$", x * 10 + y, 40.8), s("discriminant $= 0$", 180 ** 2 - 4 * 25 * 324, 0));
  void xs;
  if (Math.abs(x * x + y * y - 36) > 1e-9) throw new Error("cir-x8 point not on circle");
}
{
  const x = realRoots((x) => x * x - (x - 8) ** 2, -20, 20)[0]!;
  const y = Math.sqrt(25 - x * x);
  v("cir-x9", s("$(4, 3)$", x * 10 + y, 43), s("length $6$", 2 * y, 6));
}
