/**
 * Solve times and the averages speedcubers actually use.
 *
 * A "mean of 5" and an "average of 5" are different things and the difference
 * matters: the average drops the best and worst attempt and means the middle
 * three, so one lucky solve and one disaster both stop counting. That is the
 * figure competitions rank by, and it is the one worth showing.
 */

export interface Attempt {
  /** Milliseconds. */
  readonly time: number;
  /** WCA penalties: a +2 adds two seconds, a DNF does not count at all. */
  readonly penalty?: 'plus2' | 'dnf';
  readonly scramble: string;
  readonly at: number;
}

export const DNF = Number.POSITIVE_INFINITY;

/** An attempt's effective time, with penalties applied. */
export function effectiveTime(attempt: Attempt): number {
  if (attempt.penalty === 'dnf') return DNF;
  return attempt.time + (attempt.penalty === 'plus2' ? 2000 : 0);
}

/**
 * The average of the most recent `count` attempts, WCA style.
 *
 * The best and the worst are removed and the rest are meaned. Two or more
 * did-not-finish results leave nothing to mean, so the average is a DNF too -
 * which is the rule, and also the sensible answer.
 */
export function averageOf(attempts: readonly Attempt[], count: number): number | null {
  if (attempts.length < count) return null;
  const recent = attempts.slice(-count).map(effectiveTime);

  const failures = recent.filter((time) => time === DNF).length;
  if (failures > 1) return DNF;

  const sorted = [...recent].sort((a, b) => a - b);
  const middle = sorted.slice(1, -1);
  if (middle.some((time) => time === DNF)) return DNF;
  return middle.reduce((total, time) => total + time, 0) / middle.length;
}

/** The plain mean of every finished attempt. */
export function sessionMean(attempts: readonly Attempt[]): number | null {
  const finished = attempts.map(effectiveTime).filter((time) => time !== DNF);
  if (finished.length === 0) return null;
  return finished.reduce((total, time) => total + time, 0) / finished.length;
}

export function bestTime(attempts: readonly Attempt[]): number | null {
  const finished = attempts.map(effectiveTime).filter((time) => time !== DNF);
  return finished.length ? Math.min(...finished) : null;
}

export function worstTime(attempts: readonly Attempt[]): number | null {
  const finished = attempts.map(effectiveTime).filter((time) => time !== DNF);
  return finished.length ? Math.max(...finished) : null;
}

export interface SessionSummary {
  readonly solves: number;
  readonly best: number | null;
  readonly worst: number | null;
  readonly mean: number | null;
  readonly ao5: number | null;
  readonly ao12: number | null;
  readonly bestAo5: number | null;
}

export function summarise(attempts: readonly Attempt[]): SessionSummary {
  let bestAo5: number | null = null;
  for (let end = 5; end <= attempts.length; end++) {
    const value = averageOf(attempts.slice(0, end), 5);
    if (value !== null && value !== DNF && (bestAo5 === null || value < bestAo5)) {
      bestAo5 = value;
    }
  }
  return {
    solves: attempts.length,
    best: bestTime(attempts),
    worst: worstTime(attempts),
    mean: sessionMean(attempts),
    ao5: averageOf(attempts, 5),
    ao12: averageOf(attempts, 12),
    bestAo5,
  };
}

/** `1:23.45` or `9.87`, the way a timer displays it. */
export function formatTime(milliseconds: number | null): string {
  if (milliseconds === null) return '--';
  if (milliseconds === DNF) return 'DNF';
  const total = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  if (minutes === 0) return seconds.toFixed(2);
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}
