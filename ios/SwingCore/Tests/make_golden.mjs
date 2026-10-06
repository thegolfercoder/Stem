// Reference answers for the Swift tests, from the browser engine - which is held
// to the Python pipeline to five decimal places by swingml/tests. Regenerate with:
//   python ../../swingml/tests/fixtures/... (see make_golden.py next to this file)
import { readFileSync } from "node:fs";
import { PoseSequence, resamplePose, extractFeatures } from "../../../swingml/webapp/engine.js";
import { SwingEventModel, decodeEvents } from "../../../swingml/webapp/model.js";
import { computeMetrics } from "../../../swingml/webapp/metrics.js";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const payload = JSON.parse(readFileSync(process.argv[3], "utf8"));
const config = payload.features;
const sequence = new PoseSequence(job.xy, job.visibility, job.world, job.detected, job.times,
                                  job.width, job.height);
const { sequence: resampled } = resamplePose(sequence, config.canonical_rate_hz);
const net = new SwingEventModel(payload);
const out = { input: job, resampledTimes: resampled.times, cases: {} };
for (const hand of ["right", "left"]) {
  const { features, n, width } = extractFeatures(resampled, hand, config);
  const logits = net.forward(features, n, width);
  const decoded = decodeEvents(logits, n, payload.architecture.classes,
    payload.thresholds.min_mean_confidence, payload.thresholds.min_core_confidence || 0);
  const rows = [];
  for (let t = 0; t < n; t += 7) rows.push({ t, values: Array.from(features.slice(t * width, (t + 1) * width)) });
  const entry = { n, width, featureRows: rows, logits: Array.from(logits), ok: decoded.ok };
  if (decoded.ok) {
    Object.assign(entry, {
      frames: decoded.frames, subframe: decoded.subframe, confidence: decoded.confidence,
      meanConfidence: decoded.meanConfidence,
      metrics: computeMetrics(resampled, decoded, hand, config),
    });
  } else entry.reason = decoded.reason;
  out.cases[hand] = entry;
}
process.stdout.write(JSON.stringify(out));
