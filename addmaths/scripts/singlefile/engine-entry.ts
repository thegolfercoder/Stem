/**
 * The runtime the single-file build needs: question generation, marking and
 * the tool calculators, exposed on one global. Everything else in the page is
 * pre-rendered HTML, so this is the only application code that ships.
 */

import { buildSet, checkAnswer, generatorsFor, questionFromId, GENERATORS } from "@/lib/questions";

// Topic metadata is injected as JSON by the build script rather than imported,
// so the whole content tree stays out of this bundle.

declare global {
  interface Window {
    AddMaths: unknown;
  }
}

window.AddMaths = {
  buildSet,
  checkAnswer,
  generatorsFor,
  questionFromId,
  generators: GENERATORS.map((g) => ({
    id: g.id,
    topic: g.topic,
    title: g.title,
    difficulty: g.difficulty,
    marks: g.marks,
    paper: g.paper,
  })),
  topics: "__TOPIC_META__",
};
