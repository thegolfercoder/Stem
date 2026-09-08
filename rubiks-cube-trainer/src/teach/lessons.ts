/**
 * The curriculum.
 *
 * Seven lessons, one per stage of the layer-by-layer method, each with the idea
 * behind it rather than only the moves. The algorithms are here as data so the
 * interface, the practice checker and the documentation all quote the same
 * strings - an algorithm written out twice is an algorithm that will eventually
 * differ in one place.
 */

import { Cube, Corner, Edge } from '../core/cube.js';
import { parseSequence, type Move } from '../core/moves.js';

export interface Algorithm {
  readonly name: string;
  readonly notation: string;
  /** What it does to the cube, in plain terms. */
  readonly effect: string;
  /** Why it does that - the part a list of algorithms usually leaves out. */
  readonly why: string;
}

export interface Lesson {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  /** What you are trying to achieve. */
  readonly goal: string;
  /** The idea, in a paragraph. */
  readonly idea: string;
  /** What to look at on the cube while doing it. */
  readonly lookFor: string;
  /** The most common way people get this stage wrong. */
  readonly commonMistake: string;
  readonly algorithms: readonly Algorithm[];
  /** True when this lesson's goal is met. */
  readonly isComplete: (cube: Cube) => boolean;
}

const bottomEdges = [Edge.DR, Edge.DF, Edge.DL, Edge.DB] as const;
const bottomCorners = [Corner.DFR, Corner.DLF, Corner.DBL, Corner.DRB] as const;
const middleEdges = [Edge.FR, Edge.FL, Edge.BL, Edge.BR] as const;
const topEdges = [Edge.UR, Edge.UF, Edge.UL, Edge.UB] as const;
const topCorners = [Corner.URF, Corner.UFL, Corner.ULB, Corner.UBR] as const;

const edgeHome = (cube: Cube, edge: Edge): boolean => cube.ep[edge] === edge && cube.eo[edge] === 0;
const cornerHome = (cube: Cube, corner: Corner): boolean =>
  cube.cp[corner] === corner && cube.co[corner] === 0;

