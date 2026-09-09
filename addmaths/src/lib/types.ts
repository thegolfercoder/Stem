/**
 * The content model.
 *
 * Every lesson, example and question on the site is a typed value in
 * `src/content`, not free-floating JSX. That is what lets the search index,
 * the practice engine, the progress tracker and the syllabus audit all read
 * the same source of truth, and what makes a missing field a compile error
 * rather than a blank space on a page.
 *
 * Text fields accept inline LaTeX between single dollars: "the roots of
 * $ax^2+bx+c=0$". Display maths is its own block.
 */

export type Difficulty = "easy" | "medium" | "hard" | "olympiad";

export const DIFFICULTIES: readonly Difficulty[] = [
  "easy",
  "medium",
  "hard",
  "olympiad",
] as const;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  olympiad: "Olympiad",
};

/** A tone for a callout box. `key` is a definition, `warn` a trap. */
export type NoteTone = "tip" | "warn" | "key" | "info";

/** One curve on a plot: y = f(x), sampled and drawn as an SVG path. */
export interface Curve {
  /** Evaluated over the plot's x-range. Must be a pure function. */
  f: (x: number) => number;
  label?: string;
  /** Index into the plot palette. */
  color?: number;
  dashed?: boolean;
  /** Restrict this curve to a sub-interval of the plot window. */
  domain?: [number, number];
}

export interface PlotPoint {
  x: number;
  y: number;
  label?: string;
  open?: boolean;
}

export interface PlotSpec {
  xRange: [number, number];
  yRange: [number, number];
  curves?: Curve[];
  points?: PlotPoint[];
  /** Vertical asymptotes, drawn as dashed grey lines. */
  vLines?: { x: number; label?: string }[];
  hLines?: { y: number; label?: string }[];
  /** Shade the region between a curve and the x-axis (for integration). */
  shade?: { f: (x: number) => number; from: number; to: number; g?: (x: number) => number };
  xLabel?: string;
  yLabel?: string;
  caption?: string;
  height?: number;
  /** Tick spacing; defaults to something sensible for the range. */
  xTick?: number;
  yTick?: number;
  /** Label ticks as multiples of pi rather than decimals. */
  radians?: boolean;
}

export type Block =
  | { k: "p"; t: string }
  | { k: "math"; t: string }
  | { k: "ul"; items: string[] }
  | { k: "ol"; items: string[] }
  | { k: "note"; tone: NoteTone; title?: string; t: string }
  | { k: "table"; head: string[]; rows: string[][]; caption?: string }
  | { k: "steps"; items: Step[] }
  | { k: "plot"; spec: PlotSpec }
  | { k: "columns"; left: Block[]; right: Block[] };

/** One line of a worked solution: a sentence of reasoning, then the algebra. */
export interface Step {
  /** Why this line follows from the last one. */
  t: string;
  /** The display maths for the line, if any. */
  m?: string;
}

export interface Section {
  id: string;
  heading: string;
  body: Block[];
}

export interface WorkedExample {
  id: string;
  title: string;
  difficulty: Difficulty;
  prompt: string;
  /** Optional diagram shown with the question. */
  figure?: PlotSpec;
  steps: Step[];
  answer: string;
  /** A closing remark: the idea worth taking away. */
  remark?: string;
}

export interface ExamQuestion extends WorkedExample {
  marks: number;
  /** Which paper the style belongs to: 1 is non-calculator, 2 is calculator. */
  paper?: 1 | 2;
}

export interface Mistake {
  wrong: string;
  why: string;
  fix: string;
}

export interface FormulaEntry {
  name: string;
  latex: string;
  /** True when Cambridge prints it on page 2 of the paper. */
  given: boolean;
  note?: string;
}

export interface SyllabusRef {
  code: string;
  text: string;
  notes?: string;
}

export interface Topic {
  slug: string;
  /** Cambridge topic number, 1-14. Several site topics share one number. */
  unit: number;
  title: string;
  /** Short form for chips and breadcrumbs. */
  short: string;
  blurb: string;
  syllabus: SyllabusRef[];
  prerequisites: string[];
  estimatedMinutes: number;
  sections: Section[];
  formulas: FormulaEntry[];
  examples: WorkedExample[];
  examQuestions: ExamQuestion[];
  mistakes: Mistake[];
  tips: string[];
  /** Ids of question generators in `src/lib/questions`. */
  generators: string[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  topic?: string;
  also?: string[];
}
