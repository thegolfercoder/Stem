/**
 * The self-test.
 *
 * Two things can silently break this site: a generator that produces a
 * question with no valid answer, and content that claims to cover a syllabus
 * objective it does not. Both are checked here, over every generator and every
 * topic, so `npm test` is a real gate rather than a formality.
 */

import { GENERATORS, checkAnswer, generate, parseNumber } from "../src/lib/questions";
import { TOPICS, TOPIC_BY_SLUG } from "../src/content/topics";
import { CAMBRIDGE_UNITS } from "../src/lib/content";
import type { Answer } from "../src/lib/questions";

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

/** The string a student would type to get this question right. */
function canonicalInput(answer: Answer): string {
  switch (answer.kind) {
    case "numeric":
      return String(answer.value);
    case "set":
      return answer.values.join(", ");
    case "mcq":
      return String(answer.correct);
    case "exact":
      return answer.accept[0] ?? "";
  }
}

console.log("Generators");
const SEEDS = 60;
for (const gen of GENERATORS) {
  const problems: string[] = [];
  for (let s = 1; s <= SEEDS; s += 1) {
    const q = generate(gen, s * 7919 + 13);

    if (!q.prompt.trim()) problems.push(`seed ${s}: empty prompt`);
    if (q.solution.length < 2) problems.push(`seed ${s}: solution has fewer than 2 steps`);
    if (q.solution.some((step) => !step.t.trim())) problems.push(`seed ${s}: a solution step has no text`);
    if (q.marks < 1) problems.push(`seed ${s}: non-positive mark tariff`);

    // The answer must be well formed and self-consistent.
    if (q.answer.kind === "numeric") {
      if (!Number.isFinite(q.answer.value)) problems.push(`seed ${s}: non-finite numeric answer`);
      if (!(q.answer.tolerance > 0)) problems.push(`seed ${s}: non-positive tolerance`);
    } else if (q.answer.kind === "set") {
      if (!q.answer.values.length) problems.push(`seed ${s}: empty answer set`);
      if (q.answer.values.some((v) => !Number.isFinite(v))) problems.push(`seed ${s}: non-finite value in answer set`);
    } else if (q.answer.kind === "mcq") {
      if (q.answer.correct < 1 || q.answer.correct > q.answer.options.length) {
        problems.push(`seed ${s}: mcq correct index out of range`);
      }
    }

    // The canonical answer must actually be marked correct.
    if (!checkAnswer(q.answer, canonicalInput(q.answer))) {
      problems.push(`seed ${s}: canonical answer "${canonicalInput(q.answer)}" is marked wrong`);
    }

    // And an obviously wrong answer must be marked wrong.
    if (q.answer.kind === "numeric") {
      const wrong = q.answer.value + Math.max(10, Math.abs(q.answer.value)) + 7;
      if (checkAnswer(q.answer, String(wrong))) problems.push(`seed ${s}: a wrong answer was accepted`);
    }

    // Unbalanced dollars mean broken maths rendering.
    const dollars = (q.prompt.match(/(?<!\\)\$/g) ?? []).length;
    if (dollars % 2 !== 0) problems.push(`seed ${s}: unbalanced $ in prompt`);
    for (const step of q.solution) {
      const d = (step.t.match(/(?<!\\)\$/g) ?? []).length;
      if (d % 2 !== 0) problems.push(`seed ${s}: unbalanced $ in a solution step`);
    }

    if (!TOPIC_BY_SLUG.has(q.topic)) problems.push(`seed ${s}: unknown topic slug "${q.topic}"`);
  }

  const unique = [...new Set(problems)];
  if (unique.length) {
    failures += unique.length;
    console.error(`  ✗ ${gen.id}`);
    for (const p of unique.slice(0, 4)) console.error(`      ${p}`);
  }
  checks += SEEDS;
}
console.log(`  ${GENERATORS.length} generators × ${SEEDS} seeds`);

console.log("Determinism");
for (const gen of GENERATORS.slice(0, 12)) {
  const a = generate(gen, 4242);
  const b = generate(gen, 4242);
  check(a.prompt === b.prompt, `${gen.id}: same seed produced a different prompt`);
  check(JSON.stringify(a.answer) === JSON.stringify(b.answer), `${gen.id}: same seed produced a different answer`);
}

console.log("Answer parsing");
const PARSE_CASES: [string, number][] = [
  ["3", 3],
  ["-4.5", -4.5],
  ["1/2", 0.5],
  ["x = 1/2", 0.5],
  ["  7 ", 7],
  ["2^3", 8],
  ["sqrt9", 3],
  ["sqrt(16)", 4],
  ["pi", Math.PI],
  ["pi/3", Math.PI / 3],
  ["2pi", 2 * Math.PI],
  ["-3/4", -0.75],
  ["(1+2)/3", 1],
  ["1.5e2", 150],
];
for (const [input, expected] of PARSE_CASES) {
  const got = parseNumber(input);
  check(got !== null && Math.abs(got - expected) < 1e-9, `parseNumber("${input}") gave ${got}, expected ${expected}`);
}
for (const bad of ["", "abc", "1/0", "2+", "))"]) {
  check(parseNumber(bad) === null, `parseNumber("${bad}") should be null, got ${parseNumber(bad)}`);
}

