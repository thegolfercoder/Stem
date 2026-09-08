/**
 * The cube itself.
 *
 * Cubie level, in the representation Kociemba's solver uses, because every
 * coordinate the two-phase solver needs is a cheap function of it and a facelet
 * representation would have to be converted first on every node of the search.
 *
 *  - `cp[i]` is which corner cubie currently sits at position `i`
 *  - `co[i]` is that corner's twist: 0, 1 or 2 clockwise turns from oriented
 *  - `ep[i]` and `eo[i]` are the same for edges, with orientation 0 or 1
 *
 * Position names run URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB for corners and
 * UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR for edges. Those orderings are
 * not arbitrary - the coordinate functions in `coords.ts` depend on the E-slice
 * edges being the last four.
 */

import { ALL_MOVES, amountOf, faceOf, type Move } from './moves.js';

export const CORNER_COUNT = 8;
export const EDGE_COUNT = 12;

export enum Corner {
  URF = 0,
  UFL = 1,
  ULB = 2,
  UBR = 3,
  DFR = 4,
  DLF = 5,
  DBL = 6,
  DRB = 7,
}

export enum Edge {
  UR = 0,
  UF = 1,
  UL = 2,
  UB = 3,
  DR = 4,
  DF = 5,
  DL = 6,
  DB = 7,
  FR = 8,
  FL = 9,
  BL = 10,
  BR = 11,
}

export const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'] as const;
export const EDGE_NAMES = [
  'UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR',
] as const;

export class InvalidCubeError extends Error {}

/**
 * A cube state.
 *
 * Mutable, and every operation that changes it returns a new instance anyway -
 * the search paths in the solver are short enough that the allocation does not
 * matter, and shared mutable cube state is a source of bugs that only appear
 * under a search.
 */
export class Cube {
  readonly cp: Uint8Array;
  readonly co: Uint8Array;
  readonly ep: Uint8Array;
  readonly eo: Uint8Array;

