import type { Difficulty, Step } from "@/lib/types";

/**
 * The practice engine.
 *
 * Every question is produced by a *generator*: a pure function from a seeded
 * random number source to a question, its answer and a full worked solution.
 * Because generation is deterministic in the seed, a question can be stored as
 * a short id, replayed exactly for a retry, and shared between the practice
 * page and the exam simulator without storing any question text.
 */

export type Rng = {
  /** Uniform integer in [lo, hi], inclusive. */
  int: (lo: number, hi: number) => number;
  /** Uniform non-zero integer in [lo, hi]. */
  nz: (lo: number, hi: number) => number;
  pick: <T>(items: readonly T[]) => T;
  /** A distinct pair drawn from [lo, hi]. */
  pair: (lo: number, hi: number) => [number, number];
  sign: () => 1 | -1;
  next: () => number;
};

/** mulberry32 — small, fast, and good enough for shuffling questions. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const nz = (lo: number, hi: number) => {
    for (let i = 0; i < 50; i += 1) {
      const v = int(lo, hi);
      if (v !== 0) return v;
    }
    return lo === 0 ? 1 : lo;
  };
  return {
    next,
    int,
    nz,
    pick: <T,>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
    pair: (lo: number, hi: number) => {
      const a = int(lo, hi);
      let b = int(lo, hi);
      for (let i = 0; i < 50 && b === a; i += 1) b = int(lo, hi);
      return [a, b];
    },
    sign: () => (next() < 0.5 ? 1 : -1),
  };
}

export type Answer =
  | { kind: "numeric"; value: number; tolerance: number; display: string; unit?: string }
  | { kind: "set"; values: number[]; tolerance: number; display: string }
  | { kind: "exact"; accept: string[]; display: string }
  | { kind: "mcq"; options: string[]; correct: number; display: string };

export interface QuestionSpec {
  prompt: string;
  answer: Answer;
  solution: Step[];
  /** Overrides the generator's default mark tariff. */
  marks?: number;
  /** Shown under the input, e.g. "Give your answer to 3 significant figures." */
  hint?: string;
}

export interface Generator {
  id: string;
  /** Topic slug this generator belongs to. */
  topic: string;
  title: string;
  difficulty: Difficulty;
  marks: number;
  /** Paper style: 1 is non-calculator, 2 allows a calculator. */
  paper: 1 | 2;
  build: (r: Rng) => QuestionSpec;
}

export interface Question {
  /** Stable id of the form "<generator>:<seed>" — replayable. */
  id: string;
  generator: string;
  topic: string;
  title: string;
  difficulty: Difficulty;
  marks: number;
  paper: 1 | 2;
  prompt: string;
  answer: Answer;
  solution: Step[];
  hint?: string;
}

export function generate(gen: Generator, seed: number): Question {
  const spec = gen.build(makeRng(seed));
  return {
    id: `${gen.id}:${seed}`,
    generator: gen.id,
    topic: gen.topic,
    title: gen.title,
    difficulty: gen.difficulty,
    marks: spec.marks ?? gen.marks,
    paper: gen.paper,
    prompt: spec.prompt,
    answer: spec.answer,
    solution: spec.solution,
    ...(spec.hint ? { hint: spec.hint } : {}),
  };
}

/* ------------------------------------------------------------------ marking */

/**
 * Marks a typed answer.
 *
 * Students type maths, not canonical strings, so the checker accepts the
 * obvious variations: `1/2`, `0.5`, `x=1/2`, `½ ` with stray spaces, `pi/3`,
 * `sqrt2`, `2^3`. Anything that parses to the right number is right.
 */
export function checkAnswer(answer: Answer, raw: string): boolean {
  const input = raw.trim();
  if (!input) return false;
  switch (answer.kind) {
    case "numeric": {
      const v = parseNumber(input);
      return v !== null && Math.abs(v - answer.value) <= answer.tolerance;
    }
    case "set": {
      const parts = splitList(input);
      if (parts.length !== answer.values.length) return false;
      const got = parts.map(parseNumber);
      if (got.some((g) => g === null)) return false;
      const remaining = [...answer.values];
      for (const g of got as number[]) {
        const idx = remaining.findIndex((v) => Math.abs(v - g) <= answer.tolerance);
        if (idx === -1) return false;
        remaining.splice(idx, 1);
      }
      return true;
    }
    case "exact": {
      const norm = normalise(input);
      return answer.accept.some((a) => normalise(a) === norm);
    }
    case "mcq": {
      const idx = Number(input);
      return Number.isInteger(idx) && idx === answer.correct;
    }
  }
}

const LIST_SEPARATOR = /[,;]|\s+or\s+|\s+and\s+/i;

