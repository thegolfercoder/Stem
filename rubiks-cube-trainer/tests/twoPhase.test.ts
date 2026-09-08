/**
 * The two-phase solver.
 *
 * One test matters more than all the others: take a scrambled cube, solve it,
 * apply the solution, and check the cube is solved. Everything else here is
 * about the quality of the answer rather than its correctness.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { Cube } from '../src/core/cube.js';
import { parseSequence, quarterTurnCount, sequenceToString } from '../src/core/moves.js';
import { prepareTables } from '../src/core/tables.js';
import { solveTwoPhase } from '../src/solvers/twoPhase.js';
import { randomScramble } from '../src/core/scramble.js';

beforeAll(async () => {
  await prepareTables();
}, 180_000);

/** Deterministic pseudo-random source, so a failure names a reproducible cube. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function scrambledCube(seed: number, length = 25): { cube: Cube; scramble: number[] } {
  const next = rng(seed + 1);
  const scramble = Array.from({ length }, () => Math.trunc(next() * 18) % 18);
  return { cube: Cube.solved().apply(scramble), scramble };
}

describe('solving', () => {
  it('returns nothing for a solved cube', () => {
    const result = solveTwoPhase(Cube.solved());
    expect(result.moves).toEqual([]);
  });

  it('solves a single move', () => {
    for (let move = 0; move < 18; move++) {
      const cube = Cube.solved().move(move);
      const result = solveTwoPhase(cube, { targetLength: 1, timeLimitMs: 2000 });
      expect(result.moves).toHaveLength(1);
      expect(cube.apply(result.moves).isSolved()).toBe(true);
    }
  });

  it('solves a hundred random cubes', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { cube, scramble } = scrambledCube(seed);
      const result = solveTwoPhase(cube, { targetLength: 22, timeLimitMs: 400 });
      expect(
        cube.apply(result.moves).isSolved(),
        `failed on scramble ${sequenceToString(scramble)}`,
      ).toBe(true);
    }
  });

  it('solves the superflip', () => {
    // Every edge flipped in place: 20 moves optimally, and one of the hardest
    // positions there is. Asking for 20 is asking for the optimum, which a
    // two-phase solver will not reach - so this also checks that an unreachable
    // target still returns the best solution found rather than an exception.
    const cube = Cube.solved().apply(
      parseSequence("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"),
    );
    const result = solveTwoPhase(cube, { targetLength: 20, timeLimitMs: 2000 });
    expect(cube.apply(result.moves).isSolved()).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.moves.length).toBeLessThanOrEqual(30);
  });

  it('returns a solution even when the target is impossible', () => {
    // The regression this exists for: an early version used targetLength as the
    // phase-2 budget, so asking for something unreachably short produced no
    // answer at all instead of the best available one.
    for (let seed = 0; seed < 5; seed++) {
      const { cube } = scrambledCube(seed + 77);
      const result = solveTwoPhase(cube, { targetLength: 1, timeLimitMs: 300 });
      expect(cube.apply(result.moves).isSolved()).toBe(true);
      expect(result.timedOut).toBe(true);
    }
  });

  it('never exceeds the length ceiling it is given', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { cube } = scrambledCube(seed + 4000);
      const result = solveTwoPhase(cube, { maxLength: 25, targetLength: 25, timeLimitMs: 500 });
      expect(cube.apply(result.moves).isSolved()).toBe(true);
      expect(result.moves.length).toBeLessThanOrEqual(25);
    }
  });

  it('solves cubes from the scramble generator', () => {
    for (let seed = 0; seed < 25; seed++) {
      const scramble = randomScramble(20, rng(seed + 900));
      const cube = Cube.solved().apply(scramble);
      const result = solveTwoPhase(cube, { targetLength: 22, timeLimitMs: 400 });
      expect(cube.apply(result.moves).isSolved()).toBe(true);
    }
  });

  it('refuses a state no sequence of turns could produce', () => {
    const cube = Cube.solved().clone();
    cube.co[0] = 1;
    expect(() => solveTwoPhase(cube)).toThrow(/twisted on its own/);
  });
});

describe('solution quality', () => {
  it('averages around twenty moves and never runs long', () => {
    const lengths: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      const { cube } = scrambledCube(seed + 300);
      const result = solveTwoPhase(cube, { targetLength: 21, timeLimitMs: 500 });
      expect(cube.apply(result.moves).isSolved()).toBe(true);
      lengths.push(result.moves.length);
    }
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;

    // God's number is 20: every cube can be solved in 20 moves or fewer. A
    // two-phase solver is not optimal and should land a little above that.
    expect(mean).toBeGreaterThan(15);
    expect(mean).toBeLessThan(26);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(30);
  });

  it('returns a solution with nothing left to cancel', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { cube } = scrambledCube(seed + 600);
      const { moves } = solveTwoPhase(cube, { timeLimitMs: 300 });
      for (let i = 1; i < moves.length; i++) {
        expect(Math.trunc((moves[i] as number) / 3)).not.toBe(
          Math.trunc((moves[i - 1] as number) / 3),
        );
      }
    }
  });

  it('reports how it split the work', () => {
    const { cube } = scrambledCube(42);
    const result = solveTwoPhase(cube, { timeLimitMs: 500 });
    expect(result.phase1Length + result.phase2Length).toBe(result.moves.length);
    expect(result.candidatesExplored).toBeGreaterThan(0);
    expect(result.milliseconds).toBeGreaterThanOrEqual(0);
  });

  it('finds something shorter when given longer', () => {
    // The point of the two-phase design: a longer phase 1 often leaves a much
    // easier phase 2, so more time buys fewer moves.
    let quick = 0;
    let patient = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { cube } = scrambledCube(seed + 1200);
      quick += solveTwoPhase(cube, { targetLength: 30, timeLimitMs: 1 }).moves.length;
      patient += solveTwoPhase(cube, { targetLength: 19, timeLimitMs: 600 }).moves.length;
    }
    expect(patient).toBeLessThanOrEqual(quick);
  });

  it('counts quarter turns sensibly', () => {
    const { cube } = scrambledCube(7);
    const { moves } = solveTwoPhase(cube, { timeLimitMs: 300 });
    expect(quarterTurnCount(moves)).toBeGreaterThanOrEqual(moves.length);
  });
});
