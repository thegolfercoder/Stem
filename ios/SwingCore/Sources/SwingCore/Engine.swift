import Foundation

// A port of webapp/engine.js, which is itself held to the Python pipeline to five
// decimal places. Where anything here disagrees with those, they are right: this
// file is checked against their output on a real swing by the tests.

func median(_ values: [Double]) -> Double {
    if values.isEmpty { return .nan }
    let sorted = values.sorted()
    let mid = sorted.count / 2
    return sorted.count % 2 == 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid])
}

/// numpy.gradient: central differences inside, one-sided at the ends, with the
/// spacing taken from the sample positions rather than assumed uniform.
func gradient(_ values: [Double], _ positions: [Double]) -> [Double] {
    let n = values.count
    var out = [Double](repeating: 0, count: n)
    if n < 2 { return out }
    out[0] = (values[1] - values[0]) / (positions[1] - positions[0])
    out[n - 1] = (values[n - 1] - values[n - 2]) / (positions[n - 1] - positions[n - 2])
    if n > 2 {
        for i in 1..<(n - 1) {
            let back = positions[i] - positions[i - 1]
            let forward = positions[i + 1] - positions[i]
            out[i] = (back * back * values[i + 1] + (forward * forward - back * back) * values[i]
                - forward * forward * values[i - 1]) / (back * forward * (back + forward))
        }
    }
    return out
}

func mid(_ frame: [Point], _ a: Int, _ b: Int) -> Point {
    Point(0.5 * (frame[a].x + frame[b].x), 0.5 * (frame[a].y + frame[b].y))
}

/// Resample onto a uniform grid using the real frame times. Linear on purpose: a
/// smoother interpolant overshoots at the top and at impact, the two instants
/// being looked for.
public func resamplePose(_ sequence: PoseSequence, rateHz: Double) -> PoseSequence {
    let source = sequence.times
    if source.count < 2 { return sequence }
    let duration = source[source.count - 1] - source[0]
    let count = max(2, Int((duration * rateHz).rounded()) + 1)
    var grid = [Double](repeating: 0, count: count)
    for i in 0..<count {
        grid[i] = min(source[0] + Double(i) / rateHz, source[source.count - 1])
    }
    var xy: [[Point]] = [], visibility: [[Double]] = [], detected: [Bool] = []
    xy.reserveCapacity(count)
    var cursor = 0
    for t in grid {
        while cursor < source.count - 2 && source[cursor + 1] < t { cursor += 1 }
        let t0 = source[cursor], t1 = source[cursor + 1]
        let blend = t1 > t0 ? (t - t0) / (t1 - t0) : 0
        let a = sequence.xy[cursor], b = sequence.xy[cursor + 1]
        xy.append(zip(a, b).map { p, q in Point(p.x + (q.x - p.x) * blend, p.y + (q.y - p.y) * blend) })
        let av = sequence.visibility[cursor], bv = sequence.visibility[cursor + 1]
        visibility.append(zip(av, bv).map { v, w in v + (w - v) * blend })
        // Nearest neighbour, so a gap is never filled in by averaging across it.
        detected.append(sequence.detected[blend < 0.5 ? cursor : cursor + 1])
    }
    return PoseSequence(xy: xy, visibility: visibility, detected: detected, times: grid,
                        width: sequence.width, height: sequence.height)
}

/// A length taken from the golfer, so everything else can be dimensionless:
/// shoulder centre to ankle centre, median over the clip; torso length times
/// three when the feet are out of shot.
func bodyScale(_ square: [[Point]], _ visibility: [[Double]], _ minVisibility: Double) -> Double {
    var heights: [Double] = [], torsos: [Double] = []
    for i in 0..<square.count {
        let shoulders = mid(square[i], Landmark.leftShoulder, Landmark.rightShoulder)
        let hips = mid(square[i], Landmark.leftHip, Landmark.rightHip)
        let ankles = mid(square[i], Landmark.leftAnkle, Landmark.rightAnkle)
        torsos.append(hypot(shoulders.x - hips.x, shoulders.y - hips.y))
        let seen = min(visibility[i][Landmark.leftAnkle], visibility[i][Landmark.rightAnkle])
        if seen >= minVisibility {
            heights.append(hypot(shoulders.x - ankles.x, shoulders.y - ankles.y))
        }
    }
    if Double(heights.count) >= max(3, 0.25 * Double(square.count)) {
        let scale = median(heights)
        if scale > 1e-6 { return scale }
    }
    return max(median(torsos) * 3.0, 1e-6)
}

/// Median tilt of the golfer's long axis, taken to be the camera's roll.
func bodyAxisAngle(_ square: [[Point]], _ visibility: [[Double]], _ minVisibility: Double) -> Double {
    var angles: [Double] = [], all: [Double] = []
    for i in 0..<square.count {
        let shoulders = mid(square[i], Landmark.leftShoulder, Landmark.rightShoulder)
        let hips = mid(square[i], Landmark.leftHip, Landmark.rightHip)
        let angle = atan2(shoulders.x - hips.x, -(shoulders.y - hips.y))
        all.append(angle)
        let seen = min(visibility[i][Landmark.leftShoulder], visibility[i][Landmark.rightShoulder])
        if seen >= minVisibility { angles.append(angle) }
    }
    return median(angles.isEmpty ? all : angles)
}

