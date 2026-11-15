import { realRoots, s, v } from "./lib";

v("rad-x1", s("7.2", 6 * 1.2), s("21.6", 0.5 * 36 * 1.2));
v("rad-x2", s("\\dfrac{3\\pi}{4}", (135 * Math.PI) / 180, (3 * Math.PI) / 4), s("143.2", (2.5 * 180) / Math.PI));
{
  const rs = realRoots((r) => 0.5 * r * (20 - 2 * r) - 24, 0.01, 10);
  const th = rs.map((r) => (20 - 2 * r) / r);
  v("rad-x3", s("$r = 4$", rs[0]!, 4), s("$\\theta = 3$", th[0]!, 3), s("$r = 6$", rs[1]!, 6), s("\\theta = \\tfrac43", th[1]!, 4 / 3));
}
{
  // Chord by the cosine rule, independently of the half-angle formula.
  const chord = Math.sqrt(200 - 200 * Math.cos(1.4));
  v("rad-x4", s("12.9", chord), s("20.7", 0.5 * 100 * 1.4 - 0.5 * 100 * Math.sin(1.4)));
}
{
  const at = 5 * Math.tan(1.1);
  v("rad-x5", s("21.6", 5 * at - 0.5 * 25 * 2.2), s("30.6", 2 * at + 5 * 2.2));
}
{
  const th = realRoots((t) => t - Math.sin(t) - Math.PI / 2, 0.01, 2 * Math.PI)[0]!;
  v("rad-x6", s("2.31", th));
}
{
  const chord = Math.sqrt(128 - 128 * Math.cos(0.9));
  v("rad-x7", s("$7.2$", 7.2, 7.2), s("6.96", chord), s("14.2", 7.2 + chord), s("3.73", 32 * 0.9 - 32 * Math.sin(0.9)));
}
v(
  "rad-x8",
  s("6\\pi - 9\\sqrt{3}", 0.5 * 36 * (Math.PI / 3) - 0.5 * 36 * Math.sin(Math.PI / 3), 6 * Math.PI - 9 * Math.sqrt(3)),
  s("2\\pi + 6", 6 * (Math.PI / 3) + Math.sqrt(72 - 72 * Math.cos(Math.PI / 3)), 2 * Math.PI + 6),
);
{
  // Lens area by numerical integration: the overlap is |x - 4| <= ..., integrate 2*sqrt(25 - x^2) on [3, 5] twice.
  let area = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const x = 4 + (1 * (i + 0.5)) / N; // from x = 4 to x = 5 for the circle centred at 0
    area += 2 * Math.sqrt(Math.max(0, 25 - x * x)) * (1 / N);
  }
  v("rad-x9", s("8.18", 2 * area));
}
