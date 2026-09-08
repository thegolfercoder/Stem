/**
 * Facelets: the 54 stickers, and the conversion to and from cubie state.
 *
 * The renderer and the "type in a scramble you have in your hand" feature both
 * work in stickers; the solver works in cubies. This is the only place the two
 * meet.
 *
 * Facelet indices run U0..U8, R9..R17, F18..F26, D27..D35, L36..L44, B45..B53,
 * each face read left to right, top to bottom, as you look at that face with
 * the standard orientation (U on top, F towards you).
 */

import { Cube, Corner, Edge, InvalidCubeError } from './cube.js';

export const COLOURS = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Colour = (typeof COLOURS)[number];

export const FACELET_COUNT = 54;

/** The three facelets of each corner position, in the cubie's own order. */
export const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20], // URF: U9, R1, F3
  [6, 18, 38], // UFL: U7, F1, L3
  [0, 36, 47], // ULB: U1, L1, B3
  [2, 45, 11], // UBR: U3, B1, R3
  [29, 26, 15], // DFR: D3, F9, R7
  [27, 44, 24], // DLF: D1, L9, F7
  [33, 53, 42], // DBL: D7, B9, L7
  [35, 17, 51], // DRB: D9, R9, B7
];

/** The two facelets of each edge position. */
export const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [5, 10], // UR: U6, R2
  [7, 19], // UF: U8, F2
  [3, 37], // UL: U4, L2
  [1, 46], // UB: U2, B2
  [32, 16], // DR: D6, R8
  [28, 25], // DF: D2, F8
  [30, 43], // DL: D4, L8
  [34, 52], // DB: D8, B8
  [23, 12], // FR: F6, R4
  [21, 41], // FL: F4, L6
  [50, 39], // BL: B6, L4
  [48, 14], // BR: B4, R6
];

/** The colours a solved corner shows, in the cubie's own order. */
export const CORNER_COLOURS: readonly (readonly [Colour, Colour, Colour])[] = [
  ['U', 'R', 'F'],
  ['U', 'F', 'L'],
  ['U', 'L', 'B'],
  ['U', 'B', 'R'],
  ['D', 'F', 'R'],
  ['D', 'L', 'F'],
  ['D', 'B', 'L'],
  ['D', 'R', 'B'],
];

export const EDGE_COLOURS: readonly (readonly [Colour, Colour])[] = [
  ['U', 'R'],
  ['U', 'F'],
  ['U', 'L'],
  ['U', 'B'],
  ['D', 'R'],
  ['D', 'F'],
  ['D', 'L'],
  ['D', 'B'],
  ['F', 'R'],
  ['F', 'L'],
  ['B', 'L'],
  ['B', 'R'],
];

/** Which face each facelet belongs to. Centres are indices 4, 13, 22, 31, 40, 49. */
export function faceOfFacelet(index: number): Colour {
  const face = COLOURS[Math.trunc(index / 9)];
  if (face === undefined) throw new Error(`facelet ${index} is out of range`);
  return face;
}

/** Render a cube state as a 54-character facelet string. */
export function toFacelets(cube: Cube): string {
  const stickers = new Array<Colour>(FACELET_COUNT);

  for (let face = 0; face < 6; face++) {
    const colour = COLOURS[face];
    if (colour === undefined) continue;
    stickers[face * 9 + 4] = colour;
  }

  for (let position = 0; position < 8; position++) {
    const cubie = cube.cp[position] as Corner;
    const twist = cube.co[position] as number;
    const facelets = CORNER_FACELETS[position];
    const colours = CORNER_COLOURS[cubie];
    if (!facelets || !colours) continue;
    for (let i = 0; i < 3; i++) {
      const target = facelets[(i + twist) % 3];
      const colour = colours[i];
      if (target !== undefined && colour !== undefined) stickers[target] = colour;
    }
  }

  for (let position = 0; position < 12; position++) {
    const cubie = cube.ep[position] as Edge;
    const flip = cube.eo[position] as number;
    const facelets = EDGE_FACELETS[position];
    const colours = EDGE_COLOURS[cubie];
    if (!facelets || !colours) continue;
    for (let i = 0; i < 2; i++) {
      const target = facelets[(i + flip) % 2];
      const colour = colours[i];
      if (target !== undefined && colour !== undefined) stickers[target] = colour;
    }
  }

  return stickers.join('');
}

