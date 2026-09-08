/**
 * The curriculum, the drills, and the statistics.
 *
 * The lesson text is data, and data can be wrong in ways a type checker cannot
 * see: an algorithm that does not parse, a stage predicate that disagrees with
 * the solver, a drill that hands back a cube with nothing to practise on.
 */

import { describe, expect, it } from 'vitest';

import { Cube } from '../src/core/cube.js';
import { toFacelets } from '../src/core/facelets.js';
import { parseSequence, sequenceToString } from '../src/core/moves.js';
import { PATTERNS, patternMoves } from '../src/core/patterns.js';
import { solveBeginner } from '../src/solvers/beginner.js';
import { STAGE_ORDER } from '../src/solvers/beginner.js';
import { LESSONS, algorithmMoves, currentLesson } from '../src/teach/lessons.js';
import { drillFor, hint, progress } from '../src/teach/practice.js';
import {
  DNF,
  averageOf,
  bestTime,
  formatTime,
  sessionMean,
  summarise,
  type Attempt,
} from '../src/ui/stats.js';

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function scrambled(seed: number): Cube {
  const next = rng(seed + 1);
  return Cube.solved().apply(Array.from({ length: 25 }, () => Math.trunc(next() * 18) % 18));
}

describe('the curriculum', () => {
  it('has one lesson per stage of the solver, in the same order', () => {
    expect(LESSONS.map((lesson) => lesson.id)).toEqual(STAGE_ORDER.map((stage) => stage.id));
    LESSONS.forEach((lesson, index) => expect(lesson.index).toBe(index));
  });

  it('every algorithm parses and does something', () => {
    for (const lesson of LESSONS) {
      for (const algorithm of lesson.algorithms) {
        const moves = algorithmMoves(algorithm);
        expect(moves.length, `${algorithm.name} is empty`).toBeGreaterThan(0);
        expect(Cube.solved().apply(moves).isSolved(), `${algorithm.name} does nothing`).toBe(false);
      }
    }
  });

  it('every algorithm is written the way it is printed', () => {
    for (const lesson of LESSONS) {
      for (const algorithm of lesson.algorithms) {
        expect(sequenceToString(parseSequence(algorithm.notation))).toBe(algorithm.notation);
      }
    }
  });

  it('every lesson explains itself rather than only listing moves', () => {
    for (const lesson of LESSONS) {
      expect(lesson.goal.length).toBeGreaterThan(20);
      expect(lesson.idea.length).toBeGreaterThan(100);
      expect(lesson.lookFor.length).toBeGreaterThan(30);
      expect(lesson.commonMistake.length).toBeGreaterThan(30);
      for (const algorithm of lesson.algorithms) {
        expect(algorithm.effect.length).toBeGreaterThan(20);
        expect(algorithm.why.length).toBeGreaterThan(30);
      }
    }
  });

  it('the last-layer lessons all carry an algorithm', () => {
    for (const lesson of LESSONS.slice(3)) {
      expect(lesson.algorithms.length, `${lesson.id}`).toBeGreaterThan(0);
    }
  });

  it('every lesson is complete on a solved cube and the first is not on a scrambled one', () => {
    for (const lesson of LESSONS) expect(lesson.isComplete(Cube.solved())).toBe(true);
    expect(currentLesson(Cube.solved())).toBeNull();
  });

  it('lesson completeness agrees with the solver', () => {
    // Where the solver says a stage is finished, the lesson predicate must too.
    for (let seed = 0; seed < 25; seed++) {
      const cube = scrambled(seed);
      const solution = solveBeginner(cube);
      for (const lesson of LESSONS) {
        const firstOfNext = solution.steps.find(
          (step) => (LESSONS.find((l) => l.id === step.stage)?.index ?? -1) > lesson.index,
        );
        if (firstOfNext) {
          expect(lesson.isComplete(firstOfNext.before), `${lesson.id} seed ${seed}`).toBe(true);
        }
      }
    }
  });

  it('reports the first unfinished lesson', () => {
    for (let seed = 0; seed < 20; seed++) {
      const cube = scrambled(seed + 50);
      const lesson = currentLesson(cube);
      expect(lesson).not.toBeNull();
      expect((lesson as { isComplete: (c: Cube) => boolean }).isComplete(cube)).toBe(false);
    }
  });
});

