"use client";

import { useMemo, useState } from "react";
import { M } from "./Math";

/**
 * The interactive tools.
 *
 * Each one is deliberately small and shows its working, so it reinforces the
 * method rather than replacing it. The grapher plots functions written in the
 * ordinary way (`x^2 - 3x`, `sin(2x)`, `e^x`) using a small hand-written
 * evaluator — no expression-parsing dependency, and nothing is eval'd.
 */
export function ToolsClient() {
  return (
    <div className="space-y-6 py-9">
      <Grapher />
      <div className="grid gap-6 lg:grid-cols-2">
        <QuadraticSolver />
        <RadianConverter />
        <BinomialTool />
        <ProgressionTool />
      </div>
      <DerivativeTool />
    </div>
  );
}

/* ----------------------------------------------------------- expressions */

type Fn = (x: number) => number;

/**
 * Compiles a small subset of mathematical notation into a function.
 * Supported: + - * / ^, brackets, implicit multiplication (2x, 3sin x),
 * x, pi, e, and the functions sin cos tan sec cosec cot ln log sqrt abs exp.
 */
export function compile(src: string): { fn: Fn; error: string | null } {
  const tokens = tokenise(src.toLowerCase());
  if (!tokens) return { fn: () => NaN, error: "That expression could not be read." };
  let pos = 0;

  function peek(): string | undefined {
    return tokens![pos];
  }
  function eat(t: string): boolean {
    if (tokens![pos] === t) {
      pos += 1;
      return true;
    }
    return false;
  }

  function expr(): Fn | null {
    let left: Fn | null = term();
    if (!left) return null;
    for (;;) {
      if (eat("+")) {
        const r = term();
        if (!r) return null;
        const l: Fn = left;
        left = (x) => l(x) + r(x);
      } else if (eat("-")) {
        const r = term();
        if (!r) return null;
        const l: Fn = left;
        left = (x) => l(x) - r(x);
      } else return left;
    }
  }

  function term(): Fn | null {
    let left: Fn | null = unary();
    if (!left) return null;
    for (;;) {
      if (eat("*")) {
        const r = unary();
        if (!r) return null;
        const l: Fn = left;
        left = (x) => l(x) * r(x);
      } else if (eat("/")) {
        const r = unary();
        if (!r) return null;
        const l: Fn = left;
        left = (x) => l(x) / r(x);
      } else if (isImplicit(peek())) {
        // Implicit multiplication: 2x, 3sin(x), x(x+1)
        const r = unary();
        if (!r) return null;
        const l: Fn = left;
        left = (x) => l(x) * r(x);
      } else return left;
    }
  }

  function unary(): Fn | null {
    if (eat("-")) {
      const v = unary();
      return v ? (x) => -v(x) : null;
    }
    return power();
  }

  function power(): Fn | null {
    const base = atom();
    if (!base) return null;
    if (eat("^")) {
      const exp = unary();
      if (!exp) return null;
      return (x) => base(x) ** exp(x);
    }
    return base;
  }

  const FUNCS: Record<string, (v: number) => number> = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    sec: (v) => 1 / Math.cos(v),
    cosec: (v) => 1 / Math.sin(v),
    cot: (v) => 1 / Math.tan(v),
    ln: Math.log,
    log: Math.log10,
    sqrt: Math.sqrt,
    abs: Math.abs,
    exp: Math.exp,
  };

  function atom(): Fn | null {
    const t = peek();
    if (t === undefined) return null;
    if (t === "(") {
      pos += 1;
      const inner = expr();
      if (!inner || !eat(")")) return null;
      return inner;
    }
    if (/^[0-9]/.test(t)) {
      pos += 1;
      const v = Number(t);
      return () => v;
    }
    if (t === "x") {
      pos += 1;
      return (x) => x;
    }
    if (t === "pi") {
      pos += 1;
      return () => Math.PI;
    }
    if (t === "e") {
      pos += 1;
      return () => Math.E;
    }
    const f = FUNCS[t];
    if (f) {
      pos += 1;
      const arg = atom();
      if (!arg) return null;
      // Allow "sin 2x" to mean sin(2x) when brackets are omitted.
      return (x) => f(arg(x));
    }
    return null;
  }

  function isImplicit(t: string | undefined): boolean {
    if (t === undefined) return false;
    return t === "(" || t === "x" || t === "pi" || t === "e" || /^[0-9]/.test(t) || t in FUNCS;
  }

  const fn = expr();
  if (!fn || pos !== tokens.length) {
    return { fn: () => NaN, error: "That expression could not be read." };
  }
  return { fn, error: null };
}

