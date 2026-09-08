/**
 * Colour schemes.
 *
 * The standard scheme puts red next to orange, which about one man in twelve
 * cannot reliably tell apart. That is not a small share of the people who might
 * use this, so there is a second scheme that separates every pair by hue as
 * well as by lightness, and a third that labels each sticker with its face
 * letter for anyone who would rather not rely on colour at all.
 */

export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  /** Sticker colours in face order: U R F D L B. */
  readonly colours: readonly [string, string, string, string, string, string];
  readonly showLetters: boolean;
}

export const PALETTES: readonly Palette[] = [
  {
    id: 'standard',
    name: 'Standard',
    note: 'The colours on a shop-bought cube.',
    colours: ['#f5f5f0', '#c0392b', '#27923f', '#f2c31a', '#e8730c', '#1f5fbf'],
    showLetters: false,
  },
  {
    id: 'distinct',
    name: 'High contrast',
    note: 'Red and orange replaced by hues that stay apart for red-green colour blindness.',
    colours: ['#f7f7f2', '#d81b60', '#00897b', '#fdd835', '#fb8c00', '#1e88e5'],
    showLetters: false,
  },
  {
    id: 'lettered',
    name: 'Lettered',
    note: 'Every sticker carries its face letter, so colour is never the only cue.',
    colours: ['#f7f7f2', '#d81b60', '#00897b', '#fdd835', '#fb8c00', '#1e88e5'],
    showLetters: true,
  },
];

export const DEFAULT_PALETTE = PALETTES[0] as Palette;

export function paletteById(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? DEFAULT_PALETTE;
}
