/**
 * The speedcubing timer.
 *
 * Competition rules, because a timer that does not follow them produces times
 * that cannot be compared with anything: fifteen seconds of inspection, a
 * two-second penalty for starting late, and a did-not-finish for starting more
 * than seventeen seconds in. Hold the space bar to arm it, release to start,
 * press anything to stop.
 */

export type TimerPhase = 'idle' | 'inspecting' | 'armed' | 'running' | 'stopped';

export interface TimerState {
  readonly phase: TimerPhase;
  /** Milliseconds elapsed in the current phase. */
  readonly elapsed: number;
  /** The penalty inspection has earned so far. */
  readonly penalty: 'none' | 'plus2' | 'dnf';
}

export const INSPECTION_MS = 15_000;
export const PLUS_TWO_AFTER_MS = 15_000;
export const DNF_AFTER_MS = 17_000;
/** How long the space bar must be held before the timer will start. */
export const HOLD_MS = 350;

export function inspectionPenalty(elapsed: number): 'none' | 'plus2' | 'dnf' {
  if (elapsed >= DNF_AFTER_MS) return 'dnf';
  if (elapsed >= PLUS_TWO_AFTER_MS) return 'plus2';
  return 'none';
}

/**
 * A timer as a small state machine, with the clock injected.
 *
 * Taking `now` as a parameter rather than calling `Date.now` inside means the
 * whole thing can be tested without waiting fifteen real seconds for an
 * inspection penalty.
 */
export class SolveTimer {
  private phase: TimerPhase = 'idle';
  private phaseStarted = 0;
  private holdStarted = 0;
  private finalTime = 0;
  private penalty: 'none' | 'plus2' | 'dnf' = 'none';

  constructor(private readonly useInspection = true) {}

  state(now: number): TimerState {
    const elapsed =
      this.phase === 'stopped' ? this.finalTime : Math.max(0, now - this.phaseStarted);
    const penalty =
      this.phase === 'inspecting' || this.phase === 'armed'
        ? inspectionPenalty(elapsed)
        : this.penalty;
    return { phase: this.phase, elapsed, penalty };
  }

  /** The space bar going down. */
  press(now: number): void {
    switch (this.phase) {
      case 'idle':
        if (this.useInspection) {
          this.phase = 'inspecting';
          this.phaseStarted = now;
        } else {
          this.holdStarted = now;
          this.phase = 'armed';
          this.phaseStarted = now;
        }
        break;
      case 'inspecting':
        this.penalty = inspectionPenalty(now - this.phaseStarted);
        this.holdStarted = now;
        this.phase = 'armed';
        break;
      case 'running':
        this.finalTime = now - this.phaseStarted;
        this.phase = 'stopped';
        break;
      case 'stopped':
        this.phase = 'idle';
        this.penalty = 'none';
        break;
      case 'armed':
        break;
    }
  }

  /** The space bar coming up. Only starts the clock if it was held long enough. */
  release(now: number): void {
    if (this.phase !== 'armed') return;
    if (now - this.holdStarted < HOLD_MS) {
      // Not held long enough: back to inspecting, the way a competition timer
      // refuses to start until the hands have settled.
      this.phase = this.useInspection ? 'inspecting' : 'idle';
      return;
    }
    this.phase = 'running';
    this.phaseStarted = now;
  }

  /** Stop by any means other than the space bar - a solved cube, for instance. */
  stop(now: number): number | null {
    if (this.phase !== 'running') return null;
    this.finalTime = now - this.phaseStarted;
    this.phase = 'stopped';
    return this.finalTime;
  }

  reset(): void {
    this.phase = 'idle';
    this.penalty = 'none';
    this.finalTime = 0;
  }

  get result(): { time: number; penalty: 'none' | 'plus2' | 'dnf' } | null {
    return this.phase === 'stopped' ? { time: this.finalTime, penalty: this.penalty } : null;
  }
}
