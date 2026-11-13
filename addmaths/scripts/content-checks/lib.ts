/**
 * Independent checks for hand-written answers.
 *
 * `v(id, ...)` recomputes an answer from the question's own data, in plain
 * arithmetic that shares no code with the lesson, and states what the page
 * shows. The verifier then confirms the shown text really is in the answer
 * and that it agrees with the recomputation to the precision displayed.
 */
export interface Shown {
  /** Text that must appear verbatim in the answer. */
  show: string;
  /** The value of the shown form, when it is not a plain number or a/b. */
  is?: number;
  /** The independently computed value. */
  want: number;
}

export interface Check {
  id: string;
  items: Shown[];
}

export const CHECKS: Check[] = [];
/** Ids whose answer is a proof, sketch or statement with no number to check. */
export const PROOFS = new Map<string, string>();

export function v(id: string, ...items: Shown[]): void {
  CHECKS.push({ id, items });
}
export function proof(id: string, why: string): void {
  PROOFS.set(id, why);
}
/** Shorthand for a shown value. */
export function s(show: string, want: number, is?: number): Shown {
  return is === undefined ? { show, want } : { show, want, is };
}

/** Real roots of f on [lo, hi], found by sign changes on a fine grid then bisection. */
export function realRoots(f: (x: number) => number, lo: number, hi: number, n = 200000): number[] {
  const out: number[] = [];
  let px = lo, py = f(lo);
  for (let i = 1; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n, y = f(x);
    if (py === 0) out.push(px);
    else if ((py < 0) !== (y < 0) && y !== 0) {
      let a = px, b = x;
      for (let k = 0; k < 100; k++) {
        const m = (a + b) / 2;
        if ((f(m) < 0) === (f(a) < 0)) a = m;
        else b = m;
      }
      out.push((a + b) / 2);
    }
    px = x;
    py = y;
  }
  return out;
}
