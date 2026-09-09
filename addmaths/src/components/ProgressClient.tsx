"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  activitySeries,
  clearProgress,
  difficultyStats,
  streakDays,
  topicStats,
  useProgress,
  weakAreas,
} from "@/lib/progress";
import { DIFFICULTIES, DIFFICULTY_LABEL } from "@/lib/types";

export function ProgressClient({
  topicNames,
  totalTopics,
}: {
  topicNames: Record<string, string>;
  totalTopics: number;
}) {
  const [store, refresh] = useProgress();

  const stats = useMemo(() => topicStats(store.attempts), [store.attempts]);
  const weak = useMemo(() => weakAreas(store.attempts), [store.attempts]);
  const byLevel = useMemo(() => difficultyStats(store.attempts), [store.attempts]);
  const activity = useMemo(() => activitySeries(store.attempts, 30), [store.attempts]);

  const total = store.attempts.length;
  const correct = store.attempts.filter((a) => a.correct).length;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const streak = streakDays(store.attempts);
  const avgSeconds = total
    ? Math.round(store.attempts.reduce((n, a) => n + a.ms, 0) / total / 1000)
    : 0;

  function exportData() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `addmaths-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (total === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-lg font-medium">Nothing recorded yet.</p>
        <p className="muted mx-auto mt-2 max-w-md leading-relaxed">
          Answer some practice questions or sit a timed paper, and this page will fill with your
          accuracy by topic, your weak areas, and a queue of everything you got wrong.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/practice/" className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--accent-contrast)]">
            Start practising
          </Link>
          <Link href="/exam/" className="rounded-xl border border-[color:var(--border)] px-5 py-2.5 text-sm font-semibold">
            Sit a paper
          </Link>
        </div>
      </div>
    );
  }

  const maxDay = Math.max(1, ...activity.map((d) => d.n));

  return (
    <div className="py-9">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Questions answered", value: total },
          { label: "Overall accuracy", value: `${accuracy}%` },
          { label: "Day streak", value: streak },
          { label: "Average time", value: `${avgSeconds}s` },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-5 text-center">
            <dd className="text-2xl font-bold tabular-nums text-[color:var(--accent)]">{s.value}</dd>
            <dt className="muted mt-1 text-xs leading-snug">{s.label}</dt>
          </div>
        ))}
      </dl>

      <section className="card mt-6 p-5" aria-labelledby="activity">
        <h2 id="activity" className="text-lg font-bold">
          Last 30 days
        </h2>
        <div className="mt-4 flex h-24 items-end gap-1" role="img" aria-label={`Daily question counts over the last 30 days, ${total} answered in total`}>
          {activity.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col justify-end gap-px" title={`${d.day}: ${d.n} questions, ${d.correct} correct`}>
              <div
                className="rounded-t-sm bg-[color:var(--hard)]/60"
                style={{ height: `${((d.n - d.correct) / maxDay) * 100}%` }}
              />
              <div
                className="rounded-b-sm bg-[color:var(--accent)]"
                style={{ height: `${(d.correct / maxDay) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <p className="muted mt-2 text-xs">Blue is correct, red is incorrect. Hover a bar for the date.</p>
      </section>

      <section className="mt-8" aria-labelledby="by-difficulty">
        <h2 id="by-difficulty" className="text-lg font-bold">
          By difficulty
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {DIFFICULTIES.map((d) => {
            const v = byLevel[d];
            const pct = v.n ? Math.round((v.c / v.n) * 100) : 0;
            return (
              <div key={d} className="card p-4">
                <p className="text-sm font-medium">{DIFFICULTY_LABEL[d]}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{v.n ? `${pct}%` : "—"}</p>
                <p className="muted text-xs">{v.n} answered</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="by-topic">
        <h2 id="by-topic" className="text-lg font-bold">
          By topic
        </h2>
        <p className="muted mt-1 text-sm">
          Weakest first. {stats.length} of {totalTopics} topics attempted.
        </p>
        <ul className="mt-4 space-y-2.5">
          {stats.map((s) => {
            const pct = Math.round(s.accuracy * 100);
            return (
              <li key={s.topic} className="flex items-center gap-3">
                <Link
                  href={`/topics/${s.topic}/`}
                  className="w-36 shrink-0 truncate text-sm hover:text-[color:var(--accent)] sm:w-48"
                >
                  {topicNames[s.topic] ?? s.topic}
                </Link>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-soft)]">
                  <div
                    className={`h-full rounded-full ${pct >= 70 ? "bg-[color:var(--easy)]" : pct >= 40 ? "bg-[color:var(--medium)]" : "bg-[color:var(--hard)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                  {s.correct}/{s.attempts} · {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="next">
        <h2 id="next" className="text-lg font-bold">
          What to do next
        </h2>
        {weak.length === 0 ? (
          <p className="muted mt-2 leading-relaxed">
            Nothing is below 70% with enough attempts to be sure. Widen the net: try a mixed timed
            paper, or take on the hard and olympiad questions in topics you have only met at the
            easy level.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {weak.slice(0, 5).map((s, i) => (
              <li key={s.topic} className="card flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--hard)]/15 text-xs font-bold text-[color:var(--hard)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{topicNames[s.topic] ?? s.topic}</p>
                  <p className="muted text-sm">
                    {Math.round(s.accuracy * 100)}% over {s.attempts} questions, averaging{" "}
                    {Math.round(s.avgSeconds)}s each.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/topics/${s.topic}/`} className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm">
                    Re-read
                  </Link>
                  <Link
                    href={`/practice/?topic=${s.topic}`}
                    className="rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-sm font-semibold text-[color:var(--accent-contrast)]"
                  >
                    Drill it
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
        {store.retry.length > 0 && (
          <p className="muted mt-4 text-sm">
            You have {store.retry.length} question{store.retry.length === 1 ? "" : "s"} in the retry
            queue.{" "}
            <Link href="/practice/" className="link">
              Work through them
            </Link>
            .
          </p>
        )}
      </section>

      {store.exams.length > 0 && (
        <section className="mt-8" aria-labelledby="exams">
          <h2 id="exams" className="text-lg font-bold">
            Exam history
          </h2>
          <ul className="mt-4 space-y-2">
            {[...store.exams].reverse().map((e) => (
              <li key={e.id} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
                <span className="font-medium">{e.label}</span>
                <span className="muted">{new Date(e.at).toLocaleDateString()}</span>
                <span className="muted">{Math.round(e.durationMs / 60000)} min</span>
                <span className="ml-auto font-semibold tabular-nums">
                  {e.score}/{e.total} · {Math.round((e.score / e.total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 border-t border-[color:var(--border)] pt-6">
        <h2 className="text-sm font-semibold">Your data</h2>
        <p className="muted mt-1.5 text-sm leading-relaxed">
          All of this lives in this browser&rsquo;s local storage and is never uploaded. Clearing your
          site data will erase it, so export a copy if it matters to you.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={exportData} className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm font-medium">
            Export as JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete all your progress? This cannot be undone.")) {
                clearProgress();
                refresh();
              }
            }}
            className="rounded-lg border border-[color:var(--hard)]/50 px-4 py-2 text-sm font-medium text-[color:var(--hard)]"
          >
            Delete everything
          </button>
        </div>
      </section>
    </div>
  );
}
