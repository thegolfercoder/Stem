/**
 * Coordinates and their inverses.
 *
 * Every coordinate has a `get` and a `set`, and the solver is correct only if
 * they agree. These tests are exhaustive where the space is small enough to be,
 * because an off-by-one in a coordinate produces a solver that returns a
 * confident wrong answer rather than an error.
 */

import { describe, expect, it } from 'vitest';

import { Cube } from '../src/core/cube.js';
import * as coords from '../src/core/coords.js';
import { parseSequence } from '../src/core/moves.js';

describe('twist', () => {
  it('is zero for a solved cube', () => {
    expect(coords.getTwist(Cube.solved())).toBe(0);
  });

  it('round-trips exhaustively', () => {
    for (let twist = 0; twist < coords.TWIST_COUNT; twist++) {
      expect(coords.getTwist(coords.setTwist(twist))).toBe(twist);
    }
  });

  it('always produces a legal total twist', () => {
    for (let twist = 0; twist < coords.TWIST_COUNT; twist += 7) {
      const cube = coords.setTwist(twist);
      const total = Array.from(cube.co).reduce((sum, value) => sum + value, 0);
      expect(total % 3).toBe(0);
    }
  });
});

describe('flip', () => {
  it('round-trips exhaustively', () => {
    for (let flip = 0; flip < coords.FLIP_COUNT; flip++) {
      expect(coords.getFlip(coords.setFlip(flip))).toBe(flip);
    }
  });

  it('always produces an even total flip', () => {
    for (let flip = 0; flip < coords.FLIP_COUNT; flip += 3) {
      const cube = coords.setFlip(flip);
      const total = Array.from(cube.eo).reduce((sum, value) => sum + value, 0);
      expect(total % 2).toBe(0);
    }
  });
});

describe('slice', () => {
  it('round-trips exhaustively', () => {
    for (let slice = 0; slice < coords.SLICE_COUNT; slice++) {
      expect(coords.getSlice(coords.setSlice(slice))).toBe(slice);
    }
  });

  it('recognises a solved cube', () => {
    expect(coords.getSlice(Cube.solved())).toBe(coords.SOLVED_SLICE);
  });

  it('is unchanged by moves that keep the E-slice in place', () => {
    // U, D and the double turns of R, L, F, B are exactly the phase-2 moves,
    // and none of them takes an E-slice edge out of the E-slice.
    for (const text of ['U', "U'", 'U2', 'D', 'D2', 'R2', 'L2', 'F2', 'B2']) {
      const cube = Cube.solved().apply(parseSequence(text));
      expect(coords.getSlice(cube)).toBe(coords.SOLVED_SLICE);
    }
    expect(coords.getSlice(Cube.solved().apply(parseSequence('R')))).not.toBe(coords.SOLVED_SLICE);
  });
});

describe('permutation indices', () => {
  it('round-trip exhaustively for four elements', () => {
    for (let index = 0; index < 24; index++) {
      expect(coords.permutationToIndex(coords.indexToPermutation(index, 4))).toBe(index);
    }
  });

  it('are a bijection for four elements', () => {
    const seen = new Set(
      Array.from({ length: 24 }, (_, i) => coords.indexToPermutation(i, 4).join('')),
    );
    expect(seen.size).toBe(24);
  });

  it('round-trip across the whole eight-element range', () => {
    for (let index = 0; index < 40320; index += 7) {
      expect(coords.permutationToIndex(coords.indexToPermutation(index, 8))).toBe(index);
    }
  });

  it('put the identity at zero', () => {
    expect(coords.permutationToIndex([0, 1, 2, 3])).toBe(0);
    expect(coords.indexToPermutation(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('phase-2 coordinates', () => {
  it('round-trip', () => {
    for (let index = 0; index < 40320; index += 11) {
      expect(coords.getCornerPerm(coords.setCornerPerm(index))).toBe(index);
      expect(coords.getUdEdgePerm(coords.setUdEdgePerm(index))).toBe(index);
    }
    for (let index = 0; index < 24; index++) {
      expect(coords.getSlicePerm(coords.setSlicePerm(index))).toBe(index);
    }
  });

  it('are all zero exactly when the cube is solved', () => {
    const solved = Cube.solved();
    expect(coords.getCornerPerm(solved)).toBe(0);
    expect(coords.getUdEdgePerm(solved)).toBe(0);
    expect(coords.getSlicePerm(solved)).toBe(0);
  });
});

describe('the phase-2 group', () => {
  it('contains a solved cube and everything reachable by its own moves', () => {
    expect(coords.isInPhase2Group(Cube.solved())).toBe(true);
    const inside = Cube.solved().apply(parseSequence("U D' R2 F2 L2 B2 U2 D"));
    expect(coords.isInPhase2Group(inside)).toBe(true);
  });

  it('does not contain a cube after a quarter turn of R', () => {
    expect(coords.isInPhase2Group(Cube.solved().apply(parseSequence('R')))).toBe(false);
  });
});
