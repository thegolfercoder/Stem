/* The trained network and the ordered decoder, in the browser.
 *
 * Six hundred thousand parameters of dilated convolution. Small enough that
 * plain JavaScript on typed arrays runs a swing in well under a second, which is
 * nothing beside the pose estimation, so there is no case for pulling in a
 * tensor library to do it.
 */

const NUM_EVENTS = 8;

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class SwingEventNet {
  constructor(payload) {
    this.arch = payload.architecture;
    const weights = decodeBase64(payload.weights_base64);
    this.tensors = {};
    for (const t of payload.tensors) {
      this.tensors[t.name] = weights.subarray(t.offset, t.offset + t.count);
    }
  }

  /* Channels-first throughout, matching PyTorch, so the weight layout can be used
   * as it comes out rather than being transposed on the way in. */
  _conv1d(input, channelsIn, channelsOut, n, weight, bias, kernel, dilation) {
    const out = new Float32Array(channelsOut * n);
    const pad = (dilation * (kernel - 1)) / 2;
    for (let co = 0; co < channelsOut; co++) {
      const base = co * n;
      const b = bias[co];
      for (let t = 0; t < n; t++) out[base + t] = b;
      for (let ci = 0; ci < channelsIn; ci++) {
        const inBase = ci * n;
        for (let k = 0; k < kernel; k++) {
          const w = weight[(co * channelsIn + ci) * kernel + k];
          if (w === 0) continue;
          const shift = k * dilation - pad;
          const from = Math.max(0, -shift);
          const to = Math.min(n, n - shift);
          for (let t = from; t < to; t++) out[base + t] += w * input[inBase + t + shift];
        }
      }
    }
    return out;
  }

  _groupNorm(x, channels, n, weight, bias, groups) {
    const perGroup = channels / groups;
    for (let g = 0; g < groups; g++) {
      const start = g * perGroup;
      let sum = 0, sumSquares = 0;
      const count = perGroup * n;
      for (let c = start; c < start + perGroup; c++) {
        const base = c * n;
        for (let t = 0; t < n; t++) { const v = x[base + t]; sum += v; sumSquares += v * v; }
      }
      const mean = sum / count;
      const inverse = 1 / Math.sqrt(sumSquares / count - mean * mean + 1e-5);
      for (let c = start; c < start + perGroup; c++) {
        const base = c * n;
        const w = weight[c], b = bias[c];
        for (let t = 0; t < n; t++) x[base + t] = (x[base + t] - mean) * inverse * w + b;
      }
    }
    return x;
  }

  /* The exact erf-based GELU, not the tanh approximation. They differ by about a
   * thousandth, which is small until it is compounded through fourteen layers. */
  _gelu(x) {
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      x[i] = 0.5 * v * (1 + erf(v / Math.SQRT2));
    }
    return x;
  }

  forward(features, n, width) {
    const { channels, dilations, kernel_size: kernel, groups, classes } = this.arch;

    // (T, F) as delivered, to (F, T) as the convolutions want it.
    const input = new Float32Array(width * n);
    for (let t = 0; t < n; t++) {
      for (let f = 0; f < width; f++) input[f * n + t] = features[t * width + f];
    }

    let x = this._conv1d(input, width, channels, n,
      this.tensors["input_projection.weight"], this.tensors["input_projection.bias"], 1, 1);
    x = this._gelu(this._groupNorm(x, channels, n,
      this.tensors["input_norm.weight"], this.tensors["input_norm.bias"], groups));

    dilations.forEach((dilation, index) => {
      const residual = x.slice();
      let h = this._conv1d(x, channels, channels, n,
        this.tensors[`blocks.${index}.conv1.weight`],
        this.tensors[`blocks.${index}.conv1.bias`], kernel, dilation);
      h = this._gelu(this._groupNorm(h, channels, n,
        this.tensors[`blocks.${index}.norm1.weight`],
        this.tensors[`blocks.${index}.norm1.bias`], groups));
      h = this._conv1d(h, channels, channels, n,
        this.tensors[`blocks.${index}.conv2.weight`],
        this.tensors[`blocks.${index}.conv2.bias`], kernel, dilation);
      h = this._gelu(this._groupNorm(h, channels, n,
        this.tensors[`blocks.${index}.norm2.weight`],
        this.tensors[`blocks.${index}.norm2.bias`], groups));
      for (let i = 0; i < h.length; i++) h[i] += residual[i];
      x = h;
    });

    const head = this._conv1d(x, channels, classes, n,
      this.tensors["head.weight"], this.tensors["head.bias"], 1, 1);

    // Back to (T, classes).
    const logits = new Float32Array(n * classes);
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < classes; c++) logits[t * classes + c] = head[c * n + t];
    }
    return logits;
  }
}

