/* This session in one card (#59): how consistent the golfer was, and which swings
 * were most and least like the rest.
 *
 * A session is the swings kept on the newest swing's day (the golfer's own day,
 * progress.js `localDay`) that can be compared with one another: the same club,
 * hand, orientation, camera angle and spot (practice.js `comparableSet`, with the
 * strictest metric, so every measure here may be compared). Below three of them
 * there is no summary.
 *
 * Spread is the interquartile range. Only tempo has a measured per-swing band
 * (±27% for 80% of held-out swings); a tempo spread inside it is measurement
 * noise, and tempo then takes no part in singling a swing out. The other measures
 * have no band, which the card says. Swings are "most" and "least typical",
 * never best or worst: none of these readings has a target.
 *
 * Pure, so node can test it; the page only places the result.
 */

import { comparableSet } from "./practice.js";
import { MEASURES, localDay } from "./progress.js";

export const MIN_SESSION = 3;

const finite = (x) => typeof x === "number" && Number.isFinite(x);

function quantile(sorted, p) {
  const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/* `input`: { swings (the practice log's), rules (payload.practice), band
 * (payload.calibration.tempo or null) }. Returns { enough, day, n, ids, measures,
 * typical, least } where `measures` hold { key, label, unit, digits, n, median,
 * q1, q3, iqr, band, withinNoise }, `typical` is { id } and `least` up to two
 * { id, furthestOn } (one when there are three swings), both null when nothing may
 * single a swing out. */
export function sessionSummary(input) {
  const read = (input.swings || []).filter((s) => s.ok && s.metrics).sort((a, b) => a.id - b.id);
  if (!read.length) return { enough: false, day: null, n: 0 };
  const day = localDay(read[read.length - 1].at);
  const newestFirst = read.filter((s) => localDay(s.at) === day).reverse();
  const points = newestFirst.map((s) => ({ swing_id: s.id, value: 0, handedness: String(s.handedness || ""),
                                           club: s.club || null, camera: s.camera || null }));
  const chosen = comparableSet(input.rules, points, "shoulder_turn_foreshortened", Infinity)
    .map((i) => newestFirst[i]).reverse();
  if (chosen.length < MIN_SESSION) return { enough: false, day, n: chosen.length };

  // The tempo band was measured on the model's positions on right-handed swings (#33, #50).
  const banded = input.band && chosen.every((s) => s.handedness !== "left" && !(s.positions_set_by_you > 0));
  const measures = MEASURES.map((m) => {
    const values = chosen.map((s) => s.metrics[m.key]).filter(finite).sort((a, b) => a - b);
    if (values.length < MIN_SESSION) return null;
    const median = quantile(values, 0.5), q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
    const band = m.key === "tempo_ratio" && banded ? Math.abs(median) * input.band.half_width_fraction : null;
    return { key: m.key, label: m.label, unit: m.unit, digits: m.digits, n: values.length, median, q1, q3,
             iqr: q3 - q1, band, withinNoise: band === null ? null : q3 - q1 <= 2 * band };
  }).filter(Boolean);

  // How far each swing sits from the session, in spreads, on what may single one out.
  const usable = measures.filter((m) => m.withinNoise !== true && m.iqr > 1e-12);
  let typical = null, least = null;
  if (usable.length) {
    const scored = chosen.map((s) => {
      const parts = usable.filter((m) => finite(s.metrics[m.key]))
        .map((m) => ({ key: m.key, label: m.label, z: Math.abs(s.metrics[m.key] - m.median) / m.iqr }));
      const score = parts.length ? parts.reduce((t, p) => t + p.z, 0) / parts.length : Infinity;
      const furthest = parts.reduce((a, b) => (b.z > (a ? a.z : -1) ? b : a), null);
      return { id: s.id, score, furthestOn: furthest ? furthest.label : null };
    }).filter((s) => finite(s.score)).sort((a, b) => a.score - b.score || a.id - b.id);
    if (scored.length >= MIN_SESSION) {
      typical = { id: scored[0].id };
      // Never every swing: with three, one is typical and one is least typical.
      const count = Math.min(2, scored.length - 2);
      least = scored.slice(-count).reverse().map(({ id, furthestOn }) => ({ id, furthestOn }));
    }
  }
  return { enough: true, day, n: chosen.length, ids: chosen.map((s) => s.id), measures, typical, least,
           rankedOn: usable.map((m) => m.label) };
}
