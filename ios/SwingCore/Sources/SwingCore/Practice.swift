import Foundation

// The practice loop: one priority, one drill, a retest, a verdict.
//
// A port of swingml/insights (engine.py `choose`, compare.py `comparability` and
// `compare`) and of the plan bookkeeping in swingml/web/practice.py, as
// webapp/practice.js ports them for the browser. The rules are ported; their
// inputs are not: the drills, the tour tempo reference, the tolerances and the t
// table come from the exported payload (`practice`). PracticeTests holds these
// functions to answers the Python produced for the same swings
// (Tests/make_practice_golden.py), sentence for sentence.

/// The practice loop's fixed inputs, from swingml/insights/payload.py.
public struct PracticeRules: Codable {
    public struct TourTempo: Codable {
        public let p10: Double
        public let p50: Double
        public let p90: Double
        public let nSwings: Int
        public let source: String
        public let modelFingerprint: String

        enum CodingKeys: String, CodingKey {
            case p10, p50, p90, nSwings = "n_swings", source, modelFingerprint = "model_fingerprint"
        }
    }

    public let minSwings: Int
    public let shoulderRatioTolerance: Double
    public let bodyHeightTolerance: Double
    public let centreTolerance: Double
    public let scaleFreeMetrics: [String]
    public let t95: [[Double]]
    public let drills: [Drill]
    public let trackable: [[String]]
    public let tourTempo: TourTempo
    public let tempoLimits: [String]
    /// The same limits for left-handed swings, whose band was not measured (#33).
    /// Absent in older payloads, where the right-handed limits stand in.
    public let tempoLimitsLeftHanded: [String]?
    /// "One swing's tempo is uncertain…", by hand ("right", "left").
    public let oneSwing: [String: String]?

    enum CodingKeys: String, CodingKey {
        case minSwings = "min_swings", shoulderRatioTolerance = "shoulder_ratio_tolerance"
        case bodyHeightTolerance = "body_height_tolerance", centreTolerance = "centre_tolerance"
        case scaleFreeMetrics = "scale_free_metrics", t95, drills, trackable
        case tourTempo = "tour_tempo", tempoLimits = "tempo_limits"
        case tempoLimitsLeftHanded = "tempo_limits_left_handed", oneSwing = "one_swing"
    }

    public func drill(focus: String) -> Drill? { drills.first { $0.focus == focus } }
    public func drill(id: String) -> Drill? { drills.first { $0.id == id } }

    /// The critical value for the largest tabulated df not above `df` (conservative).
    public func criticalT(_ df: Double) -> Double {
        let usable = t95.filter { $0[0] <= max(df, 1) }
        return (usable.last ?? t95[0])[1]
    }
}

public struct Drill: Codable, Equatable, Identifiable {
    public let id: String
    public let focus: String
    public let title: String
    public let steps: [String]
    public let reps: String
    /// The stored metric a retest compares.
    public let metric: String
    /// "increase" or "decrease": which way the metric should move if the drill works.
    public let direction: String
    public let whatCounts: String

    enum CodingKeys: String, CodingKey {
        case id, focus, title, steps, reps, metric, direction, whatCounts = "what_counts"
    }
}

/// Where the camera was, as far as the golfer's body at address can say.
public struct CameraSignature: Codable, Equatable {
    public var orientation: String
    /// Head to feet at address, as a share of the frame height.
    public var bodyHeight: Double
    /// Hips at address, across the frame from 0 to 1.
    public var centreX: Double
    /// Shoulder width over torso length: about 1 face on, near 0 down the line.
    public var shoulderRatio: Double?
    public var frameRate: Double?

    enum CodingKeys: String, CodingKey {
        case orientation, bodyHeight = "body_height", centreX = "centre_x"
        case shoulderRatio = "shoulder_ratio", frameRate = "frame_rate"
    }

    public init(orientation: String, bodyHeight: Double, centreX: Double, shoulderRatio: Double?,
                frameRate: Double?) {
        self.orientation = orientation
        self.bodyHeight = bodyHeight
        self.centreX = centreX
        self.shoulderRatio = shoulderRatio
        self.frameRate = frameRate
    }
}

