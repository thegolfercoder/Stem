/* Stem's read of one swing: a few sentences made from the page's own numbers (#52).
 *
 * It replaces the read Claude gave from the pictures. Every sentence here is built
 * from a value already on the page, with the same rounding, and carries how that
 * value was obtained. Nothing is added that was not measured: no club, ball or
 * plane talk, and a refused reading is said to be missing rather than coached
 * from. The one thing to work on is always the practice engine's priority
 * (practice.js), never a different one.
 *
 * Pure, so it runs in node against fixtures and in the page alike; nothing here
 * touches the page or the network.
 */

/* Positions whose placement the tempo depends on: address, top, impact. */
const TEMPO_EVENTS = [0, 3, 5];
const EVENT_NAMES = ["address", "toe up", "mid backswing", "top", "mid downswing", "impact",
  "mid follow through", "finish"];

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const range = (ref, digits) => `${ref.p10.toFixed(digits)}–${ref.p90.toFixed(digits)}`;

/* `input`:
 *   metrics     the page's metrics (tempoRatio, slowedBy, headMovement, pelvisSway,
 *               shoulderTurnDeg, feetInShot)
 *   handedness  "right" | "left"
 *   band        payload.calibration.tempo, or null where none was measured
 *   rules       payload.practice (tour_tempo, tour_body, tempo_limits, ...), or null
 *   userSet     event indices the golfer placed by hand
 *   insight     the practice engine's priority for this swing, or null
 *   noPriority  what to say when there is no priority for this swing
 *   camera      the swing's camera signature (practice.js cameraSignature), or null
 * Returns [{ key, text, provenance, caveats }]. */
