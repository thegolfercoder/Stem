/**
 * Coordinates: cube states as small integers.
 *
 * A search cannot work on a `Cube` - comparing and hashing forty numbers per
 * node is far too slow. Instead each phase of the solver works on two or three
 * integers that capture exactly the part of the state that phase cares about,
 * and every one of those integers indexes a precomputed move table.
 *
 * The coordinates are the ones Kociemba's two-phase algorithm uses:
 *
 *  | coordinate     | range   | what it captures                                |
 *  |----------------|---------|-------------------------------------------------|
 *  | `twist`        | 0..2186 | corner orientation, 3^7 (the eighth is implied) |
 *  | `flip`         | 0..2047 | edge orientation, 2^11 (the twelfth is implied) |
 *  | `slice`        | 0..494  | which four positions hold the E-slice edges     |
 *  | `cornerPerm`   | 0..40319| corner permutation, 8!                           |
 *  | `udEdgePerm`   | 0..40319| permutation of the eight U/D edges, 8!          |
 *  | `slicePerm`    | 0..23   | permutation of the four E-slice edges, 4!        |
 *
 * The eighth corner twist and twelfth edge flip are implied because their sums
 * are fixed: total twist is a multiple of three and total flip is even. That is
 * the same law the solvability check enforces, used here to save a factor of
 * three and a factor of two.
 */

import { Cube, Edge } from './cube.js';

export const TWIST_COUNT = 2187;
export const FLIP_COUNT = 2048;
export const SLICE_COUNT = 495;
export const CORNER_PERM_COUNT = 40320;
export const UD_EDGE_PERM_COUNT = 40320;
export const SLICE_PERM_COUNT = 24;

/* ------------------------------------------------------------------ twist */

export function getTwist(cube: Cube): number {
  let value = 0;
  for (let i = 0; i < 7; i++) value = value * 3 + (cube.co[i] as number);
  return value;
}

export function setTwist(twist: number): Cube {
  const co = new Uint8Array(8);
  let remaining = twist;
  let total = 0;
  for (let i = 6; i >= 0; i--) {
    const digit = remaining % 3;
    co[i] = digit;
    total += digit;
    remaining = Math.trunc(remaining / 3);
  }
  co[7] = (3 - (total % 3)) % 3;
  return new Cube(undefined, co, undefined, undefined);
}

/* ------------------------------------------------------------------- flip */

export function getFlip(cube: Cube): number {
  let value = 0;
  for (let i = 0; i < 11; i++) value = value * 2 + (cube.eo[i] as number);
  return value;
}

export function setFlip(flip: number): Cube {
  const eo = new Uint8Array(12);
  let remaining = flip;
  let total = 0;
  for (let i = 10; i >= 0; i--) {
    const bit = remaining % 2;
    eo[i] = bit;
    total += bit;
    remaining = Math.trunc(remaining / 2);
  }
  eo[11] = total % 2;
  return new Cube(undefined, undefined, undefined, eo);
}

/* ------------------------------------------------------------------ slice */

/**
 * Which four of the twelve edge positions hold E-slice edges.
 *
 * Ranked by enumeration rather than by a binomial formula. The combinatorial
 * ranking is three lines shorter and it is also where this kind of code
 * traditionally goes wrong; five hundred entries in a lookup table cost
 * nothing and cannot be subtly off by one.
 */
const SLICE_MASKS: number[] = [];
const SLICE_INDEX = new Int16Array(1 << 12).fill(-1);

for (let mask = 0; mask < 1 << 12; mask++) {
  let bits = 0;
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) bits += 1;
  if (bits === 4) {
    SLICE_INDEX[mask] = SLICE_MASKS.length;
    SLICE_MASKS.push(mask);
  }
}

function sliceMask(cube: Cube): number {
  let mask = 0;
  for (let position = 0; position < 12; position++) {
    if ((cube.ep[position] as number) >= Edge.FR) mask |= 1 << position;
  }
  return mask;
}

export function getSlice(cube: Cube): number {
  return SLICE_INDEX[sliceMask(cube)] as number;
}