  constructor(cp?: ArrayLike<number>, co?: ArrayLike<number>, ep?: ArrayLike<number>, eo?: ArrayLike<number>) {
    this.cp = Uint8Array.from(cp ?? [0, 1, 2, 3, 4, 5, 6, 7]);
    this.co = Uint8Array.from(co ?? [0, 0, 0, 0, 0, 0, 0, 0]);
    this.ep = Uint8Array.from(ep ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    this.eo = Uint8Array.from(eo ?? new Array<number>(EDGE_COUNT).fill(0));
  }

  static solved(): Cube {
    return new Cube();
  }

  clone(): Cube {
    return new Cube(this.cp, this.co, this.ep, this.eo);
  }

  isSolved(): boolean {
    for (let i = 0; i < CORNER_COUNT; i++) {
      if (this.cp[i] !== i || this.co[i] !== 0) return false;
    }
    for (let i = 0; i < EDGE_COUNT; i++) {
      if (this.ep[i] !== i || this.eo[i] !== 0) return false;
    }
    return true;
  }

  equals(other: Cube): boolean {
    for (let i = 0; i < CORNER_COUNT; i++) {
      if (this.cp[i] !== other.cp[i] || this.co[i] !== other.co[i]) return false;
    }
    for (let i = 0; i < EDGE_COUNT; i++) {
      if (this.ep[i] !== other.ep[i] || this.eo[i] !== other.eo[i]) return false;
    }
    return true;
  }

  /**
   * Compose with another cube state: `this` then `other`.
   *
   * Orientation adds modulo 3 for corners and modulo 2 for edges, which is what
   * makes a twist applied twice come back round rather than saturating.
   */
  multiply(other: Cube): Cube {
    const cp = new Uint8Array(CORNER_COUNT);
    const co = new Uint8Array(CORNER_COUNT);
    for (let i = 0; i < CORNER_COUNT; i++) {
      const from = other.cp[i] as number;
      cp[i] = this.cp[from] as number;
      co[i] = (((this.co[from] as number) + (other.co[i] as number)) % 3) as number;
    }

    const ep = new Uint8Array(EDGE_COUNT);
    const eo = new Uint8Array(EDGE_COUNT);
    for (let i = 0; i < EDGE_COUNT; i++) {
      const from = other.ep[i] as number;
      ep[i] = this.ep[from] as number;
      eo[i] = (((this.eo[from] as number) + (other.eo[i] as number)) % 2) as number;
    }

    return new Cube(cp, co, ep, eo);
  }

  /** Apply one move. */
  move(move: Move): Cube {
    const base = MOVE_CUBES[faceOf(move)];
    if (base === undefined) throw new Error(`move ${move} is out of range`);
    let result: Cube = this;
    for (let i = 0; i < amountOf(move); i++) result = result.multiply(base);
    return result;
  }

  /** Apply a sequence, left to right. */
  apply(moves: readonly Move[]): Cube {
    let result: Cube = this;
    for (const move of moves) result = result.move(move);
    return result;
  }

  /**
   * Why this state cannot be reached by turning a solved cube, or null.
   *
   * Three laws, and every one of them is a real thing people hit: a cube taken
   * apart and reassembled at random has a one in twelve chance of satisfying
   * all three, and a cube read from a photograph with one sticker misread will
   * fail at least one.
   */
  solvabilityProblem(): string | null {
    const seenCorners = new Set(this.cp);
    if (seenCorners.size !== CORNER_COUNT) return 'a corner cubie appears twice';
    const seenEdges = new Set(this.ep);
    if (seenEdges.size !== EDGE_COUNT) return 'an edge cubie appears twice';

    let twist = 0;
    for (let i = 0; i < CORNER_COUNT; i++) {
      const value = this.co[i] as number;
      if (value > 2) return 'a corner has an impossible twist value';
      twist += value;
    }
    if (twist % 3 !== 0) return 'one corner is twisted on its own, which no sequence of turns can do';

    let flip = 0;
    for (let i = 0; i < EDGE_COUNT; i++) {
      const value = this.eo[i] as number;
      if (value > 1) return 'an edge has an impossible flip value';
      flip += value;
    }
    if (flip % 2 !== 0) return 'one edge is flipped on its own, which no sequence of turns can do';

    if (permutationParity(this.cp) !== permutationParity(this.ep)) {
      return 'exactly two pieces are swapped, which no sequence of turns can do';
    }
    return null;
  }

  isSolvable(): boolean {
    return this.solvabilityProblem() === null;
  }

  assertSolvable(): void {
    const problem = this.solvabilityProblem();
    if (problem !== null) throw new InvalidCubeError(problem);
  }
}

/** Parity of a permutation: 0 for even, 1 for odd. */
export function permutationParity(perm: ArrayLike<number>): number {
  let swaps = 0;
  const work = Array.from(perm);
  for (let i = 0; i < work.length; i++) {
    while (work[i] !== i) {
      const target = work[i] as number;
      const temp = work[target] as number;
      work[target] = target;
      work[i] = temp;
      swaps += 1;
    }
  }
  return swaps % 2;
}

/**
 * The six face turns, as cube states.
 *
 * These twenty-four arrays are the only place the geometry of a cube is written
 * down, and a single wrong entry produces a cube that looks plausible and is
 * unsolvable. They are checked by the invariants in `tests/cube.test.ts` rather
 * than by inspection: every move must have order four, opposite faces must
 * commute, and a scramble followed by its inverse must return to solved.
 */
const U = new Cube(
  [Corner.UBR, Corner.URF, Corner.UFL, Corner.ULB, Corner.DFR, Corner.DLF, Corner.DBL, Corner.DRB],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [Edge.UB, Edge.UR, Edge.UF, Edge.UL, Edge.DR, Edge.DF, Edge.DL, Edge.DB, Edge.FR, Edge.FL, Edge.BL, Edge.BR],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
);

const R = new Cube(
  [Corner.DFR, Corner.UFL, Corner.ULB, Corner.URF, Corner.DRB, Corner.DLF, Corner.DBL, Corner.UBR],
  [2, 0, 0, 1, 1, 0, 0, 2],
  [Edge.FR, Edge.UF, Edge.UL, Edge.UB, Edge.BR, Edge.DF, Edge.DL, Edge.DB, Edge.DR, Edge.FL, Edge.BL, Edge.UR],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
);

const F = new Cube(
  [Corner.UFL, Corner.DLF, Corner.ULB, Corner.UBR, Corner.URF, Corner.DFR, Corner.DBL, Corner.DRB],
  [1, 2, 0, 0, 2, 1, 0, 0],
  [Edge.UR, Edge.FL, Edge.UL, Edge.UB, Edge.DR, Edge.FR, Edge.DL, Edge.DB, Edge.UF, Edge.DF, Edge.BL, Edge.BR],
  [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
);

const D = new Cube(
  [Corner.URF, Corner.UFL, Corner.ULB, Corner.UBR, Corner.DLF, Corner.DBL, Corner.DRB, Corner.DFR],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [Edge.UR, Edge.UF, Edge.UL, Edge.UB, Edge.DF, Edge.DL, Edge.DB, Edge.DR, Edge.FR, Edge.FL, Edge.BL, Edge.BR],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
);

const L = new Cube(
  [Corner.URF, Corner.ULB, Corner.DBL, Corner.UBR, Corner.DFR, Corner.UFL, Corner.DLF, Corner.DRB],
  [0, 1, 2, 0, 0, 2, 1, 0],
  [Edge.UR, Edge.UF, Edge.BL, Edge.UB, Edge.DR, Edge.DF, Edge.FL, Edge.DB, Edge.FR, Edge.UL, Edge.DL, Edge.BR],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
);

const B = new Cube(
  [Corner.URF, Corner.UFL, Corner.UBR, Corner.DRB, Corner.DFR, Corner.DLF, Corner.ULB, Corner.DBL],
  [0, 0, 1, 2, 0, 0, 2, 1],
  [Edge.UR, Edge.UF, Edge.UL, Edge.BR, Edge.DR, Edge.DF, Edge.DL, Edge.BL, Edge.FR, Edge.FL, Edge.UB, Edge.DB],
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
);

/** Indexed by face number: U, R, F, D, L, B. */
export const MOVE_CUBES: readonly Cube[] = [U, R, F, D, L, B];

/** Every move as a cube state, indexed by move number - handy in tables. */
export const MOVE_STATES: readonly Cube[] = ALL_MOVES.map((move) => Cube.solved().move(move));
