/**
 * The layer-by-layer solver, which is the teaching engine.
 *
 * Correctness first - it has to solve every cube - and then the properties
 * that make it usable as a lesson: the steps have to be in the taught order,
 * each stage must leave the previous ones alone, and every step has to carry
 * an explanation, because a step with no explanation is a step nobody learns
 * anything from.
 */

import { describe, expect, it } from 'vitest';

import { Cube, Corner, Edge } from '../src/core/cube.js';
import { parseSequence } from '../src/core/moves.js';
import { randomScramble } from '../src/core/scramble.js';
import { STAGE_ORDER, solveBeginner } from '../src/solvers/beginner.js';

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function scrambled(seed: number, length = 25): Cube {
  const next = rng(seed + 1);
  return Cube.solved().apply(Array.from({ length }, () => Math.trunc(next() * 18) % 18));
}

describe('solving', () => {
  it('does nothing to a solved cube', () => {
    const solution = solveBeginner(Cube.solved());
    expect(solution.moves).toEqual([]);
    expect(solution.steps).toEqual([]);
  });

  it('solves two hundred random cubes', () => {
    for (let seed = 0; seed < 200; seed++) {
      const cube = scrambled(seed);
      const solution = solveBeginner(cube);
      expect(cube.apply(solution.moves).isSolved(), `seed ${seed}`).toBe(true);
    }
  });

  it('solves cubes from the scramble generator', () => {
    for (let seed = 0; seed < 50; seed++) {
      const cube = Cube.solved().apply(randomScramble(20, rng(seed + 500)));
      expect(cube.apply(solveBeginner(cube).moves).isSolved()).toBe(true);
    }
  });

  it('solves the superflip', () => {
    const cube = Cube.solved().apply(
      parseSequence("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"),
    );
    expect(cube.apply(solveBeginner(cube).moves).isSolved()).toBe(true);
  });

  it('solves a cube that is one move from solved', () => {
    for (let move = 0; move < 18; move++) {
      const cube = Cube.solved().move(move);
      expect(cube.apply(solveBeginner(cube).moves).isSolved()).toBe(true);
    }
  });

  it('refuses an impossible state', () => {
    const cube = Cube.solved().clone();
    cube.eo[0] = 1;
    expect(() => solveBeginner(cube)).toThrow(/flipped on its own/);
  });
});

