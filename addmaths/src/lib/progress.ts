"use client";

import { useCallback, useEffect, useState } from "react";
import type { Difficulty } from "./types";

/**
 * Progress lives in localStorage and nowhere else.
 *
 * There is no account, no server and no upload: a student can use the site
 * without handing over anything. The cost is that clearing site data clears
 * the history, which the export button on the progress page exists to soften.
 */

const KEY = "addmaths-progress-v1";
const EVENT = "addmaths-progress-change";

export interface Attempt {
  /** "<generator>:<seed>" — enough to rebuild the exact question. */
  qid: string;
  topic: string;
  generator: string;
  difficulty: Difficulty;
  correct: boolean;
  /** Milliseconds spent on the question. */
  ms: number;
  /** Epoch milliseconds. */
  at: number;
  marks: number;
}

export interface ExamResult {
  id: string;
  at: number;
  label: string;
  score: number;
  total: number;
  durationMs: number;
  perTopic: Record<string, { score: number; total: number }>;
}

export interface ProgressStore {
  attempts: Attempt[];
  exams: ExamResult[];
  /** Question ids answered wrongly and not yet re-answered correctly. */
  retry: string[];
  /** Topic slugs the student has ticked off on the planner. */
  completed: string[];
  examDate?: string;
}

const EMPTY: ProgressStore = { attempts: [], exams: [], retry: [], completed: [] };

export function loadProgress(): ProgressStore {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ProgressStore>;
    return {
      attempts: parsed.attempts ?? [],
      exams: parsed.exams ?? [],
      retry: parsed.retry ?? [],
      completed: parsed.completed ?? [],
      ...(parsed.examDate ? { examDate: parsed.examDate } : {}),
    };
  } catch {
    return EMPTY;
  }
}

export function saveProgress(store: ProgressStore): void {
  if (typeof window === "undefined") return;
  try {
    // Keep the history bounded: 2000 attempts is years of revision and still
    // a small fraction of the storage quota.
    const trimmed: ProgressStore = {
      ...store,
      attempts: store.attempts.slice(-2000),
      exams: store.exams.slice(-60),
    };
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota exceeded or storage disabled: the session still works, it just
       will not be remembered */
  }
}

export function recordAttempt(attempt: Attempt): void {
  const store = loadProgress();
  store.attempts.push(attempt);
  const retry = new Set(store.retry);
  if (attempt.correct) retry.delete(attempt.qid);
  else retry.add(attempt.qid);
  store.retry = [...retry].slice(-200);
  saveProgress(store);
}

export function recordExam(result: ExamResult): void {
  const store = loadProgress();
  store.exams.push(result);
  saveProgress(store);
}

export function clearProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* nothing to clear */
  }
}

/** Subscribes a component to the store, including changes from other tabs. */
export function useProgress(): [ProgressStore, () => void] {
  const [store, setStore] = useState<ProgressStore>(EMPTY);
  const refresh = useCallback(() => setStore(loadProgress()), []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  return [store, refresh];
}

/* ------------------------------------------------------------- statistics */

export interface TopicStat {
  topic: string;
  attempts: number;
  correct: number;
  accuracy: number;
  avgSeconds: number;
  lastAt: number;
}

export function topicStats(attempts: Attempt[]): TopicStat[] {
  const map = new Map<string, { n: number; c: number; ms: number; last: number }>();
  for (const a of attempts) {
    const cur = map.get(a.topic) ?? { n: 0, c: 0, ms: 0, last: 0 };
    cur.n += 1;
    cur.c += a.correct ? 1 : 0;
    cur.ms += a.ms;
    cur.last = Math.max(cur.last, a.at);
    map.set(a.topic, cur);
  }
  return [...map.entries()]
    .map(([topic, v]) => ({
      topic,
      attempts: v.n,
      correct: v.c,
      accuracy: v.n ? v.c / v.n : 0,
      avgSeconds: v.n ? v.ms / v.n / 1000 : 0,
      lastAt: v.last,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

export function difficultyStats(attempts: Attempt[]): Record<Difficulty, { n: number; c: number }> {
  const base: Record<Difficulty, { n: number; c: number }> = {
    easy: { n: 0, c: 0 },
    medium: { n: 0, c: 0 },
    hard: { n: 0, c: 0 },
    olympiad: { n: 0, c: 0 },
  };
  for (const a of attempts) {
    base[a.difficulty].n += 1;
    if (a.correct) base[a.difficulty].c += 1;
  }
  return base;
}

/**
 * Weak areas: topics with a real sample and accuracy below 70%, worst first.
 * A single wrong answer is not a weakness, so three attempts is the floor.
 */
export function weakAreas(attempts: Attempt[], minAttempts = 3): TopicStat[] {
  return topicStats(attempts).filter((s) => s.attempts >= minAttempts && s.accuracy < 0.7);
}

/** Consecutive days, ending today or yesterday, with at least one attempt. */
export function streakDays(attempts: Attempt[]): number {
  if (!attempts.length) return 0;
  const days = new Set(attempts.map((a) => dayKey(a.at)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    if (!days.has(dayKey(cursor.getTime()))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Attempts per day for the last `days` days, oldest first. */
export function activitySeries(attempts: Attempt[], days = 30): { day: string; n: number; correct: number }[] {
  const out: { day: string; n: number; correct: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = dayKey(d.getTime());
    const todays = attempts.filter((a) => dayKey(a.at) === key);
    out.push({
      day: key,
      n: todays.length,
      correct: todays.filter((a) => a.correct).length,
    });
  }
  return out;
}
