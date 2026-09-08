/**
 * Scramble generation.
 *
 * Random-move scrambles, with the two constraints a competition scramble has:
 * never two consecutive turns of the same face, and never three in a row on one
 * axis. Both would be redundant - `R L R` reaches a state `R2 L` also reaches -
 * and a scramble containing them is shorter than it looks.
 *
 * This is *not* a random-state scramble. The WCA generates scrambles by picking
 * a cube state uniformly at random and solving it, which guarantees every state
 * is equally likely and needs a solver in the loop. Twenty random moves gives a
 * distribution that is close but not uniform, and short scrambles are noticeably
 * biased towards states near solved. `randomStateScramble` does it properly, at
 * the cost of running the solver.
 */

import { Cube } from './cube.js';
import { MOVE_COUNT, faceOf, invertSequence, sameAxis, type Move } from './moves.js';

export const DEFAULT_SCRAMBLE_LENGTH = 20;

/** A random-move scramble of the given length. */
export function randomScramble(
  length: number = DEFAULT_SCRAMBLE_LENGTH,
  random: () => number = Math.random,
): Move[] {
  const moves: Move[] = [];
  while (moves.length < length) {
    const move = Math.trunc(random() * MOVE_COUNT) % MOVE_COUNT;
    const previous = moves.at(-1);
    const beforeThat = moves.at(-2);

    if (previous !== undefined && faceOf(move) === faceOf(previous)) continue;
    if (
      previous !== undefined &&
      beforeThat !== undefined &&
      sameAxis(move, previous) &&
      sameAxis(move, beforeThat)
    ) {
      continue;
    }
    moves.push(move);
  }
  return moves;
}

/**
 * A scramble drawn from a uniform random cube state.
 *
 * Picks a state uniformly at random - respecting the three laws, so the result
 * is always solvable - solves it, and returns the inverse of the solution.
 * Needs the solver, and therefore the tables.
 */
export function randomStateScramble(
  solve: (cube: Cube) => Move[],
  random: () => number = Math.random,
): Move[] {
  return invertSequence(solve(randomState(random)));
}

/** A uniformly random *solvable* cube state. */
export function randomState(random: () => number = Math.random): Cube {
  const shuffle = (values: number[]): number[] => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.trunc(random() * (i + 1));
      [values[i], values[j]] = [values[j] as number, values[i] as number];
    }
    return values;
  };

  const cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const ep = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  // The parities of the corner and edge permutations must agree; if they do
  // not, one swap in the edges fixes it and keeps the distribution uniform.
  if (parity(cp) !== parity(ep)) [ep[0], ep[1]] = [ep[1] as number, ep[0] as number];

  const co = new Uint8Array(8);
  let twist = 0;
  for (let i = 0; i < 7; i++) {
    co[i] = Math.trunc(random() * 3) % 3;
    twist += co[i] as number;
  }
  co[7] = (3 - (twist % 3)) % 3;

  const eo = new Uint8Array(12);
  let flip = 0;
  for (let i = 0; i < 11; i++) {
    eo[i] = Math.trunc(random() * 2) % 2;
    flip += eo[i] as number;
  }
  eo[11] = flip % 2;

  return new Cube(cp, co, ep, eo);
}

function parity(perm: readonly number[]): number {
  let swaps = 0;
  const work = [...perm];
  for (let i = 0; i < work.length; i++) {
    while (work[i] !== i) {
      const target = work[i] as number;
      [work[i], work[target]] = [work[target] as number, work[i] as number];
      swaps += 1;
    }
  }
  return swaps % 2;
}