func normalisePose(_ sequence: PoseSequence, _ config: ModelPayload.Features) -> [[Point]] {
    let square = sequence.squareXY()
    let scale = bodyScale(square, sequence.visibility, config.minVisibility)
    let roll = config.normaliseRoll ? bodyAxisAngle(square, sequence.visibility, config.minVisibility) : 0
    let c = cos(-roll), s = sin(-roll)
    return square.map { frame in
        let pelvis = mid(frame, Landmark.leftHip, Landmark.rightHip)
        return frame.map { p in
            let cx = (p.x - pelvis.x) / scale, cy = (p.y - pelvis.y) / scale
            return roll == 0 ? Point(cx, cy) : Point(cx * c - cy * s, cx * s + cy * c)
        }
    }
}

private func unit(_ x: Double, _ y: Double) -> (Double, Double) {
    let n = max(hypot(x, y), 1e-6)
    return (x / n, y / n)
}

/// The feature matrix, (frames x width) row-major, in the block order the model
/// was trained with.
public func extractFeatures(_ sequence: PoseSequence, handedness: Handedness,
                            config: ModelPayload.Features) -> [Float] {
    let coords = normalisePose(sequence, config)
    let times = sequence.times
    let n = times.count
    let joints = Landmark.swing
    let width = config.layout.total
    var out = [Float](repeating: 0, count: n * width)

    let lead = handedness == .left
        ? (shoulder: Landmark.rightShoulder, wrist: Landmark.rightWrist)
        : (shoulder: Landmark.leftShoulder, wrist: Landmark.leftWrist)
    let trail = handedness == .left
        ? (shoulder: Landmark.leftShoulder, wrist: Landmark.leftWrist)
        : (shoulder: Landmark.rightShoulder, wrist: Landmark.rightWrist)

    let px = joints.map { j in coords.map { $0[j].x } }
    let py = joints.map { j in coords.map { $0[j].y } }
    let vx = px.map { gradient($0, times) }
    let vy = py.map { gradient($0, times) }
    let handsX = coords.map { 0.5 * ($0[Landmark.leftWrist].x + $0[Landmark.rightWrist].x) }
    let handsY = coords.map { 0.5 * ($0[Landmark.leftWrist].y + $0[Landmark.rightWrist].y) }
    let handVX = gradient(handsX, times)
    let handVY = gradient(handsY, times)

    for i in 0..<n {
        let row = i * width
        let frame = coords[i]
        var c = 0
        func put(_ v: Double) { out[row + c] = Float(v); c += 1 }

        for k in 0..<joints.count { put(px[k][i]); put(py[k][i]) }
        for k in 0..<joints.count { put(vx[k][i]); put(vy[k][i]) }
        for k in 0..<joints.count { put(hypot(vx[k][i], vy[k][i])) }
        for k in 0..<joints.count { put(sequence.visibility[i][joints[k]]) }

        let shoulderLine = (frame[Landmark.leftShoulder].x - frame[Landmark.rightShoulder].x,
                            frame[Landmark.leftShoulder].y - frame[Landmark.rightShoulder].y)
        let hipLine = (frame[Landmark.leftHip].x - frame[Landmark.rightHip].x,
                       frame[Landmark.leftHip].y - frame[Landmark.rightHip].y)
        let shoulderCentre = mid(frame, Landmark.leftShoulder, Landmark.rightShoulder)
        let hipCentre = mid(frame, Landmark.leftHip, Landmark.rightHip)
        let spine = (shoulderCentre.x - hipCentre.x, shoulderCentre.y - hipCentre.y)
        let leadArm = (frame[lead.wrist].x - frame[lead.shoulder].x,
                       frame[lead.wrist].y - frame[lead.shoulder].y)
        let trailArm = (frame[trail.wrist].x - frame[trail.shoulder].x,
                        frame[trail.wrist].y - frame[trail.shoulder].y)
        for v in [shoulderLine, hipLine, spine, leadArm, trailArm] {
            let (ux, uy) = unit(v.0, v.1)
            put(ux); put(uy)
        }
        put(handsX[i] - shoulderCentre.x)
        put(handsY[i] - shoulderCentre.y)
        put(handVX[i])
        put(handVY[i])
        put(hypot(handVX[i], handVY[i]))
        put(hypot(shoulderLine.0, shoulderLine.1))
        put(hypot(hipLine.0, hipLine.1))
        put(hypot(leadArm.0, leadArm.1))
    }
    for i in 0..<out.count where !out[i].isFinite { out[i] = 0 }
    return out
}
