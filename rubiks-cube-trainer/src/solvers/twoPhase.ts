/**
 * Kociemba's two-phase algorithm.
 *
 * The idea is a change of target. Solving a cube directly is a search over
 * forty-three quintillion states with no useful heuristic. Instead:
 *
 *  **Phase 1** takes the cube into the subgroup G1 = <U, D, R2, L2, F2, B2>,
 *  where every corner is correctly oriented, every edge is correctly oriented,
 *  and the four E-slice edges are somewhere in the E-slice. That is a search
 *  over 2187 x 2048 x 495 = about 2.2 billion states, but only three
 *  coordinates have to be tracked and a pruning table over pairs of them makes
 *  it quick.
 *
 *  **Phase 2** finishes the job using only the ten moves that stay inside G1,
 *  so nothing phase 1 achieved is undone. That is a search over 8! x 8! x 4!
 *  states, again with pruning tables.
 *
 * The first solution found is usually around 25 moves. The algorithm gets
 * shorter by not stopping: a *longer* phase-1 maneuver often leaves a much
 * easier phase 2, so the search keeps going through phase-1 solutions of
 * increasing length and keeps the best total, until it hits the length the
 * caller asked for or runs out of time. Twenty to twenty-three moves is typical
 * within a second.
 *
 * This is not an optimal solver. Every cube can be solved in twenty moves or
 * fewer - that was proved in 2010 with several weeks of Google's CPU time - and
 * a solver that guarantees it needs far larger tables and far more search than
 * belongs in a web page.
 */

import { Cube } from '../core/cube.js';
import {
  CORNER_PERM_COUNT,
  FLIP_COUNT,
  SOLVED_SLICE,
  TWIST_COUNT,
  UD_EDGE_PERM_COUNT,
  getCornerPerm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
  getUdEdgePerm,
} from '../core/coords.js';
import {
  MOVE_COUNT,
  PHASE2_MOVES,
  cancelMoves,
  faceOf,
  sameAxis,
  type Move,
} from '../core/moves.js';
import { PHASE2_SLOT, getTables, type Tables } from '../core/tables.js';

export interface TwoPhaseOptions {
  /** Stop as soon as a solution this short is found. A goal, not a promise. */
  targetLength?: number;
  /**
   * Never return a solution longer than this.
   *
   * Distinct from `targetLength`, and the distinction matters: an early version
   * used the target as the phase-2 budget, so asking for 19 moves on a cube
   * that needed 22 produced no answer at all rather than a 22-move one. A goal
   * you might miss and a limit you must not exceed are different numbers.
   */
  maxLength?: number;
  /** Stop looking for something shorter after this long, once something exists. */
  timeLimitMs?: number;
  /** Hard ceiling on the phase-1 search depth. */
  maxPhase1Depth?: number;
}

export interface TwoPhaseResult {
  readonly moves: Move[];
  readonly phase1Length: number;
  readonly phase2Length: number;
  /** How many phase-1 maneuvers were tried before settling on this one. */
  readonly candidatesExplored: number;
  readonly milliseconds: number;
  /** True when the search stopped on its time limit rather than its target. */
  readonly timedOut: boolean;
}

/**
 * Defaults chosen so that a solution always exists inside them.
 *
 * Phase 1 never needs more than 12 moves and phase 2 never needs more than 18,
 * so a 30-move ceiling with a 13-move phase-1 depth cannot fail to find
 * something: the first phase-1 maneuver the search completes, at depth d <= 12,
 * leaves phase 2 a budget of 30 - d >= 18. Everything after that first solution
 * is optimisation, and optimisation is what the time limit governs.
 */
const DEFAULTS = {
  targetLength: 21,
  maxLength: 30,
  timeLimitMs: 1500,
  maxPhase1Depth: 13,
} as const;

/** Solve a cube. Throws if the state could not be reached by turning a cube. */
export function solveTwoPhase(cube: Cube, options: TwoPhaseOptions = {}): TwoPhaseResult {
  cube.assertSolvable();

  const targetLength = options.targetLength ?? DEFAULTS.targetLength;
  const maxLength = options.maxLength ?? DEFAULTS.maxLength;
  const timeLimitMs = options.timeLimitMs ?? DEFAULTS.timeLimitMs;
  const maxPhase1Depth = options.maxPhase1Depth ?? DEFAULTS.maxPhase1Depth;

  const started = Date.now();
  if (cube.isSolved()) {
    return {
      moves: [],
      phase1Length: 0,
      phase2Length: 0,
      candidatesExplored: 0,
      milliseconds: 0,
      timedOut: false,
    };
  }

  const tables = getTables();
  const search = new Search(
    cube,
    tables,
    {
      targetLength,
      maxLength,
      timeLimitMs,
      maxPhase1Depth,
    },
    started,
  );
  const best = search.run();

  if (best === null) {
    throw new Error(
      `no solution of ${maxLength} moves or fewer found within a phase-1 depth of ` +
        `${maxPhase1Depth}; raise maxLength or maxPhase1Depth`,
    );
  }

  return {
    moves: best.moves,
    phase1Length: best.phase1Length,
    phase2Length: best.moves.length - best.phase1Length,
    candidatesExplored: search.candidates,
    milliseconds: Date.now() - started,
    timedOut: search.timedOut,
  };
}

interface Candidate {
  moves: Move[];
  phase1Length: number;
}

class Search {
  candidates = 0;
  timedOut = false;

  private best: Candidate | null = null;
  private readonly path: Move[] = [];

  private readonly twist: number;
  private readonly flip: number;
  private readonly slice: number;

  constructor(
    private readonly cube: Cube,
    private readonly tables: Tables,
    private readonly limits: {
      targetLength: number;
      maxLength: number;
      timeLimitMs: number;
      maxPhase1Depth: number;
    },
    private readonly started: number,
  ) {
    this.twist = getTwist(cube);
    this.flip = getFlip(cube);
    this.slice = getSlice(cube);
  }