/* Abramowitz and Stegun 7.1.26. Accurate to about 1e-7, which is well below the
 * precision the weights themselves carry. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export function logSoftmax(logits, n, classes) {
  const out = new Float64Array(n * classes);
  for (let t = 0; t < n; t++) {
    const row = t * classes;
    let max = -Infinity;
    for (let c = 0; c < classes; c++) max = Math.max(max, logits[row + c]);
    let sum = 0;
    for (let c = 0; c < classes; c++) sum += Math.exp(logits[row + c] - max);
    const logSum = Math.log(sum);
    for (let c = 0; c < classes; c++) out[row + c] = logits[row + c] - max - logSum;
  }
  return out;
}

/* The best strictly increasing assignment of the eight events to frames.
 *
 * The ordering is not a tidy-up applied afterwards. A swing's events happen once
 * each in a fixed order, so the decoder searches only sequences that satisfy
 * that, and an impossible answer cannot come back. Eight independent maxima can
 * and do put impact before the top of the backswing. */
export function decodeEvents(logits, n, classes, minMeanConfidence) {
  if (n < NUM_EVENTS) {
    return { ok: false, reason: `clip is ${n} frames long and a swing needs at least ${NUM_EVENTS}` };
  }
  const scores = logSoftmax(logits, n, classes);
  const at = (event, frame) => scores[frame * classes + event];

  const NEG = -1e30;
  const best = [], back = [];
  for (let e = 0; e < NUM_EVENTS; e++) {
    best.push(new Float64Array(n).fill(NEG));
    back.push(new Int32Array(n));
  }
  for (let t = 0; t < n; t++) best[0][t] = at(0, t);

  for (let e = 1; e < NUM_EVENTS; e++) {
    let runningBest = NEG, runningArg = 0;
    for (let t = 1; t < n; t++) {
      if (best[e - 1][t - 1] > runningBest) {
        runningBest = best[e - 1][t - 1];
        runningArg = t - 1;
      }
      best[e][t] = at(e, t) + runningBest;
      back[e][t] = runningArg;
    }
    best[e][0] = NEG;
  }

  const last = best[NUM_EVENTS - 1];
  let bestFrame = 0, bestScore = NEG;
  for (let t = 0; t < n; t++) if (last[t] > bestScore) { bestScore = last[t]; bestFrame = t; }
  if (bestScore <= NEG / 2) {
    return { ok: false, reason: "no ordering of the eight events fits in this clip" };
  }

  const frames = new Int32Array(NUM_EVENTS);
  frames[NUM_EVENTS - 1] = bestFrame;
  for (let e = NUM_EVENTS - 1; e > 0; e--) frames[e - 1] = back[e][frames[e]];

  const confidence = [], subframe = [];
  let logSum = 0;
  for (let e = 0; e < NUM_EVENTS; e++) {
    const p = Math.exp(at(e, frames[e]));
    confidence.push(p);
    logSum += Math.log(Math.max(p, 1e-12));

    // Centre of mass of the probability bump, which recovers a fraction of a
    // frame. Clamped to the chosen frame's neighbours: it sharpens a good answer
    // and is not allowed to move a bad one somewhere else.
    const lo = Math.max(0, frames[e] - 2), hi = Math.min(n, frames[e] + 3);
    let total = 0, weighted = 0;
    for (let t = lo; t < hi; t++) {
      const w = Math.exp(at(e, t));
      total += w; weighted += t * w;
    }
    const centre = total > 0 ? weighted / total : frames[e];
    subframe.push(Math.min(frames[e] + 1, Math.max(frames[e] - 1, centre)));
  }

  const meanConfidence = Math.exp(logSum / NUM_EVENTS);
  if (meanConfidence < minMeanConfidence) {
    return {
      ok: false,
      reason: `best ordered sequence has a mean confidence of ${meanConfidence.toFixed(3)}, ` +
        `below the ${minMeanConfidence.toFixed(2)} required; this clip probably does not contain a swing`,
    };
  }
  return { ok: true, frames: Array.from(frames), confidence, subframe, meanConfidence };
}