/// compare.py `camera_signature`, at the source frame nearest address.
public func cameraSignature(_ sequence: PoseSequence, addressFrame: Int) -> CameraSignature? {
    guard sequence.count > 0 else { return nil }
    let frame = min(max(addressFrame, 0), sequence.count - 1)
    let xy = sequence.xy[frame]
    let a = sequence.aspect
    let square = xy.map { Point($0.x * a, $0.y) }
    let seen = sequence.visibility[frame].map { $0 >= 0.3 }
    guard seen.filter({ $0 }).count >= 8 else { return nil }
    let ls = square[Landmark.leftShoulder], rs = square[Landmark.rightShoulder]
    let lh = square[Landmark.leftHip], rh = square[Landmark.rightHip]
    let shoulders = hypot(ls.x - rs.x, ls.y - rs.y)
    let torso = hypot(0.5 * (ls.x + rs.x) - 0.5 * (lh.x + rh.x), 0.5 * (ls.y + rs.y) - 0.5 * (lh.y + rh.y))
    let ys = zip(xy, seen).filter { $0.1 }.map { $0.0.y }
    var steps: [Double] = []
    for i in 1..<max(1, sequence.times.count) { steps.append(sequence.times[i] - sequence.times[i - 1]) }
    return CameraSignature(
        orientation: sequence.height >= sequence.width ? "portrait" : "landscape",
        bodyHeight: ys.max()! - ys.min()!,
        centreX: 0.5 * (xy[Landmark.leftHip].x + xy[Landmark.rightHip].x),
        shoulderRatio: torso > 1e-6 ? shoulders / torso : nil,
        frameRate: steps.isEmpty ? nil : 1 / median(steps))
}

/// The frame of the clip nearest a time on its own timeline.
public func nearestFrame(_ sequence: PoseSequence, time: Double) -> Int {
    var best = 0, gap = Double.infinity
    for (i, t) in sequence.times.enumerated() where abs(t - time) < gap {
        gap = abs(t - time)
        best = i
    }
    return best
}

private func mean(_ values: [Double]) -> Double { values.reduce(0, +) / Double(values.count) }

private func variance(_ values: [Double]) -> Double {
    let m = mean(values)
    return values.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(values.count - 1)
}

/// Python's "{:.Nf}" and "{:.3g}": C's printf rounds as Python does.
func fixed(_ x: Double, _ digits: Int) -> String { String(format: "%.\(digits)f", x) }
public func formatG3(_ x: Double) -> String { String(format: "%.3g", x) }

/// One swing's value of the metric being tracked, with what decides comparability.
public struct SwingPoint: Codable, Equatable {
    public var swingId: Int
    public var value: Double
    public var handedness: String
    public var club: String?
    public var camera: CameraSignature?

    enum CodingKeys: String, CodingKey {
        case swingId = "swing_id", value, handedness, club, camera
    }

    public init(swingId: Int, value: Double, handedness: String, club: String?, camera: CameraSignature?) {
        self.swingId = swingId
        self.value = value
        self.handedness = handedness
        self.club = club
        self.camera = camera
    }
}

public struct Comparability: Codable, Equatable {
    public var comparable: Bool
    public var blocking: [String]
    public var warnings: [String]
}

/// Which of `points` (newest first) form one comparable set: their indices. Grown
/// from the newest, each kept only if the whole set still passes, because the camera
/// checks are ranges over the set (#53). compare.py `comparable_set`.
public func comparableSet(_ rules: PracticeRules, _ points: [SwingPoint], metric: String,
                          limit: Int = 5) -> [Int] {
    var chosen: [Int] = []
    for (i, point) in points.enumerated() where chosen.count < limit {
        if comparability(rules, chosen.map { points[$0] } + [point], [], metric: metric).comparable {
            chosen.append(i)
        }
    }
    return chosen
}

