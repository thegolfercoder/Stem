/* Run the browser pipeline headlessly, so the Python side can check it agrees.
 *
 * The three modules this imports carry no reference to a document, a window or a
 * canvas - deliberately, because the arithmetic of the analysis has nothing to do
 * with a browser and keeping it separable is what makes it testable at all. Only
 * app.js needs a DOM, and app.js is the part that draws.
 *
 * Reads one JSON job on argv, writes one JSON result to stdout. Everything about
 * how the two sides are compared lives in the Python test; this only runs.
 */
import { readFileSync } from "node:fs";
import { PoseSequence, resamplePose, extractFeatures } from "../../webapp/engine.js";
import { SwingEventModel, decodeEvents } from "../../webapp/model.js";
import { computeMetrics } from "../../webapp/metrics.js";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const payload = JSON.parse(readFileSync(job.payload, "utf8"));

const sequence = new PoseSequence(
  job.xy, job.visibility, job.world, job.detected, job.times, job.width, job.height,
);

const config = payload.features;
const { sequence: resampled } = resamplePose(sequence, config.canonical_rate_hz);
const { features, n, width } = extractFeatures(resampled, job.handedness, config);

const net = new SwingEventModel(payload);
const logits = net.forward(features, n, width);
const decoded = decodeEvents(
  logits, n, payload.architecture.classes, payload.thresholds.min_mean_confidence,
  payload.thresholds.min_core_confidence || 0,
);

const result = { n, ok: decoded.ok };
if (decoded.ok) {
  const metrics = computeMetrics(resampled, decoded, job.handedness, config);
  Object.assign(result, {
    frames: Array.from(decoded.frames),
    subframe: Array.from(decoded.subframe),
    confidence: Array.from(decoded.confidence),
    tempoRatio: metrics.tempoRatio,
    backswingMs: metrics.backswingMs,
    downswingMs: metrics.downswingMs,
    wholeMs: metrics.wholeMs,
    peakHandSpeedMs: metrics.peakHandSpeedMs,
    shoulderTurnDeg: metrics.shoulderTurnDeg,
    hipTurnDeg: metrics.hipTurnDeg,
    headMovement: metrics.headMovement,
    pelvisSway: metrics.pelvisSway,
    // A handful of feature columns, so a divergence that happens to leave the
    // events where they were still shows up.
    featureChecksum: Array.from({ length: 8 }, (_, i) => {
      let total = 0;
      for (let t = 0; t < n; t++) total += features[t * width + i * 17];
      return total;
    }),
  });
} else {
  result.reason = decoded.reason;
}
process.stdout.write(JSON.stringify(result));
