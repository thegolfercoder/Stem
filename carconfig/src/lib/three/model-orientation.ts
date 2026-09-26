/**
 * Which way a downloaded car model faces.
 *
 * Models arrive facing whichever way their author built them. Once the
 * viewer has the car's length along z it still has to pick the end that is
 * the front, and the only thing a model reliably says about that is what its
 * parts are called: headlights, a grille and the steering wheel sit toward
 * the front; taillights, the exhaust and the boot toward the back.
 */

export interface NamedPart {
  /** Mesh, parent and material names, split into words ("head light glass"). */
  readonly label: string;
  /** Position along the car's length, as a fraction of it: −0.5 to 0.5. */
  readonly along: number;
}

const FRONT: readonly (readonly [RegExp, number])[] = [
  [/\b(head ?lights?|head ?lamps?|headlamps?)\b/, 3],
  [/\bsteering\b/, 3],
  [/\b(grille?|grill|radiator)\b/, 2],
  [/\b(windshield|windscreen|wipers?|dashboard|dash)\b/, 2],
  [/\b(bonnet|hood|splitter)\b/, 1],
  [/\bfront\b/, 1],
];
const REAR: readonly (readonly [RegExp, number])[] = [
  [/\b(tail ?lights?|tail ?lamps?|taillamps?|brake ?lights?|reverse ?lights?)\b/, 3],
  [/\b(exhausts?|muffler|tailpipes?)\b/, 2],
  [/\b(trunk|boot|diffuser)\b/, 2],
  [/\b(rear|back)\b/, 1],
];

/**
 * +1 if the front is toward +along, −1 if toward −along, 0 if the names say
 * nothing (the model is left as its author oriented it).
 */
export function frontDirection(parts: readonly NamedPart[]): 1 | -1 | 0 {
  let vote = 0;
  for (const { label, along } of parts) {
    // Parts near the middle say nothing about which end is which.
    if (Math.abs(along) < 0.08) continue;
    const side = Math.sign(along);
    for (const [re, w] of FRONT) if (re.test(label)) vote += w * side;
    for (const [re, w] of REAR) if (re.test(label)) vote -= w * side;
  }
  return vote > 0 ? 1 : vote < 0 ? -1 : 0;
}
