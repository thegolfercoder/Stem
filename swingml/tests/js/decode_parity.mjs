/* The ordered decoder alone, over whatever logits the Python side sends.
 *
 * Separate from the whole-pipeline check because it can be fed cases a real clip
 * never produces: eight frames exactly, events crowded against frame zero, ties,
 * flat scores with no peak anywhere. The dynamic program's boundaries are where a
 * re-implementation goes wrong, and a single well-behaved swing exercises none of
 * them - an off-by-one in its running maximum survived the whole-pipeline test
 * without a mark.
 */
import { readFileSync } from "node:fs";
import { decodeEvents } from "../../webapp/model.js";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const results = job.cases.map(({ logits, n, classes, minMeanConfidence, minCoreConfidence }) => {
  const decoded = decodeEvents(Float32Array.from(logits), n, classes, minMeanConfidence,
                               minCoreConfidence || 0);
  return decoded.ok
    ? {
        ok: true,
        frames: Array.from(decoded.frames),
        subframe: Array.from(decoded.subframe),
        confidence: Array.from(decoded.confidence),
      }
    : { ok: false, reason: decoded.reason };
});
process.stdout.write(JSON.stringify(results));
