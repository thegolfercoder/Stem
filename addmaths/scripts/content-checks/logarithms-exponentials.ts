import { realRoots, s, v } from "./lib";

const log = (b: number, x: number) => Math.log(x) / Math.log(b);

v("log-x1", s("$1$", log(3, 81) + log(2, 1 / 8), 1));
v("log-x2", s("$2$", 2 * Math.log10(5) + Math.log10(4), 2));
{
  const r = realRoots((x) => log(2, x) + log(4, x) - 6, 0.5, 1000);
  v("log-x3", s("x = 16", r[0]!, 16));
}
{
  const r = realRoots((x) => 2 * x * Math.log(3) - (x + 1) * Math.log(5), -10, 10);
  v("log-x4", s("2.74", r[0]!));
}
{
  let n = 0;
  while (0.8 ** n >= 0.1) n++;
  v("log-x5", s("n = 11", n, 11));
}
{
  const a = 2, b = 8; // log_2 8 = 3
  v("log-x6", s("(a) $\\tfrac13$", log(b, a), 1 / 3), s("(b) $\\tfrac32$", log(a * a, b), 1.5), s("(c) $\\tfrac14$", log(a * b, a), 0.25));
}
{
  const r = realRoots((x) => log(3, x + 3) + log(3, x - 3) - 3, 3.0001, 100);
  v("log-x7", s("x = 6", r.length === 1 ? r[0]! : NaN, 6));
}
{
  const P = (t: number) => 500 * Math.exp(0.04 * t);
  let t = 0;
  while (P(t) <= 2000) t++;
  v("log-x8", s("746", P(10)), s("17.3", realRoots((t) => P(t) - 1000, 0, 100)[0]!), s("t = 35", t, 35));
}
{
  const r = realRoots((x) => 2 * log(x, 3) + log(3, x) - 3, 1.0001, 100);
  v("log-x9", s("x = 3", r[0]!, 3), s("x = 9", r[1]!, 9));
}