/**
 * Read a 54-character facelet string back into a cube state.
 *
 * Throws with a specific reason rather than a generic failure, because this is
 * the function a person hits when they have typed their cube in by hand and got
 * one sticker wrong, and "invalid cube" is not a message anybody can act on.
 */
export function fromFacelets(input: string): Cube {
  const text = input.replace(/\s+/g, '').toUpperCase();
  if (text.length !== FACELET_COUNT) {
    throw new InvalidCubeError(`expected ${FACELET_COUNT} facelets, got ${text.length}`);
  }

  const stickers: Colour[] = [];
  for (const character of text) {
    if (!(COLOURS as readonly string[]).includes(character)) {
      throw new InvalidCubeError(`${character} is not one of ${COLOURS.join('')}`);
    }
    stickers.push(character as Colour);
  }

  const counts = new Map<Colour, number>();
  for (const sticker of stickers) counts.set(sticker, (counts.get(sticker) ?? 0) + 1);
  for (const colour of COLOURS) {
    const count = counts.get(colour) ?? 0;
    if (count !== 9) throw new InvalidCubeError(`${colour} appears ${count} times, not 9`);
  }

  for (let face = 0; face < 6; face++) {
    const centre = stickers[face * 9 + 4];
    const expected = COLOURS[face];
    if (centre !== expected) {
      throw new InvalidCubeError(
        `the ${expected} centre shows ${centre}; the cube must be held with U up and F towards you`,
      );
    }
  }

  const cp = new Uint8Array(8);
  const co = new Uint8Array(8);
  for (let position = 0; position < 8; position++) {
    const facelets = CORNER_FACELETS[position];
    if (!facelets) continue;

    // The U or D sticker tells us how the corner is twisted.
    let twist = 0;
    for (; twist < 3; twist++) {
      const index = facelets[twist];
      if (index === undefined) continue;
      const colour = stickers[index];
      if (colour === 'U' || colour === 'D') break;
    }
    if (twist === 3) {
      throw new InvalidCubeError(
        `the corner at ${position} shows no ${'U'} or ${'D'} sticker, so it cannot be placed`,
      );
    }

    const a = stickers[facelets[twist % 3] as number] as Colour;
    const b = stickers[facelets[(twist + 1) % 3] as number] as Colour;
    const c = stickers[facelets[(twist + 2) % 3] as number] as Colour;

    const cubie = CORNER_COLOURS.findIndex(
      (colours) => colours[0] === a && colours[1] === b && colours[2] === c,
    );
    if (cubie < 0) {
      throw new InvalidCubeError(`no corner has the colours ${a}${b}${c}`);
    }
    cp[position] = cubie;
    co[position] = twist % 3;
  }

  const ep = new Uint8Array(12);
  const eo = new Uint8Array(12);
  for (let position = 0; position < 12; position++) {
    const facelets = EDGE_FACELETS[position];
    if (!facelets) continue;
    const first = stickers[facelets[0]] as Colour;
    const second = stickers[facelets[1]] as Colour;

    let found = -1;
    let flip = 0;
    for (let cubie = 0; cubie < 12; cubie++) {
      const colours = EDGE_COLOURS[cubie];
      if (!colours) continue;
      if (colours[0] === first && colours[1] === second) {
        found = cubie;
        flip = 0;
        break;
      }
      if (colours[0] === second && colours[1] === first) {
        found = cubie;
        flip = 1;
        break;
      }
    }
    if (found < 0) throw new InvalidCubeError(`no edge has the colours ${first}${second}`);
    ep[position] = found;
    eo[position] = flip;
  }

  const cube = new Cube(cp, co, ep, eo);
  cube.assertSolvable();
  return cube;
}
