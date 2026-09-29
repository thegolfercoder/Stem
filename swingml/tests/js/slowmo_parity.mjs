/* The browser's slow-motion retry, headlessly, for the Python side to check.
 *
 * `attempt` below is the app's per-read decision without the handedness search
 * (the job fixes handedness): resample, decode with the payload's thresholds,
 * measure, gate on plausible timing. `readAtSpeeds` and `slowedMetrics` are the
 * shipped functions, so what is compared is the retry itself.
 */
import { readFileSync } from "node:fs";
import { PoseSequence, resamplePose, extractFeatures } from "../../webapp/engine.js";
import { SwingEventModel, decodeEvents } from "../../webapp/model.js";
import { computeMetrics, implausible, readAtSpeeds } from "../../webapp/metrics.js";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const payload = JSON.parse(readFileSync(job.payload, "utf8"));
const config = payload.features;
const thresholds = payload.thresholds;
const net = new SwingEventModel(payload);

const attempt = (sequence) => {
  const { sequence: resampled } = resamplePose(sequence, config.canonical_rate_hz);
  const detected = resampled.detected.reduce((a, b) => a + (b ? 1 : 0), 0) / Math.max(1, resampled.n);
  if (detected < thresholds.min_detection_rate) return { ok: false, refusedBy: "detection" };
  const { features, n, width } = extractFeatures(resampled, job.handedness, config);
  const decoded = decodeEvents(
    net.forward(features, n, width), n, payload.architecture.classes,
    thresholds.min_mean_confidence, thresholds.min_core_confidence || 0,
  );
  if (!decoded.ok) return { ok: false, refusedBy: "events", reason: decoded.reason };
  const metrics = computeMetrics(resampled, decoded, job.handedness, config);
  const problem = implausible(metrics, thresholds);
  if (problem) return { ok: false, refusedBy: "events", reason: problem };
  return { ok: true, refusedBy: null, decoded, metrics };
};

const sequence = new PoseSequence(
  job.xy, job.visibility, job.world, job.detected, job.times, job.width, job.height,
);
const read = readAtSpeeds(sequence, attempt, thresholds.slow_motion_factors);
const result = { ok: read.ok, slowedBy: read.slowedBy, factors: thresholds.slow_motion_factors };
if (read.ok) {
  Object.assign(result, {
    frames: Array.from(read.decoded.frames),
    tempoRatio: read.metrics.tempoRatio,
    backswingMs: read.metrics.backswingMs,
    downswingMs: read.metrics.downswingMs,
    peakHandSpeedMs: read.metrics.peakHandSpeedMs,
    eventTimes: Array.from(read.metrics.eventTimes),
  });
} else {
  result.reason = read.reason;
}
process.stdout.write(JSON.stringify(result));