/// Whether two sets of swings can be compared at all. compare.py `comparability`.
public func comparability(_ rules: PracticeRules, _ before: [SwingPoint], _ after: [SwingPoint],
                          metric: String) -> Comparability {
    var blocking: [String] = [], warnings: [String] = []
    let points = before + after
    if Set(points.map(\.handedness)).count > 1 {
        blocking.append("the swings are not all the same way round (right- and left-handed)")
    }
    let clubs = Set(points.compactMap { $0.club }.filter { !$0.isEmpty }).sorted()
    if clubs.count > 1 {
        blocking.append("different clubs: \(clubs.joined(separator: ", "))")
    } else if points.contains(where: { ($0.club ?? "").isEmpty }) {
        warnings.append("not every swing says which club; mixing clubs changes tempo and turn")
    }
    let cameras = points.map(\.camera)
    if cameras.contains(where: { $0 == nil }) {
        warnings.append("some swings were analysed before the camera position was recorded, so "
            + "whether the phone moved cannot be checked")
    }
    let known = cameras.compactMap { $0 }
    if !known.isEmpty {
        if Set(known.map(\.orientation)).count > 1 {
            blocking.append("some swings were filmed in portrait and some in landscape")
        }
        let ratios = known.compactMap(\.shoulderRatio).filter(\.isFinite)
        if let hi = ratios.max(), let lo = ratios.min(), hi - lo > rules.shoulderRatioTolerance {
            blocking.append("the camera angle changed (face on in some swings, more down the line in others)")
        }
        let heights = known.map(\.bodyHeight), centres = known.map(\.centreX)
        var moved = (heights.max()! - heights.min()!) / max(heights.max()!, 1e-6) > rules.bodyHeightTolerance
        moved = moved || (centres.max()! - centres.min()!) > rules.centreTolerance
        if moved {
            let message = "the phone was closer, further or to one side in some swings"
            if rules.scaleFreeMetrics.contains(metric) {
                warnings.append(message + "; timing is unaffected")
            } else {
                blocking.append(message + "; angles and movements read from the picture change with it")
            }
        }
        let rates = known.compactMap(\.frameRate).filter(\.isFinite)
        if let hi = rates.max(), let lo = rates.min(), hi > 1.6 * lo {
            warnings.append("the frame rate differed between swings; lower frame rates place positions "
                + "less precisely")
        }
    }
    return Comparability(comparable: blocking.isEmpty, blocking: blocking, warnings: warnings)
}

/// Before against after, and what can be said about it.
public struct Change: Codable, Equatable {
    public var metric: String
    public var direction: String
    /// improved, worsened, no_detectable_change, not_comparable or not_enough_swings.
    public var verdict: String
    public var nBefore: Int
    public var nAfter: Int
    public var meanBefore: Double?
    public var meanAfter: Double?
    public var difference: Double?
    public var interval: [Double]?
    public var smallestDetectable: Double?
    public var comparability: Comparability
    public var explanation: String

    enum CodingKeys: String, CodingKey {
        case metric, direction, verdict, nBefore = "n_before", nAfter = "n_after"
        case meanBefore = "mean_before", meanAfter = "mean_after", difference, interval
        case smallestDetectable = "smallest_detectable", comparability, explanation
    }
}

/// compare.py `compare`: a Welch 95% interval on the golfer's own swings.
public func compareSwings(_ rules: PracticeRules, _ before: [SwingPoint], _ after: [SwingPoint],
                          metric: String, direction: String) -> Change {
    let check = comparability(rules, before, after, metric: metric)
    var change = Change(metric: metric, direction: direction, verdict: "", nBefore: before.count,
                        nAfter: after.count, comparability: check, explanation: "")
    let least = rules.minSwings
    if before.count < least || after.count < least {
        change.verdict = "not_enough_swings"
        change.explanation = "A comparison needs at least \(least) swings before and \(least) after; "
            + "\(max(least - before.count, 0)) more before and \(max(least - after.count, 0)) more after are "
            + "needed. One or two swings cannot separate a change from the spread between swings."
        return change
    }
    if !check.comparable {
        change.verdict = "not_comparable"
        change.explanation = "These swings cannot be compared: " + check.blocking.joined(separator: "; ") + "."
        return change
    }
    let a = before.map(\.value), b = after.map(\.value)
    // A side whose readings are all identical has no spread to measure a change
    // against; no direction is claimed (#54). compare.py `_flat_explanation`.
    let flat = [("before", a), ("after", b)].filter { $0.1.max() == $0.1.min() }.map(\.0)
    if !flat.isEmpty {
        let which = flat.count == 2 ? "The swings before, and the swings after, each read"
            : "The swings \(flat[0]) read"
        change.verdict = "no_detectable_change"
        change.explanation = "\(which) exactly the same every time, so the spread between swings, "
            + "which a change is measured against, cannot be estimated from them. Identical readings "
            + "do not mean the measurement has no noise: positions fall on whole frames, so the same "
            + "reading recurs. Record more swings on each side, each its own recording."
        return change
    }
    let va = variance(a) / Double(a.count), vb = variance(b) / Double(b.count)
    let se = (va + vb).squareRoot()
    let difference = mean(b) - mean(a)
    let df = se == 0 ? Double.infinity
        : (va + vb) * (va + vb) / (va * va / Double(a.count - 1) + vb * vb / Double(b.count - 1))
    let half = rules.criticalT(df) * se
    let interval = [difference - half, difference + half]
    let wanted = direction == "increase" ? 1.0 : -1.0
    if interval[0] > 0 || interval[1] < 0 {
        change.verdict = difference * wanted > 0 ? "improved" : "worsened"
    } else {
        change.verdict = "no_detectable_change"
    }
    switch change.verdict {
    case "improved":
        change.explanation = "The change is larger than the spread between your swings can explain, "
            + "and in the direction the drill aims for."
    case "worsened":
        change.explanation = "The change is larger than the spread between your swings can explain, "
            + "but in the opposite direction to the one the drill aims for."
    default:
        change.explanation = "Any change is smaller than about \(formatG3(half)), which is what "
            + "the spread between these swings can resolve. That is not the same as no change: "
            + "more swings on each side narrow it."
    }
    if metric == "tempo_ratio" {
        change.explanation += " Tempo readings move by less than the real change (about 0.44 of it on "
            + "held-out swings), so a real change in tempo is shown smaller than it is."
    }
    change.meanBefore = mean(a)
    change.meanAfter = mean(b)
    change.difference = difference
    change.interval = interval
    change.smallestDetectable = half
    return change
}

