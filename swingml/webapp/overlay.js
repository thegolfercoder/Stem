/* Lines on a swing frame (#58): shoulder, hip and spine lines with their angles,
 * and a head box held where the head was at address.
 *
 * Every angle here is an angle in the picture, between a line drawn on the frame
 * and the frame's own level or upright. It is not a body angle: the same body
 * reads differently from another camera spot, and the page says "in the picture"
 * beside every one. Face on, a tilted shoulder line is mostly side bend; down the
 * line it mostly shows the turn, so the words change with the view.
 *
 * Pure, so node can test the geometry; the page only draws what it returns.
 */

import { L } from "./engine.js";

const SEEN = 0.3;
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/* Degrees from level of the line a to b, in pixels, 0 to 90, and which end is lower. */
function fromLevel(a, b) {
  const [left, right] = a[0] <= b[0] ? [a, b] : [b, a];
  const dx = right[0] - left[0], dy = right[1] - left[1];
  const degrees = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
  const tilt = Math.min(degrees, 180 - degrees);
  return { degrees: tilt, lower: Math.abs(dy) < 1e-9 ? null : dy > 0 ? "right" : "left" };
}

/* Degrees from upright of the line from `low` up to `high`, and which way it leans. */
function fromUpright(low, high) {
  const dx = high[0] - low[0], up = low[1] - high[1];
  const degrees = Math.atan2(Math.abs(dx), Math.max(up, 1e-9)) * 180 / Math.PI;
  return { degrees, leans: Math.abs(dx) < 1e-9 ? null : dx > 0 ? "right" : "left" };
}

/* The lines on one frame. `xy` is the frame's 33 landmarks as fractions of the
 * frame, `visibility` theirs; `width` and `height` are the frame's in pixels, so
 * angles are the ones a viewer sees. A line whose ends were not seen is null. */
export function frameLines(xy, visibility, width, height) {
  const px = (i) => [xy[i][0] * width, xy[i][1] * height];
  const seen = (...ids) => ids.every((i) => visibility[i] >= SEEN);
  const line = (a, b) => (seen(a, b) ? { a: xy[a], b: xy[b], ...fromLevel(px(a), px(b)) } : null);
  const shoulders = line(L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
  const hips = line(L.LEFT_HIP, L.RIGHT_HIP);
  let spine = null;
  if (seen(L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP)) {
    const low = mid(px(L.LEFT_HIP), px(L.RIGHT_HIP)), high = mid(px(L.LEFT_SHOULDER), px(L.RIGHT_SHOULDER));
    spine = { a: [low[0] / width, low[1] / height], b: [high[0] / width, high[1] / height],
              ...fromUpright(low, high) };
  }
  return { shoulders, hips, spine };
}

/* A box round the head as it was at address, as fractions of the frame, padded
 * so a still head stays inside it; null if the head was not seen. */
export function headBox(xy, visibility, pad = 0.35) {
  const seen = HEAD.filter((i) => visibility[i] >= SEEN);
  if (seen.length < 3) return null;
  const xs = seen.map((i) => xy[i][0]), ys = seen.map((i) => xy[i][1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = size * (0.5 + pad);
  return { x: cx - half, y: cy - half, width: 2 * half, height: 2 * half };
}

/* Whether the head is inside the address box on this frame (its seen points' centre). */
export function headInside(box, xy, visibility) {
  const seen = HEAD.filter((i) => visibility[i] >= SEEN);
  if (!box || seen.length < 3) return null;
  const cx = seen.reduce((s, i) => s + xy[i][0], 0) / seen.length;
  const cy = seen.reduce((s, i) => s + xy[i][1], 0) / seen.length;
  return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height;
}

/* The words for each line, by view. `faceOn` is true, false (down the line), or
 * null when the view is not known; every label says it is read in the picture. */
export function lineLabels(lines, faceOn) {
  const names = faceOn === false
    ? { shoulders: "Shoulder line", hips: "Hip line", spine: "Spine, forward lean" }
    : faceOn === true
      ? { shoulders: "Shoulder tilt", hips: "Hip tilt", spine: "Spine, side lean" }
      : { shoulders: "Shoulder line", hips: "Hip line", spine: "Spine line" };
  const out = {};
  for (const key of ["shoulders", "hips"]) {
    const l = lines[key];
    out[key] = l ? `${names[key]} ${Math.round(l.degrees)}° from level` +
      (l.lower && Math.round(l.degrees) > 0 ? ` (${l.lower} end lower)` : "") + ", in the picture" : null;
  }
  const s = lines.spine;
  out.spine = s ? `${names.spine} ${Math.round(s.degrees)}° from upright` +
    (s.leans && Math.round(s.degrees) > 0 ? ` (leaning ${s.leans})` : "") + ", in the picture" : null;
  return out;
}
