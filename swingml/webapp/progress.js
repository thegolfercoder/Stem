/* Progress over time in the browser page (#38): one small chart per measure, drawn
 * from the practice log kept in this browser.
 *
 * Each swing is a point. Swings filmed so that they cannot be compared with the
 * newest one (another club, hand, camera angle or spot: practice.js
 * `comparability`) are drawn hollow and left out of the session medians, which
 * are joined across sessions. Tempo carries its measured per-swing spread where
 * one applies. The tour readings sit behind as a labelled band, and a retest
 * verdict is marked where its last swing fell. Nothing here is new data: every
 * value is a stored reading, and every rule is practice.js's.
 *
 * Pure, so node can test the series; the page only places the SVG strings.
 */

import { comparability } from "./practice.js";

export const MEASURES = [
  { key: "tempo_ratio", label: "Tempo", unit: "backswing ÷ downswing", digits: 2 },
  { key: "head_movement", label: "Head movement", unit: "body lengths, address to impact", digits: 3 },
  { key: "pelvis_sway", label: "Pelvis sway", unit: "body lengths", digits: 3 },
  { key: "shoulder_turn_foreshortened", label: "Shoulder turn", unit: "° at the top, as the camera sees it",
    digits: 1 },
];

export const MIN_SWINGS = 3;

const VERDICT_LABELS = {
  improved: "moved the drill's way",
  worsened: "moved the other way",
  no_detectable_change: "no detectable change",
};

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const TEMPO_EVENTS = [0, 3, 5];

/* The golfer's own calendar day for a stored UTC time (#69): an evening session
 * west of UTC, or a morning one east of it, crosses UTC midnight but is one day. */
export function localDay(at) {
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return (at || "").slice(0, 10);
  const two = (n) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* `input`:
 *   swings    the practice log's swings ({ id, at, ok, metrics, handedness, club, camera,
 *             positions_set_by_you })
 *   verdicts  [{ plan, change }] for plans with a retest verdict (practice.js planChange)
 *   rules     payload.practice
 *   band      payload.calibration.tempo, or null
 * Returns { enough, swings, measures: [{ key, label, unit, digits, points, sessions,
 * reference, verdicts }] }, measures in MEASURES order. */
