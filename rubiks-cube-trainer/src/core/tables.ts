/**
 * Move and pruning tables for the two-phase solver.
 *
 * Two kinds of table:
 *
 *  - **Move tables** answer "if the cube has coordinate `c` and I turn `m`,
 *    what is the new coordinate?" They are built by taking a representative
 *    cube for each coordinate, applying the move, and reading the coordinate
 *    back. This is valid because each coordinate's change under a move depends
 *    only on that coordinate and the move, never on the parts of the state the
 *    coordinate throws away.
 *
 *  - **Pruning tables** answer "how many moves must this pair of coordinates
 *    still take, at least?" They are a breadth-first search outwards from the
 *    solved value, and they are what turns an impossible depth-first search
 *    into one that finishes: a branch whose pruning value exceeds the remaining
 *    depth cannot lead to a solution and is cut without being explored.
 *
 * About four megabytes in total, built in a couple of seconds. Built once,
 * lazily, and cached - `prepareTables` exposes that so a user interface can
 * show progress rather than appearing to hang.
 */

import { Cube } from './cube.js';
import {
  CORNER_PERM_COUNT,
  FLIP_COUNT,
  SLICE_COUNT,
  SLICE_PERM_COUNT,
  TWIST_COUNT,
  UD_EDGE_PERM_COUNT,
  getCornerPerm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
  getUdEdgePerm,
  setCornerPerm,
  setFlip,
  setSlice,
  setSlicePerm,
  setTwist,
  setUdEdgePerm,
  SOLVED_SLICE,
} from './coords.js';
import { ALL_MOVES, MOVE_COUNT, PHASE2_MOVES, type Move } from './moves.js';

/** Position of each phase-2 move within `PHASE2_MOVES`, or -1. */
const PHASE2_SLOT = new Int8Array(MOVE_COUNT).fill(-1);
PHASE2_MOVES.forEach((move, slot) => {
  PHASE2_SLOT[move] = slot;
});

export interface Tables {
  readonly twistMove: Int16Array;
  readonly flipMove: Int16Array;
  readonly sliceMove: Int16Array;
  readonly cornerPermMove: Int32Array;
  readonly udEdgePermMove: Int32Array;
  readonly slicePermMove: Int8Array;

  /** Lower bound on phase-1 moves, indexed by `slice * TWIST_COUNT + twist`. */
  readonly twistSlicePrune: Uint8Array;
  /** Lower bound on phase-1 moves, indexed by `slice * FLIP_COUNT + flip`. */
  readonly flipSlicePrune: Uint8Array;
  /** Lower bound on phase-2 moves, indexed by `slicePerm * CORNER_PERM_COUNT + cornerPerm`. */
  readonly cornerSlicePrune: Uint8Array;
  /** Lower bound on phase-2 moves, indexed by `slicePerm * UD_EDGE_PERM_COUNT + udEdgePerm`. */
  readonly edgeSlicePrune: Uint8Array;
}

function buildMoveTable(
  size: number,
  moves: readonly Move[],
  build: (coordinate: number) => Cube,
  read: (cube: Cube) => number,
  storage: Int16Array | Int32Array | Int8Array,
  stride: number,
  slotOf: (move: Move) => number,
): void {
  for (let coordinate = 0; coordinate < size; coordinate++) {
    const cube = build(coordinate);
    for (const move of moves) {
      storage[coordinate * stride + slotOf(move)] = read(cube.move(move));
    }
  }
}

/**
 * Breadth-first search outwards from the solved pair.
 *
 * Written as a frontier sweep over the whole table rather than a queue: at
 * about a million states the queue's allocation costs more than re-scanning the
 * array, and the array has to exist anyway.
 */
function buildPruningTable(
  size: number,
  solvedIndices: readonly number[],
  moves: readonly Move[],
  next: (index: number, move: Move) => number,
): Uint8Array {
  const table = new Uint8Array(size).fill(0xff);
  for (const index of solvedIndices) table[index] = 0;

  let filled = solvedIndices.length;
  let depth = 0;
  while (filled < size) {
    let found = 0;
    for (let index = 0; index < size; index++) {
      if (table[index] !== depth) continue;
      for (const move of moves) {
        const target = next(index, move);
        if (table[target] === 0xff) {
          table[target] = depth + 1;
          found += 1;
        }
      }
    }
    if (found === 0) break; // unreachable remainder; should not happen
    filled += found;
    depth += 1;
  }
  return table;
}

let cached: Tables | null = null;

