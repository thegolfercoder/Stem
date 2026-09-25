import Foundation

/// One analysed swing, as it is shown and kept.
public struct SwingResult: Codable {
    public var handedness: Handedness
    /// "detected", "chosen" or "assumed".
    public var handednessFrom: String
    public var frames: [Int]
    public var subframe: [Double]
    public var confidence: [Double]
    public var meanConfidence: Double
    public var metrics: SwingMetrics
    public var detectionRate: Double
    /// Times of the resampled grid the frames index into.
    public var grid: [Double]
}

public enum Verdict {
    case swing(SwingResult)
    case refused(reason: String, advice: String, score: Double)

    /// For choosing between candidate stretches of a long clip: any swing beats
    /// any refusal, and among swings the one the model is surest of wins.
    public var score: Double {
        switch self {
        case .swing(let result): return 1 + result.meanConfidence
        case .refused(_, _, let score): return score
        }
    }

    public var result: SwingResult? {
        if case .swing(let result) = self { return result }
        return nil
    }
}

public final class SwingAnalyzer {
    public let payload: ModelPayload
    public let model: EventModel

    public init(payload: ModelPayload) throws {
        self.payload = payload
        model = try EventModel(payload: payload)
    }

    public static func bundled() throws -> SwingAnalyzer {
        try SwingAnalyzer(payload: ModelPayload.bundled())
    }

    public func logits(_ sequence: PoseSequence, handedness: Handedness) -> [Float] {
        let features = extractFeatures(sequence, handedness: handedness, config: payload.features)
        return model.forward(features, n: sequence.count, width: payload.features.layout.total)
    }

    private func decode(_ resampled: PoseSequence, _ hand: Handedness) -> Decoded {
        let t = payload.thresholds
        return decodeEvents(logits(resampled, handedness: hand), n: resampled.count,
                            classes: payload.architecture.classes,
                            minMeanConfidence: t.minMeanConfidence, minCoreConfidence: t.minCoreConfidence)
    }

    /// Analyse a tracked clip. `handedness` nil means work it out.
    public func analyse(_ sequence: PoseSequence, handedness: Handedness? = nil) -> Verdict {
        let config = payload.features, thresholds = payload.thresholds
        let resampled = resamplePose(sequence, rateHz: config.canonicalRateHz)
        let detectionRate = Double(resampled.detected.filter { $0 }.count) / Double(max(1, resampled.count))
        if detectionRate < thresholds.minDetectionRate {
            return .refused(
                reason: String(format: "a body was found in only %.0f percent of frames, below the %.0f "
                    + "percent a swing needs", detectionRate * 100, thresholds.minDetectionRate * 100),
                advice: "Make sure the golfer is fully in shot for the whole clip and reasonably well lit. "
                    + "Standing further back so the whole body fits beats filling the frame and losing the feet.",
                score: detectionRate - 1)
        }

        // Handedness reaches only a few inputs, so a first pass either way finds the
        // top well enough to ask the body which way round it is; if the first pass
        // finds nothing, the other way round gets its own chance.
        var hand = handedness ?? .right
        var decoded = decode(resampled, hand)
        var from = handedness == nil ? "assumed" : "chosen"
        if handedness == nil {
            if decoded.events == nil {
                let other = decode(resampled, .left)
                if other.events != nil || other.meanConfidence > decoded.meanConfidence {
                    decoded = other
                    hand = .left
                }
            }
            if let events = decoded.events, let call = inferHandedness(resampled, top: events.frames[3]) {
                from = "detected"
                if call.hand != hand {
                    let again = decode(resampled, call.hand)
                    if again.events != nil { decoded = again; hand = call.hand }
                }
            }
        }
        guard let events = decoded.events else {
            if case .refused(let reason, let mean) = decoded {
                return .refused(
                    reason: reason,
                    advice: "This is most often a clip that stops before the finish, or one filmed from behind "
                        + "the golfer where the body hides itself. Face on, square to the target line, is what "
                        + "it handles best.",
                    score: mean ?? 0)
            }
            return .refused(reason: "no swing found", advice: "", score: 0)
        }
        let metrics = computeMetrics(resampled, events, config: config)
        if let problem = implausible(metrics, thresholds) {
            return .refused(reason: problem,
                            advice: "The clip probably does not contain a whole swing. Start recording before "
                                + "the takeaway and keep going until the finish is held.",
                            score: 0.5 * events.meanConfidence)
        }
        return .swing(SwingResult(
            handedness: hand, handednessFrom: from, frames: events.frames, subframe: events.subframe,
            confidence: events.confidence, meanConfidence: events.meanConfidence, metrics: metrics,
            detectionRate: detectionRate, grid: resampled.times))
    }

