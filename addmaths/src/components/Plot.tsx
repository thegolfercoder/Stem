import type { PlotSpec } from "@/lib/types";

/**
 * A function plotter that renders to plain SVG on the server.
 *
 * Every diagram on the site is generated from the same spec type, so a curve
 * in a lesson and the same curve in a worked solution cannot drift apart. The
 * sampler breaks the path where a function jumps (tan, 1/x) instead of drawing
 * the vertical line through the asymptote that naive plotters produce.
 */

const PALETTE = ["#2549d8", "#c23b3b", "#10896b", "#7b46c9", "#b06a09"];
const PALETTE_DARK = ["#8fb0ff", "#ff9d9d", "#5fd0ae", "#c6a2ff", "#e6b45c"];

const W = 640;
const PAD = { l: 44, r: 18, t: 16, b: 34 };

export function Plot({ spec }: { spec: PlotSpec }) {
  const H = spec.height ?? 380;
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * iw;
  const sy = (y: number) => PAD.t + ih - ((y - y0) / (y1 - y0)) * ih;

  const xTick = spec.xTick ?? niceTick(x1 - x0);
  const yTick = spec.yTick ?? niceTick(y1 - y0);
  const xTicks = ticks(x0, x1, spec.radians ? Math.PI / 2 : xTick);
  const yTicks = ticks(y0, y1, yTick);

  const axisY = clamp(0, y0, y1);
  const axisX = clamp(0, x0, x1);

  const shadePath = spec.shade ? buildShade(spec.shade, sx, sy, y0, y1) : null;

  return (
    <figure className="my-5">
      <div className="card overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={spec.caption ?? "Graph"}
        >
          <g className="text-[color:var(--border)]" stroke="currentColor" strokeWidth={1}>
            {xTicks.map((t) => (
              <line key={`gx${t}`} x1={sx(t)} y1={PAD.t} x2={sx(t)} y2={PAD.t + ih} opacity={0.55} />
            ))}
            {yTicks.map((t) => (
              <line key={`gy${t}`} x1={PAD.l} y1={sy(t)} x2={PAD.l + iw} y2={sy(t)} opacity={0.55} />
            ))}
          </g>

          {shadePath && (
            <path d={shadePath} className="fill-[color:var(--accent)]" opacity={0.16} />
          )}

          <g className="text-[color:var(--text-muted)]" stroke="currentColor" strokeWidth={1.4}>
            <line x1={PAD.l} y1={sy(axisY)} x2={PAD.l + iw} y2={sy(axisY)} />
            <line x1={sx(axisX)} y1={PAD.t} x2={sx(axisX)} y2={PAD.t + ih} />
          </g>

          {(spec.vLines ?? []).map((v, i) => (
            <line
              key={`v${i}`}
              x1={sx(v.x)}
              y1={PAD.t}
              x2={sx(v.x)}
              y2={PAD.t + ih}
              className="text-[color:var(--text-muted)]"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeDasharray="5 4"
              opacity={0.85}
            />
          ))}
          {(spec.hLines ?? []).map((h, i) => (
            <line
              key={`h${i}`}
              x1={PAD.l}
              y1={sy(h.y)}
              x2={PAD.l + iw}
              y2={sy(h.y)}
              className="text-[color:var(--text-muted)]"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeDasharray="5 4"
              opacity={0.85}
            />
          ))}

          <g className="text-[10px] fill-[color:var(--text-muted)]" fontFamily="var(--font-sans)">
            {xTicks.map((t) =>
              Math.abs(t - axisX) < 1e-9 ? null : (
                <text key={`tx${t}`} x={sx(t)} y={sy(axisY) + 14} textAnchor="middle">
                  {spec.radians ? radLabel(t) : fmt(t)}
                </text>
              ),
            )}
            {yTicks.map((t) =>
              Math.abs(t - axisY) < 1e-9 ? null : (
                <text key={`ty${t}`} x={sx(axisX) - 7} y={sy(t) + 3.5} textAnchor="end">
                  {fmt(t)}
                </text>
              ),
            )}
            <text x={PAD.l + iw} y={sy(axisY) - 8} textAnchor="end" className="fill-[color:var(--text)]" fontSize={12} fontStyle="italic">
              {spec.xLabel ?? "x"}
            </text>
            <text x={sx(axisX) + 8} y={PAD.t + 10} className="fill-[color:var(--text)]" fontSize={12} fontStyle="italic">
              {spec.yLabel ?? "y"}
            </text>
          </g>

          {(spec.curves ?? []).map((c, i) => {
            const idx = c.color ?? i;
            const segs = sample(c.f, c.domain?.[0] ?? x0, c.domain?.[1] ?? x1, y0, y1);
            return (
              <g key={`c${i}`}>
                {segs.map((seg, j) => (
                  <path
                    key={j}
                    d={path(seg, sx, sy)}
                    fill="none"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={c.dashed ? "7 5" : undefined}
                    stroke={PALETTE[idx % PALETTE.length]}
                    className="dark:hidden"
                  />
                ))}
                {segs.map((seg, j) => (
                  <path
                    key={`d${j}`}
                    d={path(seg, sx, sy)}
                    fill="none"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={c.dashed ? "7 5" : undefined}
                    stroke={PALETTE_DARK[idx % PALETTE_DARK.length]}
                    className="hidden dark:block"
                  />
                ))}
              </g>
            );
          })}

          {(spec.points ?? []).map((p, i) => (
            <g key={`p${i}`}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={4}
                className={p.open ? "fill-[color:var(--bg-card)]" : "fill-[color:var(--text)]"}
                stroke="currentColor"
                strokeWidth={1.6}
              />
              {p.label && (
                <text
                  x={sx(p.x) + 8}
                  y={sy(p.y) - 8}
                  className="fill-[color:var(--text)]"
                  fontSize={11.5}
                  fontFamily="var(--font-sans)"
                >
                  {p.label}
                </text>
              )}
            </g>
          ))}

          <g fontSize={12} fontFamily="var(--font-sans)">
            {(spec.curves ?? []).map((c, i) =>
              c.label ? (
                <g key={`l${i}`}>
                  <rect
                    x={PAD.l + 8}
                    y={PAD.t + 6 + i * 20}
                    width={9}
                    height={9}
                    rx={2}
                    fill={PALETTE[(c.color ?? i) % PALETTE.length]}
                    className="dark:hidden"
                  />
                  <rect
                    x={PAD.l + 8}
                    y={PAD.t + 6 + i * 20}
                    width={9}
                    height={9}
                    rx={2}
                    fill={PALETTE_DARK[(c.color ?? i) % PALETTE_DARK.length]}
                    className="hidden dark:block"
                  />
                  <text
                    x={PAD.l + 23}
                    y={PAD.t + 15 + i * 20}
                    className="fill-[color:var(--text)]"
                  >
                    {c.label}
                  </text>
                </g>
              ) : null,
            )}
          </g>
        </svg>
      </div>
      {spec.caption && (
        <figcaption className="muted mt-2 text-center text-sm">{spec.caption}</figcaption>
      )}
    </figure>
  );
}