describe('drills', () => {
  it('produce a cube where everything before the stage is done and the stage is not', () => {
    for (const lesson of LESSONS) {
      for (let seed = 0; seed < 3; seed++) {
        const drill = drillFor(lesson.id, rng(seed + lesson.index * 31 + 1));
        expect(drill.lesson.id).toBe(lesson.id);
        expect(lesson.isComplete(drill.cube), `${lesson.id} should not be done`).toBe(false);
        for (const earlier of LESSONS.slice(0, lesson.index)) {
          expect(earlier.isComplete(drill.cube), `${earlier.id} should be done`).toBe(true);
        }
      }
    }
  });

  it('produce a cube the setup sequence reproduces exactly', () => {
    const drill = drillFor('middle-layer', rng(7));
    expect(Cube.solved().apply(drill.setup).equals(drill.cube)).toBe(true);
  });

  it('produce a solvable cube', () => {
    for (const lesson of LESSONS) {
      const drill = drillFor(lesson.id, rng(lesson.index + 900));
      expect(drill.cube.isSolvable()).toBe(true);
      expect(drill.cube.apply(solveBeginner(drill.cube).moves).isSolved()).toBe(true);
    }
  });

  it('refuse a lesson that does not exist', () => {
    expect(() => drillFor('telekinesis')).toThrow(/no lesson called/);
  });
});

describe('hints', () => {
  it('name the stage and the next move', () => {
    for (let seed = 0; seed < 20; seed++) {
      const cube = scrambled(seed + 200);
      const next = hint(cube);
      expect(next).not.toBeNull();
      const value = next as NonNullable<typeof next>;
      expect(value.step.moves.length).toBeGreaterThan(0);
      expect(value.step.detail.length).toBeGreaterThan(10);
      expect(value.stepsRemaining).toBeGreaterThan(0);
      expect(value.lesson.id).toBe(value.step.stage);
    }
  });

  it('say there is nothing to do on a solved cube', () => {
    expect(hint(Cube.solved())).toBeNull();
  });

  it('lead to a solved cube if followed', () => {
    // The regression this exists for: hints used to hand back one step of the
    // corner-turning stage, which leaves the cube in pieces, so the next hint
    // went back to fixing what that step had broken - forever, on most cubes.
    for (const seed of [3, 4, 11, 25]) {
      let cube = scrambled(seed);
      for (let guard = 0; guard < 120 && !cube.isSolved(); guard++) {
        const next = hint(cube);
        expect(next, `seed ${seed}`).not.toBeNull();
        cube = cube.apply((next as NonNullable<typeof next>).step.moves);
      }
      expect(cube.isSolved(), `seed ${seed}`).toBe(true);
    }
  });

  it('merge the steps that cannot be split, and say so', () => {
    let cube = scrambled(3);
    let sawGrouped = false;
    for (let guard = 0; guard < 120 && !cube.isSolved(); guard++) {
      const next = hint(cube);
      const value = next as NonNullable<typeof next>;
      if (value.grouped) {
        sawGrouped = true;
        // All three last-layer stages take pieces out of place part way
        // through; none of them has a meaningful halfway point.
        expect(['top-corner-positions', 'top-corner-orientations', 'top-edges']).toContain(
          value.step.stage,
        );
        expect(value.step.detail).toMatch(/done together/);
      }
      cube = cube.apply(value.step.moves);
    }
    expect(sawGrouped).toBe(true);
  });
});

