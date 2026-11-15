import { TOPICS } from "@/content/topics";
import type { Difficulty, ExamQuestion, Topic, WorkedExample } from "./types";

/** Cambridge's own unit names, used by the syllabus page and the audit. */
export const CAMBRIDGE_UNITS: { n: number; name: string }[] = [
  { n: 1, name: "Functions" },
  { n: 2, name: "Quadratic functions" },
  { n: 3, name: "Factors of polynomials" },
  { n: 4, name: "Equations, inequalities and graphs" },
  { n: 5, name: "Simultaneous equations" },
  { n: 6, name: "Logarithmic and exponential functions" },
  { n: 7, name: "Straight-line graphs" },
  { n: 8, name: "Coordinate geometry of the circle" },
  { n: 9, name: "Circular measure" },
  { n: 10, name: "Trigonometry" },
  { n: 11, name: "Permutations and combinations" },
  { n: 12, name: "Series" },
  { n: 13, name: "Vectors in two dimensions" },
  { n: 14, name: "Calculus" },
];

/** Unit 0 is assumed IGCSE knowledge the papers lean on without testing directly. */
export const ASSUMED_UNIT = { n: 0, name: "Assumed knowledge (IGCSE Mathematics)" };

export function unitName(n: number): string {
  return n === 0 ? ASSUMED_UNIT.name : (CAMBRIDGE_UNITS.find((u) => u.n === n)?.name ?? "Unknown");
}

export function topicsByUnit(): { unit: number; name: string; topics: Topic[] }[] {
  const units = [ASSUMED_UNIT, ...CAMBRIDGE_UNITS];
  return units
    .map((u) => ({ unit: u.n, name: u.name, topics: TOPICS.filter((t) => t.unit === u.n) }))
    .filter((g) => g.topics.length > 0);
}

export interface ExampleRef {
  topic: Topic;
  example: WorkedExample;
}

export function allExamples(): ExampleRef[] {
  return TOPICS.flatMap((topic) => topic.examples.map((example) => ({ topic, example })));
}

export interface ExamQuestionRef {
  topic: Topic;
  question: ExamQuestion;
}

export function allExamQuestions(): ExamQuestionRef[] {
  return TOPICS.flatMap((topic) => topic.examQuestions.map((question) => ({ topic, question })));
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  olympiad: 3,
};

export function siteStats() {
  const examples = allExamples().length;
  const examQuestions = allExamQuestions().length;
  const objectives = TOPICS.reduce((n, t) => n + t.syllabus.length, 0);
  const formulas = TOPICS.reduce((n, t) => n + t.formulas.length, 0);
  const minutes = TOPICS.reduce((n, t) => n + t.estimatedMinutes, 0);
  return { topics: TOPICS.length, examples, examQuestions, objectives, formulas, minutes };
}