function tokenise(src: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j += 1;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z]/.test(src[j]!)) j += 1;
      const word = src.slice(i, j);
      // Split a run of letters into known names, so "xsinx" still parses.
      const known = ["cosec", "sqrt", "sin", "cos", "tan", "sec", "cot", "log", "abs", "exp", "ln", "pi", "x", "e"];
      let rest = word;
      while (rest.length) {
        const match = known.find((k) => rest.startsWith(k));
        if (!match) return null;
        out.push(match);
        rest = rest.slice(match.length);
      }
      i = j;
      continue;
    }
    return null;
  }
  return out;
}

/* --------------------------------------------------------------- grapher */

const PALETTE = ["#2549d8", "#c23b3b", "#10896b"];

function Grapher() {
  const [inputs, setInputs] = useState<string[]>(["x^2 - 3x + 1", "2x - 3", ""]);
  const [range, setRange] = useState({ x0: -6, x1: 6, y0: -8, y1: 8 });

  const compiled = useMemo(
    () => inputs.map((src) => (src.trim() ? compile(src) : null)),
    [inputs],
  );

  const W = 720;
  const H = 420;
  const pad = { l: 42, r: 16, t: 16, b: 32 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - range.x0) / (range.x1 - range.x0)) * iw;
  const sy = (y: number) => pad.t + ih - ((y - range.y0) / (range.y1 - range.y0)) * ih;

  const paths = compiled.map((c) => {
    if (!c || c.error) return [];
    const segs: string[] = [];
    let d = "";
    let prev: number | null = null;
    const span = range.y1 - range.y0;
    for (let i = 0; i <= 900; i += 1) {
      const x = range.x0 + ((range.x1 - range.x0) * i) / 900;
      const y = c.fn(x);
      const bad = !Number.isFinite(y) || y < range.y0 - span || y > range.y1 + span;
      const jump = prev !== null && Math.abs(y - prev) > span * 0.6;
      if (bad || jump) {
        if (d) segs.push(d);
        d = "";
        prev = bad ? null : y;
        if (bad) continue;
      }
      d += `${d ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
      prev = y;
    }
    if (d) segs.push(d);
    return segs;
  });

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="grapher">
      <h2 id="grapher" className="text-lg font-bold">
        Graph plotter
      </h2>
      <p className="muted mt-1 text-sm">
        Type functions of $x$ the way you would write them: <code>x^2 - 3x</code>,{" "}
        <code>sin 2x</code>, <code>e^x</code>, <code>1/(x-2)</code>, <code>abs(x^2-4)</code>.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {inputs.map((v, i) => (
          <div key={i}>
            <label htmlFor={`fn${i}`} className="mb-1 block text-xs font-medium">
              <span aria-hidden style={{ color: PALETTE[i] }}>
                ●
              </span>{" "}
              Function {i + 1}
            </label>
            <input
              id={`fn${i}`}
              value={v}
              onChange={(e) => setInputs((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
              placeholder={i === 2 ? "optional" : ""}
            />
            {compiled[i]?.error && <p className="mt-1 text-xs text-[color:var(--hard)]">{compiled[i]!.error}</p>}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["x0", "x min"],
            ["x1", "x max"],
            ["y0", "y min"],
            ["y1", "y max"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={`r-${key}`} className="mb-1 block text-xs font-medium">
              {label}
            </label>
            <input
              id={`r-${key}`}
              type="number"
              value={range[key]}
              onChange={(e) => setRange((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--border)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Plot of the entered functions">
          <g stroke="var(--border)" strokeWidth={1}>
            {gridLines(range.x0, range.x1).map((t) => (
              <line key={`gx${t}`} x1={sx(t)} y1={pad.t} x2={sx(t)} y2={pad.t + ih} />
            ))}
            {gridLines(range.y0, range.y1).map((t) => (
              <line key={`gy${t}`} x1={pad.l} y1={sy(t)} x2={pad.l + iw} y2={sy(t)} />
            ))}
          </g>
          <g stroke="var(--text-muted)" strokeWidth={1.4}>
            <line x1={pad.l} y1={sy(clamp(0, range.y0, range.y1))} x2={pad.l + iw} y2={sy(clamp(0, range.y0, range.y1))} />
            <line x1={sx(clamp(0, range.x0, range.x1))} y1={pad.t} x2={sx(clamp(0, range.x0, range.x1))} y2={pad.t + ih} />
          </g>
          <g fontSize={10} fill="var(--text-muted)">
            {gridLines(range.x0, range.x1).map((t) => (
              <text key={`tx${t}`} x={sx(t)} y={sy(clamp(0, range.y0, range.y1)) + 13} textAnchor="middle">
                {t}
              </text>
            ))}
            {gridLines(range.y0, range.y1).map((t) => (
              <text key={`ty${t}`} x={sx(clamp(0, range.x0, range.x1)) - 6} y={sy(t) + 3.5} textAnchor="end">
                {t}
              </text>
            ))}
          </g>
          {paths.map((segs, i) =>
            segs.map((d, j) => (
              <path key={`${i}-${j}`} d={d} fill="none" stroke={PALETTE[i]} strokeWidth={2.2} strokeLinecap="round" />
            )),
          )}
        </svg>
      </div>
    </section>
  );
}

function gridLines(a: number, b: number): number[] {
  const span = b - a;
  const raw = span / 10;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) {
    out.push(Math.round(t * 1000) / 1000);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/* ------------------------------------------------------ quadratic solver */

function QuadraticSolver() {
  const [a, setA] = useState("1");
  const [b, setB] = useState("-5");
  const [c, setC] = useState("6");
  const A = Number(a);
  const B = Number(b);
  const C = Number(c);
  const valid = Number.isFinite(A) && Number.isFinite(B) && Number.isFinite(C) && A !== 0;
  const disc = B * B - 4 * A * C;

  return (
    <section className="card p-5" aria-labelledby="quad">
      <h2 id="quad" className="text-lg font-bold">
        Quadratic and discriminant
      </h2>
      <p className="muted mt-1 text-sm">
        For <M>{"ax^2 + bx + c = 0"}</M>: the roots, the discriminant, and the completed square.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(
          [
            [a, setA, "a"],
            [b, setB, "b"],
            [c, setC, "c"],
          ] as const
        ).map(([val, set, label]) => (
          <div key={label}>
            <label htmlFor={`q-${label}`} className="mb-1 block text-xs font-medium">
              {label}
            </label>
            <input
              id={`q-${label}`}
              value={val}
              onChange={(e) => set(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 text-sm">
        {!valid ? (
          <p className="muted">Enter three numbers, with $a \ne 0$.</p>
        ) : (
          <>
            <p>
              Discriminant <M>{`b^2 - 4ac = ${round(disc)}`}</M>
            </p>
            <p className="muted">
              {disc > 0
                ? "Positive: two distinct real roots, so the curve crosses the x-axis twice."
                : disc === 0
                  ? "Zero: one repeated root, so the x-axis is a tangent to the curve."
                  : "Negative: no real roots, so the curve never meets the x-axis."}
            </p>
            {disc >= 0 && (
              <p>
                Roots:{" "}
                <M>{`x = ${round((-B + Math.sqrt(disc)) / (2 * A))}`}</M>
                {disc > 0 && (
                  <>
                    {" and "}
                    <M>{`x = ${round((-B - Math.sqrt(disc)) / (2 * A))}`}</M>
                  </>
                )}
              </p>
            )}
            <p>
              Completed square:{" "}
              <M>{`${A === 1 ? "" : round(A)}\\left(x ${B / (2 * A) >= 0 ? "+" : "-"} ${round(Math.abs(B / (2 * A)))}\\right)^2 ${C - (B * B) / (4 * A) >= 0 ? "+" : "-"} ${round(Math.abs(C - (B * B) / (4 * A)))}`}</M>
            </p>
            <p className="muted">
              Vertex at <M>{`\\left(${round(-B / (2 * A))},\\ ${round(C - (B * B) / (4 * A))}\\right)`}</M>, a{" "}
              {A > 0 ? "minimum" : "maximum"}.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ radian converter */

function RadianConverter() {
  const [deg, setDeg] = useState("60");
  const d = Number(deg);
  const rad = (d * Math.PI) / 180;
  const exact = exactRadian(d);
  return (
    <section className="card p-5" aria-labelledby="rad">
      <h2 id="rad" className="text-lg font-bold">
        Degrees, radians, arcs and sectors
      </h2>
      <div className="mt-4">
        <label htmlFor="deg" className="mb-1 block text-xs font-medium">
          Angle in degrees
        </label>
        <input
          id="deg"
          value={deg}
          onChange={(e) => setDeg(e.target.value)}
          className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
        />
      </div>
      {Number.isFinite(d) ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <M>{`${d}^\\circ = ${rad.toFixed(5)}`}</M> radians
            {exact && (
              <>
                {" "}
                = <M>{exact}</M>
              </>
            )}
          </p>
          <p className="muted">
            For a circle of radius <M>{"r"}</M>: arc <M>{`s = ${rad.toFixed(4)}r`}</M>, sector area{" "}
            <M>{`A = ${(rad / 2).toFixed(4)}r^2`}</M>.
          </p>
          <p className="muted">
            Segment area <M>{`= \\tfrac12 r^2\\left(${rad.toFixed(4)} - ${Math.sin(rad).toFixed(4)}\\right) = ${((rad - Math.sin(rad)) / 2).toFixed(4)}r^2`}</M>
          </p>
        </div>
      ) : (
        <p className="muted mt-4 text-sm">Enter a number.</p>
      )}
    </section>
  );
}

function exactRadian(deg: number): string | null {
  if (!Number.isFinite(deg)) return null;
  const twelfths = (deg * 12) / 180;
  if (Math.abs(twelfths - Math.round(twelfths)) > 1e-9) return null;
  let num = Math.round(twelfths);
  let den = 12;
  const g = gcd(Math.abs(num), den);
  num /= g;
  den /= g;
  if (num === 0) return "0";
  if (den === 1) return num === 1 ? "\\pi" : `${num}\\pi`;
  return `\\frac{${num === 1 ? "" : num}\\pi}{${den}}`;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/* ---------------------------------------------------------- binomial tool */

function BinomialTool() {
  const [n, setN] = useState("8");
  const [r, setR] = useState("3");
  const N = Number(n);
  const R = Number(r);
  const valid = Number.isInteger(N) && Number.isInteger(R) && N >= 0 && R >= 0 && R <= N && N <= 30;
  const value = valid ? nCr(N, R) : null;
  const perm = valid ? nPr(N, R) : null;
  return (
    <section className="card p-5" aria-labelledby="bin">
      <h2 id="bin" className="text-lg font-bold">
        Combinations and permutations
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="bn" className="mb-1 block text-xs font-medium">
            n
          </label>
          <input id="bn" value={n} onChange={(e) => setN(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
        <div>
          <label htmlFor="br" className="mb-1 block text-xs font-medium">
            r
          </label>
          <input id="br" value={r} onChange={(e) => setR(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
      </div>
      {valid ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <M>{`^{${N}}C_{${R}} = ${value}`}</M> — selections, where order does not matter.
          </p>
          <p>
            <M>{`^{${N}}P_{${R}} = ${perm}`}</M> — arrangements, where order does matter.
          </p>
          <p className="muted">
            The binomial term: <M>{`\\binom{${N}}{${R}}a^{${N - R}}b^{${R}}`}</M>, the ${R + 1}th term of{" "}
            <M>{`(a+b)^{${N}}`}</M>.
          </p>
        </div>
      ) : (
        <p className="muted mt-4 text-sm">Enter whole numbers with $0 \le r \le n \le 30$.</p>
      )}
    </section>
  );
}

function nCr(n: number, k: number): number {
  let out = 1;
  for (let i = 0; i < k; i += 1) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
}

function nPr(n: number, k: number): number {
  let out = 1;
  for (let i = 0; i < k; i += 1) out *= n - i;
  return out;
}

/* ------------------------------------------------------- progression tool */

function ProgressionTool() {
  const [kind, setKind] = useState<"ap" | "gp">("ap");
  const [a, setA] = useState("3");
  const [d, setD] = useState("2");
  const [n, setN] = useState("10");
  const A = Number(a);
  const D = Number(d);
  const N = Number(n);
  const valid = Number.isFinite(A) && Number.isFinite(D) && Number.isInteger(N) && N > 0 && N <= 500;
  const term = kind === "ap" ? A + (N - 1) * D : A * D ** (N - 1);
  const sum = kind === "ap" ? (N / 2) * (2 * A + (N - 1) * D) : D === 1 ? A * N : (A * (1 - D ** N)) / (1 - D);
  const infinite = kind === "gp" && Math.abs(D) < 1 ? A / (1 - D) : null;

  return (
    <section className="card p-5" aria-labelledby="prog">
      <h2 id="prog" className="text-lg font-bold">
        Progressions
      </h2>
      <div className="mt-3 flex gap-2">
        {(["ap", "gp"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${kind === k ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]" : "border-[color:var(--border)]"}`}
          >
            {k === "ap" ? "Arithmetic" : "Geometric"}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="pa" className="mb-1 block text-xs font-medium">
            first term a
          </label>
          <input id="pa" value={a} onChange={(e) => setA(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
        <div>
          <label htmlFor="pd" className="mb-1 block text-xs font-medium">
            {kind === "ap" ? "difference d" : "ratio r"}
          </label>
          <input id="pd" value={d} onChange={(e) => setD(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
        <div>
          <label htmlFor="pn" className="mb-1 block text-xs font-medium">
            n
          </label>
          <input id="pn" value={n} onChange={(e) => setN(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
      </div>
      {valid ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <M>{`u_{${N}} = ${round(term)}`}</M>
          </p>
          <p>
            <M>{`S_{${N}} = ${round(sum)}`}</M>
          </p>
          {kind === "gp" && (
            <p className="muted">
              {infinite !== null ? (
                <>
                  Since <M>{"|r| < 1"}</M>, the sum to infinity exists: <M>{`S_\\infty = ${round(infinite)}`}</M>.
                </>
              ) : (
                <>
                  Since <M>{"|r| \\ge 1"}</M>, the terms do not tend to zero, so there is no sum to infinity.
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        <p className="muted mt-4 text-sm">Enter numbers, with $n$ a positive whole number.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------- derivative check */

function DerivativeTool() {
  const [src, setSrc] = useState("x^3 - 4x + 1");
  const [at, setAt] = useState("2");
  const compiled = useMemo(() => compile(src), [src]);
  const x0 = Number(at);
  const valid = !compiled.error && Number.isFinite(x0);
  // A central difference is accurate enough to check a hand-computed gradient.
  const h = 1e-5;
  const derivative = valid ? (compiled.fn(x0 + h) - compiled.fn(x0 - h)) / (2 * h) : NaN;
  const value = valid ? compiled.fn(x0) : NaN;

  return (
    <section className="card p-5" aria-labelledby="deriv">
      <h2 id="deriv" className="text-lg font-bold">
        Gradient checker
      </h2>
      <p className="muted mt-1 text-sm">
        Enter a function and a value of $x$ to check a gradient you have worked out by hand. It uses
        a numerical estimate, so treat the last digit with suspicion — and never write this method
        in an exam, where the marks are for the differentiation.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="dfn" className="mb-1 block text-xs font-medium">
            f(x)
          </label>
          <input id="dfn" value={src} onChange={(e) => setSrc(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
        <div>
          <label htmlFor="dat" className="mb-1 block text-xs font-medium">
            at x =
          </label>
          <input id="dat" value={at} onChange={(e) => setAt(e.target.value)} className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[color:var(--accent)]" />
        </div>
      </div>
      {compiled.error ? (
        <p className="mt-3 text-sm text-[color:var(--hard)]">{compiled.error}</p>
      ) : valid ? (
        <div className="mt-4 space-y-1.5 text-sm">
          <p>
            <M>{`f(${x0}) = ${round(value)}`}</M>
          </p>
          <p>
            <M>{`f'(${x0}) \\approx ${round(derivative)}`}</M>
          </p>
          <p className="muted">
            Tangent at that point: <M>{`y = ${round(derivative)}x ${value - derivative * x0 >= 0 ? "+" : "-"} ${round(Math.abs(value - derivative * x0))}`}</M>. The normal has gradient{" "}
            <M>{`${round(-1 / derivative)}`}</M>.
          </p>
        </div>
      ) : (
        <p className="muted mt-3 text-sm">Enter a numeric value of $x$.</p>
      )}
    </section>
  );
}

function round(v: number): string {
  if (!Number.isFinite(v)) return "\\text{undefined}";
  const r = Math.round(v * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(Number(r.toPrecision(6)));
}