export function stemRead(input) {
  const { metrics: m, handedness, band, rules } = input;
  const userSet = new Set(input.userSet || []);
  const left = handedness === "left";
  const out = [];

  // 1. Tempo, against what tour swings read through the same model.
  if (!finite(m.tempoRatio)) {
    out.push({ key: "tempo", provenance: "refused", caveats: [],
               text: "There is no tempo reading for this swing, so it cannot be compared with tour swings." });
  } else {
    const tempo = m.tempoRatio;
    const handPlaced = TEMPO_EVENTS.filter((e) => userSet.has(e));
    let text = `Your tempo reads ${tempo.toFixed(2)} (backswing ÷ downswing)`;
    if (band && !handPlaced.length) {
      const spread = Math.abs(tempo) * band.half_width_fraction;
      text += `, with a measured spread of ${(tempo - spread).toFixed(2)}–${(tempo + spread).toFixed(2)}`;
    }
    const tour = rules && rules.tour_tempo;
    if (tour) {
      const reference = `the ${range(tour, 2)} that tour swings read through the same analysis ` +
        `(the middle 80% of ${tour.n_swings})`;
      const verdict = tempoVerdict(input);
      if (verdict === "below") {
        text += `, all below ${reference}: a quick backswing for your downswing`;
      } else if (verdict === "above") {
        text += `, all above ${reference}: a long backswing for your downswing`;
      } else if (verdict === "inside") {
        text += `, inside ${reference}`;
      } else if (verdict === "overlaps") {
        text += `, which overlaps ${reference}`;
      } else {
        text += `; tour swings read ${range(tour, 2)} through the same analysis ` +
          `(the middle 80% of ${tour.n_swings})`;
      }
    }
    text += ".";
    const caveats = [];
    if (handPlaced.length) {
      caveats.push(`You placed the ${handPlaced.map((e) => EVENT_NAMES[e]).join(" and ")} by hand, ` +
        "so the model's measured spread does not apply to this reading.");
    }
    if (m.slowedBy) {
      caveats.push(`Read as slow motion played about ${m.slowedBy.toFixed(0)} times slower: the ratio ` +
        "assumes the whole swing was slowed evenly, and no duration is given.");
    }
    const limits = rules && (left && rules.tempo_limits_left_handed
      ? rules.tempo_limits_left_handed : rules.tempo_limits);
    if (limits) caveats.push(...limits);
    out.push({ key: "tempo", text, provenance: "derived", caveats });
  }

  // 2. Head, sway and turn, against tour swings filmed face on. A difference, not a fault.
  // Only for a clip that looks face on: those readings are face on only (QA, #52).
  const body = rules && rules.tour_body;
  const minRatio = rules && rules.face_on_min_shoulder_ratio;
  const ratio = input.camera ? input.camera.shoulder_ratio : null;
  if (body && finite(minRatio) && !(finite(ratio) && ratio >= minRatio)) {
    out.push({ key: "body", provenance: "refused", caveats: [],
               text: "Head, sway and turn are not compared with tour swings, which were filmed face on: " +
                 (finite(ratio)
                   ? `this camera does not look face on (the shoulders measure ${ratio.toFixed(2)} of the ` +
                     `torso length at address; face-on clips read ${minRatio.toFixed(2)} or more).`
                   : "the camera's angle could not be read at address.") });
  } else if (body) {
    const seen = [];
    const differs = [];
    if (m.feetInShot && finite(m.headMovement) && body.head_movement) {
      const ref = body.head_movement;
      seen.push("head movement");
      if (m.headMovement > ref.p90) {
        differs.push(`your head moved ${m.headMovement.toFixed(3)} body lengths from address to ` +
          `impact, more than most (${range(ref, 3)})`);
      }
    }
    if (m.feetInShot && finite(m.pelvisSway) && body.pelvis_sway) {
      const ref = body.pelvis_sway;
      seen.push("pelvis sway");
      if (m.pelvisSway > ref.p90) {
        differs.push(`your pelvis swayed ${m.pelvisSway.toFixed(3)} body lengths side to side, ` +
          `more than most (${range(ref, 3)})`);
      }
    }
    if (finite(m.shoulderTurnDeg) && body.shoulder_turn_foreshortened) {
      const ref = body.shoulder_turn_foreshortened;
      seen.push("shoulder turn");
      if (m.shoulderTurnDeg < ref.p10 || m.shoulderTurnDeg > ref.p90) {
        differs.push(`your shoulder turn at the top reads ${m.shoulderTurnDeg.toFixed(1)}°, ` +
          `${m.shoulderTurnDeg < ref.p10 ? "less" : "more"} than most (${range(ref, 1)}°)`);
      }
    }
    const n = (body.head_movement || body.pelvis_sway || body.shoulder_turn_foreshortened).n_swings;
    const caveats = [
      `Tour readings from ${n} tour swings filmed face on, through the same analysis; they hold ` +
      "only if you filmed face on with your whole body in shot. A reading outside them differs " +
      "from those tour swings; that does not make it a fault.",
    ];
    if (differs.length) {
      const joined = differs.length === 1 ? differs[0]
        : `${differs.slice(0, -1).join("; ")}; and ${differs[differs.length - 1]}`;
      out.push({ key: "body", provenance: "projected", caveats,
                 text: `Against tour swings filmed face on, ${joined}.` });
    } else if (seen.length) {
      const list = seen.length === 1 ? seen[0]
        : `${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}`;
      out.push({ key: "body", provenance: "projected", caveats,
                 text: `Your ${list} ${seen.length === 1 ? "reads" : "read"} within the range of tour swings filmed face on.` });
    } else {
      out.push({ key: "body", provenance: "refused", caveats: [],
                 text: m.feetInShot
                   ? "Head, sway and turn cannot be compared: the shoulders were never seen clearly enough."
                   : "Head and sway cannot be compared because your feet were not in shot, and the " +
                     "shoulders were not seen clearly enough for the turn." });
    }
  }

  // 3. The one thing to work on: the practice engine's priority, as it stands.
  const insight = input.insight;
  if (insight) {
    const text = insight.drill
      ? `Work on one thing: ${lower(insight.title)}, with the drill “${insight.drill.title}”. ` +
        `Then retest: ${lower(insight.retest)}`
      : insight.kind === "not_enough" ? `No priority yet: ${lower(insight.title)}`
      : `${insight.title}, in the practice section below`;
    out.push({ key: "priority", text: endWithStop(text), provenance: "derived",
               caveats: insight.confidence && insight.confidence !== "none"
                 ? [`Confidence in this priority: ${insight.confidence}.`] : [] });
  } else if (input.noPriority) {
    out.push({ key: "priority", text: endWithStop(input.noPriority), provenance: "derived", caveats: [] });
  }
  return out;
}

/* Where one swing's tempo sits against the tour readings: "below" or "above" only
 * when its whole measured spread does (QA, #52), "inside", "overlaps", or
 * "unjudged" where no spread applies (no band, positions placed by hand, a
 * left-hander's band not measured) or there is no tempo or reference. Stem's
 * read and the spoken cue both use this, so they cannot disagree. */
export function tempoVerdict(input) {
  const { metrics: m, handedness, band, rules } = input;
  const tour = rules && rules.tour_tempo;
  const handPlaced = TEMPO_EVENTS.some((e) => new Set(input.userSet || []).has(e));
  if (!finite(m.tempoRatio) || !tour || !band || handPlaced || handedness === "left") return "unjudged";
  const tempo = m.tempoRatio;
  const spread = Math.abs(tempo) * band.half_width_fraction;
  if (tempo + spread < tour.p10) return "below";
  if (tempo - spread > tour.p90) return "above";
  if (tempo >= tour.p10 && tempo <= tour.p90) return "inside";
  return "overlaps";
}

