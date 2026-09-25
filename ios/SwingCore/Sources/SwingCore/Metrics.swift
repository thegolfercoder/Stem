import Foundation

/// What is measured from one swing. Durations come straight off the frame times;
/// lengths are in units of the golfer's own body; turns come from foreshortening.
/// All of these survive an uncalibrated phone camera. Nothing here is a club,
/// ball or launch quantity: one camera on a body tracker cannot measure those.
public struct SwingMetrics: Codable, Equatable {
    public var eventTimes: [Double]
    public var tempoRatio: Double?
    public var backswingMs: Double
    public var downswingMs: Double
    public var wholeMs: Double
    public var peakHandSpeedMs: Double
    public var shoulderTurnDeg: Double?
    public var hipTurnDeg: Double?
    public var headMovement: Double?
    public var pelvisSway: Double?
    public var pelvisLift: Double?
    public var feetInShot: Bool
}

func percentile(_ values: [Double], _ p: Double) -> Double {
    if values.isEmpty { return .nan }
    let sorted = values.sorted()
    let position = Double(sorted.count - 1) * p
    let lower = Int(position.rounded(.down)), upper = Int(position.rounded(.up))
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - Double(lower))
}

/// How far a body line has turned away from square to the camera, from how short
/// it looks against the widest it appeared in the clip. Unsigned: turning towards
/// the camera and away from it shorten a line identically.
func turnFromForeshortening(_ square: [[Point]], _ visibility: [[Double]], _ a: Int, _ b: Int,
                            from: Int, to: Int, frame: Int, minVisibility: Double) -> Double? {
    var widths: [Double] = []
    if from < to {
        for i in from..<to where min(visibility[i][a], visibility[i][b]) >= minVisibility {
            widths.append(hypot(square[i][a].x - square[i][b].x, square[i][a].y - square[i][b].y))
        }
    }
    if widths.count < 5 { return nil }
    let reference = percentile(widths, 0.95)
    if reference <= 1e-6 { return nil }
    if min(visibility[frame][a], visibility[frame][b]) < minVisibility { return nil }
    let here = hypot(square[frame][a].x - square[frame][b].x, square[frame][a].y - square[frame][b].y)
    return acos(min(1, max(0, here / reference))) * 180 / .pi
}

public func computeMetrics(_ sequence: PoseSequence, _ events: DecodedEvents,
                           config: ModelPayload.Features) -> SwingMetrics {
    let times = sequence.times
    let eventTimes = events.subframe.map { position -> Double in
        let lower = max(0, min(times.count - 1, Int(position.rounded(.down))))
        let upper = min(times.count - 1, lower + 1)
        return times[lower] + (position - Double(lower)) * (times[upper] - times[lower])
    }
    let backswing = eventTimes[3] - eventTimes[0]
    let downswing = eventTimes[5] - eventTimes[3]
    let whole = eventTimes[7] - eventTimes[0]

    let coords = normalisePose(sequence, config)
    let square = sequence.squareXY()
    let scale = bodyScale(square, sequence.visibility, config.minVisibility)
    let roll = config.normaliseRoll ? bodyAxisAngle(square, sequence.visibility, config.minVisibility) : 0
    let address = events.frames[0], top = events.frames[3]
    let impact = events.frames[5], finish = events.frames[7]

    let handsX = coords.map { 0.5 * ($0[Landmark.leftWrist].x + $0[Landmark.rightWrist].x) }
    let handsY = coords.map { 0.5 * ($0[Landmark.leftWrist].y + $0[Landmark.rightWrist].y) }
    let vx = gradient(handsX, times), vy = gradient(handsY, times)
    var peakFrame = top, peakSpeed = -1.0
    if top <= impact {
        for i in top...impact {
            let speed = hypot(vx[i], vy[i])
            if speed > peakSpeed { peakSpeed = speed; peakFrame = i }
        }
    }

    // Movement against the ground, not the pelvis: a golfer who swayed would
    // otherwise look perfectly still because everything moved with them.
    let c = cos(-roll), s = sin(-roll)
    var feetSeen = 0
    let grounded: [[Point]] = square.enumerated().map { i, frame in
        if min(sequence.visibility[i][Landmark.leftAnkle], sequence.visibility[i][Landmark.rightAnkle])
            >= config.minVisibility { feetSeen += 1 }
        let ankles = mid(frame, Landmark.leftAnkle, Landmark.rightAnkle)
        return frame.map { p in
            let gx = (p.x - ankles.x) / scale, gy = (p.y - ankles.y) / scale
            return roll == 0 ? Point(gx, gy) : Point(gx * c - gy * s, gx * s + gy * c)
        }
    }
    let haveFeet = Double(feetSeen) >= max(3, 0.25 * Double(square.count))
    var head: Double?, sway: Double?, lift: Double?
    if haveFeet {
        let headA = mid(grounded[address], Landmark.leftEar, Landmark.rightEar)
        let headI = mid(grounded[impact], Landmark.leftEar, Landmark.rightEar)
        let pelvisA = mid(grounded[address], Landmark.leftHip, Landmark.rightHip)
        let pelvisI = mid(grounded[impact], Landmark.leftHip, Landmark.rightHip)
        head = hypot(headI.x - headA.x, headI.y - headA.y)
        sway = abs(pelvisI.x - pelvisA.x)
        lift = abs(pelvisI.y - pelvisA.y)
    }
    let end = min(finish + 1, square.count)
    let shoulderTurn = turnFromForeshortening(square, sequence.visibility, Landmark.leftShoulder,
        Landmark.rightShoulder, from: address, to: end, frame: top, minVisibility: config.minVisibility)
    let hipTurn = turnFromForeshortening(square, sequence.visibility, Landmark.leftHip,
        Landmark.rightHip, from: address, to: end, frame: top, minVisibility: config.minVisibility)

    return SwingMetrics(
        eventTimes: eventTimes,
        tempoRatio: downswing > 0 ? backswing / downswing : nil,
        backswingMs: backswing * 1000, downswingMs: downswing * 1000, wholeMs: whole * 1000,
        peakHandSpeedMs: (times[peakFrame] - times[impact]) * 1000,
        shoulderTurnDeg: shoulderTurn, hipTurnDeg: hipTurn,
        headMovement: head, pelvisSway: sway, pelvisLift: lift, feetInShot: haveFeet)
}