export function setSlice(slice: number): Cube {
  const mask = SLICE_MASKS[slice];
  if (mask === undefined) throw new Error(`slice coordinate ${slice} is out of range`);

  const ep = new Uint8Array(12);
  const sliceEdges = [Edge.FR, Edge.FL, Edge.BL, Edge.BR];
  const otherEdges = [Edge.UR, Edge.UF, Edge.UL, Edge.UB, Edge.DR, Edge.DF, Edge.DL, Edge.DB];
  let sliceNext = 0;
  let otherNext = 0;
  for (let position = 0; position < 12; position++) {
    ep[position] = (
      mask & (1 << position) ? sliceEdges[sliceNext++] : otherEdges[otherNext++]
    ) as number;
  }
  return new Cube(undefined, undefined, ep, undefined);
}

/** The slice coordinate of a solved cube: the E-slice edges in the E-slice. */
export const SOLVED_SLICE = SLICE_INDEX[0b1111_0000_0000] as number;

/* ------------------------------------------------------- permutation index */

/**
 * Lehmer code: a permutation of n elements as an integer in 0..n!-1.
 *
 * `permutationToIndex` and `indexToPermutation` are inverses, which the tests
 * check exhaustively for n = 4 and over a large sample for n = 8. They only
 * have to agree with each other - any bijection works, provided the move tables
 * are built with the same one.
 */
export function permutationToIndex(perm: ArrayLike<number>): number {
  const n = perm.length;
  let index = 0;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    for (let j = i + 1; j < n; j++) {
      if ((perm[j] as number) < (perm[i] as number)) smaller += 1;
    }
    index = index * (n - i) + smaller;
  }
  return index;
}

export function indexToPermutation(index: number, n: number): number[] {
  const lehmer = new Array<number>(n);
  let remaining = index;
  for (let i = n - 1; i >= 0; i--) {
    lehmer[i] = remaining % (n - i);
    remaining = Math.trunc(remaining / (n - i));
  }

  const available = Array.from({ length: n }, (_, i) => i);
  const perm = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const take = lehmer[i] as number;
    perm[i] = available.splice(take, 1)[0] as number;
  }
  return perm;
}

/* ------------------------------------------------------------ corner perm */

export function getCornerPerm(cube: Cube): number {
  return permutationToIndex(cube.cp);
}

export function setCornerPerm(index: number): Cube {
  return new Cube(indexToPermutation(index, 8), undefined, undefined, undefined);
}

/* ----------------------------------------------------------- U/D edge perm */

/**
 * The permutation of the eight U and D layer edges.
 *
 * Only meaningful once the cube is in the phase-2 group, where those eight
 * edges are guaranteed to be in U and D positions. Reading it before then
 * returns a number, and the number means nothing.
 */
export function getUdEdgePerm(cube: Cube): number {
  return permutationToIndex(Array.from(cube.ep.slice(0, 8)));
}

export function setUdEdgePerm(index: number): Cube {
  const ep = new Uint8Array(12);
  const perm = indexToPermutation(index, 8);
  for (let i = 0; i < 8; i++) ep[i] = perm[i] as number;
  for (let i = 8; i < 12; i++) ep[i] = i;
  return new Cube(undefined, undefined, ep, undefined);
}

/* ------------------------------------------------------------- slice perm */

export function getSlicePerm(cube: Cube): number {
  const slice = [0, 1, 2, 3].map((i) => (cube.ep[8 + i] as number) - 8);
  return permutationToIndex(slice);
}

export function setSlicePerm(index: number): Cube {
  const ep = new Uint8Array(12);
  for (let i = 0; i < 8; i++) ep[i] = i;
  const perm = indexToPermutation(index, 4);
  for (let i = 0; i < 4; i++) ep[8 + i] = (perm[i] as number) + 8;
  return new Cube(undefined, undefined, ep, undefined);
}

/** True when the cube is in the phase-2 group <U, D, R2, L2, F2, B2>. */
export function isInPhase2Group(cube: Cube): boolean {
  return getTwist(cube) === 0 && getFlip(cube) === 0 && getSlice(cube) === SOLVED_SLICE;
}