public struct Evidence: Codable, Equatable {
    public var label: String
    public var value: String
    /// "measured" or "derived".
    public var provenance: String
    public var swingId: Int?

    enum CodingKeys: String, CodingKey { case label, value, provenance, swingId = "swing_id" }
}

/// What the rules may look at for one swing.
public struct RecentSwing: Codable, Equatable {
    public var swingId: Int
    public var refused: Bool
    public var refusal: String?
    public var detectionRate: Double?
    public var tempo: Double?
    public var point: SwingPoint?

    enum CodingKeys: String, CodingKey {
        case swingId = "swing_id", refused, refusal, detectionRate = "detection_rate", tempo, point
    }
}

public struct Insight: Codable, Equatable {
    /// capture, not_enough, tempo_quick, tempo_slow or choose.
    public var kind: String
    public var title: String
    public var summary: String
    public var evidence: [Evidence]
    /// none, low, moderate or high.
    public var confidence: String
    public var limitations: [String]
    public var drill: Drill?
    public var retest: String
    public var success: String
    /// Focus and label pairs, offered when nothing measured stands out.
    public var choices: [[String]]
}

/// The one thing to work on next. engine.py `choose`; `recent` is newest first.
public func choosePriority(_ rules: PracticeRules, _ recent: [RecentSwing]) -> Insight {
    let least = rules.minSwings
    guard let newestSwing = recent.first else {
        return Insight(kind: "not_enough", title: "Record your first swing",
                       summary: "Nothing has been measured yet.", evidence: [], confidence: "none",
                       limitations: [], drill: rules.drill(focus: "capture"),
                       retest: "Record 3 swings from the same spot.",
                       success: "Three swings analysed without a refusal.", choices: [])
    }
    let lastThree = Array(recent.prefix(3))
    let refused = lastThree.filter(\.refused)
    let poorlySeen = lastThree.filter { !$0.refused && ($0.detectionRate.map { $0 < 0.8 } ?? false) }
    if newestSwing.refused || refused.count >= 2 || !poorlySeen.isEmpty {
        let evidence = (refused + poorlySeen).map { s in
            Evidence(label: "Swing \(s.swingId)",
                     value: s.refused ? "refused: \(s.refusal ?? "None")"
                         : "body found in \(fixed(100 * (s.detectionRate ?? 0), 0))% of frames",
                     provenance: "measured", swingId: s.swingId)
        }
        return Insight(
            kind: "capture", title: "Get a recording the app can measure",
            summary: "Until swings are recorded so the whole body is seen from address to finish, "
                + "every other number is unreliable. This comes before anything about the swing.",
            evidence: evidence, confidence: "high",
            limitations: ["Based on the analysis's own refusals and detection rates."],
            drill: rules.drill(focus: "capture"), retest: "Record 3 swings with the setup above.",
            success: "Three swings in a row analysed without a refusal.", choices: [])
    }

    let analysed = recent.filter { !$0.refused && $0.tempo != nil && $0.point != nil }
    let window = Array(analysed.prefix(10))
    let comparable = comparableSet(rules, window.map { $0.point! }, metric: "tempo_ratio").map { window[$0] }
    // Comparable swings share a hand, so the newest swing's hand is every reading's (#33).
    let left = analysed.first?.point?.handedness == "left"
    let limits = left ? (rules.tempoLimitsLeftHanded ?? rules.tempoLimits) : rules.tempoLimits
    let oneSwing = rules.oneSwing?[left ? "left" : "right"]
        ?? "One swing's tempo is uncertain by about ±27%, so a single reading cannot say what to work on."
    let tempoEvidence = { (s: RecentSwing) in
        Evidence(label: "Swing \(s.swingId)", value: "tempo \(fixed(s.tempo!, 2))", provenance: "derived",
                 swingId: s.swingId)
    }
    if comparable.count < least {
        let more = least - comparable.count
        return Insight(
            kind: "not_enough", title: "Record \(more) more swing(s) from the same spot",
            summary: "A priority needs at least \(least) analysed swings filmed from the same "
                + "place with the same club; there are \(comparable.count). " + oneSwing,
            evidence: comparable.map(tempoEvidence), confidence: "none", limitations: limits,
            drill: nil, retest: "Record \(more) more swing(s) without moving the phone.",
            success: "\(least) comparable swings analysed.", choices: [])
    }

    let tempos = comparable.map { $0.tempo! }
    let average = mean(tempos)
    let reference = rules.tourTempo
    let evidence = comparable.map(tempoEvidence) + [
        Evidence(label: "Tour swings read by the same model",
                 value: "\(fixed(reference.p10, 2)) to \(fixed(reference.p90, 2)) "
                     + "(10th to 90th percentile, \(reference.nSwings) swings)",
                 provenance: "measured", swingId: nil),
    ]
    if average < reference.p10 || average > reference.p90 {
        let quick = average < reference.p10
        let allOutside = quick ? tempos.allSatisfy { $0 < reference.p10 } : tempos.allSatisfy { $0 > reference.p90 }
        let drill = rules.drill(focus: quick ? "tempo_quick" : "tempo_slow")!
        return Insight(
            kind: quick ? "tempo_quick" : "tempo_slow",
            title: quick ? "Your backswing is quick for your downswing" : "Your backswing is long for your downswing",
            summary: "Your average tempo reading over \(comparable.count) comparable swings is "
                + "\(fixed(average, 2)), \(quick ? "below" : "above") the range the same analysis reads "
                + "for 80% of tour swings (\(fixed(reference.p10, 2)) to \(fixed(reference.p90, 2))). "
                + "Tempo is a ratio of two durations, so moving the phone nearer or further does not "
                + "change it; keep the club and the camera angle the same.",
            evidence: evidence, confidence: allOutside ? "moderate" : "low", limitations: limits,
            drill: drill, retest: "Practise the drill, then record 5 swings from the same spot with the same club.",
            success: drill.whatCounts, choices: [])
    }
    return Insight(
        kind: "choose", title: "Nothing measured stands out: choose what to work on",
        summary: "Your average tempo reading over \(comparable.count) comparable swings is \(fixed(average, 2)), "
            + "inside the range the analysis reads for tour swings. The other measurements have no "
            + "reference the app can defend, so rather than guess at a fault it will measure "
            + "whatever you choose to practise, against your own swings.",
        evidence: evidence, confidence: "low", limitations: limits, drill: nil,
        retest: "Choose a focus, practise its drill, then record 5 swings from the same spot.",
        success: "The chosen measurement moves in the drill's direction by more than the "
            + "spread between your swings can explain.",
        choices: rules.trackable)
}