    public func band(event: Int, confidence: Double) -> ErrorBand? {
        errorBand(payload.calibration, event: event, confidence: confidence)
    }

    /// The measured 80% spread on the tempo ratio, as a fraction, if measured.
    public var tempoBand: Double? { payload.calibration?.tempo?.halfWidthFraction }
}

/// One sample of a coarse scan through a long clip.
public struct ScanSample {
    public var time: Double
    public var landmarks: [Point]?
    public init(time: Double, landmarks: [Point]?) { self.time = time; self.landmarks = landmarks }
}

/// The stretches of a long clip most likely to hold the swing, best first, from a
/// scan a few frames a second. Each moment the hands move fastest for a second
/// either side is a candidate, raised where the hands also went above the
/// shoulders (every full swing does; walking and waggles do not) and lowered where
/// the feet were moving. Up to three, at least two and a half seconds apart. A
/// port of the browser's scanForSwing; the model decides between them.
public func swingCandidates(_ samples: [ScanSample], width: Double, height: Double,
                            duration: Double) -> [(start: Double, end: Double)] {
    let n = samples.count
    if n == 0 { return [] }
    func midpoint(_ m: [Point], _ a: Int, _ b: Int) -> Point {
        Point((m[a].x + m[b].x) * 0.5 * width, (m[a].y + m[b].y) * 0.5 * height)
    }
    var speed = [Double](repeating: 0, count: n), feet = [Double](repeating: 0, count: n)
    var high = [Double](repeating: -.infinity, count: n)
    for i in 0..<n {
        guard let b = samples[i].landmarks else { continue }
        let shoulders = midpoint(b, 11, 12), hips = midpoint(b, 23, 24)
        let torso = hypot(shoulders.x - hips.x, shoulders.y - hips.y)
        if torso < 1 { continue }
        high[i] = (shoulders.y - midpoint(b, 15, 16).y) / torso
        guard i > 0, let a = samples[i - 1].landmarks else { continue }
        let dt = max(1e-3, samples[i].time - samples[i - 1].time)
        let ha = midpoint(a, 15, 16), hb = midpoint(b, 15, 16)
        speed[i] = hypot(hb.x - ha.x, hb.y - ha.y) / torso / dt
        let fa = midpoint(a, 27, 28), fb = midpoint(b, 27, 28)
        feet[i] = hypot(fb.x - fa.x, fb.y - fa.y) / torso / dt
    }
    var smooth = [Double](repeating: 0, count: n)
    for i in 0..<n {
        let before = speed[max(0, i - 1)], after = speed[min(n - 1, i + 1)]
        smooth[i] = (before + 2 * speed[i] + after) / 4
    }
    func around(_ i: Int, _ before: Double, _ after: Double, _ pick: (Int) -> Double) -> [Double] {
        (0..<n).filter { samples[$0].time >= samples[i].time - before && samples[$0].time <= samples[i].time + after }
            .map(pick)
    }
    var peaks: [(i: Int, score: Double)] = []
    for i in 0..<n where smooth[i] > 0 {
        if smooth[i] < (around(i, 1, 1) { smooth[$0] }.max() ?? 0) { continue }
        let raised = around(i, 2, 1) { high[$0] }.max() ?? -.infinity
        let walking = around(i, 1.5, 1.5) { feet[$0] }
        let feetSpeed = walking.reduce(0, +) / Double(max(1, walking.count))
        var score = smooth[i] * (1 + 2 * max(0, min(1, raised + 0.2)))
        if feetSpeed > 0.8 { score *= 0.3 }
        peaks.append((i, score))
    }
    peaks.sort { $0.score > $1.score }
    var chosen: [Int] = []
    for p in peaks where chosen.count < 3 {
        if chosen.contains(where: { abs(samples[$0].time - samples[p.i].time) < 2.5 }) { continue }
        chosen.append(p.i)
    }
    return chosen.map { peak in
        let active = 0.25 * smooth[peak]
        var left = peak, right = peak
        while left > 0 && max(smooth[left - 1], smooth[max(0, left - 2)]) > active { left -= 1 }
        while right < n - 1 && max(smooth[right + 1], smooth[min(n - 1, right + 2)]) > active { right += 1 }
        let tp = samples[peak].time
        return (max(0, tp - 4.5, min(samples[left].time - 1.5, tp - 3.0)),
                min(duration, tp + 3.5, max(samples[right].time + 1.2, tp + 2.0)))
    }
}
