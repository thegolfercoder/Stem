/* A drill shown, not only told (#57): a looping stick figure for each drill and a
 * rep counter for its sets.
 *
 * The figure is an illustration drawn by hand (insights/drills.py POSES), seen face
 * on, right-handed, and slowed down where the drill is about a count. It is not a
 * measurement of anyone's swing and the page says so beside it. The animation is
 * SVG's own (SMIL), so it runs without a script loop; the page pauses it for a
 * golfer who asks for reduced motion.
 *
 * Pure, so node can test it; the page only places the strings.
 */

export const ILLUSTRATION = "Illustration drawn by hand, not a measurement of anyone's swing.";

const BONES = [
  ["neck", "r_sh"], ["neck", "l_sh"], ["r_sh", "r_el"], ["r_el", "hands"], ["l_sh", "l_el"],
  ["l_el", "hands"], ["r_hip", "r_knee"], ["r_knee", "r_foot"], ["l_hip", "l_knee"],
  ["l_knee", "l_foot"],
];
const HIGHLIGHT = { shoulders: ["r_sh", "l_sh"], hips: ["r_hip", "l_hip"] };

const f1 = (x) => Number(x.toFixed(1));
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* Each key's pose with the spine's lower end added. */
function framesOf(demo, poses) {
  return demo.keys.map((key) => {
    const pose = poses[key.pose];
    if (!pose) throw new Error(`no pose named ${key.pose}`);
    return { ...pose, pelvis: mid(pose.r_hip, pose.l_hip) };
  });
}

/* One attribute's SMIL animation over the drill's keys. */
function animate(attr, values, keyTimes, dur) {
  return `<animate attributeName="${attr}" values="${values.map(f1).join(";")}" ` +
    `keyTimes="${keyTimes}" dur="${dur}s" repeatCount="indefinite"/>`;
}

function line(frames, a, b, keyTimes, dur, cls) {
  const first = frames[0];
  const coord = (joint, k) => frames.map((f) => f[joint][k]);
  return `<line class="${cls}" x1="${f1(first[a][0])}" y1="${f1(first[a][1])}" ` +
    `x2="${f1(first[b][0])}" y2="${f1(first[b][1])}">` +
    animate("x1", coord(a, 0), keyTimes, dur) + animate("y1", coord(a, 1), keyTimes, dur) +
    animate("x2", coord(b, 0), keyTimes, dur) + animate("y2", coord(b, 1), keyTimes, dur) +
    "</line>";
}

/* The drill's illustration as an SVG string: 100 by 140 user units, coloured by
 * the page's classes (dm-*) so dark mode follows. */
export function drillDemoSvg(drill, poses) {
  const demo = drill.demo;
  const frames = framesOf(demo, poses);
  const dur = demo.keys[demo.keys.length - 1].at;
  const keyTimes = demo.keys.map((k) => Number((k.at / dur).toFixed(4))).join(";");
  const parts = [];
  const start = frames[0];
  if (demo.highlight === "frame") {
    // Whole body in frame, with room above the hands at the top.
    parts.push('<rect class="dm-frame" x="6" y="4" width="88" height="132" rx="3"/>');
  }
  if (demo.highlight === "head") {
    const [x, y] = start.head;
    parts.push(`<rect class="dm-guide" x="${x - 11}" y="${y - 11}" width="22" height="22"/>`);
  }
  if (demo.highlight === "hips") {
    // Where the hips started: turning keeps their middle on this line.
    const x = f1(start.pelvis[0]);
    parts.push(`<line class="dm-guide" x1="${x}" x2="${x}" y1="56" y2="86"/>`);
  }
  if ((demo.props || []).includes("stick")) {
    parts.push(`<line class="dm-stick" x1="${f1(start.head[0] - 13)}" ` +
      `x2="${f1(start.head[0] - 13)}" y1="8" y2="132"/>`);
  }
  parts.push('<line class="dm-ground" x1="4" x2="96" y1="131" y2="131"/>');
  parts.push(line(frames, "neck", "pelvis", keyTimes, dur, "dm-bone"));
  const lit = HIGHLIGHT[demo.highlight] || [];
  for (const [a, b] of [["r_sh", "l_sh"], ["r_hip", "l_hip"]]) {
    parts.push(line(frames, a, b, keyTimes, dur, lit.includes(a) ? "dm-lit" : "dm-bone"));
  }
  for (const [a, b] of BONES) parts.push(line(frames, a, b, keyTimes, dur, "dm-bone"));
  parts.push(line(frames, "grip", "club", keyTimes, dur, "dm-club"));
  const head = frames.map((f) => f.head);
  parts.push(`<circle class="${demo.highlight === "head" ? "dm-lit-head" : "dm-head"}" ` +
    `cx="${f1(head[0][0])}" cy="${f1(head[0][1])}" r="7">` +
    animate("cx", head.map((p) => p[0]), keyTimes, dur) +
    animate("cy", head.map((p) => p[1]), keyTimes, dur) + "</circle>");
  // The count, a word at a time, held from its key to the next.
  demo.keys.forEach((key, i) => {
    if (!key.say) return;
    const from = key.at / dur, to = (demo.keys[i + 1] ? demo.keys[i + 1].at : dur) / dur;
    const times = [0, from, to, 1].map((t) => Number(t.toFixed(4)));
    const values = ["0", "1", "0", "0"];
    if (from === 0) { times.splice(0, 1); values.splice(0, 1); }
    parts.push(`<text class="dm-say" x="96" y="16" text-anchor="end" opacity="${from === 0 ? 1 : 0}">` +
      `${esc(key.say)}<animate attributeName="opacity" values="${values.join(";")}" ` +
      `keyTimes="${times.join(";")}" calcMode="discrete" dur="${dur}s" ` +
      'repeatCount="indefinite"/></text>');
  });
  return `<svg class="drill-demo-svg" viewBox="0 0 100 140" role="img" ` +
    `aria-label="${esc(`${drill.title}: ${ILLUSTRATION}`)}">${parts.join("")}</svg>`;
}

/* Where a golfer is in the drill's sets after `done` reps. */
export function repState(drill, done) {
  const total = drill.sets * drill.reps_per_set;
  const count = Math.max(0, Math.min(done, total));
  const set = Math.min(Math.floor(count / drill.reps_per_set) + 1, drill.sets);
  const rep = count - (set - 1) * drill.reps_per_set;
  return { done: count, total, set, rep, finished: count >= total,
           setDone: count > 0 && count % drill.reps_per_set === 0 };
}

export function repLabel(drill, done) {
  const s = repState(drill, done);
  if (s.finished) return `All ${s.total} done: ${drill.sets} set${drill.sets === 1 ? "" : "s"} of ${drill.reps_per_set}`;
  if (s.setDone) return `Set ${s.set - 1} of ${drill.sets} done: rest, then the next`;
  const set = drill.sets > 1 ? `Set ${s.set} of ${drill.sets} · ` : "";
  return `${set}rep ${s.rep} of ${drill.reps_per_set}`;
}