/// One clip as the practice loop keeps it: numbers only, never the video.
public struct PracticeSwing: Codable, Equatable, Identifiable {
    public var id: Int
    public var at: Date
    public var ok: Bool
    public var refusal: String?
    public var detectionRate: Double?
    public var handedness: String?
    public var club: String?
    public var camera: CameraSignature?
    /// tempo_ratio, head_movement, pelvis_sway, shoulder_turn_foreshortened, detection_rate.
    public var metrics: [String: Double]
    public var slowedBy: Double?
    /// Which clip this reading came from (a hash of the file), so the same clip
    /// analysed again is one swing, as in the browser and on the desktop.
    public var clipKey: String?
    /// When the clip was last analysed again, if it was.
    public var rereadAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, at, ok, refusal, detectionRate = "detection_rate", handedness, club, camera, metrics
        case slowedBy = "slowed_by", clipKey = "clip_key", rereadAt = "reread_at"
    }

    public init(id: Int = 0, at: Date = Date(), ok: Bool, refusal: String?, detectionRate: Double?,
                handedness: String?, club: String?, camera: CameraSignature?, metrics: [String: Double],
                slowedBy: Double?, clipKey: String? = nil) {
        self.id = id
        self.at = at
        self.ok = ok
        self.refusal = refusal
        self.detectionRate = detectionRate
        self.handedness = handedness
        self.club = club
        self.camera = camera
        self.metrics = metrics
        self.slowedBy = slowedBy
        self.clipKey = clipKey
    }

    /// An analysed swing, under the names the desktop stores its metrics by.
    public static func analysed(_ result: SwingResult, sequence: PoseSequence, club: String?,
                                clipKey: String? = nil) -> PracticeSwing {
        let m = result.metrics
        var metrics: [String: Double] = ["detection_rate": result.detectionRate]
        metrics["tempo_ratio"] = m.tempoRatio
        metrics["head_movement"] = m.headMovement
        metrics["pelvis_sway"] = m.pelvisSway
        metrics["shoulder_turn_foreshortened"] = m.shoulderTurnDeg
        let address = nearestFrame(sequence, time: m.eventTimes[0])
        return PracticeSwing(ok: true, refusal: nil, detectionRate: result.detectionRate,
                             handedness: result.handedness.rawValue, club: club,
                             camera: cameraSignature(sequence, addressFrame: address), metrics: metrics,
                             slowedBy: m.slowedBy, clipKey: clipKey)
    }

    public static func refused(_ reason: String, detectionRate: Double?, club: String?,
                               clipKey: String? = nil) -> PracticeSwing {
        PracticeSwing(ok: false, refusal: reason, detectionRate: detectionRate, handedness: nil, club: club,
                      camera: nil, metrics: [:], slowedBy: nil, clipKey: clipKey)
    }
}

