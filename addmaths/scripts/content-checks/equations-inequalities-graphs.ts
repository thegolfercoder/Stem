import { realRoots, s, v } from "./lib";

{
  const r = realRoots((x) => Math.abs(3 * x - 2) - 7, -20, 20);
  v("mod-x1", s("x = 3", r[1]!, 3), s("x = -\\dfrac53", r[0]!, -5 / 3));
}
{
  const r = realRoots((x) => Math.abs(x - 4) - 3, -20, 20);
  v("mod-x2", s("1 \\le x", r[0]!, 1), s("x \\le 7", r[1]!, 7));
}
{
  const g = (x: number) => Math.abs(x - 2) - Math.abs(2 * x + 1);
  const r = realRoots(g, -20, 20);
  v("mod-x3", s("x = \\dfrac13", r[1]!, 1 / 3), s("x = -3", r[0]!, -3));
  // The inequality holds where g < 0: check a point in each claimed region and outside.
  const ok = g(-4) < 0 && g(1) < 0 && g(0) > 0;
  v("mod-x4", s("x < -3", ok ? r[0]! : NaN, -3), s("x > \\dfrac13", ok ? r[1]! : NaN, 1 / 3));
}
{
  const r = realRoots((x) => Math.abs(x * x - 5 * x) - 6, -20, 20);
  v("mod-x5", s("x = -1", r[0]!, -1), s("x = 2", r[1]!, 2), s("x = 3", r[2]!, 3), s("x = 6", r[3]!, 6));
}
{
  const h = (x: number) => Math.abs(x - 1) + Math.abs(x - 3);
  const r = realRoots((x) => h(x) - 4, -20, 20);
  // Constant value on [1, 3].
  const flat = [1, 1.5, 2.2, 3].map(h);
  const k = flat.every((y) => Math.abs(y - flat[0]!) < 1e-12) ? flat[0]! : NaN;
  v("mod-x6", s("x = 0", r[0]!, 0), s("x = 4", r[1]!, 4), s("k = 2", k, 2));
}
{
  const r = realRoots((x) => Math.abs(2 * x + 3) - Math.abs(x - 6), -50, 50);
  v("mod-x7", s("x = -9", r[0]!, -9), s("x = 1", r[1]!, 1));
}
{
  const r = realRoots((x) => Math.abs(2 * x - 4) - (x + 1), -50, 50);
  v("mod-x8", s("1 < x", r[0]!, 1), s("x < 5", r[1]!, 5));
}
{
  const r = realRoots((x) => 2 * x - 7 * Math.sqrt(x) + 3, 0, 50);
  v("mod-x9", s("x = \\dfrac14", r[0]!, 0.25), s("x = 9", r[1]!, 9));
}