type Pt = [number, number];

/**
 * Sample a function, splitting into separate polylines wherever it leaves the
 * viewport or jumps discontinuously — which is what keeps a tan graph from
 * being drawn with vertical strokes joining its branches.
 */
function sample(f: (x: number) => number, a: number, b: number, y0: number, y1: number): Pt[][] {
  const N = 900;
  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: number | null = null;
  const span = y1 - y0;
  for (let i = 0; i <= N; i += 1) {
    const x = a + ((b - a) * i) / N;
    let y: number;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    const bad = !Number.isFinite(y) || y < y0 - span || y > y1 + span;
    const jump = prev !== null && Math.abs(y - prev) > span * 0.6;
    if (bad || jump) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      prev = bad ? null : y;
      if (bad) continue;
    }
    cur.push([x, y]);
    prev = y;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

function path(pts: Pt[], sx: (n: number) => number, sy: (n: number) => number): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p[0]).toFixed(2)} ${sy(p[1]).toFixed(2)}`)
    .join(" ");
}

function buildShade(
  shade: NonNullable<PlotSpec["shade"]>,
  sx: (n: number) => number,
  sy: (n: number) => number,
  y0: number,
  y1: number,
): string {
  const N = 240;
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= N; i += 1) {
    const x = shade.from + ((shade.to - shade.from) * i) / N;
    const yt = clamp(shade.f(x), y0, y1);
    const yb = clamp(shade.g ? shade.g(x) : 0, y0, y1);
    if (Number.isFinite(yt) && Number.isFinite(yb)) {
      top.push([x, yt]);
      bottom.push([x, yb]);
    }
  }
  if (!top.length) return "";
  const forward = top.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p[0]).toFixed(2)} ${sy(p[1]).toFixed(2)}`);
  const back = bottom
    .slice()
    .reverse()
    .map((p) => `L${sx(p[0]).toFixed(2)} ${sy(p[1]).toFixed(2)}`);
  return `${forward.join(" ")} ${back.join(" ")} Z`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function niceTick(span: number): number {
  const raw = span / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * mag;
}

function ticks(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(a / step) * step;
  for (let t = start; t <= b + 1e-9; t += step) out.push(Math.abs(t) < 1e-12 ? 0 : t);
  return out;
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(Math.abs(r) < 1 ? 2 : 1);
}

/** Ticks as multiples of pi, for trigonometric graphs drawn in radians. */
function radLabel(x: number): string {
  const k = Math.round((x / Math.PI) * 2);
  if (k === 0) return "0";
  const half = k % 2 !== 0;
  const whole = half ? k : k / 2;
  const sign = whole < 0 ? "−" : "";
  const a = Math.abs(whole);
  const num = a === 1 ? "π" : `${a}π`;
  return half ? `${sign}${num}/2` : `${sign}${num}`;
}
