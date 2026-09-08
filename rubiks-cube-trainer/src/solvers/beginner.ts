/**
 * The layer-by-layer beginner method.
 *
 * This solver exists to be *followed*, not to be short. It produces around
 * eighty moves where the two-phase solver produces twenty, and every one of
 * them belongs to a step a person can understand and repeat on a physical cube:
 * place this edge, insert that corner, apply this named algorithm because the
 * last layer looks like this.
 *
 * Seven stages, in the order every beginner tutorial teaches them, and the
 * order matters more than it looks:
 *
 *  1. the cross on D
 *  2. the four D corners, finishing the first layer
 *  3. the four middle-layer edges
 *  4. orient the last-layer edges - the yellow cross
 *  5. **permute** the last-layer corners
 *  6. **orient** the last-layer corners
 *  7. permute the last-layer edges
 *
 * Five before six because the corner three-cycle used in step 5 twists the
 * corners it moves, so orienting first and permuting second would undo the
 * work. Step 6's `R' D' R D` repetition leaves the corner *positions* alone,
 * which is exactly why the beginner method uses that awkward-looking sequence
 * instead of a Sune.
 *
 * Stages 2 to 7 work by searching over a small set of named manoeuvres - an
 * alignment turn of U followed by one of the taught algorithms - and keeping
 * the first that makes progress. That is what a person does when they look at
 * the cube, decide which case they have, and pick the matching algorithm; it
 * is also far more robust than hand-coding forty case recognitions, and the
 * annotation still names the algorithm that was used.
 */

import { Cube, Corner, Edge } from '../core/cube.js';
import { cancelMoves, parseSequence, type Move } from '../core/moves.js';

export interface SolutionStep {
  /** Which stage this belongs to. */
  readonly stage: string;
  readonly title: string;
  /** What this particular step achieves, in one line. */
  readonly detail: string;
  /** The named algorithm used, when one was. */
  readonly technique?: string;
  /** Why that algorithm does what it does. */
  readonly why?: string;
  readonly moves: Move[];
  /** The state before this step, so a viewer can highlight what is about to change. */
  readonly before: Cube;
}

export interface BeginnerSolution {
  readonly steps: SolutionStep[];
  readonly moves: Move[];
}

export class UnsolvableStageError extends Error {}

/* ------------------------------------------------------------- primitives */

const alg = (text: string): Move[] => parseSequence(text);

const U_ALIGNMENTS: { label: string; moves: Move[] }[] = [
  { label: '', moves: [] },
  { label: 'U', moves: alg('U') },
  { label: 'U2', moves: alg('U2') },
  { label: "U'", moves: alg("U'") },
];

interface Manoeuvre {
  readonly name: string;
  readonly why: string;
  readonly moves: Move[];
}

/** Prefix each algorithm with each U alignment, as a person would. */
function withAlignments(name: string, why: string, moves: Move[]): Manoeuvre[] {
  return U_ALIGNMENTS.map((alignment) => ({
    name: alignment.label ? `${alignment.label} then ${name}` : name,
    why,
    moves: [...alignment.moves, ...moves],
  }));
}

/**
 * Breadth-first search over whole manoeuvres rather than single turns.
 *
 * The branching factor is the number of algorithms a person would consider,
 * not eighteen, so the search is over the same decisions a learner makes and
 * the result reads as a sequence of named steps.
 */
