/* The practice loop in the browser: one priority, one drill, a retest, a verdict.
 *
 * A port of swingml/insights (engine.py `choose`, compare.py `comparability` and
 * `compare`) and of the plan bookkeeping in swingml/web/practice.py. The rules are
 * ported; their inputs are not. The drills, the tour tempo reference, the
 * tolerances and the t table come from the exported payload (`payload.practice`,
 * written by swingml/insights/payload.py), and tests/test_browser_practice.py
 * holds these functions to the Python ones on the same swings, sentence for
 * sentence.
 *
 * Everything is kept on this device, in this browser's storage: the numbers of
 * each analysed clip, never the clip or a frame of it. It can be exported and
 * erased from the page.
 */

import { L } from "./engine.js";

const HISTORY = 12;

/* Python's "{:.Nf}". */
const fixed = (x, digits) => x.toFixed(digits);

/* Python's "{:.3g}": three significant figures, trailing zeros dropped. */
export function formatG3(x) {
  if (x === 0) return "0";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : x < 0 ? "-inf" : "nan";
  const [mantissa, exp] = x.toExponential(2).split("e");
  const exponent = Number(exp);
  if (exponent < -4 || exponent >= 3) {
    const m = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
    const sign = exponent < 0 ? "-" : "+";
    return `${m}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  const out = x.toFixed(Math.max(0, 2 - exponent));
  return out.includes(".") ? out.replace(/0+$/, "").replace(/\.$/, "") : out;
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

function variance(values) {
  const m = mean(values);
  return values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/* The critical value for the largest tabulated df not above `df` (conservative). */
export function t95(rules, df) {
  const usable = rules.t95.filter(([k]) => k <= Math.max(df, 1));
  return usable.length ? usable[usable.length - 1][1] : rules.t95[0][1];
}

/* Where the camera was, as far as the golfer's body at address can say.
 * compare.py `camera_signature`; keys as Python writes them. */
export function cameraSignature(sequence, addressFrame) {
  if (!sequence.n) return null;
  const frame = Math.min(Math.max(addressFrame, 0), sequence.n - 1);
  const xy = sequence.xy[frame];
  const square = xy.map(([x, y]) => [x * sequence.aspect, y]);
  const seen = sequence.visibility[frame].map((v) => v >= 0.3);
  if (seen.filter(Boolean).length < 8) return null;
  const shoulders = Math.hypot(square[L.LEFT_SHOULDER][0] - square[L.RIGHT_SHOULDER][0],
                               square[L.LEFT_SHOULDER][1] - square[L.RIGHT_SHOULDER][1]);
  const midpoint = (a, b) => [0.5 * (square[a][0] + square[b][0]), 0.5 * (square[a][1] + square[b][1])];
  const s = midpoint(L.LEFT_SHOULDER, L.RIGHT_SHOULDER), h = midpoint(L.LEFT_HIP, L.RIGHT_HIP);
  const torso = Math.hypot(s[0] - h[0], s[1] - h[1]);
  const ys = xy.filter((_, i) => seen[i]).map(([, y]) => y);
  const steps = [];
  for (let i = 1; i < sequence.times.length; i++) steps.push(sequence.times[i] - sequence.times[i - 1]);
  return {
    orientation: sequence.height >= sequence.width ? "portrait" : "landscape",
    body_height: Math.max(...ys) - Math.min(...ys),
    centre_x: 0.5 * (xy[L.LEFT_HIP][0] + xy[L.RIGHT_HIP][0]),
    shoulder_ratio: torso > 1e-6 ? shoulders / torso : null,
    frame_rate: steps.length ? 1 / median(steps) : null,
  };
}

/* Whether two sets of swings can be compared at all. compare.py `comparability`. */
export function comparability(rules, before, after, metric) {
  const blocking = [], warnings = [];
  const points = [...before, ...after];
  if (new Set(points.map((p) => p.handedness)).size > 1) {
    blocking.push("the swings are not all the same way round (right- and left-handed)");
  }
  const clubs = [...new Set(points.map((p) => p.club).filter(Boolean))].sort();
  if (clubs.length > 1) {
    blocking.push(`different clubs: ${clubs.join(", ")}`);
  } else if (points.some((p) => !p.club)) {
    warnings.push("not every swing says which club; mixing clubs changes tempo and turn");
  }
  const cameras = points.map((p) => p.camera || null);
  if (cameras.some((c) => c === null)) {
    warnings.push("some swings were analysed before the camera position was recorded, so " +
                  "whether the phone moved cannot be checked");
  }
  const known = cameras.filter((c) => c !== null);
  if (known.length) {
    if (new Set(known.map((c) => c.orientation)).size > 1) {
      blocking.push("some swings were filmed in portrait and some in landscape");
    }
    const ratios = known.map((c) => c.shoulder_ratio).filter(finite);
    if (ratios.length && Math.max(...ratios) - Math.min(...ratios) > rules.shoulder_ratio_tolerance) {
      blocking.push("the camera angle changed (face on in some swings, more down the line in others)");
    }
    const heights = known.map((c) => c.body_height), centres = known.map((c) => c.centre_x);
    let moved = (Math.max(...heights) - Math.min(...heights)) / Math.max(Math.max(...heights), 1e-6) >
      rules.body_height_tolerance;
    moved = moved || (Math.max(...centres) - Math.min(...centres)) > rules.centre_tolerance;
    if (moved) {
      const message = "the phone was closer, further or to one side in some swings";
      if (rules.scale_free_metrics.includes(metric)) {
        warnings.push(message + "; timing is unaffected");
      } else {
        blocking.push(message + "; angles and movements read from the picture change with it");
      }
    }
    const rates = known.map((c) => c.frame_rate).filter(finite);
    if (rates.length && Math.max(...rates) > 1.6 * Math.min(...rates)) {
      warnings.push("the frame rate differed between swings; lower frame rates place positions " +
                    "less precisely");
    }
  }
  return { comparable: blocking.length === 0, blocking, warnings };
}

function welch(before, after) {
  const va = variance(before) / before.length, vb = variance(after) / after.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return [mean(after) - mean(before), 0, Infinity];
  const df = (va + vb) ** 2 / (va ** 2 / (before.length - 1) + vb ** 2 / (after.length - 1));
  return [mean(after) - mean(before), se, df];
}

/* Before against after, and what can be said about it. compare.py `compare`. */
export function compareSwings(rules, before, after, metric, direction) {
  const check = comparability(rules, before, after, metric);
  const common = {
    metric, direction, n_before: before.length, n_after: after.length, comparability: check,
    mean_before: null, mean_after: null, difference: null, interval: null, smallest_detectable: null,
  };
  const least = rules.min_swings;
  if (before.length < least || after.length < least) {
    const need = [Math.max(least - before.length, 0), Math.max(least - after.length, 0)];
    return {
      ...common, verdict: "not_enough_swings",
      explanation: `A comparison needs at least ${least} swings before and ${least} after; ` +
        `${need[0]} more before and ${need[1]} more after are needed. One or two swings ` +
        "cannot separate a change from the spread between swings.",
    };
  }
  if (!check.comparable) {
    return { ...common, verdict: "not_comparable",
             explanation: "These swings cannot be compared: " + check.blocking.join("; ") + "." };
  }
  const a = before.map((p) => p.value), b = after.map((p) => p.value);
  const [difference, se, df] = welch(a, b);
  const half = t95(rules, df) * se;
  const interval = [difference - half, difference + half];
  const wanted = direction === "increase" ? 1 : -1;
  const verdict = interval[0] > 0 || interval[1] < 0
    ? (difference * wanted > 0 ? "improved" : "worsened")
    : "no_detectable_change";
  let explanation = {
    improved: "The change is larger than the spread between your swings can explain, " +
      "and in the direction the drill aims for.",
    worsened: "The change is larger than the spread between your swings can explain, " +
      "but in the opposite direction to the one the drill aims for.",
    no_detectable_change: `Any change is smaller than about ${formatG3(half)}, which is what ` +
      "the spread between these swings can resolve. That is not the same as no change: " +
      "more swings on each side narrow it.",
  }[verdict];
  if (metric === "tempo_ratio") {
    explanation += " Tempo readings move by less than the real change (about 0.44 of it on held-out " +
      "swings), so a real change in tempo is shown smaller than it is.";
  }
  return { ...common, verdict, mean_before: mean(a), mean_after: mean(b), difference, interval,
           smallest_detectable: half, explanation };
}

const drillFor = (rules, focus) => rules.drills.find((d) => d.focus === focus) || null;

/* The one thing to work on next. engine.py `choose`; `recent` is newest first. */
export function choosePriority(rules, recent) {
  const least = rules.min_swings;
  const insight = (fields) => ({ choices: [], ...fields });
  if (!recent.length) {
    return insight({
      kind: "not_enough", title: "Record your first swing", summary: "Nothing has been measured yet.",
      evidence: [], confidence: "none", limitations: [], drill: drillFor(rules, "capture"),
      retest: "Record 3 swings from the same spot.",
      success: "Three swings analysed without a refusal.",
    });
  }
  const lastThree = recent.slice(0, 3);
  const refused = lastThree.filter((s) => s.refused);
  const poorlySeen = lastThree.filter(
    (s) => !s.refused && s.detection_rate !== null && s.detection_rate !== undefined && s.detection_rate < 0.8);
  if (recent[0].refused || refused.length >= 2 || poorlySeen.length) {
    return insight({
      kind: "capture",
      title: "Get a recording the app can measure",
      summary: "Until swings are recorded so the whole body is seen from address to finish, " +
        "every other number is unreliable. This comes before anything about the swing.",
      evidence: [...refused, ...poorlySeen].map((s) => ({
        label: `Swing ${s.swing_id}`,
        // Python prints a missing reason as None.
        value: s.refused ? `refused: ${s.refusal === null || s.refusal === undefined ? "None" : s.refusal}`
          : `body found in ${fixed(100 * (s.detection_rate || 0), 0)}% of frames`,
        provenance: "measured", swing_id: s.swing_id,
      })),
      confidence: "high",
      limitations: ["Based on the analysis's own refusals and detection rates."],
      drill: drillFor(rules, "capture"),
      retest: "Record 3 swings with the setup above.",
      success: "Three swings in a row analysed without a refusal.",
    });
  }

  const analysed = recent.filter((s) => !s.refused && finite(s.tempo) && s.point);
  const comparable = [];
  if (analysed.length) {
    const newest = analysed[0];
    for (const swing of analysed.slice(0, 10)) {
      if (comparability(rules, [newest.point], [swing.point], "tempo_ratio").comparable) comparable.push(swing);
      if (comparable.length === 5) break;
    }
  }
  // Comparable swings share a hand, so the newest swing's hand is every reading's (#33).
  const left = analysed.length > 0 && analysed[0].point.handedness === "left";
  const limits = left && rules.tempo_limits_left_handed ? rules.tempo_limits_left_handed : rules.tempo_limits;
  const oneSwing = rules.one_swing
    ? rules.one_swing[left ? "left" : "right"]
    : "One swing's tempo is uncertain by about ±27%, so a single reading cannot say what to work on.";
  const tempoEvidence = (s) => ({ label: `Swing ${s.swing_id}`, value: `tempo ${fixed(s.tempo, 2)}`,
                                  provenance: "derived", swing_id: s.swing_id });
  if (comparable.length < least) {
    const more = least - comparable.length;
    return insight({
      kind: "not_enough",
      title: `Record ${more} more swing(s) from the same spot`,
      summary: `A priority needs at least ${least} analysed swings filmed from the same ` +
        `place with the same club; there are ${comparable.length}. ` + oneSwing,
      evidence: comparable.map(tempoEvidence),
      confidence: "none", limitations: limits, drill: null,
      retest: `Record ${more} more swing(s) without moving the phone.`,
      success: `${least} comparable swings analysed.`,
    });
  }

  const tempos = comparable.map((s) => s.tempo);
  const average = mean(tempos);
  const reference = rules.tour_tempo;
  const evidence = [
    ...comparable.map(tempoEvidence),
    { label: "Tour swings read by the same model",
      value: `${fixed(reference.p10, 2)} to ${fixed(reference.p90, 2)} ` +
        `(10th to 90th percentile, ${reference.n_swings} swings)`,
      provenance: "measured", swing_id: null },
  ];
  if (average < reference.p10 || average > reference.p90) {
    const quick = average < reference.p10;
    const allOutside = quick ? tempos.every((t) => t < reference.p10) : tempos.every((t) => t > reference.p90);
    const drill = drillFor(rules, quick ? "tempo_quick" : "tempo_slow");
    return insight({
      kind: quick ? "tempo_quick" : "tempo_slow",
      title: quick ? "Your backswing is quick for your downswing" : "Your backswing is long for your downswing",
      summary: `Your average tempo reading over ${comparable.length} comparable swings is ` +
        `${fixed(average, 2)}, ${quick ? "below" : "above"} the range the same analysis reads ` +
        `for 80% of tour swings (${fixed(reference.p10, 2)} to ${fixed(reference.p90, 2)}). ` +
        "Tempo is a ratio of two durations and does not depend on where the camera stood.",
      evidence, confidence: allOutside ? "moderate" : "low", limitations: limits, drill,
      retest: "Practise the drill, then record 5 swings from the same spot with the same club.",
      success: drill.what_counts,
    });
  }
  return insight({
    kind: "choose",
    title: "Nothing measured stands out: choose what to work on",
    summary: `Your average tempo reading over ${comparable.length} comparable swings is ${fixed(average, 2)}, ` +
      "inside the range the analysis reads for tour swings. The other measurements have no " +
      "reference the app can defend, so rather than guess at a fault it will measure " +
      "whatever you choose to practise, against your own swings.",
    evidence, confidence: "low", limitations: limits, drill: null,
    retest: "Choose a focus, practise its drill, then record 5 swings from the same spot.",
    success: "The chosen measurement moves in the drill's direction by more than the " +
      "spread between your swings can explain.",
    choices: rules.trackable,
  });
}

/* The browser's metrics, under the names the desktop stores them by. */
export function storedMetrics(m, detectionRate) {
  return {
    tempo_ratio: finite(m.tempoRatio) ? m.tempoRatio : null,
    head_movement: finite(m.headMovement) ? m.headMovement : null,
    pelvis_sway: finite(m.pelvisSway) ? m.pelvisSway : null,
    shoulder_turn_foreshortened: finite(m.shoulderTurnDeg) ? m.shoulderTurnDeg : null,
    detection_rate: detectionRate,
  };
}

/* A short fingerprint of a clip, so the same file analysed twice is recognised.
 * From its name, size and modification time, hashed so the name itself is not
 * kept (cyrb53: a small, fast, non-cryptographic 53-bit hash). */
export function clipKey(name, size, lastModified) {
  const text = `${name}|${size}|${lastModified}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* Swings and plans kept in this browser. `storage` is anything with getItem and
 * setItem (localStorage, or a map in tests); every access is guarded, because a
 * private window or a browser set to block site data throws on it, and the page
 * must still analyse clips with nothing remembered. */
export class PracticeLog {
  constructor(storage, key = "swing-practice-v1") {
    this.storage = storage;
    this.key = key;
    this.data = { next: 1, swings: [], plans: [] };
    this.available = false;
    try {
      const saved = storage && storage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.swings) && Array.isArray(parsed.plans)) this.data = parsed;
      }
      this.available = Boolean(storage);
    } catch (error) {
      this.available = false;
    }
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.data));
      this.available = true;
      return true;
    } catch (error) {
      this.available = false;
      return false;
    }
  }

  get swings() { return this.data.swings; }
  get plans() { return this.data.plans; }
  get(id) { return this.data.swings.find((s) => s.id === id) || null; }
  activePlan() { return this.data.plans.find((p) => p.status === "active") || null; }

  /* Keep one analysed (or refused) clip. With `forPlan`, it also counts as a
   * retest swing for the active plan, as an upload from the desktop's practice
   * page does. */
  add(record, forPlan = false) {
    // The same clip analysed again (dropped twice, or re-run with the other
    // hand) replaces its earlier reading instead of becoming a second swing:
    // one clip counted as three retest swings once turned "not enough swings"
    // into "improved". It keeps its number and its place in any plan.
    const again = record.clip_key
      ? this.data.swings.find((s) => s.clip_key === record.clip_key) : null;
    if (again && again.ok && !record.ok) {
      // A refused re-read never replaces an analysed reading of the same clip:
      // one run with the wrong hand set used to wipe a good retest swing out of
      // its plan (#26). The earlier reading stands, plans and all; the page
      // shows this run's refusal and says which reading was kept.
      return again;
    }
    let swing;
    if (again) {
      Object.assign(again, record, { id: again.id, at: again.at, reread_at: new Date().toISOString() });
      swing = again;
    } else {
      swing = { ...record, id: this.data.next++, at: new Date().toISOString() };
      this.data.swings.push(swing);
    }
    const plan = forPlan ? this.activePlan() : null;
    if (plan && !plan.baseline.includes(swing.id) && !plan.retest.includes(swing.id)) {
      plan.retest.push(swing.id);
    }
    this.save();
    return swing;
  }

  /* Forget one swing, and take it out of every plan's baseline and retest, as
   * the desktop (`SwingStore.delete`) and the iPhone (`PracticeLog.remove`) do. */
  remove(id) {
    const before = this.data.swings.length;
    this.data.swings = this.data.swings.filter((s) => s.id !== id);
    for (const plan of this.data.plans) {
      plan.baseline = plan.baseline.filter((n) => n !== id);
      plan.retest = plan.retest.filter((n) => n !== id);
    }
    this.save();
    return this.data.swings.length < before;
  }

  update(id, patch) {
    const swing = this.get(id);
    if (swing) { Object.assign(swing, patch); this.save(); }
    return swing;
  }

  clubs() {
    return [...new Set(this.data.swings.map((s) => s.club).filter(Boolean))].sort();
  }

  /* Newest first, up to and including `id`, so a swing's priority never changes
   * when more swings come after it. */
  recentUpTo(id) {
    return this.data.swings.filter((s) => id === null || id === undefined || s.id <= id)
      .sort((a, b) => b.id - a.id).slice(0, HISTORY);
  }

  pointOf(swing, metric) {
    const value = swing.metrics ? swing.metrics[metric] : null;
    if (!finite(value)) return null;
    return { swing_id: swing.id, value, handedness: String(swing.handedness || ""),
             club: swing.club || null, camera: swing.camera || null };
  }

  recentSwings(id) {
    return this.recentUpTo(id).map((s) => ({
      swing_id: s.id, refused: !s.ok, refusal: s.refusal || null,
      detection_rate: finite(s.detection_rate) ? s.detection_rate : null,
      tempo: s.ok && s.metrics && finite(s.metrics.tempo_ratio) ? s.metrics.tempo_ratio : null,
      point: s.ok ? this.pointOf(s, "tempo_ratio") : null,
    }));
  }

  insightFor(rules, id) {
    return choosePriority(rules, this.recentSwings(id));
  }

  /* The most recent comparable swings with a reading of the drill's metric. */
  baselineFor(rules, drill, upTo) {
    const usable = this.recentUpTo(upTo).filter((s) => s.ok)
      .map((s) => [s, this.pointOf(s, drill.metric)]).filter(([, p]) => p);
    if (!usable.length) return { baseline: [], club: null };
    const newest = usable[0][1];
    const baseline = usable.filter(([, p]) => comparability(rules, [newest], [p], drill.metric).comparable)
      .map(([s]) => s.id).slice(0, 5);
    return { baseline, club: usable[0][0].club || null };
  }

  /* Start practising one thing; any plan still active is abandoned first. */
  startPlan(rules, focus, fromSwing) {
    const drill = drillFor(rules, focus);
    if (!drill) throw new Error(`no drill for ${focus}`);
    const now = new Date().toISOString();
    for (const plan of this.data.plans) {
      if (plan.status === "active") { plan.status = "abandoned"; plan.closed_at = now; }
    }
    const { baseline, club } = focus === "capture" ? { baseline: [], club: null }
      : this.baselineFor(rules, drill, fromSwing);
    const plan = {
      id: this.data.plans.reduce((m, p) => Math.max(m, p.id), 0) + 1,
      focus, drill_id: drill.id, metric: drill.metric, direction: drill.direction, club,
      baseline, retest: [], status: "active", created_at: now, closed_at: null,
      insight: this.insightFor(rules, fromSwing),
    };
    this.data.plans.push(plan);
    this.save();
    return plan;
  }

  closePlan(status) {
    if (status !== "completed" && status !== "abandoned") {
      throw new Error(`a plan closes as completed or abandoned, not ${status}`);
    }
    const plan = this.activePlan();
    if (!plan) return false;
    plan.status = status;
    plan.closed_at = new Date().toISOString();
    this.save();
    return true;
  }

  planChange(rules, plan) {
    const drill = rules.drills.find((d) => d.id === plan.drill_id);
    if (!drill || drill.focus === "capture") return null;
    const points = (ids) => ids.map((id) => this.get(id)).filter((s) => s && s.ok)
      .map((s) => this.pointOf(s, drill.metric)).filter(Boolean);
    return compareSwings(rules, points(plan.baseline), points(plan.retest), drill.metric, drill.direction);
  }

  captureProgress(plan) {
    let streak = 0;
    for (const id of plan.retest.slice().sort((a, b) => a - b)) {
      const swing = this.get(id);
      if (swing) streak = swing.ok ? streak + 1 : 0;
    }
    return { recorded: plan.retest.length, clean_in_a_row: streak };
  }

  exportAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  eraseAll() {
    const count = this.data.swings.length;
    this.data = { next: 1, swings: [], plans: [] };
    try { if (this.storage) this.storage.removeItem(this.key); } catch (error) { /* nothing kept */ }
    return count;
  }
}
