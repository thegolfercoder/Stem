/**
 * Where the stickers are.
 *
 * Checked by agreement rather than by eye: a corner's three stickers have to
 * land on the same cubie, an edge's two likewise, and every cubie has to end up
 * with exactly as many stickers as its position allows. A face read in the
 * wrong order passes none of these and looks perfectly fine on a solved cube.
 */

import { describe, expect, it } from 'vitest';

import { CORNER_FACELETS, EDGE_FACELETS } from '../src/core/facelets.js';
import {
  FACE_NORMALS,
  cubiePositions,
  moveFromDrag,
  placeSticker,
  positionKey,
} from '../src/ui/geometry.js';
import { moveToString } from '../src/core/moves.js';

describe('sticker placement', () => {
  it('places all 54 stickers on the 26 visible cubies', () => {
    const counts = new Map<string, number>();
    for (let index = 0; index < 54; index++) {
      const key = positionKey(placeSticker(index).position);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(26);

    // A corner shows three stickers, an edge two, a centre one.
    const histogram = new Map<number, number>();
    for (const count of counts.values()) histogram.set(count, (histogram.get(count) ?? 0) + 1);
    expect(histogram.get(3)).toBe(8);
    expect(histogram.get(2)).toBe(12);
    expect(histogram.get(1)).toBe(6);
  });

  it('puts a corner’s three stickers on one cubie', () => {
    for (const facelets of CORNER_FACELETS) {
      const keys = facelets.map((index) => positionKey(placeSticker(index).position));
      expect(new Set(keys).size, `corner ${facelets.join(',')}`).toBe(1);
      // And on three different faces.
      expect(new Set(facelets.map((index) => placeSticker(index).face)).size).toBe(3);
    }
  });

  it('puts an edge’s two stickers on one cubie', () => {
    for (const facelets of EDGE_FACELETS) {
      const keys = facelets.map((index) => positionKey(placeSticker(index).position));
      expect(new Set(keys).size, `edge ${facelets.join(',')}`).toBe(1);
      expect(new Set(facelets.map((index) => placeSticker(index).face)).size).toBe(2);
    }
  });

  it('puts every centre in the middle of its own face', () => {
    for (let face = 0; face < 6; face++) {
      const placement = placeSticker(face * 9 + 4);
      expect(placement.position).toEqual(FACE_NORMALS[face]);
      expect(placement.normal).toEqual(FACE_NORMALS[face]);
    }
  });

  it('always points a sticker outwards along its own face', () => {
    for (let index = 0; index < 54; index++) {
      const { position, normal } = placeSticker(index);
      const along = position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
      expect(along).toBe(1);
    }
  });

  it('lists 26 cubies and no centre of the cube', () => {
    const positions = cubiePositions();
    expect(positions).toHaveLength(26);
    expect(positions.some(([x, y, z]) => x === 0 && y === 0 && z === 0)).toBe(false);
  });

  it('rejects a facelet outside the cube', () => {
    expect(() => placeSticker(54)).toThrow(/out of range/);
  });
});

describe('turning a drag into a move', () => {
  it('maps each axis and layer to the right face', () => {
    expect(moveToString(moveFromDrag([1, 0, 0], [1, 0, 0]) as number)).toBe('R');
    expect(moveToString(moveFromDrag([-1, 0, 0], [1, 0, 0]) as number)).toBe("R'");
    expect(moveToString(moveFromDrag([0, 1, 0], [0, 1, 0]) as number)).toBe('U');
    expect(moveToString(moveFromDrag([0, -1, 0], [0, 1, 0]) as number)).toBe("U'");
    expect(moveToString(moveFromDrag([0, 0, 1], [0, 0, 1]) as number)).toBe('F');
    expect(moveToString(moveFromDrag([0, 0, -1], [0, 0, 1]) as number)).toBe("F'");
  });

  it('turns a far-side layer the opposite way to the near one', () => {
    // Clockwise about +x is R on the near side and L-prime on the far side:
    // the same physical rotation, opposite notation.
    expect(moveToString(moveFromDrag([1, 0, 0], [-1, 0, 0]) as number)).toBe("L'");
    expect(moveToString(moveFromDrag([0, 1, 0], [0, -1, 0]) as number)).toBe("D'");
    expect(moveToString(moveFromDrag([0, 0, 1], [0, 0, -1]) as number)).toBe("B'");
    expect(moveToString(moveFromDrag([-1, 0, 0], [-1, 0, 0]) as number)).toBe('L');
    expect(moveToString(moveFromDrag([0, -1, 0], [0, -1, 0]) as number)).toBe('D');
    expect(moveToString(moveFromDrag([0, 0, -1], [0, 0, -1]) as number)).toBe('B');
  });

  it('refuses a middle slice, which this cube has no notation for', () => {
    expect(moveFromDrag([1, 0, 0], [0, 1, 0])).toBeNull();
    expect(moveFromDrag([0, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('takes the dominant axis of an imprecise drag', () => {
    expect(moveToString(moveFromDrag([0.9, 0.1, -0.2], [1, 0, 0]) as number)).toBe('R');
  });
});
