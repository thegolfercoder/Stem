import { realRoots, s, v } from "./lib";

{
  const r = realRoots((x) => x * x + (5 - x) ** 2 - 13, -20, 20);
  v("sim-x1", s("x = 2, y = 3", r[0]! * 10 + (5 - r[0]!), 23), s("x = 3, y = 2", r[1]! * 10 + (5 - r[1]!), 32));
}
{
  const r = realRoots((x) => x * x - 4 - (2 * x - 1), -20, 20);
  v("sim-x2", s("x = 3, y = 5", r[1]! * 10 + (2 * r[1]! - 1), 35), s("x = -1, y = -3", r[0]! * 10 + (2 * r[0]! - 1), -13));
}
{
  const r = realRoots((x) => x * x - 3 - 2 * x, -20, 20);
  const [a, b] = [r[0]!, r[1]!];
  v("sim-x3", s("4\\sqrt{5}", Math.hypot(b - a, 2 * b - 2 * a), 4 * Math.sqrt(5)));
}
{
  const r = realRoots((y) => (7 - 2 * y) * y - 6, -20, 20);
  v("sim-x4", s("x = 3, y = 2", (7 - 2 * r[1]!) * 10 + r[1]!, 32), s("x = 4, y = \\tfrac32", 7 - 2 * r[0]!, 4));
}
{
  const r = realRoots((y) => (y + 3) * y - 10, -20, 20).filter((y) => y > 0 && y + 3 > 0);
  v("sim-x5", s("$x = 5$", r.length === 1 ? r[0]! + 3 : NaN, 5), s("$y = 2$", r[0]!, 2));
}
{
  // Brute-force search on a grid, refined: points with x^2 + y^2 = 10 and xy = 3.
  const sols: string[] = [];
  for (const x of realRoots((x) => x ** 4 - 10 * x * x + 9, -10, 10)) sols.push(`${Math.round(x)},${Math.round(3 / x)}`);
  const want = new Set(["3,1", "1,3", "-1,-3", "-3,-1"]);
  const match = sols.length === 4 && sols.every((p) => want.has(p)) ? 4 : NaN;
  v("sim-x6", s("$(3, 1)$, $(1, 3)$, $(-1, -3)$, $(-3, -1)$", match, 4));
}
{
  const f = (x: number) => x * x + x * (2 * x + 3) + (2 * x + 3) ** 2 - 7;
  const r = realRoots(f, -20, 20);
  v(
    "sim-x7",
    s("x = -2, y = -1", r[0]! * 10 + (2 * r[0]! + 3), -21),
    s("x = -\\tfrac17", r[1]!, -1 / 7),
    s("y = \\tfrac{19}{7}", 2 * r[1]! + 3, 19 / 7),
  );
}
{
  const r = realRoots((x) => 2 * x * x + (3 - x) ** 2 - 11, -20, 20);
  const [xb, xa] = [r[0]!, r[1]!];
  v(
    "sim-x8",
    s("2.29", xa),
    s("0.709", 3 - xa),
    s("-0.291", xb),
    s("3.29", 3 - xb),
    s("3.65", Math.hypot(xa - xb, (3 - xa) - (3 - xb))),
  );
}
{
  const r = realRoots((x) => x * (6 - x) - 8, -20, 20).filter((x) => x > 0 && 6 - x > 0);
  v("sim-x9", s("x = 2, y = 4", r[0]! * 10 + (6 - r[0]!), 24), s("x = 4, y = 2", r[1]! * 10 + (6 - r[1]!), 42));
}