function searchManoeuvres(
  start: Cube,
  manoeuvres: readonly Manoeuvre[],
  goal: (cube: Cube) => boolean,
  key: (cube: Cube) => string,
  maxDepth: number,
): Manoeuvre[] | null {
  if (goal(start)) return [];

  interface Node {
    cube: Cube;
    path: Manoeuvre[];
  }
  let frontier: Node[] = [{ cube: start, path: [] }];
  const seen = new Set<string>([key(start)]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const manoeuvre of manoeuvres) {
        const cube = node.cube.apply(manoeuvre.moves);
        if (goal(cube)) return [...node.path, manoeuvre];
        const identity = key(cube);
        if (seen.has(identity)) continue;
        seen.add(identity);
        next.push({ cube, path: [...node.path, manoeuvre] });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}

/** Plain breadth-first search over single turns, for the intuitive cross. */
function searchTurns(
  start: Cube,
  goal: (cube: Cube) => boolean,
  key: (cube: Cube) => string,
  maxDepth: number,
): Move[] | null {
  if (goal(start)) return [];

  interface Node {
    cube: Cube;
    path: Move[];
    lastFace: number;
  }
  let frontier: Node[] = [{ cube: start, path: [], lastFace: -1 }];
  const seen = new Set<string>([key(start)]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (let move = 0; move < 18; move++) {
        const face = Math.trunc(move / 3);
        if (face === node.lastFace) continue;
        const cube = node.cube.move(move);
        const path = [...node.path, move];
        if (goal(cube)) return path;
        const identity = key(cube);
        if (seen.has(identity)) continue;
        seen.add(identity);
        next.push({ cube, path, lastFace: face });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}

/* ------------------------------------------------------------ predicates */

const positionOfEdge = (cube: Cube, cubie: Edge): number => cube.ep.indexOf(cubie);
const positionOfCorner = (cube: Cube, cubie: Corner): number => cube.cp.indexOf(cubie);

const edgeSolved = (cube: Cube, cubie: Edge): boolean =>
  cube.ep[cubie] === cubie && cube.eo[cubie] === 0;

const cornerSolved = (cube: Cube, cubie: Corner): boolean =>
  cube.cp[cubie] === cubie && cube.co[cubie] === 0;

/** A key describing only the edges the current sub-goal cares about. */
const edgeKey = (cube: Cube, cubies: readonly Edge[]): string =>
  cubies.map((cubie) => `${positionOfEdge(cube, cubie)}.${cube.eo[positionOfEdge(cube, cubie)]}`).join('|');

const cornerKey = (cube: Cube, cubies: readonly Corner[]): string =>
  cubies
    .map((cubie) => `${positionOfCorner(cube, cubie)}.${cube.co[positionOfCorner(cube, cubie)]}`)
    .join('|');

const upperLayerKey = (cube: Cube): string =>
  [0, 1, 2, 3].map((i) => `${cube.cp[i]}.${cube.co[i]}.${cube.ep[i]}.${cube.eo[i]}`).join('|');

/* ---------------------------------------------------------------- stage 1 */

const CROSS_EDGES: readonly Edge[] = [Edge.DF, Edge.DR, Edge.DB, Edge.DL];
const CROSS_EDGE_NAMES = ['front', 'right', 'back', 'left'] as const;

function solveCross(cube: Cube): SolutionStep[] {
  const steps: SolutionStep[] = [];
  let current = cube;

  for (let index = 0; index < CROSS_EDGES.length; index++) {
    const placed = CROSS_EDGES.slice(0, index + 1);
    if (placed.every((cubie) => edgeSolved(current, cubie))) continue;

    const moves = searchTurns(
      current,
      (state) => placed.every((cubie) => edgeSolved(state, cubie)),
      (state) => edgeKey(state, placed),
      8,
    );
    if (moves === null) {
      throw new UnsolvableStageError(`could not place the ${CROSS_EDGE_NAMES[index]} cross edge`);
    }

    steps.push({
      stage: 'cross',
      title: 'The cross',
      detail:
        `Bring the ${CROSS_EDGE_NAMES[index]} edge of the bottom layer home, ` +
        `leaving the ${index} already placed where ${index === 1 ? 'it is' : 'they are'}.`,
      why:
        'The cross is solved by looking rather than by algorithm. Each edge only has to ' +
        'reach one place the right way up, and the shortest route is usually obvious once ' +
        'you spot which face it is on.',
      moves,
      before: current,
    });
    current = current.apply(moves);
  }
  return steps;
}

/* ---------------------------------------------------------------- stage 2 */

/**
 * The first-layer corners, by repeating `R U R' U'` from the corner's own slot.
 *
 * That four-move trio takes the corner out of the slot, round the top and back
 * in, twisted by one third each time. Three applications therefore return it
 * the way it came - which is why repeating it eventually inserts the corner the
 * right way up, and why the whole rest of the bottom layer is untouched.
 */
const CORNER_SLOTS: readonly { corner: Corner; face: string; where: string }[] = [
  { corner: Corner.DFR, face: 'R', where: 'front-right' },
  { corner: Corner.DRB, face: 'B', where: 'back-right' },
  { corner: Corner.DBL, face: 'L', where: 'back-left' },
  { corner: Corner.DLF, face: 'F', where: 'front-left' },
];

function solveFirstLayerCorners(cube: Cube): SolutionStep[] {
  const steps: SolutionStep[] = [];
  let current = cube;

  for (let index = 0; index < CORNER_SLOTS.length; index++) {
    const slot = CORNER_SLOTS[index] as (typeof CORNER_SLOTS)[number];
    const placed = CORNER_SLOTS.slice(0, index + 1).map((entry) => entry.corner);
    if (placed.every((corner) => cornerSolved(current, corner))) continue;

    // Only the trios of slots that are not yet finished may be used: a trio on
    // a finished slot would empty it again.
    const usable = CORNER_SLOTS.filter(
      (entry, position) => position >= index || !cornerSolved(current, entry.corner),
    );
    const manoeuvres = usable.flatMap((entry) =>
      withAlignments(
        `the ${entry.face} U ${entry.face}' U' trio`,
        `Repeating ${entry.face} U ${entry.face}' U' lifts the ${entry.where} corner out, ` +
          'turns it, and puts it back. Everything else in the bottom layer is returned ' +
          'exactly where it was, which is what makes it safe to repeat.',
        alg(`${entry.face} U ${entry.face}' U'`),
      ),
    );

    const path = searchManoeuvres(
      current,
      manoeuvres,
      (state) => placed.every((corner) => cornerSolved(state, corner)),
      (state) => cornerKey(state, placed),
      6,
    );
    if (path === null) {
      throw new UnsolvableStageError(`could not place the ${slot.where} corner`);
    }

    for (const manoeuvre of path) {
      steps.push({
        stage: 'first-layer-corners',
        title: 'First layer corners',
        detail: `Work the ${slot.where} corner into place.`,
        technique: manoeuvre.name,
        why: manoeuvre.why,
        moves: manoeuvre.moves,
        before: current,
      });
      current = current.apply(manoeuvre.moves);
    }
  }
  return steps;
}

/* ---------------------------------------------------------------- stage 3 */

/**
 * The middle layer. Four slots, two algorithms, mirror images of each other.
 *
 * Each takes an edge sitting in the top layer, sends it away, turns the top,
 * and brings it back into the slot on the way through. The pieces below are
 * disturbed and restored within the eight moves.
 */
const MIDDLE_SLOTS: readonly { edge: Edge; front: string; right: string; where: string }[] = [
  { edge: Edge.FR, front: 'F', right: 'R', where: 'front-right' },
  { edge: Edge.BR, front: 'R', right: 'B', where: 'back-right' },
  { edge: Edge.BL, front: 'B', right: 'L', where: 'back-left' },
  { edge: Edge.FL, front: 'L', right: 'F', where: 'front-left' },
];

function solveMiddleLayer(cube: Cube): SolutionStep[] {
  const steps: SolutionStep[] = [];
  let current = cube;

  for (let index = 0; index < MIDDLE_SLOTS.length; index++) {
    const slot = MIDDLE_SLOTS[index] as (typeof MIDDLE_SLOTS)[number];
    const placed = MIDDLE_SLOTS.slice(0, index + 1).map((entry) => entry.edge);
    if (placed.every((edge) => edgeSolved(current, edge))) continue;

    const usable = MIDDLE_SLOTS.filter(
      (entry, position) => position >= index || !edgeSolved(current, entry.edge),
    );
    const manoeuvres = usable.flatMap((entry) => [
      ...withAlignments(
        `the right-hand insert into the ${entry.where} slot`,
        `${entry.right} U' ${entry.right}' pushes the slot's contents up out of the way, ` +
          `and U' ${entry.front}' U ${entry.front} brings the edge back down into it.`,
        alg(`U ${entry.right} U' ${entry.right}' U' ${entry.front}' U ${entry.front}`),
      ),
      ...withAlignments(
        `the left-hand insert into the ${entry.where} slot`,
        'The mirror image of the right-hand insert, for an edge approaching from the other side.',
        alg(`U' ${entry.front}' U ${entry.front} U ${entry.right} U' ${entry.right}'`),
      ),
    ]);

    const path = searchManoeuvres(
      current,
      manoeuvres,
      (state) => placed.every((edge) => edgeSolved(state, edge)),
      (state) => edgeKey(state, placed),
      4,
    );
    if (path === null) {
      throw new UnsolvableStageError(`could not place the ${slot.where} middle edge`);
    }

    for (const manoeuvre of path) {
      steps.push({
        stage: 'middle-layer',
        title: 'Middle layer',
        detail: `Put the ${slot.where} edge into its slot.`,
        technique: manoeuvre.name,
        why: manoeuvre.why,
        moves: manoeuvre.moves,
        before: current,
      });
      current = current.apply(manoeuvre.moves);
    }
  }
  return steps;
}

/* ---------------------------------------------------------------- stage 4 */

const LAST_LAYER_EDGES: readonly Edge[] = [Edge.UR, Edge.UF, Edge.UL, Edge.UB];
const LAST_LAYER_CORNERS: readonly Corner[] = [Corner.URF, Corner.UFL, Corner.ULB, Corner.UBR];

const topEdgesOriented = (cube: Cube): boolean =>
  LAST_LAYER_EDGES.every((edge) => cube.eo[edge] === 0);

function solveTopCross(cube: Cube): SolutionStep[] {
  const manoeuvres = withAlignments(
    'F R U R\' U\' F\'',
    'The three moves in the middle are the same trio used on the corners; wrapping them in ' +
      'F and F\' aims that trio at the top edges instead. A dot becomes an L, an L becomes a ' +
      'line, and a line becomes the cross.',
    alg("F R U R' U' F'"),
  );

  const path = searchManoeuvres(
    cube,
    manoeuvres,
    topEdgesOriented,
    (state) => LAST_LAYER_EDGES.map((edge) => state.eo[edge]).join(''),
    4,
  );
  if (path === null) throw new UnsolvableStageError('could not make the top cross');

  const steps: SolutionStep[] = [];
  let current = cube;
  for (const manoeuvre of path) {
    steps.push({
      stage: 'top-cross',
      title: 'The top cross',
      detail: 'Turn the top edges the right way up, ignoring where they are.',
      technique: manoeuvre.name,
      why: manoeuvre.why,
      moves: manoeuvre.moves,
      before: current,
    });
    current = current.apply(manoeuvre.moves);
  }
  return steps;
}

/* ---------------------------------------------------------------- stage 5 */

const topCornersPlaced = (cube: Cube): boolean =>
  LAST_LAYER_CORNERS.every((corner) => cube.cp[corner] === corner);

function solveTopCornerPositions(cube: Cube): SolutionStep[] {
  const manoeuvres: Manoeuvre[] = [
    ...withAlignments(
      'the corner three-cycle',
      "U R U' L' U R' U' L moves three top corners round and leaves the fourth alone. It " +
        'twists the ones it moves, which does not matter yet - the next step is where they ' +
        'get turned the right way up.',
      alg("U R U' L' U R' U' L"),
    ),
    ...withAlignments(
      'the T-perm',
      'Swaps two neighbouring corners, and two edges with them. Needed when the corners are ' +
        'in an odd arrangement that no amount of three-cycling can fix.',
      alg("R U R' U' R' F R2 U' R' U' R U R' F'"),
    ),
    ...withAlignments(
      'the Y-perm',
      'Swaps two corners diagonally opposite each other, and two edges.',
      alg("F R U' R' U' R U R' F' R U R' U' R' F R F'"),
    ),
    { name: 'U', why: 'Line the top layer up with the sides.', moves: alg('U') },
    { name: 'U2', why: 'Line the top layer up with the sides.', moves: alg('U2') },
    { name: "U'", why: 'Line the top layer up with the sides.', moves: alg("U'") },
  ];

  const path = searchManoeuvres(
    cube,
    manoeuvres,
    topCornersPlaced,
    (state) => LAST_LAYER_CORNERS.map((corner) => state.cp[corner]).join(''),
    4,
  );
  if (path === null) throw new UnsolvableStageError('could not place the top corners');

  const steps: SolutionStep[] = [];
  let current = cube;
  for (const manoeuvre of path) {
    steps.push({
      stage: 'top-corner-positions',
      title: 'Top corners into place',
      detail: 'Get each top corner to the right spot, ignoring which way it faces.',
      technique: manoeuvre.name,
      why: manoeuvre.why,
      moves: manoeuvre.moves,
      before: current,
    });
    current = current.apply(manoeuvre.moves);
  }
  return steps;
}

/* ---------------------------------------------------------------- stage 6 */

/**
 * Turning the top corners the right way up, without moving them.
 *
 * `R' D' R D` twists the corner at the top front-right by one third every two
 * applications, and scrambles the bottom layer while it does. It comes back:
 * the sequence has order six, each corner needs two or four applications, and
 * the three laws force the total to be a multiple of six. So by the time the
 * last corner is turned, the bottom layer has returned to exactly where it was.
 *
 * This looks alarming the first time you do it and is the step where beginners
 * most often give up two moves early. It is also the reason the corners are
 * *placed* before they are *turned*: nothing here moves a corner to a different
 * position.
 */
function solveTopCornerOrientations(cube: Cube): SolutionStep[] {
  // Nothing to do is a real case, and emitting the four presenting turns anyway
  // would put five pointless steps in front of a learner.
  if (LAST_LAYER_CORNERS.every((corner) => cube.co[corner] === 0)) return [];

  const trio = alg("R' D' R D");
  const steps: SolutionStep[] = [];
  let current = cube;

  for (let visited = 0; visited < 4; visited++) {
    let applications = 0;
    while (current.co[Corner.URF] !== 0) {
      if (applications >= 2) {
        throw new UnsolvableStageError('a top corner refused to turn the right way up');
      }
      const moves = [...trio, ...trio];
      steps.push({
        stage: 'top-corner-orientations',
        title: 'Turning the top corners',
        detail: 'Twist the front-right top corner without moving it out of its place.',
        technique: "R' D' R D, twice",
        why:
          "Each pair of R' D' R D turns this one corner by a third and leaves its position " +
          'alone. The bottom layer is disturbed in the middle of it and comes back by the ' +
          'time every corner has been turned.',
        moves,
        before: current,
      });
      current = current.apply(moves);
      applications += 1;
    }

    if (visited < 3) {
      const moves = alg('U');
      steps.push({
        stage: 'top-corner-orientations',
        title: 'Turning the top corners',
        detail: 'Bring the next top corner round to the front-right.',
        technique: 'U',
        why: 'The top layer is turned to present the next corner; the bottom is untouched.',
        moves,
        before: current,
      });
      current = current.apply(moves);
    }
  }

  // Four U turns were spent presenting corners, so one more completes the loop
  // and returns the top layer to where it started.
  const finish = alg('U');
  steps.push({
    stage: 'top-corner-orientations',
    title: 'Turning the top corners',
    detail: 'Complete the turn of the top layer, putting it back where it started.',
    technique: 'U',
    why: 'Four U turns in total, so the layer ends where it began and the bottom is restored.',
    moves: finish,
    before: current,
  });
  return steps;
}

/* ---------------------------------------------------------------- stage 7 */

function solveTopEdgePositions(cube: Cube): SolutionStep[] {
  const manoeuvres: Manoeuvre[] = [
    ...withAlignments(
      'the Ua-perm',
      "R U' R U R U R U' R' U' R2 cycles three top edges one way and touches nothing else.",
      alg("R U' R U R U R U' R' U' R2"),
    ),
    ...withAlignments(
      'the Ub-perm',
      'The same three-cycle in the other direction, for when the edges go round the other way.',
      alg("R2 U R U R' U' R' U' R' U R'"),
    ),
    { name: 'U', why: 'Line the top layer up with the sides.', moves: alg('U') },
    { name: 'U2', why: 'Line the top layer up with the sides.', moves: alg('U2') },
    { name: "U'", why: 'Line the top layer up with the sides.', moves: alg("U'") },
  ];

  const path = searchManoeuvres(
    cube,
    manoeuvres,
    (state) => state.isSolved(),
    upperLayerKey,
    4,
  );
  if (path === null) throw new UnsolvableStageError('could not finish the top edges');

  const steps: SolutionStep[] = [];
  let current = cube;
  for (const manoeuvre of path) {
    steps.push({
      stage: 'top-edges',
      title: 'The last four edges',
      detail: 'Cycle the top edges into place. This is the last step.',
      technique: manoeuvre.name,
      why: manoeuvre.why,
      moves: manoeuvre.moves,
      before: current,
    });
    current = current.apply(manoeuvre.moves);
  }
  return steps;
}

/* -------------------------------------------------------------- the solver */

const STAGES: readonly ((cube: Cube) => SolutionStep[])[] = [
  solveCross,
  solveFirstLayerCorners,
  solveMiddleLayer,
  solveTopCross,
  solveTopCornerPositions,
  solveTopCornerOrientations,
  solveTopEdgePositions,
];

/**
 * Solve a cube the way a person would learn to.
 *
 * Returns every step with the state it started from, so an interface can play
 * them back one at a time and highlight what each is about to change.
 */
export function solveBeginner(cube: Cube): BeginnerSolution {
  cube.assertSolvable();

  const steps: SolutionStep[] = [];
  let current = cube;
  for (const stage of STAGES) {
    const produced = stage(current);
    for (const step of produced) current = current.apply(step.moves);
    steps.push(...produced);
  }

  if (!current.isSolved()) {
    throw new UnsolvableStageError('the beginner method finished without solving the cube');
  }

  const moves = steps.flatMap((step) => step.moves);
  return { steps, moves: cancelMoves(moves) };
}

/** The seven stages, for a lesson index that does not need a cube to build. */
export const STAGE_ORDER: readonly { id: string; title: string }[] = [
  { id: 'cross', title: 'The cross' },
  { id: 'first-layer-corners', title: 'First layer corners' },
  { id: 'middle-layer', title: 'Middle layer' },
  { id: 'top-cross', title: 'The top cross' },
  { id: 'top-corner-positions', title: 'Top corners into place' },
  { id: 'top-corner-orientations', title: 'Turning the top corners' },
  { id: 'top-edges', title: 'The last four edges' },
];