public struct PracticePlan: Codable, Equatable, Identifiable {
    public var id: Int
    public var focus: String
    public var drillId: String
    public var metric: String
    public var direction: String
    public var club: String?
    public var baseline: [Int]
    public var retest: [Int]
    /// active, completed or abandoned.
    public var status: String
    public var createdAt: Date
    public var closedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, focus, drillId = "drill_id", metric, direction, club, baseline, retest, status
        case createdAt = "created_at", closedAt = "closed_at"
    }
}

/// Every clip's numbers and every plan, as swingml/web/practice.py keeps them.
public struct PracticeLog: Codable, Equatable {
    public var next = 1
    public var swings: [PracticeSwing] = []
    public var plans: [PracticePlan] = []

    static let history = 12

    public init() {}

    public func swing(_ id: Int) -> PracticeSwing? { swings.first { $0.id == id } }
    public var activePlan: PracticePlan? { plans.first { $0.status == "active" } }

    /// Keep one clip. With `forPlan`, it also counts as a retest swing for the active plan.
    ///
    /// The same clip analysed again (same `clipKey`) replaces its earlier reading in
    /// place, keeping its number and its place in any plan, and is never added as a
    /// retest of a plan it is already in: one clip counted as three retest swings
    /// once turned "not enough swings" into "improved" (#22). A refused re-read never
    /// replaces an analysed reading of the clip (#26). The rules of the browser's
    /// PracticeLog.add (webapp/practice.js) and the desktop's SwingStore.record.
    @discardableResult
    public mutating func add(_ swing: PracticeSwing, forPlan: Bool = false) -> Int {
        let id: Int
        if let key = swing.clipKey, let i = swings.firstIndex(where: { $0.clipKey == key }) {
            if swings[i].ok && !swing.ok { return swings[i].id }
            var replaced = swing
            replaced.id = swings[i].id
            replaced.at = swings[i].at
            replaced.rereadAt = Date()
            swings[i] = replaced
            id = replaced.id
        } else {
            var kept = swing
            kept.id = next
            next += 1
            swings.append(kept)
            id = kept.id
        }
        if forPlan, let i = plans.firstIndex(where: { $0.status == "active" }),
           !plans[i].baseline.contains(id), !plans[i].retest.contains(id) {
            plans[i].retest.append(id)
        }
        return id
    }

