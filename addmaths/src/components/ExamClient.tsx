"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildSet, checkAnswer, type Question } from "@/lib/questions";
import { recordAttempt, recordExam } from "@/lib/progress";
import { Steps } from "./Blocks";
import { T } from "./Math";
import { Chip, DifficultyBadge } from "./ui";

interface Paper {
  label: string;
  paper: 1 | 2;
  questions: number;
  minutes: number;
}

const PAPERS: Paper[] = [
  { label: "Quick test", paper: 2, questions: 8, minutes: 20 },
  { label: "Half paper", paper: 1, questions: 12, minutes: 45 },
  { label: "Full Paper 1 (no calculator)", paper: 1, questions: 20, minutes: 120 },
  { label: "Full Paper 2 (calculator)", paper: 2, questions: 20, minutes: 120 },
];

type Phase = "setup" | "sitting" | "review";

/**
 * The exam simulator.
 *
 * Marking happens only at the end, exactly as in a real paper — no feedback
 * while you work — and the time spent on each question is recorded so the
 * report can show where the minutes went, not just where the marks went.
 */
export function ExamClient({
  topicNames,
  paperCounts,
}: {
  topicNames: Record<string, string>;
  paperCounts: Record<number, number>;
}) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [paper, setPaper] = useState<Paper>(PAPERS[0]!);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const enteredAt = useRef(Date.now());
  const startedAt = useRef(0);

  const recordTime = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      const dt = Date.now() - enteredAt.current;
      enteredAt.current = Date.now();
      setSpent((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + dt }));
    },
    [],
  );

  const finish = useCallback(() => {
    recordTime(questions[current]?.id);
    setPhase("review");
  }, [current, questions, recordTime]);

  // The clock.
  useEffect(() => {
    if (phase !== "sitting") return;
    const timer = window.setInterval(() => {
      setRemaining((t) => {
        if (t <= 1) {
          window.clearInterval(timer);
          finish();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, finish]);

  // Score and persist, once, on entering review.
  const marked = useMemo(() => {
    if (phase !== "review") return null;
    let score = 0;
    let total = 0;
    const perTopic: Record<string, { score: number; total: number }> = {};
    for (const q of questions) {
      const given = answers[q.id] ?? "";
      const correct = given.trim() !== "" && checkAnswer(q.answer, given);
      total += q.marks;
      if (correct) score += q.marks;
      const bucket = perTopic[q.topic] ?? { score: 0, total: 0 };
      bucket.total += q.marks;
      if (correct) bucket.score += q.marks;
      perTopic[q.topic] = bucket;
    }
    return { score, total, perTopic };
  }, [phase, questions, answers]);

  const savedRef = useRef(false);
  useEffect(() => {
    if (phase !== "review" || !marked || savedRef.current) return;
    savedRef.current = true;
    for (const q of questions) {
      const given = answers[q.id] ?? "";
      recordAttempt({
        qid: q.id,
        topic: q.topic,
        generator: q.generator,
        difficulty: q.difficulty,
        correct: given.trim() !== "" && checkAnswer(q.answer, given),
        ms: spent[q.id] ?? 0,
        at: Date.now(),
        marks: q.marks,
      });
    }
    recordExam({
      id: `exam-${Date.now()}`,
      at: Date.now(),
      label: paper.label,
      score: marked.score,
      total: marked.total,
      durationMs: Date.now() - startedAt.current,
      perTopic: marked.perTopic,
    });
  }, [phase, marked, questions, answers, spent, paper.label]);

  function begin(p: Paper) {
    const set = buildSet({
      paper: p.paper,
      count: p.questions,
      seed: Math.floor(Math.random() * 2 ** 30),
    });
    savedRef.current = false;
    setPaper(p);
    setQuestions(set);
    setAnswers({});
    setFlagged(new Set());
    setSpent({});
    setCurrent(0);
    setRemaining(p.minutes * 60);
    enteredAt.current = Date.now();
    startedAt.current = Date.now();
    setPhase("sitting");
    window.scrollTo({ top: 0 });
  }

  function goTo(index: number) {
    recordTime(questions[current]?.id);
    setCurrent(index);
  }

  if (phase === "setup") {
    return (
      <div className="py-9">
        <div className="grid gap-4 sm:grid-cols-2">
          {PAPERS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => begin(p)}
              className="card p-5 text-left transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/50"
            >
              <h2 className="font-semibold">{p.label}</h2>
              <p className="muted mt-1.5 text-sm">
                {p.questions} questions · {p.minutes} minutes · Paper {p.paper}
                {p.paper === 1 ? " (non-calculator style)" : " (calculator allowed)"}
              </p>
              <p className="muted mt-2 text-xs">
                Drawn from {paperCounts[p.paper]} question templates across the whole syllabus.
              </p>
            </button>
          ))}
        </div>
        <div className="card mt-6 p-5">
          <h2 className="font-semibold">How it works</h2>
          <ul className="muted mt-2 space-y-1.5 text-sm">
            <li>· Nothing is marked until you submit — exactly like the real paper.</li>
            <li>· Move freely between questions, and flag any you want to come back to.</li>
            <li>· The clock runs down; at zero the paper is submitted automatically.</li>
            <li>· Afterwards you get the score, a topic breakdown, the time you spent on each question, and every worked solution.</li>
          </ul>
        </div>
      </div>
    );
  }

  const q = questions[current];

  if (phase === "sitting" && q) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const low = remaining < 300;
    return (
      <div className="py-6">
        <div className="sticky top-16 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)]/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-lg font-bold tabular-nums ${low ? "text-[color:var(--hard)]" : ""}`}
              role="timer"
              aria-live="off"
            >
              {mins}:{String(secs).padStart(2, "0")}
            </span>
            <span className="muted text-sm">{paper.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="muted text-sm tabular-nums">
              {Object.values(answers).filter((a) => a.trim()).length}/{questions.length} answered
            </span>
            <button
              type="button"
              onClick={finish}
              className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)]"
            >
              Submit paper
            </button>
          </div>
        </div>

        <nav aria-label="Question navigation" className="mb-5 flex flex-wrap gap-1.5">
          {questions.map((item, i) => {
            const done = (answers[item.id] ?? "").trim() !== "";
            const flag = flagged.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(i)}
                aria-current={i === current ? "true" : undefined}
                aria-label={`Question ${i + 1}${done ? ", answered" : ""}${flag ? ", flagged" : ""}`}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold tabular-nums transition ${
                  i === current
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-contrast)]"
                    : flag
                      ? "border-amber-500/60 bg-amber-500/15"
                      : done
                        ? "border-[color:var(--easy)]/50 bg-[color:var(--easy)]/12"
                        : "border-[color:var(--border)]"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>

        <article className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-2.5 border-b border-[color:var(--border)] bg-[color:var(--bg-soft)] px-5 py-3">
            <span className="text-sm font-semibold">Question {current + 1}</span>
            <DifficultyBadge level={q.difficulty} />
            <Chip>{q.marks} marks</Chip>
            <button
              type="button"
              onClick={() =>
                setFlagged((prev) => {
                  const next = new Set(prev);
                  if (next.has(q.id)) next.delete(q.id);
                  else next.add(q.id);
                  return next;
                })
              }
              aria-pressed={flagged.has(q.id)}
              className="ml-auto rounded-lg border border-[color:var(--border)] px-3 py-1 text-xs font-medium"
            >
              {flagged.has(q.id) ? "★ Flagged" : "☆ Flag for review"}
            </button>
          </header>
          <div className="p-5">
            <div className="space-y-1.5 text-[1.02rem] leading-relaxed">
              {q.prompt.split("\n").map((line, i) =>
                line.trim() ? (
                  <p key={i}>
                    <T>{line}</T>
                  </p>
                ) : (
                  <div key={i} className="h-2" />
                ),
              )}
            </div>
            <label htmlFor="exam-answer" className="mt-5 mb-1.5 block text-sm font-medium">
              Your answer
            </label>
            <input
              id="exam-answer"
              key={q.id}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              autoComplete="off"
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3.5 py-2.5 font-mono text-[0.95rem] outline-none focus:border-[color:var(--accent)]"
              placeholder={q.answer.kind === "mcq" ? "Type the option number" : "e.g. 3/4, -2.5, sqrt5"}
            />
            <p className="muted mt-1.5 text-xs">{q.hint ?? "Fractions, surds, powers and pi are accepted."}</p>
          </div>
        </article>

        <div className="mt-5 flex justify-between gap-3">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, current - 1))}
            disabled={current === 0}
            className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={() => goTo(Math.min(questions.length - 1, current + 1))}
            disabled={current === questions.length - 1}
            className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    );
  }

  if (phase === "review" && marked) {
    const percent = marked.total ? Math.round((marked.score / marked.total) * 100) : 0;
    const totalTime = Object.values(spent).reduce((a, b) => a + b, 0);
    const slowest = [...questions]
      .map((item, i) => ({ item, i, ms: spent[item.id] ?? 0 }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3);

    return (
      <div className="py-9">
        <section className="card p-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]">
            {paper.label} · complete
          </p>
          <p className="mt-2 text-4xl font-bold tabular-nums">
            {marked.score}
            <span className="muted text-2xl"> / {marked.total}</span>
          </p>
          <p className="muted mt-1.5">{percent}% · {Math.round(totalTime / 60000)} minutes used</p>
          <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-[color:var(--bg-soft)]">
            <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${percent}%` }} />
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-lg font-bold">Performance by topic</h2>
          <ul className="mt-4 space-y-2.5">
            {Object.entries(marked.perTopic)
              .sort((a, b) => a[1].score / a[1].total - b[1].score / b[1].total)
              .map(([slug, v]) => {
                const pct = Math.round((v.score / v.total) * 100);
                return (
                  <li key={slug} className="flex items-center gap-4">
                    <Link href={`/topics/${slug}/`} className="w-40 shrink-0 truncate text-sm hover:text-[color:var(--accent)]">
                      {topicNames[slug] ?? slug}
                    </Link>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-soft)]">
                      <div
                        className={`h-full rounded-full ${pct >= 70 ? "bg-[color:var(--easy)]" : pct >= 40 ? "bg-[color:var(--medium)]" : "bg-[color:var(--hard)]"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                      {v.score}/{v.total}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>

        <section className="mt-7">
          <h2 className="text-lg font-bold">Where the time went</h2>
          <ul className="muted mt-3 space-y-1.5 text-sm">
            {slowest.map(({ item, i, ms }) => (
              <li key={item.id}>
                Question {i + 1} ({item.title}) took {Math.round(ms / 1000)} s
                {item.marks ? ` for ${item.marks} marks — ${(ms / 1000 / item.marks).toFixed(0)} s per mark` : ""}.
              </li>
            ))}
          </ul>
          <p className="muted mt-3 text-sm">
            In the real paper you have 90 seconds per mark. Anything far above that is a topic to
            drill, not a question to worry about.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Every question, with solutions</h2>
          <div className="mt-4 space-y-4">
            {questions.map((item, i) => {
              const given = answers[item.id] ?? "";
              const correct = given.trim() !== "" && checkAnswer(item.answer, given);
              return (
                <details key={item.id} className="card overflow-hidden" open={!correct}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                    <span className={`text-sm font-semibold ${correct ? "text-[color:var(--easy)]" : "text-[color:var(--hard)]"}`}>
                      {correct ? "✓" : "✗"} Q{i + 1}
                    </span>
                    <span className="text-sm">{item.title}</span>
                    <Chip>{item.marks} marks</Chip>
                    <span className="muted ml-auto text-xs">{Math.round((spent[item.id] ?? 0) / 1000)} s</span>
                  </summary>
                  <div className="border-t border-[color:var(--border)] p-5">
                    <div className="rounded-xl bg-[color:var(--bg-soft)] p-4 text-sm leading-relaxed">
                      {item.prompt.split("\n").map((line, j) => (
                        <p key={j}>
                          <T>{line}</T>
                        </p>
                      ))}
                    </div>
                    <p className="mt-3 text-sm">
                      <span className="muted">Your answer: </span>
                      {given.trim() ? given : <span className="muted italic">left blank</span>}
                      <span className="muted"> · Correct: </span>
                      <T>{item.answer.display}</T>
                    </p>
                    <div className="mt-4">
                      <Steps steps={item.solution} />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPhase("setup")}
            className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
          >
            Sit another paper
          </button>
          <Link href="/progress/" className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold">
            See your progress
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
