import Foundation

/// The eight positions, decoded in order: the best strictly increasing assignment
/// of events to frames. A swing's events happen once each in a fixed order, so
/// only such sequences are searched and an impossible answer cannot come back.
public struct DecodedEvents {
    public var frames: [Int]
    public var confidence: [Double]
    /// Centre of mass of each event's probability bump, clamped to the chosen
    /// frame's neighbours: a fraction of a frame recovered, never a move elsewhere.
    public var subframe: [Double]
    public var meanConfidence: Double
    public var coreConfidence: Double
}

public enum Decoded {
    case found(DecodedEvents)
    case refused(reason: String, meanConfidence: Double?)

    public var events: DecodedEvents? {
        if case .found(let events) = self { return events }
        return nil
    }

    /// For comparing candidate stretches of a clip.
    public var meanConfidence: Double {
        switch self {
        case .found(let events): return events.meanConfidence
        case .refused(_, let mean): return mean ?? 0
        }
    }
}

let eventCount = 8
/// Address, top, mid-downswing and impact: what every real swing is sure of, even
/// when a finish the clip cut short drags the mean of all eight down.
let coreEvents = [0, 3, 4, 5]

func logSoftmax(_ logits: [Float], _ n: Int, _ classes: Int) -> [Double] {
    var out = [Double](repeating: 0, count: n * classes)
    for t in 0..<n {
        let row = t * classes
        var biggest = -Double.infinity
        for c in 0..<classes { biggest = max(biggest, Double(logits[row + c])) }
        var sum = 0.0
        for c in 0..<classes { sum += exp(Double(logits[row + c]) - biggest) }
        let logSum = log(sum)
        for c in 0..<classes { out[row + c] = Double(logits[row + c]) - biggest - logSum }
    }
    return out
}

public func decodeEvents(_ logits: [Float], n: Int, classes: Int,
                         minMeanConfidence: Double, minCoreConfidence: Double = 0) -> Decoded {
    if n < eventCount {
        return .refused(reason: "clip is \(n) frames long and a swing needs at least \(eventCount)",
                        meanConfidence: nil)
    }
    let scores = logSoftmax(logits, n, classes)
    func at(_ event: Int, _ frame: Int) -> Double { scores[frame * classes + event] }

    let negative = -1e30
    var best = [[Double]](repeating: [Double](repeating: negative, count: n), count: eventCount)
    var back = [[Int]](repeating: [Int](repeating: 0, count: n), count: eventCount)
    for t in 0..<n { best[0][t] = at(0, t) }
    for e in 1..<eventCount {
        var runningBest = negative, runningArg = 0
        for t in 1..<n {
            if best[e - 1][t - 1] > runningBest {
                runningBest = best[e - 1][t - 1]
                runningArg = t - 1
            }
            best[e][t] = at(e, t) + runningBest
            back[e][t] = runningArg
        }
        best[e][0] = negative
    }
    var bestFrame = 0, bestScore = negative
    for t in 0..<n where best[eventCount - 1][t] > bestScore {
        bestScore = best[eventCount - 1][t]
        bestFrame = t
    }
    if bestScore <= negative / 2 {
        return .refused(reason: "no ordering of the eight events fits in this clip", meanConfidence: nil)
    }
    var frames = [Int](repeating: 0, count: eventCount)
    frames[eventCount - 1] = bestFrame
    for e in stride(from: eventCount - 1, to: 0, by: -1) { frames[e - 1] = back[e][frames[e]] }

    var confidence: [Double] = [], subframe: [Double] = []
    var logSum = 0.0
    for e in 0..<eventCount {
        let p = exp(at(e, frames[e]))
        confidence.append(p)
        logSum += log(max(p, 1e-12))
        let lo = max(0, frames[e] - 2), hi = min(n, frames[e] + 3)
        var total = 0.0, weighted = 0.0
        for t in lo..<hi {
            let w = exp(at(e, t))
            total += w
            weighted += Double(t) * w
        }
        let centre = total > 0 ? weighted / total : Double(frames[e])
        subframe.append(min(Double(frames[e] + 1), max(Double(frames[e] - 1), centre)))
    }
    let meanConfidence = exp(logSum / Double(eventCount))
    let coreConfidence = exp(coreEvents.map { log(max(confidence[$0], 1e-12)) }.reduce(0, +)
        / Double(coreEvents.count))
    if coreConfidence < minCoreConfidence {
        return .refused(
            reason: String(format: "address, top, mid-downswing and impact have a mean confidence of %.3f, "
                + "below the %.2f required; this clip probably does not contain a swing",
                coreConfidence, minCoreConfidence),
            meanConfidence: meanConfidence)
    }
    if meanConfidence < minMeanConfidence {
        return .refused(
            reason: String(format: "best ordered sequence has a mean confidence of %.3f, below the %.2f "
                + "required; this clip probably does not contain a swing",
                meanConfidence, minMeanConfidence),
            meanConfidence: meanConfidence)
    }
    return .found(DecodedEvents(frames: frames, confidence: confidence, subframe: subframe,
                                meanConfidence: meanConfidence, coreConfidence: coreConfidence))
}

/// An event's measured error band: the distance that held the stated share of
/// errors on held-out real swings at this confidence. Nil where none was measured,
/// which is never shown as zero.
public struct ErrorBand {
    public let frames: Double
    public let milliseconds: Double
    public let coverage: Double
    public let clips: Int
    public let measuredOn: String
}

let minimumBinCount = 40

public func errorBand(_ calibration: ModelPayload.Calibration?, event: Int, confidence: Double) -> ErrorBand? {
    guard let table = calibration?.events else { return nil }
    let edges = table.confidenceEdges[event]
    var bin = 0
    while bin < edges.count && confidence >= edges[bin] { bin += 1 }
    let count = table.counts[event][bin]
    if count < minimumBinCount { return nil }
    let frames = table.halfWidthFrames[event][bin]
    return ErrorBand(frames: frames, milliseconds: 1000 * frames / table.canonicalRateHz,
                     coverage: table.coverage, clips: count, measuredOn: table.measuredOn)
}
