"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Difficulty } from "@/lib/types";
import { DIFFICULTIES, DIFFICULTY_LABEL } from "@/lib/types";
import { buildSet, questionFromId, type Question } from "@/lib/questions";
import { loadProgress, recordAttempt } from "@/lib/progress";
import { QuestionCard, type AttemptResult } from "./QuestionCard";

export interface TopicOption {
  slug: string;
  title: string;
  short: string;
  count: number;
}

const COUNTS = [5, 10, 15, 20] as const;

export function PracticeClient({ topics }: { topics: TopicOption[] }) {
  const params = useSearchParams();
  const initialTopic = params.get("topic");

  const [selected, setSelected] = useState<string[]>(() =>
    initialTopic && topics.some((t) => t.slug === initialTopic) ? [initialTopic] : [],
  );
  const [levels, setLevels] = useState<Difficulty[]>([]);
  const [count, setCount] = useState<number>(10);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [results, setResults] = useState<Record<string, AttemptResult>>({});
  const [retryAvailable, setRetryAvailable] = useState(0);

  useEffect(() => {
    setRetryAvailable(loadProgress().retry.length);
  }, [questions]);

  const start = useCallback(() => {
    const set = buildSet({
      topics: selected,
      difficulties: levels,
      count,
      seed: Math.floor(Math.random() * 2 ** 30),
    });
    setResults({});
    setQuestions(set);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selected, levels, count]);

  const startRetry = useCallback(() => {
    const ids = loadProgress().retry.slice(-20).reverse();
    const set = ids.map(questionFromId).filter((q): q is Question => q !== null);
    setResults({});
    setQuestions(set);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  function onAnswered(q: Question, result: AttemptResult) {
    setResults((prev) => ({ ...prev, [q.id]: result }));
    recordAttempt({
      qid: q.id,
      topic: q.topic,
      generator: q.generator,
      difficulty: q.difficulty,
      correct: result.correct,
      ms: result.ms,
      at: Date.now(),
      marks: q.marks,
    });
  }

  const answered = Object.values(results);
  const score = answered.filter((r) => r.correct).length;
  const available = useMemo(
    () =>
      topics
        .filter((t) => !selected.length || selected.includes(t.slug))
        .reduce((n, t) => n + t.count, 0),
    [topics, selected],
  );

  return (
    <div className="py-9">
      <section aria-labelledby="build" className="card p-5 sm:p-6">
        <h2 id="build" className="text-lg font-bold">
          Build your set
        </h2>

        <fieldset className="mt-5">
          <legend className="mb-2.5 text-sm font-medium">
            Topics{" "}
            <span className="muted font-normal">
              ({selected.length === 0 ? "all topics" : `${selected.length} selected`})
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelected([])}
              aria-pressed={selected.length === 0}
              className={chipClass(selected.length === 0)}
            >
              All topics
            </button>
            {topics.map((t) => {
              const on = selected.includes(t.slug);
              return (
                <button
                  key={t.slug}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(t.slug) ? prev.filter((s) => s !== t.slug) : [...prev, t.slug],
                    )
                  }
                  className={chipClass(on)}
                >
                  {t.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-2.5 text-sm font-medium">
            Difficulty{" "}
            <span className="muted font-normal">
              ({levels.length === 0 ? "any" : levels.map((l) => DIFFICULTY_LABEL[l]).join(", ")})
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLevels([])}
              aria-pressed={levels.length === 0}
              className={chipClass(levels.length === 0)}
            >
              Any
            </button>
            {DIFFICULTIES.map((d) => {
              const on = levels.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setLevels((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
                  }
                  className={chipClass(on)}
                >
                  {DIFFICULTY_LABEL[d]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-2.5 text-sm font-medium">Number of questions</legend>
          <div className="flex flex-wrap gap-2">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={count === c}
                onClick={() => setCount(c)}
                className={chipClass(count === c)}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={available === 0}
            className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-[color:var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-50"
          >
            {questions ? "Generate a new set" : "Start practising"}
          </button>
          {retryAvailable > 0 && (
            <button
              type="button"
              onClick={startRetry}
              className="rounded-xl border border-[color:var(--border)] px-5 py-3 text-sm font-semibold transition hover:border-[color:var(--accent)]/50"
            >
              Retry {Math.min(retryAvailable, 20)} you got wrong
            </button>
          )}
          <p className="muted text-sm">
            {available === 0
              ? "No templates match that combination — widen the difficulty."
              : `${available} templates match.`}
          </p>
        </div>
      </section>

      {questions && questions.length > 0 && (
        <section aria-labelledby="set" className="mt-9">
          <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)]/90 px-4 py-3 backdrop-blur">
            <h2 id="set" className="text-sm font-semibold">
              {answered.length} of {questions.length} answered
            </h2>
            <div className="flex items-center gap-3">
              <div
                className="h-1.5 w-28 overflow-hidden rounded-full bg-[color:var(--bg-soft)]"
                role="progressbar"
                aria-valuenow={answered.length}
                aria-valuemin={0}
                aria-valuemax={questions.length}
                aria-label="Questions answered"
              >
                <div
                  className="h-full rounded-full bg-[color:var(--accent)] transition-all"
                  style={{ width: `${(answered.length / questions.length) * 100}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {score}/{answered.length || 0}
              </span>
            </div>
          </div>

          <div className="space-y-5">
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={i}
                total={questions.length}
                autoFocus={i === 0}
                onAnswered={(result) => onAnswered(q, result)}
              />
            ))}
          </div>

          {answered.length === questions.length && (
            <div className="card mt-7 p-6 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.1em] text-[color:var(--accent)]">
                Set complete
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {score} / {questions.length}
              </p>
              <p className="muted mt-1.5 text-sm">
                {Math.round((score / questions.length) * 100)}% correct. Everything you missed is in
                your retry queue.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={start}
                  className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
                >
                  Another set
                </button>
                <Link
                  href="/progress/"
                  className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold"
                >
                  See your progress
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
      : "border-[color:var(--border)] hover:border-[color:var(--accent)]/50"
  }`;
}