/// Whether what was found is shaped like a golf swing at all: the decoder always
/// returns eight ordered frames, so ordering alone proves nothing.
public func implausible(_ metrics: SwingMetrics, _ thresholds: ModelPayload.Thresholds) -> String? {
    let back = metrics.backswingMs / 1000, down = metrics.downswingMs / 1000
    let b = thresholds.plausibleBackswingS, d = thresholds.plausibleDownswingS
    let t = thresholds.plausibleTempo
    if !(back >= b[0] && back <= b[1]) {
        return String(format: "the backswing would have lasted %.0f ms, outside the %.0f to %.0f ms a golf "
            + "swing takes. Whatever is in this clip, it is not a swing being made", back * 1000, b[0] * 1000, b[1] * 1000)
    }
    if !(down >= d[0] && down <= d[1]) {
        return String(format: "the downswing would have lasted %.0f ms, outside the %.0f to %.0f ms a golf "
            + "swing takes", down * 1000, d[0] * 1000, d[1] * 1000)
    }
    guard let tempo = metrics.tempoRatio, tempo >= t[0] && tempo <= t[1] else {
        return String(format: "the two halves imply a tempo outside the %.1f to %.1f a golf swing produces",
                      t[0], t[1])
    }
    return nil
}

/// Which way round the golfer stands, from where the hands are at the top: over
/// the right shoulder for a right-hander. The rule the training labels were made
/// with, right on 45 of 48 clips of players whose handedness is known.
public func inferHandedness(_ sequence: PoseSequence, top: Int) -> (hand: Handedness, margin: Double)? {
    let square = sequence.squareXY()
    var left = 0.0, right = 0.0, seen = 0
    let lo = max(0, top - 4), hi = min(sequence.count - 1, top + 4)
    if lo > hi { return nil }
    for f in lo...hi {
        let v = sequence.visibility[f]
        if min(v[Landmark.leftWrist], v[Landmark.rightWrist]) < 0.3 { continue }
        let p = square[f]
        let hx = 0.5 * (p[Landmark.leftWrist].x + p[Landmark.rightWrist].x)
        let hy = 0.5 * (p[Landmark.leftWrist].y + p[Landmark.rightWrist].y)
        left += hypot(hx - p[Landmark.leftShoulder].x, hy - p[Landmark.leftShoulder].y)
        right += hypot(hx - p[Landmark.rightShoulder].x, hy - p[Landmark.rightShoulder].y)
        seen += 1
    }
    if seen == 0 { return nil }
    return (right < left ? .right : .left, abs(right - left) / max(right + left, 1e-9))
}