export const LESSONS: readonly Lesson[] = [
  {
    id: 'cross',
    index: 0,
    title: 'The cross',
    goal: 'Four edges of the bottom face home, each with its side colour matching the centre beside it.',
    idea:
      'Centres never move relative to each other, so they are the frame everything else is ' +
      'fitted to. The cross is four edges brought to the bottom face the right way up - and ' +
      '"the right way up" means the side sticker matches the centre it sits against, not just ' +
      'that the bottom sticker faces down. An edge that looks right from underneath and wrong ' +
      'from the side is the single most common false start on a cube.',
    lookFor:
      'One edge at a time. Find where it is, work out which face has to turn to bring it to the ' +
      'top above its slot, then turn that face twice to drop it in.',
    commonMistake:
      'Solving all four bottom stickers without checking the sides. Turn the cube over and look ' +
      'at the four side colours: each must line up with its centre.',
    algorithms: [],
    isComplete: (cube) => bottomEdges.every((edge) => edgeHome(cube, edge)),
  },
  {
    id: 'first-layer-corners',
    index: 1,
    title: 'First layer corners',
    goal: 'The bottom layer completely finished.',
    idea:
      'Bring the corner to the top, directly above the slot it belongs in, then repeat one ' +
      'four-move trio until it drops in the right way up. The trio lifts the corner out of the ' +
      'slot, turns it a third, and puts it back, so at most three repeats is enough. Everything ' +
      'else in the bottom layer is taken out and put back within the four moves, which is what ' +
      'makes it safe to repeat blindly.',
    lookFor:
      'The corner with the bottom colour on it. If it is already in a slot but the wrong way ' +
      'round, do the trio once to kick it out to the top first.',
    commonMistake:
      'Turning the whole cube between repeats. Keep the slot at the front-right and let the ' +
      'top layer do the moving.',
    algorithms: [
      {
        name: 'The trio',
        notation: "R U R' U'",
        effect: 'Takes the front-right corner out of its slot, turns it, and puts it back.',
        why:
          "R lifts the slot to the top, U moves it aside, R' puts the column back, U' undoes " +
          'the aside. The corner comes back a third of a turn different; everything else comes ' +
          'back exactly as it was.',
      },
    ],
    isComplete: (cube) =>
      bottomEdges.every((edge) => edgeHome(cube, edge)) &&
      bottomCorners.every((corner) => cornerHome(cube, corner)),
  },
  {
    id: 'middle-layer',
    index: 2,
    title: 'Middle layer',
    goal: 'The bottom two layers finished, leaving only the top.',
    idea:
      'Four edges, no corners - the middle layer has no corners of its own. Each edge is sitting ' +
      'in the top layer with neither of its colours on top matching the top centre. Line its ' +
      'front colour up with the front centre, then send it left or right depending on which way ' +
      'it needs to go.',
    lookFor:
      'A top-layer edge with no top colour on it. The colour on its side tells you which face to ' +
      'line it up with; the colour on top tells you which way it goes.',
    commonMistake:
      'An edge already in the middle layer but the wrong way round. Use the insert to eject it ' +
      'first, then put it back properly - there is no shortcut.',
    algorithms: [
      {
        name: 'Right-hand insert',
        notation: "U R U' R' U' F' U F",
        effect: 'Sends the edge from the top-front into the front-right slot.',
        why:
          'The first half empties the slot upwards; the second half brings the edge down into ' +
          'it while the piece that was there returns to the top.',
      },
      {
        name: 'Left-hand insert',
        notation: "U' L' U L U F U' F'",
        effect: 'Sends the edge from the top-front into the front-left slot.',
        why: 'The mirror image of the right-hand insert. Same idea, other hand.',
      },
    ],
    isComplete: (cube) =>
      bottomEdges.every((edge) => edgeHome(cube, edge)) &&
      bottomCorners.every((corner) => cornerHome(cube, corner)) &&
      middleEdges.every((edge) => edgeHome(cube, edge)),
  },
  {
    id: 'top-cross',
    index: 3,
    title: 'The top cross',
    goal: 'The four top edges facing up, wherever they happen to be.',
    idea:
      'From here on the bottom two layers are finished and every algorithm has to put them back ' +
      'the way it found them. This one turns the top edges the right way up without caring where ' +
      'they are. There are only three cases and they run into each other: a dot becomes an L, an ' +
      'L becomes a line, a line becomes the cross.',
    lookFor:
      'The shape the top colour makes on the top face. A dot, an L, or a line. Hold an L at the ' +
      'back-left and a line across from left to right.',
    commonMistake:
      'Trying to match the side colours at this stage. Ignore them completely - only the top ' +
      'face matters here.',
    algorithms: [
      {
        name: 'The edge flipper',
        notation: "F R U R' U' F'",
        effect: 'Turns some of the top edges the right way up.',
        why:
          'The middle three moves are the same trio used on the corners. Wrapping them in F and ' +
          "F' aims that trio at the top edges instead of a corner slot.",
      },
    ],
    isComplete: (cube) => topEdges.every((edge) => cube.eo[edge] === 0),
  },
  {
    id: 'top-corner-positions',
    index: 4,
    title: 'Top corners into place',
    goal: 'Every top corner in the right spot, regardless of which way it faces.',
    idea:
      'Position first, orientation second, and that order is not a matter of taste: the ' +
      'three-cycle used here twists the corners it moves, so turning them the right way up first ' +
      'would immediately undo the work. A corner is in the right spot when its three colours ' +
      'match the three faces meeting at that corner, in any arrangement.',
    lookFor:
      'A corner whose three colours belong where it is sitting, even if scrambled. There is ' +
      'almost always one; hold it at the back-right and cycle the other three.',
    commonMistake:
      'Checking whether the top colour is on top. It does not matter yet, and looking at it ' +
      'makes the case much harder to read.',
    algorithms: [
      {
        name: 'Corner three-cycle',
        notation: "U R U' L' U R' U' L",
        effect: 'Moves three top corners round, leaving the fourth where it is.',
        why:
          'R and L work on opposite sides, so the U turns between them affect one and not the ' +
          'other. That asymmetry is what turns two mirrored move pairs into a three-cycle.',
      },
      {
        name: 'T-perm',
        notation: "R U R' U' R' F R2 U' R' U' R U R' F'",
        effect: 'Swaps two neighbouring corners, and two edges with them.',
        why:
          'Needed when the corners are in an arrangement no three-cycle can reach. Swapping a ' +
          'single pair is an odd rearrangement, and three-cycles are even.',
      },
    ],
    isComplete: (cube) => topCorners.every((corner) => cube.cp[corner] === corner),
  },
  {
    id: 'top-corner-orientations',
    index: 5,
    title: 'Turning the top corners',
    goal: 'Every top corner facing up, still in the right spot.',
    idea:
      'The alarming one. Each corner is turned by repeating a short sequence that wrecks the ' +
      'bottom layer while it works, and the bottom layer comes back on its own by the time the ' +
      'last corner is done. It is not luck: the sequence returns to where it started after six ' +
      'repeats, each corner needs two or four, and the total across four corners is always a ' +
      'multiple of six because the total twist on a cube is always a multiple of three.',
    lookFor:
      'Keep the top layer facing you and never turn the cube over. Turn only the top layer ' +
      'between corners, and only after the corner in front of you is finished.',
    commonMistake:
      'Stopping when the bottom looks ruined. It is meant to. Carry on to the last corner and ' +
      'it comes back.',
    algorithms: [
      {
        name: 'The corner twister',
        notation: "R' D' R D",
        effect: 'Turns the top front-right corner by a third every two repeats, without moving it.',
        why:
          'It is a commutator: two moves, then their opposites in the other order. That shape ' +
          'always produces a small, local change and undoes everything else along the way.',
      },
    ],
    isComplete: (cube) =>
      topCorners.every((corner) => cornerHome(cube, corner)) &&
      bottomCorners.every((corner) => cornerHome(cube, corner)),
  },
  {
    id: 'top-edges',
    index: 6,
    title: 'The last four edges',
    goal: 'A solved cube: every face showing a single colour.',
    idea:
      'Everything except four edges is finished, and those four need cycling into place. Two ' +
      'algorithms, mirror images of each other, one for each direction. If no edge is already ' +
      'correct, run either one once and one will be.',
    lookFor:
      'An edge whose side colour already matches its centre. Hold it at the back and cycle the ' +
      'other three.',
    commonMistake:
      'Running the algorithm from the wrong angle. Find the finished edge first, then hold it ' +
      'at the back before starting.',
    algorithms: [
      {
        name: 'Ua-perm',
        notation: "R U' R U R U R U' R' U' R2",
        effect: 'Cycles three top edges one way, touching nothing else.',
        why:
          'Every move is on the R and U faces, and they undo each other except for the effect on ' +
          'three edges - which is what a well-chosen sequence of a dozen moves can be made to do.',
      },
      {
        name: 'Ub-perm',
        notation: "R2 U R U R' U' R' U' R' U R'",
        effect: 'The same three-cycle, the other way round.',
        why: 'The inverse of the Ua-perm, written out forwards.',
      },
    ],
    isComplete: (cube) => cube.isSolved(),
  },
];

export const LESSON_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

/** Every algorithm in the curriculum, parsed. Used by the tests to check them. */
export function algorithmMoves(algorithm: Algorithm): Move[] {
  return parseSequence(algorithm.notation);
}

/** The first lesson whose goal is not yet met, or null when the cube is solved. */
export function currentLesson(cube: Cube): Lesson | null {
  for (const lesson of LESSONS) {
    if (!lesson.isComplete(cube)) return lesson;
  }
  return null;
}
