import type { Difficulty } from "@/lib/types";
import type { Generator, Question } from "./engine";
import { generate, makeRng } from "./engine";
import { functionGenerators } from "./generators/functions";
import { algebraGenerators } from "./generators/algebra";
import { geometryGenerators } from "./generators/geometry";
import { calculusGenerators } from "./generators/calculus";

/** Every question generator on the site, in one list. */
export const GENERATORS: Generator[] = [
  ...functionGenerators,
  ...algebraGenerators,
  ...geometryGenerators,
  ...calculusGenerators,
];

export const GENERATOR_BY_ID = new Map(GENERATORS.map((g) => [g.id, g]));

export function generatorsFor(opts: {
  topics?: string[];
  difficulties?: Difficulty[];
  paper?: 1 | 2;
}): Generator[] {
  return GENERATORS.filter((g) => {
    if (opts.topics?.length && !opts.topics.includes(g.topic)) return false;
    if (opts.difficulties?.length && !opts.difficulties.includes(g.difficulty)) return false;
    if (opts.paper && g.paper !== opts.paper) return false;
    return true;
  });
}

/**
 * Builds a question set. Generators are drawn without replacement until the
 * pool is exhausted and only then reused, so a ten-question set never repeats
 * a template while an unused one is still available.
 */
export function buildSet(opts: {
  topics?: string[];
  difficulties?: Difficulty[];
  paper?: 1 | 2;
  count: number;
  seed: number;
}): Question[] {
  const pool = generatorsFor(opts);
  if (!pool.length) return [];
  const r = makeRng(opts.seed);
  const out: Question[] = [];
  let bag: Generator[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    if (!bag.length) bag = shuffle(pool, r);
    const gen = bag.pop()!;
    out.push(generate(gen, r.int(1, 2 ** 30)));
  }
  return out;
}

function shuffle<T>(items: T[], r: { int: (a: number, b: number) => number }): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = r.int(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Rebuilds a question from its stored id, for retries and review. */
export function questionFromId(id: string): Question | null {
  const at = id.lastIndexOf(":");
  if (at === -1) return null;
  const gen = GENERATOR_BY_ID.get(id.slice(0, at));
  const seed = Number(id.slice(at + 1));
  if (!gen || !Number.isFinite(seed)) return null;
  return generate(gen, seed);
}

/** Topic slugs that have at least one generator. */
export function practisableTopics(): string[] {
  return [...new Set(GENERATORS.map((g) => g.topic))];
}

export { generate, makeRng };
export type { Generator, Question };
export { checkAnswer, parseNumber } from "./engine";
export type { Answer } from "./engine";
