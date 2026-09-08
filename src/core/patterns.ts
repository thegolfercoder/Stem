/**
 * Named patterns.
 *
 * Every one is a short sequence from a solved cube, and each is worth a look
 * for a different reason: the superflip is the hardest position there is, the
 * checkerboard is three commuting double turns, and the cube-in-a-cube is the
 * clearest demonstration that a cube's structure is not what it looks like.
 */

import type { Move } from './moves.js';
import { parseSequence } from './moves.js';

export interface Pattern {
  readonly id: string;
  readonly name: string;
  readonly notation: string;
  readonly note: string;
}

export const PATTERNS: readonly Pattern[] = [
  {
    id: 'checkerboard',
    name: 'Checkerboard',
    notation: 'U2 D2 F2 B2 L2 R2',
    note:
      'Six double turns, one per face, and every face comes out chequered. They all commute, ' +
      'so the order does not matter - try them in any sequence you like.',
  },
  {
    id: 'superflip',
    name: 'Superflip',
    notation: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2",
    note:
      'Every edge flipped in place, nothing else moved. It needs twenty moves to solve and ' +
      'nothing needs more - it was one of the first positions proved to sit at that distance.',
  },
  {
    id: 'cube-in-a-cube',
    name: 'Cube in a cube',
    notation: "F L F U' R U F2 L2 U' L' B D' B' L2 U",
    note: 'A smaller cube apparently nested in the corner of the larger one.',
  },
  {
    id: 'cube-in-a-cube-in-a-cube',
    name: 'Cube in a cube in a cube',
    notation: "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'",
    note: 'The same illusion twice over, one nested cube inside another inside the whole.',
  },
  {
    id: 'six-spots',
    name: 'Six spots',
    notation: "U D' R L' F B' U D'",
    note:
      'Every centre showing a different colour to its face. On a cube with fixed centres this ' +
      'is impossible - which is a good way to notice that the centres here are not fixed.',
  },
  {
    id: 'anaconda',
    name: 'Anaconda',
    notation: "L U B' U' R L' B R' F B' D R D' F'",
    note: 'A single band of colour winding all the way round the cube without a break.',
  },
  {
    id: 'four-crosses',
    name: 'Four crosses',
    notation: "U F2 L2 B2 R2 D' L2 U2 R2 U2 F2 U2 F2 U2 R2 U2 L2 D2 F2 R2 U2",
    note: 'Crosses on four of the six faces.',
  },
  {
    id: 'four-spots',
    name: 'Four spots',
    notation: "F2 B2 U D' R2 L2 U D'",
    note:
      'Four faces solid in the wrong colour, each with a single dot of its own colour in the ' +
      'middle. The two faces left alone are the ones the sequence never turns on their own.',
  },
];

export function patternMoves(pattern: Pattern): Move[] {
  return parseSequence(pattern.notation);
}