export function progressSeries(input) {
  const { rules } = input;
  const read = (input.swings || []).filter((s) => s.ok && s.metrics)
    .sort((a, b) => a.id - b.id);
  const measures = MEASURES.map((measure) => {
    const withValue = read.filter((s) => finite(s.metrics[measure.key]));
    const point = (s) => ({ swing_id: s.id, value: s.metrics[measure.key],
                            handedness: String(s.handedness || ""), club: s.club || null,
                            camera: s.camera || null });
    const newest = withValue[withValue.length - 1];
    const points = withValue.map((s) => {
      const value = s.metrics[measure.key];
      const comparable = Boolean(newest) &&
        comparability(rules, [point(newest)], [point(s)], measure.key).comparable;
      // The tempo band applies only where it was measured: the model's own
      // positions, on a right-handed swing (#33, #50).
      const banded = measure.key === "tempo_ratio" && input.band && s.handedness !== "left" &&
        !(s.positions_set_by_you > 0);
      const spread = banded ? Math.abs(value) * input.band.half_width_fraction : null;
      return { id: s.id, at: s.at || null, day: localDay(s.at), value, comparable,
               low: spread === null ? null : value - spread,
               high: spread === null ? null : value + spread };
    });
    const days = [...new Set(points.map((p) => p.day))];
    const sessions = days.map((day) => {
      const used = points.filter((p) => p.day === day && p.comparable);
      return { day, n: used.length, median: used.length ? median(used.map((p) => p.value)) : null,
               ids: points.filter((p) => p.day === day).map((p) => p.id) };
    });
    const tour = measure.key === "tempo_ratio" ? rules && rules.tour_tempo
      : rules && rules.tour_body && rules.tour_body[measure.key];
    const reference = tour ? {
      p10: tour.p10, p90: tour.p90, n: tour.n_swings,
      source: measure.key === "tempo_ratio"
        ? "tour players, broadcast video"
        : "tour players filmed face on, broadcast video",
    } : null;
    const verdicts = (input.verdicts || [])
      .filter((v) => v.change && v.change.metric === measure.key && VERDICT_LABELS[v.change.verdict])
      .map((v) => {
        const last = Math.max(...v.plan.retest.filter((id) => points.some((p) => p.id === id)));
        return Number.isFinite(last) ? { id: last, verdict: v.change.verdict,
                                         label: VERDICT_LABELS[v.change.verdict] } : null;
      }).filter(Boolean);
    return { ...measure, points, sessions, reference, verdicts };
  });
  return { enough: read.length >= MIN_SWINGS, swings: read.length, measures };
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* One measure's chart as an SVG string, `width` by `height` user units. Colour
 * comes from the page's tokens through classes (pg-*), so dark mode follows. */
export function progressSvg(series, width = 340, height = 150) {
  const pad = { left: 40, right: 10, top: 18, bottom: 22 };
  const pts = series.points;
  if (!pts.length) return "";
  const values = pts.flatMap((p) => [p.value, p.low, p.high]).filter(finite);
  if (series.reference) values.push(series.reference.p10, series.reference.p90);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const margin = (hi - lo) * 0.08;
  lo -= margin; hi += margin;
  const w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
  const x = (i) => pad.left + (pts.length === 1 ? w / 2 : (i * w) / (pts.length - 1));
  const y = (v) => pad.top + h - ((v - lo) / (hi - lo)) * h;
  const fmt = (v) => v.toFixed(series.digits);
  const parts = [];
  if (series.reference) {
    const r = series.reference;
    parts.push(`<rect class="pg-ref" x="${pad.left}" y="${y(r.p90).toFixed(1)}" width="${w}" ` +
      `height="${(y(r.p10) - y(r.p90)).toFixed(1)}"><title>${esc(r.source)}: middle 80% of ` +
      `${r.n} swings, ${fmt(r.p10)}–${fmt(r.p90)}</title></rect>`);
    parts.push(`<text class="pg-ref-label" x="${pad.left + 4}" y="${(y(r.p90) + 11).toFixed(1)}">` +
      `${esc(r.source)}</text>`);
  }
  // Recessive axis: the range's ends only.
  for (const v of [lo + margin, hi - margin]) {
    parts.push(`<text class="pg-axis" x="${pad.left - 6}" y="${(y(v) + 4).toFixed(1)}" ` +
      `text-anchor="end">${fmt(v)}</text>`);
  }
  parts.push(`<line class="pg-base" x1="${pad.left}" x2="${pad.left + w}" y1="${pad.top + h}" ` +
    `y2="${pad.top + h}"/>`);
  // Session boundaries and their dates.
  // A date is written only where it does not crowd the last one.
  let lastLabel = -Infinity;
  for (const s of series.sessions) {
    const idx = pts.findIndex((p) => p.day === s.day);
    if (idx > 0) {
      const bx = (x(idx - 1) + x(idx)) / 2;
      parts.push(`<line class="pg-session" x1="${bx.toFixed(1)}" x2="${bx.toFixed(1)}" ` +
        `y1="${pad.top}" y2="${pad.top + h}"/>`);
    }
    if (x(idx) - lastLabel >= 44) {
      parts.push(`<text class="pg-axis" x="${x(idx).toFixed(1)}" y="${height - 6}" ` +
        `text-anchor="${idx === 0 ? "start" : "middle"}">${esc(s.day.slice(5) || "—")}</text>`);
      lastLabel = x(idx);
    }
  }
  // Per-swing spread, then the session medians joined.
  for (const [i, p] of pts.entries()) {
    if (finite(p.low) && finite(p.high)) {
      parts.push(`<line class="pg-spread" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" ` +
        `y1="${y(p.high).toFixed(1)}" y2="${y(p.low).toFixed(1)}"/>`);
    }
  }
  // Each day's median spans that day's swings; thin connectors join the days.
  const medians = series.sessions.filter((s) => s.median !== null).map((s) => {
    const idx = s.ids.map((id) => pts.findIndex((p) => p.id === id));
    return { a: x(Math.min(...idx)) - 6, b: x(Math.max(...idx)) + 6, y: y(s.median), s };
  });
  for (let k = 1; k < medians.length; k++) {
    parts.push(`<line class="pg-link" x1="${medians[k - 1].b.toFixed(1)}" ` +
      `y1="${medians[k - 1].y.toFixed(1)}" x2="${medians[k].a.toFixed(1)}" ` +
      `y2="${medians[k].y.toFixed(1)}"/>`);
  }
  for (const m of medians) {
    parts.push(`<line class="pg-median" x1="${m.a.toFixed(1)}" x2="${m.b.toFixed(1)}" ` +
      `y1="${m.y.toFixed(1)}" y2="${m.y.toFixed(1)}"><title>${esc(m.s.day)}: median ` +
      `${fmt(m.s.median)} of ${m.s.n} comparable swing${m.s.n === 1 ? "" : "s"}</title></line>`);
  }
  for (const [i, p] of pts.entries()) {
    const tip = `Swing ${p.id}${p.day ? `, ${p.day}` : ""}: ${fmt(p.value)}` +
      (finite(p.low) ? ` (measured spread ${fmt(p.low)}–${fmt(p.high)})` : "") +
      (p.comparable ? "" : " — filmed differently from your latest swing, so not in the median");
    parts.push(`<circle class="${p.comparable ? "pg-point" : "pg-point pg-hollow"}" ` +
      `cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" data-swing="${p.id}">` +
      `<title>${esc(tip)}</title></circle>`);
  }
  for (const v of series.verdicts) {
    const i = pts.findIndex((p) => p.id === v.id);
    parts.push(`<text class="pg-verdict" x="${x(i).toFixed(1)}" y="${pad.top - 6}" ` +
      `text-anchor="${i > pts.length / 2 ? "end" : "start"}">▼ ${esc(v.label)}</text>`);
  }
  return `<svg class="pg-chart" viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="${esc(series.label)} over ${pts.length} swings">${parts.join("")}</svg>`;
}
