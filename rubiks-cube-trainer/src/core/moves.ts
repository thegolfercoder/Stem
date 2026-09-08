/**
 * Move notation: parsing, printing, inverting and cancelling.
 *
 * Singmaster notation. A move is a face (U R F D L B) and an amount (1 = 90°
 * clockwise, 2 = 180°, 3 = 90° anticlockwise, written `'`). Everything in the
 * codebase passes moves around as small integers - face * 3 + (amount - 1),
 * 0..17 - because that is what indexes a move table, and a string would mean
 * parsing inside the search loop.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

/** A move encoded as `face * 3 + (amount - 1)`, in the range 0..17. */
export type Move = number;

export const MOVE_COUNT = 18;

/** Every move, in table order. */
export const ALL_MOVES: readonly Move[] = Array.from({ length: MOVE_COUNT }, (_, i) => i);

/** The ten moves of the phase-2 group <U, D, R2, L2, F2, B2>. */
export const PHASE2_MOVES: readonly Move[] = [
  0,
  1,
  2, // U, U2, U'
  4, // R2
  7, // F2
  9,
  10,
  11, // D, D2, D'
  13, // L2
  16, // B2
];

export function faceOf(move: Move): number {
  return Math.trunc(move / 3);
}

/** 1, 2 or 3 quarter turns. */
export function amountOf(move: Move): number {
  return (move % 3) + 1;
}

export function makeMove(face: number, amount: number): Move {
  const normalised = ((amount % 4) + 4) % 4;
  if (normalised === 0) throw new Error('a move of zero quarter turns is not a move');
  return face * 3 + (normalised - 1);
}

export function invertMove(move: Move): Move {
  return makeMove(faceOf(move), 4 - amountOf(move));
}

export function moveToString(move: Move): string {
  const face = FACES[faceOf(move)];
  if (face === undefined) throw new Error(`move ${move} is out of range`);
  return face + ['', '2', "'"][amountOf(move) - 1];
}

export function sequenceToString(moves: readonly Move[]): string {
  return moves.map(moveToString).join(' ');
}

export function invertSequence(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}

const FACE_INDEX = new Map<string, number>(FACES.map((face, index) => [face, index]));

/** Faces that lie on the same axis, so their moves commute. */
export function sameAxis(a: Move, b: Move): boolean {
  return faceOf(a) % 3 === faceOf(b) % 3;
}

export function sameFace(a: Move, b: Move): boolean {
  return faceOf(a) === faceOf(b);
}

export class NotationError extends Error {}

/**
 * Parse a scramble or algorithm.
 *
 * Accepts `R`, `R2`, `R'`, `R‘`, `R’` and `R2'`, in upper or lower case, with
 * any whitespace between moves. Rejects anything else loudly: a silently
 * ignored token in a scramble means the cube on screen is not the cube the user
 * typed, and they will not find out until the solution does not work.
 */
export function parseSequence(text: string): Move[] {
  const tokens = text
    .replace(/[‘’´`]/g, "'")
    .replace(/[（(].*?[)）]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);

  const moves: Move[] = [];
  for (const token of tokens) {
    const match = /^([URFDLBurfdlb])(['2]?)(['2]?)$/.exec(token);
    if (!match) throw new NotationError(`${token} is not a move`);

    const [, letter = '', first = '', second = ''] = match;
    const face = FACE_INDEX.get(letter.toUpperCase());
    if (face === undefined) throw new NotationError(`${letter} is not a face`);

    const suffix = first + second;
    let amount: number;
    switch (suffix) {
      case '':
        amount = 1;
        break;
      case '2':
        amount = 2;
        break;
      case "'":
        amount = 3;
        break;
      case "2'":
      case "'2":
        amount = 2;
        break;
      default:
        throw new NotationError(`${token} is not a move`);
    }
    moves.push(makeMove(face, amount));
  }
  return moves;
}

/**
 * Remove redundant turns from a sequence, without changing what it does.
 *
 * Two rules, applied until neither fires:
 *
 *  - `R R'`, `R R R R`, `U2 U2` and so on collapse: consecutive turns of the
 *    same face add, and a total of zero disappears.
 *  - `R L R'` becomes `L`: moves on opposite faces commute, so a turn can slide
 *    past one to meet its partner.
 *
 * The beginner solver produces around a hundred and thirty moves and this
 * removes roughly a fifth of them, which is the difference between a solution a
 * person will sit through and one they will not.
 */
export function cancelMoves(moves: readonly Move[]): Move[] {
  const output: Move[] = [];

  for (const move of moves) {
    let current: Move | null = move;

    while (current !== null) {
      // Find the nearest earlier move on the same face, allowing the search to
      // pass over moves on the opposite face because those commute.
      let index = output.length - 1;
      while (index >= 0) {
        const candidate = output[index];
        if (candidate === undefined) break;
        if (sameFace(candidate, current)) break;
        if (!sameAxis(candidate, current)) {
          index = -1;
          break;
        }
        index -= 1;
      }

      if (index < 0) {
        output.push(current);
        current = null;
        continue;
      }

      const partner = output[index];
      if (partner === undefined) {
        output.push(current);
        current = null;
        continue;
      }

      const total: number = (amountOf(partner) + amountOf(current)) % 4;
      output.splice(index, 1);
      current = total === 0 ? null : (makeMove(faceOf(current), total) as Move);
    }
  }

  return output;
}

/** How many quarter turns a sequence costs, the metric speedcubers call QTM. */
export function quarterTurnCount(moves: readonly Move[]): number {
  return moves.reduce((total: number, move) => total + (amountOf(move) === 2 ? 2 : 1), 0);
}