describe('progress', () => {
  it('is complete on a solved cube and empty on a thoroughly scrambled one', () => {
    const solved = progress(Cube.solved());
    expect(solved.completed).toBe(LESSONS.length);
    expect(solved.current).toBeNull();
    expect(progress(scrambled(5)).completed).toBeLessThan(LESSONS.length);
  });

  it('counts the run of finished stages, not the total finished', () => {
    // A later stage can read as finished by luck while an earlier one is not,
    // and calling that progress would show a learner a bar that goes backwards.
    for (let seed = 0; seed < 30; seed++) {
      const report = progress(scrambled(seed + 300));
      for (let i = 0; i < report.completed; i++) expect(report.done[i]).toBe(true);
      if (report.completed < report.total) expect(report.done[report.completed]).toBe(false);
    }
  });

  it('only ever increases as the solution is followed', () => {
    // Except inside the corner-turning stage, which takes the cube apart on
    // purpose. That stage is marked as one group precisely because its middle
    // is not a state anybody should be shown a progress bar for.
    const cube = scrambled(9);
    let current = cube;
    let last = progress(current).completed;
    for (const step of solveBeginner(cube).steps) {
      current = current.apply(step.moves);
      if (step.group !== undefined) continue;
      const now = progress(current).completed;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(progress(current).completed).toBe(LESSONS.length);
  });
});

describe('patterns', () => {
  it('all parse, and none is already solved', () => {
    for (const pattern of PATTERNS) {
      const moves = patternMoves(pattern);
      expect(moves.length, pattern.id).toBeGreaterThan(0);
      const cube = Cube.solved().apply(moves);
      expect(cube.isSolvable(), pattern.id).toBe(true);
      expect(cube.isSolved(), pattern.id).toBe(false);
    }
  });

  it('are all solvable by both solvers', () => {
    for (const pattern of PATTERNS) {
      const cube = Cube.solved().apply(patternMoves(pattern));
      expect(cube.apply(solveBeginner(cube).moves).isSolved(), pattern.id).toBe(true);
    }
  });

  it('the checkerboard really is chequered', () => {
    const pattern = PATTERNS.find((entry) => entry.id === 'checkerboard');
    expect(pattern).toBeDefined();
    const cube = Cube.solved().apply(patternMoves(pattern as NonNullable<typeof pattern>));
    // Every face alternates between its own colour and its opposite.
    expect(toFacelets(cube).slice(0, 9)).toBe('UDUDUDUDU');
  });

  it('each carries a note explaining what it is', () => {
    for (const pattern of PATTERNS) {
      expect(pattern.note.length, pattern.id).toBeGreaterThan(30);
      expect(pattern.name.length).toBeGreaterThan(2);
    }
  });
});

describe('timing statistics', () => {
  const attempt = (time: number, penalty?: 'plus2' | 'dnf'): Attempt => ({
    time,
    ...(penalty ? { penalty } : {}),
    scramble: '',
    at: 0,
  });

  it('needs enough attempts before it reports an average', () => {
    expect(averageOf([attempt(1000)], 5)).toBeNull();
    expect(
      averageOf(
        Array.from({ length: 4 }, () => attempt(1000)),
        5,
      ),
    ).toBeNull();
  });

  it('drops the best and the worst', () => {
    const attempts = [1000, 2000, 3000, 4000, 100000].map((time) => attempt(time));
    // 1000 and 100000 are removed; the mean of 2000, 3000, 4000 is 3000.
    expect(averageOf(attempts, 5)).toBe(3000);
  });

  it('adds two seconds for a plus-two', () => {
    expect(
      averageOf(
        [1000, 2000, 3000, 4000, 5000].map((t) => attempt(t)),
        5,
      ),
    ).toBe(3000);
    const withPenalty = [
      attempt(1000),
      attempt(2000, 'plus2'),
      attempt(3000),
      attempt(4000),
      attempt(5000),
    ];
    // 2000 becomes 4000, so the middle three are 3000, 4000, 4000.
    expect(averageOf(withPenalty, 5)).toBeCloseTo((3000 + 4000 + 4000) / 3, 5);
  });

  it('tolerates one did-not-finish and not two', () => {
    const one = [attempt(1000), attempt(2000), attempt(3000), attempt(4000), attempt(0, 'dnf')];
    expect(averageOf(one, 5)).toBe(3000);

    const two = [attempt(1000), attempt(2000), attempt(3000), attempt(0, 'dnf'), attempt(0, 'dnf')];
    expect(averageOf(two, 5)).toBe(DNF);
  });

  it('reports a session summary', () => {
    const attempts = [12000, 9000, 15000, 11000, 10000, 13000].map((t) => attempt(t));
    const summary = summarise(attempts);
    expect(summary.solves).toBe(6);
    expect(summary.best).toBe(9000);
    expect(summary.worst).toBe(15000);
    expect(sessionMean(attempts)).toBeCloseTo(11666.67, 0);
    expect(summary.ao5).not.toBeNull();
    expect(summary.ao12).toBeNull();
    expect(summary.bestAo5).not.toBeNull();
  });

  it('ignores did-not-finish attempts in the best time', () => {
    expect(bestTime([attempt(5000), attempt(0, 'dnf')])).toBe(5000);
    expect(bestTime([attempt(0, 'dnf')])).toBeNull();
  });

  it('formats times the way a timer does', () => {
    expect(formatTime(null)).toBe('--');
    expect(formatTime(DNF)).toBe('DNF');
    expect(formatTime(9870)).toBe('9.87');
    expect(formatTime(83450)).toBe('1:23.45');
    expect(formatTime(60000)).toBe('1:00.00');
  });
});
