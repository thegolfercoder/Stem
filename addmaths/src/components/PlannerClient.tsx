"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { loadProgress, saveProgress, useProgress } from "@/lib/progress";

interface PlannerTopic {
  slug: string;
  title: string;
  short: string;
  minutes: number;
  unit: number;
}

/**
 * Spreads the course over the weeks remaining before the exam.
 *
 * Topics keep their teaching order, so nothing is scheduled before the topic it
 * depends on. The last 15% of the available time is reserved for past papers
 * and mixed practice rather than new content — which is what actually moves a
 * grade in the final fortnight.
 */
export function PlannerClient({ topics }: { topics: PlannerTopic[] }) {
  const [store, refresh] = useProgress();
  const [examDate, setExamDate] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState(4);

  useEffect(() => {
    const saved = loadProgress().examDate;
    if (saved) setExamDate(saved);
  }, []);

  function setDate(value: string) {
    setExamDate(value);
    const current = loadProgress();
    saveProgress({ ...current, examDate: value || undefined });
    refresh();
  }

  const plan = useMemo(() => {
    if (!examDate) return null;
    const exam = new Date(`${examDate}T00:00:00`);
    if (Number.isNaN(exam.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const days = Math.ceil((exam.getTime() - now.getTime()) / 86400000);
    if (days <= 0) return { days, weeks: 0, weeksOfContent: 0, schedule: [], totalHours: 0 };

    const weeks = Math.max(1, Math.ceil(days / 7));
    const weeksOfContent = Math.max(1, Math.floor(weeks * 0.85));
    const totalMinutes = topics.reduce((n, t) => n + t.minutes, 0);
    // Reading is roughly a third of the work; practice is the rest.
    const workMinutes = totalMinutes * 3;
    const minutesPerWeek = hoursPerWeek * 60;

    const schedule: { week: number; topics: PlannerTopic[]; minutes: number }[] = [];
    const budget = Math.max(minutesPerWeek, workMinutes / weeksOfContent);
    let bucket: PlannerTopic[] = [];
    let used = 0;
    let week = 1;
    for (const t of topics) {
      const cost = t.minutes * 3;
      if (used + cost > budget && bucket.length && week < weeksOfContent) {
        schedule.push({ week, topics: bucket, minutes: used });
        week += 1;
        bucket = [];
        used = 0;
      }
      bucket.push(t);
      used += cost;
    }
    if (bucket.length) schedule.push({ week, topics: bucket, minutes: used });

    return { days, weeks, weeksOfContent, schedule, totalHours: Math.round(workMinutes / 60) };
  }, [examDate, hoursPerWeek, topics]);

  const done = new Set(store.completed);
  const percent = Math.round((done.size / topics.length) * 100);

  return (
    <div className="py-9">
      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-bold">Your details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="exam-date" className="mb-1.5 block text-sm font-medium">
              Exam date
            </label>
            <input
              id="exam-date"
              type="date"
              value={examDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </div>
          <div>
            <label htmlFor="hours" className="mb-1.5 block text-sm font-medium">
              Hours of Add Maths per week: <span className="tabular-nums">{hoursPerWeek}</span>
            </label>
            <input
              id="hours"
              type="range"
              min={1}
              max={20}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(Number(e.target.value))}
              className="w-full accent-[color:var(--accent)]"
            />
          </div>
        </div>
      </section>

      <section className="card mt-6 p-5 sm:p-6" aria-labelledby="coverage">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="coverage" className="text-lg font-bold">
            Topics revised
          </h2>
          <span className="text-sm font-semibold tabular-nums">
            {done.size} / {topics.length} ({percent}%)
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--bg-soft)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Topics revised">
          <div className="h-full rounded-full bg-[color:var(--accent)] transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="muted mt-3 text-sm">
          Mark a topic as revised from its own page — the button sits under the title.
        </p>
      </section>

      {plan && plan.days <= 0 && (
        <p className="muted mt-6">That date has passed. Good luck — or pick a future date.</p>
      )}

      {plan && plan.days > 0 && (
        <section className="mt-8" aria-labelledby="schedule">
          <div className="mb-5 flex flex-wrap items-baseline gap-3">
            <h2 id="schedule" className="text-xl font-bold sm:text-2xl">
              Your {plan.weeks}-week plan
            </h2>
            <p className="muted text-sm">
              {plan.days} days left · about {plan.totalHours} hours of work · content finishes in week{" "}
              {plan.weeksOfContent}, leaving the rest for papers.
            </p>
          </div>

          <ol className="space-y-3">
            {plan.schedule.map((row) => {
              const allDone = row.topics.every((t) => done.has(t.slug));
              return (
                <li
                  key={row.week}
                  className={`card p-4 ${allDone ? "border-[color:var(--easy)]/45" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-xs font-bold tabular-nums text-[color:var(--accent)]">
                      {row.week}
                    </span>
                    <span className="text-sm font-semibold">Week {row.week}</span>
                    <span className="muted text-xs">≈ {Math.round(row.minutes / 60)} hours</span>
                    {allDone && <span className="ml-auto text-xs font-semibold text-[color:var(--easy)]">✓ done</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.topics.map((t) => (
                      <Link
                        key={t.slug}
                        href={`/topics/${t.slug}/`}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                          done.has(t.slug)
                            ? "border-[color:var(--easy)]/45 bg-[color:var(--easy)]/10 text-[color:var(--easy)] line-through"
                            : "border-[color:var(--border)] hover:border-[color:var(--accent)]/50"
                        }`}
                      >
                        {t.short}
                      </Link>
                    ))}
                  </div>
                </li>
              );
            })}
            {plan.weeks > plan.weeksOfContent && (
              <li className="card border-dashed p-4">
                <p className="text-sm font-semibold">
                  Weeks {plan.weeksOfContent + 1}–{plan.weeks}: papers only
                </p>
                <p className="muted mt-1.5 text-sm leading-relaxed">
                  No new content. Sit a full timed paper, mark it, and spend the next session only on
                  what you got wrong. Repeat. This is the fortnight that moves grades.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/exam/" className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)]">
                    Sit a timed paper
                  </Link>
                  <Link href="/past-papers/" className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm font-semibold">
                    Past-paper style questions
                  </Link>
                </div>
              </li>
            )}
          </ol>

          <div className="card mt-6 p-5">
            <h3 className="font-semibold">How to use a session</h3>
            <ol className="muted mt-2 space-y-1.5 text-sm">
              <li>1. Read the topic page once, without writing anything.</li>
              <li>2. Work the examples yourself, covering the solution, then compare.</li>
              <li>3. Generate ten practice questions on that topic and mark them.</li>
              <li>4. Re-read only the mistakes list. Then move on.</li>
            </ol>
          </div>
        </section>
      )}

      {!plan && (
        <p className="muted mt-6">Enter your exam date above to build a schedule.</p>
      )}
    </div>
  );
}
