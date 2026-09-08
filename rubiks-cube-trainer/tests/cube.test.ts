/**
 * The move tables.
 *
 * Twenty-four arrays describe the geometry of a cube, and one wrong entry gives
 * a cube that looks plausible in a renderer and is quietly unsolvable. Nothing
 * downstream is worth testing until these are right, so these tests check the
 * group structure rather than the arrays: every claim below is true of a real
 * cube for reasons that have nothing to do with how it was written down.
 */

import { describe, expect, it } from 'vitest';

import { Cube, MOVE_CUBES, permutationParity } from '../src/core/cube.js';
import { toFacelets, fromFacelets } from '../src/core/facelets.js';
import {
  ALL_MOVES,
  cancelMoves,
  invertSequence,
  moveToString,
  parseSequence,
  quarterTurnCount,
  sequenceToString,
} from '../src/core/moves.js';

const solved = Cube.solved();

describe('the move tables describe a real cube', () => {
  it('every quarter turn has order four', () => {
    for (let face = 0; face < 6; face++) {
      let cube = solved;
      for (let turn = 0; turn < 4; turn++) {
        cube = cube.multiply(MOVE_CUBES[face]!);
        expect(cube.isSolved()).toBe(turn === 3);
      }
    }
  });

  it('opposite faces commute and adjacent ones do not', () => {
    // U and D, R and L, F and B share an axis, so their turns commute.
    const opposite: [number, number][] = [
      [0, 3],
      [1, 4],
      [2, 5],
    ];
    for (const [a, b] of opposite) {
      const one = solved.multiply(MOVE_CUBES[a]!).multiply(MOVE_CUBES[b]!);
      const other = solved.multiply(MOVE_CUBES[b]!).multiply(MOVE_CUBES[a]!);
      expect(one.equals(other)).toBe(true);
    }

    const adjacent = solved.multiply(MOVE_CUBES[0]!).multiply(MOVE_CUBES[1]!);
    const reversed = solved.multiply(MOVE_CUBES[1]!).multiply(MOVE_CUBES[0]!);
    expect(adjacent.equals(reversed)).toBe(false);
  });

  it('the sexy move has order six', () => {
    // (R U R' U') is the first algorithm anybody learns, and repeating it six
    // times returns to solved. That is a strong constraint on the R and U
    // tables together, including their orientation columns.
    const sexy = parseSequence("R U R' U'");
    let cube = solved;
    for (let repeat = 0; repeat < 6; repeat++) {
      cube = cube.apply(sexy);
      expect(cube.isSolved()).toBe(repeat === 5);
    }
  });

  it('the sune has order six', () => {
    const sune = parseSequence("R U R' U R U2 R'");
    let cube = solved;
    for (let repeat = 0; repeat < 6; repeat++) cube = cube.apply(sune);
    expect(cube.isSolved()).toBe(true);
  });

  it('a T-perm is its own inverse', () => {
    const tPerm = parseSequence("R U R' U' R' F R2 U' R' U' R U R' F'");
    expect(solved.apply(tPerm).apply(tPerm).isSolved()).toBe(true);
  });

  it('the superflip is not solved but flips every edge in place', () => {
    const superflip = parseSequence("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
    const cube = solved.apply(superflip);
    expect(cube.isSolved()).toBe(false);
    for (let i = 0; i < 12; i++) {
      expect(cube.ep[i]).toBe(i);
      expect(cube.eo[i]).toBe(1);
    }
    for (let i = 0; i < 8; i++) {
      expect(cube.cp[i]).toBe(i);
      expect(cube.co[i]).toBe(0);
    }
  });

  it('a sequence followed by its inverse returns to solved', () => {
    for (let trial = 0; trial < 200; trial++) {
      const moves = randomMoves(trial, 25);
      const cube = solved.apply(moves).apply(invertSequence(moves));
      expect(cube.isSolved()).toBe(true);
    }
  });

  it('every reachable state satisfies the three laws', () => {
    for (let trial = 0; trial < 300; trial++) {
      const cube = solved.apply(randomMoves(trial + 1000, 30));
      expect(cube.solvabilityProblem()).toBeNull();
    }
  });

  it('composition is associative', () => {
    const a = solved.apply(parseSequence('R U F'));
    const b = solved.apply(parseSequence('L D B'));
    const c = solved.apply(parseSequence("R2 U' F2"));
    expect(
      a
        .multiply(b)
        .multiply(c)
        .equals(a.multiply(b.multiply(c))),
    ).toBe(true);
  });
});

describe('the three laws reject impossible cubes', () => {
  it('rejects a single twisted corner', () => {
    const cube = solved.clone();
    cube.co[0] = 1;
    expect(cube.solvabilityProblem()).toMatch(/twisted on its own/);
  });

  it('rejects a single flipped edge', () => {
    const cube = solved.clone();
    cube.eo[0] = 1;
    expect(cube.solvabilityProblem()).toMatch(/flipped on its own/);
  });

  it('rejects two swapped pieces', () => {
    const cube = solved.clone();
    [cube.ep[0], cube.ep[1]] = [cube.ep[1]!, cube.ep[0]!];
    expect(cube.solvabilityProblem()).toMatch(/two pieces are swapped/);
  });

  it('rejects a duplicated cubie', () => {
    const cube = solved.clone();
    cube.cp[1] = cube.cp[0]!;
    expect(cube.solvabilityProblem()).toMatch(/appears twice/);
  });

  it('accepts a twist and a counter-twist', () => {
    const cube = solved.clone();
    cube.co[0] = 1;
    cube.co[1] = 2;
    expect(cube.solvabilityProblem()).toBeNull();
  });
});

describe('permutation parity', () => {
  it('is zero for the identity and one after a single swap', () => {
    expect(permutationParity([0, 1, 2, 3])).toBe(0);
    expect(permutationParity([1, 0, 2, 3])).toBe(1);
    expect(permutationParity([1, 2, 0, 3])).toBe(0);
  });

  it('flips with every quarter turn', () => {
    // A quarter turn is two four-cycles, each odd, so corners and edges both
    // flip parity together - which is exactly why they must always agree.
    for (const face of [0, 1, 2, 3, 4, 5]) {
      const cube = solved.multiply(MOVE_CUBES[face]!);
      expect(permutationParity(cube.cp)).toBe(1);
      expect(permutationParity(cube.ep)).toBe(1);
    }
  });
});

describe('facelets', () => {
  it('a solved cube is nine of each colour in order', () => {
    expect(toFacelets(solved)).toBe(
      'UUUUUUUUU' + 'RRRRRRRRR' + 'FFFFFFFFF' + 'DDDDDDDDD' + 'LLLLLLLLL' + 'BBBBBBBBB',
    );
  });

  it('round-trips any reachable state', () => {
    for (let trial = 0; trial < 200; trial++) {
      const cube = solved.apply(randomMoves(trial + 5000, 20));
      expect(fromFacelets(toFacelets(cube)).equals(cube)).toBe(true);
    }
  });

  it('centres never move', () => {
    const facelets = toFacelets(solved.apply(parseSequence("R U F' L2 D B")));
    for (let face = 0; face < 6; face++) {
      expect(facelets[face * 9 + 4]).toBe('URFDLB'[face]);
    }
  });

  it('explains what is wrong rather than saying invalid', () => {
    expect(() => fromFacelets('UUU')).toThrow(/expected 54 facelets/);
    expect(() => fromFacelets('X'.repeat(54))).toThrow(/is not one of/);
    expect(() => fromFacelets('U'.repeat(54))).toThrow(/appears 54 times/);
  });

  it('rejects a cube held in the wrong orientation', () => {
    const scrambled = toFacelets(solved);
    const rotated = scrambled.slice(9) + scrambled.slice(0, 9);
    expect(() => fromFacelets(rotated)).toThrow(/must be held with U up/);
  });
});

describe('notation', () => {
  it('round-trips every move', () => {
    for (const move of ALL_MOVES) {
      expect(parseSequence(moveToString(move))).toEqual([move]);
    }
  });

  it('accepts the spellings people actually type', () => {
    const expected = parseSequence("R U' F2");
    expect(parseSequence("r u' f2")).toEqual(expected);
    expect(parseSequence('R  U’  F2')).toEqual(expected);
    expect(parseSequence("R,U',F2")).toEqual(expected);
    expect(parseSequence("R U'2 F2")).toEqual(parseSequence('R U2 F2'));
  });

  it('refuses a token it does not understand rather than skipping it', () => {
    // A silently dropped token means the cube on screen is not the cube the
    // user typed, and they find out when the solution does not work.
    expect(() => parseSequence('R U X')).toThrow(/X is not a move/);
    expect(() => parseSequence('R U3')).toThrow();
    expect(() => parseSequence('M2')).toThrow();
  });

  it('prints a sequence back the way it came in', () => {
    const text = "R U2 F' L D2 B'";
    expect(sequenceToString(parseSequence(text))).toBe(text);
  });

  it('counts quarter turns', () => {
    expect(quarterTurnCount(parseSequence("R U2 F'"))).toBe(4);
  });
});

describe('move cancellation', () => {
  const unchanged = (text: string) => {
    const moves = parseSequence(text);
    expect(solved.apply(cancelMoves(moves)).equals(solved.apply(moves))).toBe(true);
  };

  it('collapses a move and its inverse', () => {
    expect(sequenceToString(cancelMoves(parseSequence("R R'")))).toBe('');
    expect(sequenceToString(cancelMoves(parseSequence('R R')))).toBe('R2');
    expect(sequenceToString(cancelMoves(parseSequence('R R R')))).toBe("R'");
    expect(sequenceToString(cancelMoves(parseSequence('R R R R')))).toBe('');
    expect(sequenceToString(cancelMoves(parseSequence('U2 U2')))).toBe('');
  });

  it('sees through a move on the opposite face', () => {
    // R and L commute, so the two R turns meet even with an L between them.
    expect(sequenceToString(cancelMoves(parseSequence("R L R'")))).toBe('L');
    expect(sequenceToString(cancelMoves(parseSequence("U D2 U'")))).toBe('D2');
  });

  it('does not see through a move on a different axis', () => {
    expect(sequenceToString(cancelMoves(parseSequence("R U R'")))).toBe("R U R'");
  });

  it('never changes what a sequence does', () => {
    unchanged("R U R' U'");
    unchanged("R L R' L' U D U' D'");
    unchanged('F F F F B B');
    for (let trial = 0; trial < 300; trial++) {
      const moves = randomMoves(trial + 9000, 30);
      expect(solved.apply(cancelMoves(moves)).equals(solved.apply(moves))).toBe(true);
    }
  });

  it('never makes a sequence longer', () => {
    for (let trial = 0; trial < 200; trial++) {
      const moves = randomMoves(trial + 12000, 40);
      expect(cancelMoves(moves).length).toBeLessThanOrEqual(moves.length);
    }
  });

  it('leaves nothing further to cancel', () => {
    for (let trial = 0; trial < 200; trial++) {
      const once = cancelMoves(randomMoves(trial + 15000, 40));
      expect(cancelMoves(once)).toEqual(once);
    }
  });
});

/** A deterministic pseudo-random move sequence, so a failure can be reproduced. */
function randomMoves(seed: number, length: number): number[] {
  let state = seed * 2654435761 + 1;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length }, () => Math.trunc(next() * 18) % 18);
}
