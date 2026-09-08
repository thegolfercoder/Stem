/**
 * Where each sticker lives in space.
 *
 * The facelet string numbers the stickers 0 to 53, nine per face, read as you
 * look at that face with U on top and F towards you. This module turns that
 * into a lattice position and an outward normal, which is what the renderer
 * needs and what the pointer controls need to work backwards from.
 *
 * The mapping is the fiddly part of drawing a cube and the easy thing to get
 * subtly wrong - a face read in the wrong order looks fine on a solved cube and
 * mirrors itself the moment anything moves. `tests/geometry.test.ts` checks it
 * by agreement instead of by eye: the three stickers of a corner must all land
 * on the same cubie, and so must the two of an edge.
 */

export type Axis = 'x' | 'y' | 'z';

export interface StickerPlacement {
  /** Lattice position, each component -1, 0 or 1. */
  readonly position: readonly [number, number, number];
  /** Outward normal, a unit vector along one axis. */
  readonly normal: readonly [number, number, number];
  readonly face: number;
}

/** Outward normal of each face, in the order U R F D L B. */
export const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0], // U
  [1, 0, 0], // R
  [0, 0, 1], // F
  [0, -1, 0], // D
  [-1, 0, 0], // L
  [0, 0, -1], // B
];

/**
 * Turn a facelet index into a place in space.
 *
 * Each face is read left to right, top to bottom, from outside that face with
 * U up - except U and D, which have no "up" of their own and are read with F
 * towards the viewer. That convention is where the two special cases below
 * come from.
 */
export function placeSticker(index: number): StickerPlacement {
  const face = Math.trunc(index / 9);
  const cell = index % 9;
  const row = Math.trunc(cell / 3);
  const column = cell % 3;

  let position: [number, number, number];
  switch (face) {
    case 0: // U: rows run back to front, columns left to right
      position = [column - 1, 1, row - 1];
      break;
    case 1: // R: seen from +x, F on the left
      position = [1, 1 - row, 1 - column];
      break;
    case 2: // F: seen from +z, L on the left
      position = [column - 1, 1 - row, 1];
      break;
    case 3: // D: rows run front to back
      position = [column - 1, -1, 1 - row];
      break;
    case 4: // L: seen from -x, B on the left
      position = [-1, 1 - row, column - 1];
      break;
    case 5: // B: seen from -z, R on the left
      position = [1 - column, 1 - row, -1];
      break;
    default:
      throw new Error(`facelet ${index} is out of range`);
  }

  const normal = FACE_NORMALS[face];
  if (normal === undefined) throw new Error(`facelet ${index} is out of range`);
  return { position, normal, face };
}

/** Every visible cubie's lattice position: 3x3x3 without the hidden centre. */
export function cubiePositions(): [number, number, number][] {
  const positions: [number, number, number][] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        positions.push([x, y, z]);
      }
    }
  }
  return positions;
}

export const positionKey = (position: readonly [number, number, number]): string =>
  position.join(',');

/**
 * Which move a drag on a face amounts to.
 *
 * `axis` is the rotation axis the drag implies, found from the cross product of
 * the drag direction and the face normal, and the turn is always clockwise seen
 * from the positive end of that axis. A layer on the negative side of the cube
 * therefore turns the *opposite* way to its own face's notation, which is why
 * half the entries below carry a prime.
 */
export function moveFromDrag(
  axis: readonly [number, number, number],
  cubie: readonly [number, number, number],
): number | null {
  const dominant = [Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2])];
  const which = dominant.indexOf(Math.max(...dominant));
  const sign = Math.sign(axis[which] ?? 0);
  if (sign === 0) return null;

  const layer = cubie[which] ?? 0;
  if (layer === 0) return null; // a middle slice: this cube has no notation for it

  // Face numbers: U 0, R 1, F 2, D 3, L 4, B 5.
  const positiveFace = [1, 0, 2][which] as number; // x -> R, y -> U, z -> F
  const negativeFace = [4, 3, 5][which] as number; // x -> L, y -> D, z -> B

  const face = layer > 0 ? positiveFace : negativeFace;
  // Clockwise about the positive axis matches the positive face's own notation
  // and opposes the negative face's.
  const clockwise = sign > 0 ? layer > 0 : layer < 0;
  return face * 3 + (clockwise ? 0 : 2);
}