    public mutating func remove(_ id: Int) {
        swings.removeAll { $0.id == id }
        for i in plans.indices {
            plans[i].baseline.removeAll { $0 == id }
            plans[i].retest.removeAll { $0 == id }
        }
    }

    /// Newest first, up to and including `id`, so a swing's priority never changes
    /// when more swings come after it.
    public func recent(upTo id: Int?) -> [PracticeSwing] {
        Array(swings.filter { id == nil || $0.id <= id! }.sorted { $0.id > $1.id }.prefix(Self.history))
    }

    public func point(_ swing: PracticeSwing, metric: String) -> SwingPoint? {
        guard let value = swing.metrics[metric], value.isFinite else { return nil }
        return SwingPoint(swingId: swing.id, value: value, handedness: swing.handedness ?? "",
                          club: swing.club, camera: swing.camera)
    }

    public func insight(_ rules: PracticeRules, upTo id: Int?) -> Insight {
        choosePriority(rules, recent(upTo: id).map { s in
            RecentSwing(swingId: s.id, refused: !s.ok, refusal: s.refusal, detectionRate: s.detectionRate,
                        tempo: s.ok ? s.metrics["tempo_ratio"] : nil,
                        point: s.ok ? point(s, metric: "tempo_ratio") : nil)
        })
    }

    /// The most recent comparable swings with a reading of the drill's metric.
    public func baseline(_ rules: PracticeRules, drill: Drill, upTo id: Int?) -> (ids: [Int], club: String?) {
        let usable = recent(upTo: id).filter(\.ok).compactMap { s in point(s, metric: drill.metric).map { (s, $0) } }
        guard let newest = usable.first else { return ([], nil) }
        let ids = comparableSet(rules, usable.map(\.1), metric: drill.metric).map { usable[$0].0.id }
        return (ids, newest.0.club)
    }

    /// Start practising one thing; any plan still active is abandoned first.
    @discardableResult
    public mutating func startPlan(_ rules: PracticeRules, focus: String, from id: Int?) -> PracticePlan? {
        guard let drill = rules.drill(focus: focus) else { return nil }
        let now = Date()
        for i in plans.indices where plans[i].status == "active" {
            plans[i].status = "abandoned"
            plans[i].closedAt = now
        }
        let (ids, club) = focus == "capture" ? ([], nil) : baseline(rules, drill: drill, upTo: id)
        let plan = PracticePlan(id: (plans.map(\.id).max() ?? 0) + 1, focus: focus, drillId: drill.id,
                                metric: drill.metric, direction: drill.direction, club: club, baseline: ids,
                                retest: [], status: "active", createdAt: now, closedAt: nil)
        plans.append(plan)
        return plan
    }

    @discardableResult
    public mutating func closePlan(_ status: String) -> Bool {
        guard status == "completed" || status == "abandoned",
              let i = plans.firstIndex(where: { $0.status == "active" }) else { return false }
        plans[i].status = status
        plans[i].closedAt = Date()
        return true
    }

    public func change(_ rules: PracticeRules, plan: PracticePlan) -> Change? {
        guard let drill = rules.drill(id: plan.drillId), drill.focus != "capture" else { return nil }
        let points = { (ids: [Int]) in
            ids.compactMap { self.swing($0) }.filter(\.ok).compactMap { self.point($0, metric: drill.metric) }
        }
        return compareSwings(rules, points(plan.baseline), points(plan.retest), metric: drill.metric,
                             direction: drill.direction)
    }

    public func captureProgress(_ plan: PracticePlan) -> (recorded: Int, cleanInARow: Int) {
        var streak = 0
        for id in plan.retest.sorted() { if let s = swing(id) { streak = s.ok ? streak + 1 : 0 } }
        return (plan.retest.count, streak)
    }
}