/* One short sentence to speak after a swing in a range session (#62), when the
 * golfer is too far from the phone to read it. Built from the same verdict as
 * Stem's read: a number is never spoken without what it means, a judgement is
 * never stronger than the read's, and nothing on FORBIDDEN is said. The left-
 * handed and slow-motion caveats are shortened, not dropped. `input` is
 * stemRead's, plus `swing` (its number) and `refused` (true for a clip the
 * analysis did not read). */
export function voiceCue(input) {
  const n = input.swing;
  if (input.refused) return `Swing ${n} not read.`;
  const m = input.metrics;
  if (!finite(m.tempoRatio)) return `Swing ${n}: no tempo reading.`;
  const tempo = `tempo ${m.tempoRatio.toFixed(1)}`;
  const meaning = {
    below: "a quick backswing for your downswing",
    above: "a long backswing for your downswing",
    inside: "inside the tour range",
    overlaps: "at the edge of the tour range",
    unjudged: "backswing to downswing",
  }[tempoVerdict(input)];
  const caveats = [];
  if (input.handedness === "left") caveats.push("a rough reading for a left-hander");
  if (m.slowedBy) caveats.push("read as slow motion");
  return `Swing ${n}, ${tempo}, ${meaning}${caveats.length ? `; ${caveats.join(", ")}` : ""}.`;
}

/* The words on a shared swing card (#44), short enough for an image: the tempo
 * with its measured spread where one applies, where it sits against the tour
 * readings (the same verdict as Stem's read), the practice priority, and what
 * one phone camera cannot promise. `input` is stemRead's plus `date`. Every
 * number is the page's, with the page's rounding. */
export function cardText(input) {
  const { metrics: m, band, rules } = input;
  const left = input.handedness === "left";
  const handPlaced = TEMPO_EVENTS.some((e) => new Set(input.userSet || []).has(e));
  const lines = { date: input.date || "", tempo: null, spread: null, meaning: null,
                  priority: null, limitation: "Measured from one phone camera." };
  if (finite(m.tempoRatio)) {
    lines.tempo = `Tempo ${m.tempoRatio.toFixed(2)} (backswing ÷ downswing)`;
    if (handPlaced) {
      lines.spread = "Positions set by hand: the model's spread does not apply";
    } else if (band) {
      const spread = Math.abs(m.tempoRatio) * band.half_width_fraction;
      lines.spread = `Measured spread ${(m.tempoRatio - spread).toFixed(2)}–` +
        `${(m.tempoRatio + spread).toFixed(2)}` + (left ? " (not measured for left-handers)" : "");
      lines.limitation = `Measured from one phone camera; tempo ±${Math.round(100 * band.half_width_fraction)}% ` +
        `for ${Math.round(100 * band.coverage)}% of held-out swings.`;
    }
    const tour = rules && rules.tour_tempo;
    if (tour) {
      const where = { below: "a quick backswing for the downswing, against", above:
        "a long backswing for the downswing, against", inside: "inside", overlaps: "overlapping",
        unjudged: "tour swings read" }[tempoVerdict(input)];
      lines.meaning = `${where[0].toUpperCase()}${where.slice(1)} ${range(tour, 2)}, ` +
        "the middle 80% of tour swings through the same analysis";
    }
    if (m.slowedBy) lines.meaning = `${lines.meaning ? `${lines.meaning}. ` : ""}Read as slow motion`;
  } else {
    lines.tempo = "No tempo reading for this swing";
  }
  // Only a priority with a drill: "record more swings" is advice for the page, not a card.
  const insight = input.insight;
  if (insight && insight.drill && insight.kind !== "not_enough") {
    lines.priority = `Working on: ${lower(insight.title)}. Drill: ${insight.drill.title}`;
  }
  return lines;
}

function lower(text) {
  return text && /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

function endWithStop(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/* Words a read must never contain: quantities one camera cannot measure (the
 * charter's forbidden outputs) and the plane. Tests hold every read to this. */
export const FORBIDDEN = [
  "spin", "spin axis", "face angle", "club face", "clubface", "club path", "path",
  "attack angle", "angle of attack", "swing plane", "plane", "launch", "ball speed",
  "club speed", "clubhead speed", "club-head speed", "carry", "distance", "yards",
];
