/**
 * Verifies every answer added in the content expansion against an
 * independent recomputation (see scripts/content-checks).
 */
import { TOPICS } from "../src/content/topics";
import { CHECKS, PROOFS } from "./content-checks/lib";
import "./content-checks/all";

let failures = 0;
const fail = (m: string) => {
  failures += 1;
  console.error(`  ✗ ${m}`);
};

const items = new Map<string, string>();
const extraIds = new Set<string>();
for (const t of TOPICS) {
  for (const e of [...t.examples, ...t.examQuestions]) items.set(e.id, e.answer);
}
// Every item whose id carries the expansion marker must be checked.
for (const id of items.keys()) if (/-x\d+$/.test(id)) extraIds.add(id);

function parse(text: string): number | null {
  const t = text.replace(/[−–]/g, "-").replace(/\s/g, "");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const f = t.match(/^(-?\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  return null;
}
function places(text: string): number {
  const m = text.match(/\.(\d+)/);
  return m ? m[1]!.length : 0;
}

const seen = new Set<string>();
for (const c of CHECKS) {
  if (seen.has(c.id)) fail(`${c.id}: checked twice`);
  seen.add(c.id);
  const answer = items.get(c.id);
  if (answer === undefined) {
    fail(`${c.id}: no such example or exam question`);
    continue;
  }
  for (const it of c.items) {
    if (!answer.includes(it.show)) fail(`${c.id}: answer does not contain "${it.show}"`);
    if (!Number.isFinite(it.want)) fail(`${c.id}: recomputed value for "${it.show}" is not finite`);
    const value = parse(it.show) ?? it.is;
    if (value === undefined) {
      fail(`${c.id}: "${it.show}" is not a plain number, so its value must be given`);
      continue;
    }
    const plain = parse(it.show) !== null;
    // A decimal shown to n places must be within half a unit in the last place.
    const tol = plain && /\./.test(it.show) ? 0.5 * 10 ** -places(it.show) + 1e-12 : 1e-9 * Math.max(1, Math.abs(it.want));
    // Three significant figures on a large number rounds in the integer part.
    const sigTol = plain && !/\./.test(it.show) && Math.abs(it.want - Math.round(it.want)) > 1e-9 ? 0.5 : 0;
    if (Math.abs(value - it.want) > Math.max(tol, sigTol)) {
      fail(`${c.id}: shows ${it.show} (= ${value}) but recomputes to ${it.want}`);
    }
  }
}
for (const id of extraIds) {
  if (!seen.has(id) && !PROOFS.has(id)) fail(`${id}: added answer has no independent check`);
}
for (const id of PROOFS.keys()) if (!items.has(id)) fail(`${id}: proof entry for a missing item`);

console.log("Independent verification of written answers");
console.log(`  ${CHECKS.length} answers recomputed, ${PROOFS.size} proofs or sketches`);
if (failures) {
  console.error(`FAILED — ${failures} problem${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("All written answers agree with their recomputation.");