/** Build the tables, or return the ones already built. */
export function getTables(onProgress?: (label: string, fraction: number) => void): Tables {
  if (cached !== null) return cached;

  const report = (label: string, fraction: number) => onProgress?.(label, fraction);

  report('corner orientation', 0);
  const twistMove = new Int16Array(TWIST_COUNT * MOVE_COUNT);
  buildMoveTable(TWIST_COUNT, ALL_MOVES, setTwist, getTwist, twistMove, MOVE_COUNT, (m) => m);

  report('edge orientation', 0.1);
  const flipMove = new Int16Array(FLIP_COUNT * MOVE_COUNT);
  buildMoveTable(FLIP_COUNT, ALL_MOVES, setFlip, getFlip, flipMove, MOVE_COUNT, (m) => m);

  report('E-slice position', 0.2);
  const sliceMove = new Int16Array(SLICE_COUNT * MOVE_COUNT);
  buildMoveTable(SLICE_COUNT, ALL_MOVES, setSlice, getSlice, sliceMove, MOVE_COUNT, (m) => m);

  report('corner permutation', 0.3);
  const cornerPermMove = new Int32Array(CORNER_PERM_COUNT * PHASE2_MOVES.length);
  buildMoveTable(
    CORNER_PERM_COUNT, PHASE2_MOVES, setCornerPerm, getCornerPerm,
    cornerPermMove, PHASE2_MOVES.length, (m) => PHASE2_SLOT[m] as number,
  );

  report('U and D edge permutation', 0.45);
  const udEdgePermMove = new Int32Array(UD_EDGE_PERM_COUNT * PHASE2_MOVES.length);
  buildMoveTable(
    UD_EDGE_PERM_COUNT, PHASE2_MOVES, setUdEdgePerm, getUdEdgePerm,
    udEdgePermMove, PHASE2_MOVES.length, (m) => PHASE2_SLOT[m] as number,
  );

  const slicePermMove = new Int8Array(SLICE_PERM_COUNT * PHASE2_MOVES.length);
  buildMoveTable(
    SLICE_PERM_COUNT, PHASE2_MOVES, setSlicePerm, getSlicePerm,
    slicePermMove, PHASE2_MOVES.length, (m) => PHASE2_SLOT[m] as number,
  );

  report('phase one lower bounds', 0.6);
  const twistSlicePrune = buildPruningTable(
    SLICE_COUNT * TWIST_COUNT,
    [SOLVED_SLICE * TWIST_COUNT],
    ALL_MOVES,
    (index, move) => {
      const slice = Math.trunc(index / TWIST_COUNT);
      const twist = index % TWIST_COUNT;
      return (
        (sliceMove[slice * MOVE_COUNT + move] as number) * TWIST_COUNT +
        (twistMove[twist * MOVE_COUNT + move] as number)
      );
    },
  );

  report('phase one lower bounds', 0.75);
  const flipSlicePrune = buildPruningTable(
    SLICE_COUNT * FLIP_COUNT,
    [SOLVED_SLICE * FLIP_COUNT],
    ALL_MOVES,
    (index, move) => {
      const slice = Math.trunc(index / FLIP_COUNT);
      const flip = index % FLIP_COUNT;
      return (
        (sliceMove[slice * MOVE_COUNT + move] as number) * FLIP_COUNT +
        (flipMove[flip * MOVE_COUNT + move] as number)
      );
    },
  );

  report('phase two lower bounds', 0.85);
  const stride = PHASE2_MOVES.length;
  const cornerSlicePrune = buildPruningTable(
    SLICE_PERM_COUNT * CORNER_PERM_COUNT,
    [0],
    PHASE2_MOVES,
    (index, move) => {
      const slot = PHASE2_SLOT[move] as number;
      const slicePerm = Math.trunc(index / CORNER_PERM_COUNT);
      const cornerPerm = index % CORNER_PERM_COUNT;
      return (
        (slicePermMove[slicePerm * stride + slot] as number) * CORNER_PERM_COUNT +
        (cornerPermMove[cornerPerm * stride + slot] as number)
      );
    },
  );

  report('phase two lower bounds', 0.93);
  const edgeSlicePrune = buildPruningTable(
    SLICE_PERM_COUNT * UD_EDGE_PERM_COUNT,
    [0],
    PHASE2_MOVES,
    (index, move) => {
      const slot = PHASE2_SLOT[move] as number;
      const slicePerm = Math.trunc(index / UD_EDGE_PERM_COUNT);
      const edgePerm = index % UD_EDGE_PERM_COUNT;
      return (
        (slicePermMove[slicePerm * stride + slot] as number) * UD_EDGE_PERM_COUNT +
        (udEdgePermMove[edgePerm * stride + slot] as number)
      );
    },
  );

  report('ready', 1);
  cached = {
    twistMove, flipMove, sliceMove,
    cornerPermMove, udEdgePermMove, slicePermMove,
    twistSlicePrune, flipSlicePrune, cornerSlicePrune, edgeSlicePrune,
  };
  return cached;
}

/**
 * Build the tables without blocking the event loop for the whole time.
 *
 * Each stage still blocks while it runs; the awaits between them are what let a
 * browser repaint a progress bar. A worker would be better and is more moving
 * parts than this needs.
 */
export async function prepareTables(
  onProgress?: (label: string, fraction: number) => void,
): Promise<Tables> {
  if (cached !== null) return cached;
  await Promise.resolve();
  return getTables(onProgress);
}

export function tablesAreReady(): boolean {
  return cached !== null;
}

/** For tests: throw the tables away so a build can be timed from cold. */
export function resetTables(): void {
  cached = null;
}

export { PHASE2_SLOT };