describe('the steps build on each other', () => {
  const stageIndex = new Map(STAGE_ORDER.map((stage, index) => [stage.id, index]));

  it('never goes back to an earlier stage', () => {
    for (let seed = 0; seed < 30; seed++) {
      const solution = solveBeginner(scrambled(seed + 100));
      let highest = -1;
      for (const step of solution.steps) {
        const index = stageIndex.get(step.stage);
        expect(index, `unknown stage ${step.stage}`).toBeDefined();
        expect(index as number).toBeGreaterThanOrEqual(highest);
        highest = index as number;
      }
    }
  });

  it('has the bottom cross finished before the first-layer corners start', () => {
    const crossEdges = [Edge.DR, Edge.DF, Edge.DL, Edge.DB];
    for (let seed = 0; seed < 30; seed++) {
      const cube = scrambled(seed + 200);
      const solution = solveBeginner(cube);
      const first = solution.steps.find((step) => step.stage === 'first-layer-corners');
      if (!first) continue;
      for (const edge of crossEdges) {
        expect(first.before.ep[edge]).toBe(edge);
        expect(first.before.eo[edge]).toBe(0);
      }
    }
  });

  it('has the whole first layer finished before the middle layer starts', () => {
    const bottom = [Corner.DFR, Corner.DLF, Corner.DBL, Corner.DRB];
    for (let seed = 0; seed < 30; seed++) {
      const solution = solveBeginner(scrambled(seed + 300));
      const first = solution.steps.find((step) => step.stage === 'middle-layer');
      if (!first) continue;
      for (const corner of bottom) {
        expect(first.before.cp[corner]).toBe(corner);
        expect(first.before.co[corner]).toBe(0);
      }
    }
  });

  it('has the top edges turned the right way up before the corners are placed', () => {
    for (let seed = 0; seed < 30; seed++) {
      const solution = solveBeginner(scrambled(seed + 400));
      const first = solution.steps.find((step) => step.stage === 'top-corner-positions');
      if (!first) continue;
      for (const edge of [Edge.UR, Edge.UF, Edge.UL, Edge.UB]) {
        expect(first.before.eo[edge]).toBe(0);
      }
    }
  });

  it('places the top corners before turning them, not the other way round', () => {
    // The corner three-cycle twists what it moves, so orienting first would
    // undo itself. This is the ordering the whole beginner method hangs on.
    for (let seed = 0; seed < 30; seed++) {
      const solution = solveBeginner(scrambled(seed + 450));
      const first = solution.steps.find((step) => step.stage === 'top-corner-orientations');
      if (!first) continue;
      for (const corner of [Corner.URF, Corner.UFL, Corner.ULB, Corner.UBR]) {
        expect(first.before.cp[corner]).toBe(corner);
      }
    }
  });

  it('leaves the bottom two layers alone once they are finished', () => {
    const lower = [Edge.DR, Edge.DF, Edge.DL, Edge.DB, Edge.FR, Edge.FL, Edge.BL, Edge.BR];
    const lowerCorners = [Corner.DFR, Corner.DLF, Corner.DBL, Corner.DRB];

    for (let seed = 0; seed < 20; seed++) {
      const solution = solveBeginner(scrambled(seed + 500));
      const lastLayer = solution.steps.filter((step) => step.stage.startsWith('top'));
      for (const step of lastLayer) {
        // The corner-turning step is the exception and is honest about it: it
        // scrambles the bottom layer inside itself and restores it by the end.
        if (step.stage === 'top-corner-orientations') continue;
        const after = step.before.apply(step.moves);
        for (const edge of lower) {
          expect(after.ep[edge]).toBe(edge);
          expect(after.eo[edge]).toBe(0);
        }
        for (const corner of lowerCorners) {
          expect(after.cp[corner]).toBe(corner);
          expect(after.co[corner]).toBe(0);
        }
      }
    }
  });

  it('restores the bottom layer by the end of the corner-turning stage', () => {
    for (let seed = 0; seed < 20; seed++) {
      const solution = solveBeginner(scrambled(seed + 600));
      const index = solution.steps.findIndex((step) => step.stage === 'top-edges');
      if (index < 0) continue;
      const before = solution.steps[index]?.before;
      if (!before) continue;
      for (const corner of [Corner.DFR, Corner.DLF, Corner.DBL, Corner.DRB]) {
        expect(before.cp[corner]).toBe(corner);
        expect(before.co[corner]).toBe(0);
      }
    }
  });

  it('each step starts from where the previous one ended', () => {
    for (let seed = 0; seed < 20; seed++) {
      const cube = scrambled(seed + 700);
      const solution = solveBeginner(cube);
      let current = cube;
      for (const step of solution.steps) {
        expect(step.before.equals(current)).toBe(true);
        current = current.apply(step.moves);
      }
      expect(current.isSolved()).toBe(true);
    }
  });
});

describe('the steps are teachable', () => {
  it('every step explains itself', () => {
    const solution = solveBeginner(scrambled(11));
    expect(solution.steps.length).toBeGreaterThan(10);
    for (const step of solution.steps) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.detail.length).toBeGreaterThan(15);
      expect(step.moves.length).toBeGreaterThan(0);
      // A step with a named algorithm has to say why the algorithm works.
      if (step.technique) expect(step.why?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('names an algorithm for every last-layer step', () => {
    const solution = solveBeginner(scrambled(12));
    for (const step of solution.steps) {
      if (step.stage.startsWith('top')) expect(step.technique).toBeTruthy();
    }
  });

  it('covers all seven stages on a thoroughly scrambled cube', () => {
    const used = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const step of solveBeginner(scrambled(seed + 800)).steps) used.add(step.stage);
    }
    expect(used.size).toBe(STAGE_ORDER.length);
    for (const stage of STAGE_ORDER) expect(used.has(stage.id)).toBe(true);
  });
});

describe('solution length', () => {
  it('is long, because the method is meant to be followed rather than short', () => {
    const lengths: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      lengths.push(solveBeginner(scrambled(seed + 900)).moves.length);
    }
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    // Around 150 moves against the two-phase solver's 21. That gap is the
    // whole point of shipping both.
    expect(mean).toBeGreaterThan(80);
    expect(mean).toBeLessThan(220);
  });

  it('has nothing left to cancel', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { moves } = solveBeginner(scrambled(seed + 1000));
      for (let i = 1; i < moves.length; i++) {
        expect(Math.trunc((moves[i] as number) / 3)).not.toBe(
          Math.trunc((moves[i - 1] as number) / 3),
        );
      }
    }
  });
});
