import type { ExamQuestion, MarkItem } from "./types";
import { schemeFromSolution } from "./questions/engine";

/**
 * The mark scheme for a written exam question: its own when it has one,
 * otherwise one derived from the worked solution, so every question shows
 * where its marks come from.
 */
export function schemeFor(q: ExamQuestion): MarkItem[] {
  if (q.markScheme?.length) return q.markScheme;
  return schemeFromSolution(q.marks, q.steps, { kind: "exact", accept: [], display: q.answer });
}
