/**
 * Keeping a session between visits.
 *
 * Local storage only. There is no account, no server and nothing leaves the
 * machine, which is the right shape for a page that solves a puzzle - and it
 * means every read has to survive the storage being unavailable, because a
 * private window or a browser set to block site data will throw on access
 * rather than return nothing.
 */

import type { Attempt } from './stats.js';

const ATTEMPTS_KEY = 'rubiks-cube-trainer:attempts';
const SETTINGS_KEY = 'rubiks-cube-trainer:settings';

export interface Settings {
  paletteId: string;
  animationMs: number;
  useInspection: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  paletteId: 'standard',
  animationMs: 160,
  useInspection: true,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full, or blocked. Losing a session history is not worth an error
    // in front of somebody who is trying to solve a cube.
  }
}

export function loadSettings(): Settings {
  return read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

export function loadAttempts(): Attempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Attempt =>
        typeof entry === 'object' && entry !== null && typeof (entry as Attempt).time === 'number',
    );
  } catch {
    return [];
  }
}

export function saveAttempts(attempts: readonly Attempt[]): void {
  // Keep the last few hundred: enough for every average anyone computes, and
  // small enough never to bump into a storage quota.
  write(ATTEMPTS_KEY, attempts.slice(-500));
}

export function clearAttempts(): void {
  try {
    localStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    // As above.
  }
}
