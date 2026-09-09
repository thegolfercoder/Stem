"use client";

import { useEffect, useRef, useState } from "react";
import type { Question } from "@/lib/questions";
import { checkAnswer } from "@/lib/questions";
import { Steps } from "./Blocks";
import { T } from "./Math";
import { DifficultyBadge, Chip } from "./ui";
import { getTopic } from "@/content/topics";

export interface AttemptResult {
  correct: boolean;
  ms: number;
  given: string;
}

/**
 * One question, from asking to marking to the worked solution.
 *
 * Marking is generous about form — `1/2`, `0.5` and `x = 1/2` are all the same
 * answer — because a student should lose a mark for the maths, not for how
 * they typed it.
 */
export function QuestionCard({
  question,
  index,
  total,
  onAnswered,
  autoFocus = false,
  revealed,
}: {
  question: Question;
  index: number;
  total?: number;
  onAnswered?: (result: AttemptResult) => void;
  autoFocus?: boolean;
  /** Force the solution open, for exam review. */
  revealed?: { given: string; correct: boolean };
}) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"asking" | "right" | "wrong">("asking");
  const [showSolution, setShowSolution] = useState(false);
  const started = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue("");
    setState("asking");
    setShowSolution(false);
    started.current = Date.now();
    if (autoFocus) inputRef.current?.focus();
  }, [question.id, autoFocus]);

  const locked = state !== "asking" || !!revealed;
  const topic = getTopic(question.topic);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !value.trim()) return;
    const correct = checkAnswer(question.answer, value);
    setState(correct ? "right" : "wrong");
    if (!correct) setShowSolution(true);
    onAnswered?.({ correct, ms: Date.now() - started.current, given: value });
  }

  const shown = revealed
    ? { correct: revealed.correct, given: revealed.given }
    : state === "asking"
      ? null
      : { correct: state === "right", given: value };

  const isMcq = question.answer.kind === "mcq";

  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-[color:var(--border)] bg-[color:var(--bg-soft)] px-5 py-3">
        <span className="text-sm font-semibold tabular-nums">
          Q{index + 1}
          {total ? <span className="muted font-normal"> of {total}</span> : null}
        </span>
        <DifficultyBadge level={question.difficulty} />
        {topic && <Chip>{topic.short}</Chip>}
        <Chip>{question.marks} marks</Chip>
        <Chip>Paper {question.paper}</Chip>
      </header>

      <div className="p-5">
        <div className="space-y-1.5 text-[1.02rem] leading-relaxed">
          {question.prompt.split("\n").map((line, i) =>
            line.trim() ? (
              <p key={i}>
                <T>{line}</T>
              </p>
            ) : (
              <div key={i} className="h-2" />
            ),
          )}
        </div>

        <form onSubmit={submit} className="mt-5">
          <label htmlFor={`ans-${question.id}`} className="mb-1.5 block text-sm font-medium">
            {isMcq ? "Your choice" : "Your answer"}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`ans-${question.id}`}
              ref={inputRef}
              value={revealed ? revealed.given : value}
              onChange={(e) => setValue(e.target.value)}
              disabled={locked}
              inputMode={isMcq ? "numeric" : "text"}
              autoComplete="off"
              aria-describedby={`hint-${question.id}`}
              className="min-w-0 flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3.5 py-2.5 font-mono text-[0.95rem] outline-none transition focus:border-[color:var(--accent)] disabled:opacity-70"
              placeholder={isMcq ? "Type the option number" : "e.g. 3/4, -2.5, sqrt5, pi/6"}
            />
            {!locked && (
              <button
                type="submit"
                className="rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--accent-contrast)] transition hover:opacity-90"
              >
                Check
              </button>
            )}
          </div>
          <p id={`hint-${question.id}`} className="muted mt-1.5 text-xs">
            {question.hint ?? "Fractions, surds, powers and pi are all accepted."}
          </p>
        </form>

        <div aria-live="polite">
          {shown && (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 ${
                shown.correct
                  ? "border-[color:var(--easy)]/45 bg-[color:var(--easy)]/10"
                  : "border-[color:var(--hard)]/45 bg-[color:var(--hard)]/10"
              }`}
            >
              <p className="text-sm font-semibold">
                {shown.correct ? "✓ Correct" : "✗ Not quite"}
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                The answer is <T>{question.answer.display}</T>
                {!shown.correct && shown.given ? (
                  <span className="muted"> — you gave {shown.given}.</span>
                ) : null}
              </p>
            </div>
          )}
        </div>

        {(shown || showSolution) && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowSolution((v) => !v)}
              aria-expanded={showSolution}
              className="text-sm font-medium text-[color:var(--accent)] underline underline-offset-4"
            >
              {showSolution ? "Hide the worked solution" : "Show the worked solution"}
            </button>
            {showSolution && (
              <div className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-4">
                <Steps steps={question.solution} />
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