  run(): Candidate | null {
    const start = this.phase1LowerBound(this.twist, this.flip, this.slice);
    for (let depth = start; depth <= this.limits.maxPhase1Depth; depth++) {
      this.path.length = 0;
      this.searchPhase1(this.twist, this.flip, this.slice, depth, -1);
      if (this.finished()) break;
    }
    return this.best;
  }

  /**
   * Whether to stop searching.
   *
   * The time limit only ends the search once there is something to return.
   * Before that it is ignored, because a solver that runs out of time and hands
   * back nothing is worse than one that takes a moment longer: the caller has a
   * scrambled cube either way, and now also has an exception. The guarantee in
   * DEFAULTS is what makes that safe - a first solution always exists within
   * the search bounds, and it is found quickly.
   */
  private finished(): boolean {
    if (this.best === null) return false;
    if (this.best.moves.length <= this.limits.targetLength) return true;
    if (Date.now() - this.started > this.limits.timeLimitMs) {
      this.timedOut = true;
      return true;
    }
    return false;
  }

  private phase1LowerBound(twist: number, flip: number, slice: number): number {
    return Math.max(
      this.tables.twistSlicePrune[slice * TWIST_COUNT + twist] as number,
      this.tables.flipSlicePrune[slice * FLIP_COUNT + flip] as number,
    );
  }

  /**
   * Depth-first search for a phase-1 maneuver of exactly `remaining` moves.
   *
   * Two prunings do the work. The table gives a lower bound on the moves still
   * needed, so a branch that needs more than remain is abandoned at once. And
   * two consecutive moves on the same face are never useful - they would
   * combine into one - while two on the same axis are only generated in a fixed
   * order, because turning R then L reaches the same state as L then R.
   */
  private searchPhase1(
    twist: number,
    flip: number,
    slice: number,
    remaining: number,
    lastMove: Move,
  ): void {
    if (this.finished()) return;

    if (remaining === 0) {
      if (twist === 0 && flip === 0 && slice === SOLVED_SLICE) {
        this.candidates += 1;
        this.tryPhase2();
      }
      return;
    }

    if (this.phase1LowerBound(twist, flip, slice) > remaining) return;

    for (let move = 0; move < MOVE_COUNT; move++) {
      if (lastMove >= 0) {
        if (faceOf(move) === faceOf(lastMove)) continue;
        // On one axis, only ever turn the lower-numbered face first.
        if (sameAxis(move, lastMove) && faceOf(move) > faceOf(lastMove)) continue;
      }

      this.path.push(move);
      this.searchPhase1(
        this.tables.twistMove[twist * MOVE_COUNT + move] as number,
        this.tables.flipMove[flip * MOVE_COUNT + move] as number,
        this.tables.sliceMove[slice * MOVE_COUNT + move] as number,
        remaining - 1,
        move,
      );
      this.path.pop();

      if (this.finished()) return;
    }
  }

  /** Run phase 2 on the state the current phase-1 path reaches. */
  private tryPhase2(): void {
    // Before a first solution exists the budget is the hard ceiling; afterwards
    // it tightens, so every further solution found is strictly shorter.
    const ceiling = this.best?.moves.length ?? this.limits.maxLength + 1;
    const budget = ceiling - this.path.length - 1;
    if (budget < 0) return;

    const state = this.cube.apply(this.path);
    const cornerPerm = getCornerPerm(state);
    const edgePerm = getUdEdgePerm(state);
    const slicePerm = getSlicePerm(state);

    const lower = this.phase2LowerBound(cornerPerm, edgePerm, slicePerm);
    if (lower > budget) return;

    for (let depth = lower; depth <= budget; depth++) {
      const tail: Move[] = [];
      if (this.searchPhase2(cornerPerm, edgePerm, slicePerm, depth, this.path.at(-1) ?? -1, tail)) {
        const moves = cancelMoves([...this.path, ...tail]);
        if (this.best === null || moves.length < this.best.moves.length) {
          this.best = { moves, phase1Length: this.path.length };
        }
        return;
      }
    }
  }

  private phase2LowerBound(cornerPerm: number, edgePerm: number, slicePerm: number): number {
    return Math.max(
      this.tables.cornerSlicePrune[slicePerm * CORNER_PERM_COUNT + cornerPerm] as number,
      this.tables.edgeSlicePrune[slicePerm * UD_EDGE_PERM_COUNT + edgePerm] as number,
    );
  }

  private searchPhase2(
    cornerPerm: number,
    edgePerm: number,
    slicePerm: number,
    remaining: number,
    lastMove: Move,
    path: Move[],
  ): boolean {
    if (remaining === 0) {
      return cornerPerm === 0 && edgePerm === 0 && slicePerm === 0;
    }
    if (this.phase2LowerBound(cornerPerm, edgePerm, slicePerm) > remaining) return false;

    const stride = PHASE2_MOVES.length;
    for (const move of PHASE2_MOVES) {
      if (lastMove >= 0) {
        if (faceOf(move) === faceOf(lastMove)) continue;
        if (sameAxis(move, lastMove) && faceOf(move) > faceOf(lastMove)) continue;
      }
      const slot = PHASE2_SLOT[move] as number;
      path.push(move);
      const solved = this.searchPhase2(
        this.tables.cornerPermMove[cornerPerm * stride + slot] as number,
        this.tables.udEdgePermMove[edgePerm * stride + slot] as number,
        this.tables.slicePermMove[slicePerm * stride + slot] as number,
        remaining - 1,
        move,
        path,
      );
      if (solved) return true;
      path.pop();
    }
    return false;
  }
}
