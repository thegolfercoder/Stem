/**
 * Practice: cubes that need exactly one stage, and hints when you get stuck.
 *
 * The useful drill for a stage is not a fully scrambled cube - it is a cube
 * where everything before that stage is already finished, so the case in front
 * of you is the case you are trying to learn. Generating one is easy given a
 * solver that works in stages: scramble, solve up to the stage before, stop.
 */

import { Cube } from '../core/cube.js';
import { randomScramble } from '../core/scramble.js';
import { cancelMoves, type Move } from '../core/moves.js';
import { solveBeginner, type SolutionStep } from '../solvers/beginner.js';
import { LESSONS, type Lesson, currentLesson } from './lessons.js';

export interface Drill {
  readonly lesson: Lesson;
  readonly cube: Cube;
  /** The scramble that produced it, so it can be reproduced or shared. */
  readonly setup: Move[];
}

export class DrillError extends Error {}

/**
 * A cube on which everything before `lessonId` is done and that stage is not.
 *
 * Retries rather than constructing the state directly: a randomly built state
 * would be uniform over the stage's cases, and a scramble carried forward is
 * the distribution a learner will actually meet.
 */
export function drillFor(
  lessonId: string,
  random: () => number = Math.random,
  attempts = 40,
): Drill {
  const lesson = LESSONS.find((entry) => entry.id === lessonId);
  if (!lesson) throw new DrillError(`no lesson called ${lessonId}`);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const scramble = randomScramble(25, random);
    const cube = Cube.solved().apply(scramble);
    const solution = solveBeginner(cube);

    const upToStage = solution.steps.filter((step) => stageIndex(step) < lesson.index);
    const setup = cancelMoves([...scramble, ...upToStage.flatMap((step) => step.moves)]);
    const staged = Cube.solved().apply(setup);

    // The scramble may have left this stage already done, which makes a poor
    // drill; try again rather than hand back a cube with nothing to do.
    if (!lesson.isComplete(staged)) {
      return { lesson, cube: staged, setup };
    }
  }
  throw new DrillError(
    `could not produce a cube needing the ${lessonId} stage in ${attempts} attempts`,
  );
}

function stageIndex(step: SolutionStep): number {
  const lesson = LESSONS.find((entry) => entry.id === step.stage);
  return lesson?.index ?? Number.MAX_SAFE_INTEGER;
}

export interface Hint {
  readonly lesson: Lesson;
  readonly step: SolutionStep;
  /** How many steps of the beginner method remain from here. */
  readonly stepsRemaining: number;
  /** True when several steps were merged because they cannot be split. */
  readonly grouped: boolean;
}

/**
 * The next thing to do, and why. Null when the cube is already solved.
 *
 * A hint is a whole *group*, not a single step. The corner-turning stage
 * deliberately leaves the cube in pieces between its steps, so handing back the
 * first one and re-planning from wherever it lands is a loop: the position of
 * the corners breaks, the position stage fixes it, the orientation stage breaks
 * it again. Following hints one at a time used to run forever on most cubes.
 */
export function hint(cube: Cube): Hint | null {
  if (cube.isSolved()) return null;
  const lesson = currentLesson(cube);
  if (lesson === null) return null;

  const solution = solveBeginner(cube);
  const first = solution.steps[0];
  if (first === undefined) return null;

  if (first.group === undefined) {
    return { lesson, step: first, stepsRemaining: solution.steps.length, grouped: false };
  }

  const run: SolutionStep[] = [];
  for (const step of solution.steps) {
    if (step.group !== first.group) break;
    run.push(step);
  }
  const merged: SolutionStep = {
    ...first,
    detail:
      run.length === 1
        ? first.detail
        : `${first.title}: ${run.length} steps that have to be done together. ` +
          'Pieces move out of place part way through and are back by the end.',
    moves: run.flatMap((step) => step.moves),
  };
  return {
    lesson,
    step: merged,
    stepsRemaining: solution.steps.length - run.length + 1,
    grouped: run.length > 1,
  };
}

export interface Progress {
  readonly completed: number;
  readonly total: number;
  readonly current: Lesson | null;
  /** Per lesson, whether its goal is met. */
  readonly done: readonly boolean[];
}

/** Which stages of the method this cube has reached. */
export function progress(cube: Cube): Progress {
  const done = LESSONS.map((lesson) => lesson.isComplete(cube));
  // A later stage can read as complete by accident while an earlier one is not;
  // progress is the run of stages finished from the start, not the count.
  let completed = 0;
  while (completed < done.length && done[completed]) completed += 1;
  return {
    completed,
    total: LESSONS.length,
    current: currentLesson(cube),
    done,
  };
}