console.log("Set marking");
const setAnswer: Answer = { kind: "set", values: [2, -3], tolerance: 1e-6, display: "" };
check(checkAnswer(setAnswer, "-3, 2"), "a set answer should mark correct in any order");
check(checkAnswer(setAnswer, "2 or -3"), "a set answer should accept 'or' as a separator");
check(!checkAnswer(setAnswer, "2"), "a set answer should reject an incomplete list");
check(!checkAnswer(setAnswer, "2, 3"), "a set answer should reject a wrong value");

console.log("Content");
const slugs = new Set<string>();
for (const topic of TOPICS) {
  check(!slugs.has(topic.slug), `duplicate topic slug: ${topic.slug}`);
  slugs.add(topic.slug);
  check(topic.sections.length >= 3, `${topic.slug}: fewer than 3 lesson sections`);
  check(topic.examples.length >= 3, `${topic.slug}: fewer than 3 worked examples`);
  check(topic.examQuestions.length >= 1, `${topic.slug}: no exam-style questions`);
  check(topic.mistakes.length >= 4, `${topic.slug}: fewer than 4 common mistakes`);
  check(topic.tips.length >= 4, `${topic.slug}: fewer than 4 exam tips`);
  check(topic.formulas.length >= 3, `${topic.slug}: fewer than 3 formulas`);
  check(topic.syllabus.length >= 1, `${topic.slug}: no syllabus references`);
  check(topic.estimatedMinutes > 0, `${topic.slug}: no reading estimate`);

  for (const pre of topic.prerequisites) {
    check(TOPIC_BY_SLUG.has(pre), `${topic.slug}: prerequisite "${pre}" is not a topic`);
  }

  const ids = new Set<string>();
  for (const ex of [...topic.examples, ...topic.examQuestions]) {
    check(!ids.has(ex.id), `${topic.slug}: duplicate example id ${ex.id}`);
    ids.add(ex.id);
    check(ex.steps.length >= 2, `${ex.id}: a worked solution needs at least two steps`);
    check(ex.answer.trim().length > 0, `${ex.id}: no final answer`);
    check(ex.prompt.trim().length > 0, `${ex.id}: no question text`);
  }

  // Every difficulty band should appear somewhere in the topic's examples.
  const levels = new Set(topic.examples.map((e) => e.difficulty));
  check(levels.size >= 3, `${topic.slug}: worked examples span fewer than 3 difficulty levels`);

  // Generators named by a topic must exist and belong to it.
  for (const id of topic.generators) {
    const gen = GENERATORS.find((g) => g.id === id);
    check(!!gen, `${topic.slug}: names generator "${id}", which does not exist`);
    if (gen) check(gen.topic === topic.slug, `generator ${id} belongs to ${gen.topic}, not ${topic.slug}`);
  }
}

console.log("Balanced maths delimiters in content");
for (const topic of TOPICS) {
  const strings: string[] = [
    topic.blurb,
    ...topic.syllabus.map((s) => s.text),
    ...topic.tips,
    ...topic.mistakes.flatMap((m) => [m.wrong, m.why, m.fix]),
    ...topic.examples.flatMap((e) => [e.prompt, e.answer, ...e.steps.map((s) => s.t)]),
    ...topic.examQuestions.flatMap((e) => [e.prompt, e.answer, ...e.steps.map((s) => s.t)]),
  ];
  for (const s of strings) {
    const d = (s.match(/(?<!\\)\$/g) ?? []).length;
    check(d % 2 === 0, `${topic.slug}: unbalanced $ in "${s.slice(0, 60)}…"`);
  }
}

console.log("Syllabus coverage");
for (const unit of CAMBRIDGE_UNITS) {
  const covering = TOPICS.filter((t) => t.unit === unit.n);
  check(covering.length > 0, `Cambridge unit ${unit.n} (${unit.name}) has no topic page`);
}
const objectives = TOPICS.flatMap((t) => t.syllabus.map((s) => s.code)).filter((c) => c !== "—");
check(objectives.length >= 50, `only ${objectives.length} syllabus objectives are listed; expected at least 50`);
const dupes = objectives.filter((c, i) => objectives.indexOf(c) !== i);
check(dupes.length === 0, `duplicate syllabus objective codes: ${[...new Set(dupes)].join(", ")}`);

console.log("");
if (failures) {
  console.error(`FAILED — ${failures} problem${failures === 1 ? "" : "s"} across ${checks} checks.`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
