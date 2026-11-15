/**
 * Tunes the book to an exact page count.
 *
 * Pages rise by about 35 per extra exercise per template and by under one per
 * mixed-review exercise, so: fix PER_GEN just below the target, then binary
 * search MIXED for the smallest value that reaches the target, and confirm
 * with two full LaTeX passes so the table of contents is settled.
 */
import { execSync } from "node:child_process";

const TARGET = Number(process.env.TARGET ?? 2000);
const PER_GEN = Number(process.env.PER_GEN ?? 44);

function build(mixed: number, passes = 1): number {
  execSync(`PER_GEN=${PER_GEN} MIXED=${mixed} npx tsx scripts/book/build-book.ts`, { stdio: "ignore" });
  for (let i = 0; i < passes; i++) {
    execSync("pdflatex -interaction=nonstopmode -halt-on-error main.tex", { cwd: "book", stdio: "ignore", timeout: 1800_000 });
  }
  const info = execSync("pdfinfo main.pdf", { cwd: "book" }).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  console.log(`MIXED=${mixed} passes=${passes} -> ${pages} pages`);
  return pages;
}

let lo = 0;
let hi = 400;
// Settle the table of contents with the mixed chapter present.
let p = build(hi, 2);
while (p < TARGET) {
  lo = hi;
  hi *= 2;
  p = build(hi);
}
// Smallest MIXED with pages >= TARGET, by bisection.
while (hi - lo > 1) {
  const mid = Math.floor((lo + hi) / 2);
  if (build(mid) >= TARGET) hi = mid;
  else lo = mid;
}
let final = build(hi, 2);
// If a page break jumped past the target, step down until it lands.
let m = hi;
while (final !== TARGET && m > 0 && final > TARGET) {
  m -= 1;
  final = build(m, 2);
}
console.log(final === TARGET ? `EXACT: ${final} pages with PER_GEN=${PER_GEN}, MIXED=${m}` : `MISSED: ${final} pages`);
process.exit(final === TARGET ? 0 : 1);
