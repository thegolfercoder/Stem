import type { Question } from "./engine";
import { generate } from "./engine";
import { GENERATOR_BY_ID } from "./index";

/**
 * One worked instance of every kind of question the practice engine can set.
 *
 * Many templates branch: a "largest domain" question can be about a root, a
 * reciprocal or a logarithm, and each needs a different method. Two instances
 * follow the same method exactly when their wording and solution steps match
 * once every number and every piece of maths is removed. So seeds are scanned
 * in a fixed order and the first instance of each distinct method is kept.
 * The result is deterministic, so the static pages never change between builds.
 */
export function signature(q: Question): string {
  const words = (s: string) =>
    s
      .replace(/\$[^$]*\$/g, " ")
      .replace(/-?\d+(\.\d+)?/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return [words(q.prompt), ...q.solution.map((st) => words(st.t)), q.answer.kind].join(" | ");
}

export interface QuestionType {
  generator: string;
  title: string;
  instances: Question[];
}

const SEEDS = 400;
const MAX_VARIANTS = 4;

export function questionTypes(generatorIds: string[]): QuestionType[] {
  const out: QuestionType[] = [];
  for (const id of generatorIds) {
    const gen = GENERATOR_BY_ID.get(id);
    if (!gen) continue;
    const seen = new Set<string>();
    const instances: Question[] = [];
    for (let seed = 1; seed <= SEEDS && instances.length < MAX_VARIANTS; seed += 1) {
      const q = generate(gen, seed * 104729 + 7);
      const sig = signature(q);
      if (seen.has(sig)) continue;
      seen.add(sig);
      instances.push(q);
    }
    out.push({ generator: id, title: gen.title, instances });
  }
  return out;
}