export function splitList(input: string): string[] {
  return input
    .split(LIST_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parses the arithmetic a student would actually type into an answer box:
 * integers, decimals, fractions, surds, powers, pi and e — but not a general
 * expression language, which would be a security and complexity cost for no
 * extra marks.
 */
export function parseNumber(raw: string): number | null {
  let s = raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^[a-z]=/, "")
    .replace(/[{}$]/g, "")
    .replace(/−/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/√/g, "sqrt");
  if (!s) return null;

  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;

  // Tokens the parser understands, in the order they must be substituted.
  s = s.replace(/pi|π/g, `(${Math.PI})`);
  s = s.replace(/(?<![a-z])e(?![a-z0-9])/g, `(${Math.E})`);
  s = s.replace(/sqrt\(([^()]*)\)/g, (_m, inner: string) => `(${Math.sqrt(evalSimple(inner) ?? NaN)})`);
  s = s.replace(/sqrt(\d+(?:\.\d+)?)/g, (_m, n: string) => `(${Math.sqrt(Number(n))})`);
  s = s.replace(/\^/g, "**");

  if (!/^[-+*/().0-9e\s]*$/.test(s.replace(/\*\*/g, "*"))) return null;
  return evalSimple(s);
}

/** A tiny recursive-descent evaluator: + - * / ** and brackets, nothing else. */
function evalSimple(src: string): number | null {
  const s = src.replace(/\s+/g, "");
  let i = 0;

  function expr(): number | null {
    let v = term();
    if (v === null) return null;
    while (i < s.length && (s[i] === "+" || s[i] === "-")) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function term(): number | null {
    let v = power();
    if (v === null) return null;
    while (i < s.length && (s[i] === "*" || s[i] === "/")) {
      if (s[i] === "*" && s[i + 1] === "*") break;
      const op = s[i++];
      const r = power();
      if (r === null) return null;
      if (op === "/" && r === 0) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function power(): number | null {
    const base = unary();
    if (base === null) return null;
    if (s[i] === "*" && s[i + 1] === "*") {
      i += 2;
      const exp = power();
      if (exp === null) return null;
      return base ** exp;
    }
    return base;
  }

  function unary(): number | null {
    if (s[i] === "-") {
      i += 1;
      const v = unary();
      return v === null ? null : -v;
    }
    if (s[i] === "+") {
      i += 1;
      return unary();
    }
    return atom();
  }

  function atom(): number | null {
    if (s[i] === "(") {
      i += 1;
      const v = expr();
      if (v === null || s[i] !== ")") return null;
      i += 1;
      return implicitMultiply(v);
    }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i]!)) i += 1;
    if (i === start) return null;
    const v = Number(s.slice(start, i));
    if (!Number.isFinite(v)) return null;
    return implicitMultiply(v);
  }

  /** Lets "2(3)" and "2(1/2)" mean multiplication, the way people write it. */
  function implicitMultiply(v: number): number | null {
    if (s[i] === "(") {
      const r = atom();
      return r === null ? null : v * r;
    }
    return v;
  }

  const value = expr();
  if (value === null || i !== s.length || !Number.isFinite(value)) return null;
  return value;
}

/** Loose normalisation for string answers: case, spaces and cosmetic LaTeX. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\\left|\\right|\\!|\\,|\;/g, "")
    .replace(/[{}$\s]/g, "")
    .replace(/\\dfrac/g, "\\frac")
    .replace(/−/g, "-")
    .replace(/\*/g, "")
    .replace(/\.0+(?![0-9])/g, "");
}

/* ------------------------------------------------------ formatting helpers */

/** "3x", "-x", "x" — a coefficient printed the way a person would write it. */
export function coef(a: number, symbol = "x"): string {
  if (a === 1) return symbol;
  if (a === -1) return `-${symbol}`;
  return `${a}${symbol}`;
}

/** A signed term for building expressions: "+ 3x", "- 2". */
export function signed(a: number, symbol = ""): string {
  if (a === 0) return "";
  const body = symbol ? coef(Math.abs(a), symbol) : String(Math.abs(a));
  return `${a > 0 ? " + " : " - "}${body}`;
}

/** ax² + bx + c with tidy signs and no "+ 0" or "1x". */
export function quadratic(a: number, b: number, c: number, v = "x"): string {
  let out = a === 0 ? "" : coef(a, `${v}^2`);
  if (!out && b !== 0) out = coef(b, v);
  else out += signed(b, v);
  out += signed(c);
  return out.trim() || "0";
}

/** A fraction, reduced, printed as LaTeX; integers print bare. */
export function frac(n: number, d: number): string {
  if (d === 0) return "\\text{undefined}";
  const g = gcd(Math.abs(n), Math.abs(d));
  let num = n / g;
  let den = d / g;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  if (den === 1) return String(num);
  return num < 0 ? `-\\frac{${-num}}{${den}}` : `\\frac{${num}}{${den}}`;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/** Rounds for display and comparison: 3 significant figures unless told otherwise. */
export function sf(value: number, digits = 3): number {
  if (value === 0) return 0;
  const mag = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - mag);
  return Math.round(value * factor) / factor;
}

export function dp(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** A tolerance that scales with the size of the answer, for 3sf marking. */
export function tol3sf(value: number): number {
  return Math.max(Math.abs(value) * 5e-3, 5e-4);
}
