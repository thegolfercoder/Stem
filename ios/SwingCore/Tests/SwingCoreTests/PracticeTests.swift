import XCTest
@testable import SwingCore

/// Practice.swift held to the Python rules, answer for answer: the priority for
/// 150 generated swing histories, the verdict for 150 before/after sets, the
/// camera's signature on the real swing, and a plan played through the log.
/// Regenerate the reference with Tests/make_practice_golden.py; the Python suite
/// fails when it is stale.
final class PracticeTests: XCTestCase {
    struct Golden: Decodable {
        struct History: Decodable { let recent: [RecentSwing]; let expected: Insight }
        struct Sets: Decodable {
            let before: [SwingPoint]
            let after: [SwingPoint]
            let metric: String
            let direction: String
            let expected: Change
        }
        struct Camera: Decodable { let frames: [Int]; let expected: [CameraSignature?] }
        struct Swing: Decodable {
            let ok: Bool
            let detection_rate: Double
            let handedness: String
            let club: String?
            let camera: CameraSignature?
            let metrics: [String: Double?]
        }
        struct Plan: Decodable {
            struct Expected: Decodable {
                let insight: Insight
                let baseline: [Int]
                let club: String?
                let retest: [Int]
                let change: Change?
            }
            let focus: String
            let before: [Swing]
            let after: [Swing]
            let expected: Expected
        }
        let histories: [History]
        let sets: [Sets]
        let g3: [[G3]]
        let camera: Camera
        let plans: [Plan]
    }

    /// A number and how Python printed it.
    enum G3: Decodable {
        case number(Double), text(String)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let x = try? c.decode(Double.self) { self = .number(x) } else { self = .text(try c.decode(String.self)) }
        }
    }

    static let golden: Golden = {
        let url = Bundle.module.url(forResource: "practice_golden", withExtension: "json", subdirectory: "Resources")!
        return try! JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }()

    static let rules = try! ModelPayload.bundled().practice!

    func close(_ a: Double?, _ b: Double?, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        switch (a, b) {
        case (nil, nil): return
        case let (x?, y?): XCTAssertEqual(x, y, accuracy: 1e-9 * max(1, abs(y)), what, file: file, line: line)
        default: XCTFail("\(what): \(String(describing: a)) against \(String(describing: b))", file: file, line: line)
        }
    }

    func check(_ mine: Change, _ theirs: Change, _ what: String) {
        XCTAssertEqual(mine.verdict, theirs.verdict, what)
        XCTAssertEqual(mine.explanation, theirs.explanation, what)
        XCTAssertEqual(mine.comparability, theirs.comparability, what)
        XCTAssertEqual([mine.nBefore, mine.nAfter], [theirs.nBefore, theirs.nAfter], what)
        close(mine.meanBefore, theirs.meanBefore, what)
        close(mine.meanAfter, theirs.meanAfter, what)
        close(mine.difference, theirs.difference, what)
        close(mine.smallestDetectable, theirs.smallestDetectable, what)
        close(mine.interval?[0], theirs.interval?[0], what)
        close(mine.interval?[1], theirs.interval?[1], what)
    }

    func testTheBundledPayloadCarriesThePracticeRules() {
        XCTAssertEqual(Self.rules.minSwings, 3)
        XCTAssertNotNil(Self.rules.drill(focus: "capture"))
        XCTAssertNotNil(Self.rules.drill(focus: "tempo_quick"))
    }

    func testThePrioritiesAgreeWordForWord() {
        var kinds = Set<String>()
        for (i, history) in Self.golden.histories.enumerated() {
            XCTAssertEqual(choosePriority(Self.rules, history.recent), history.expected, "history \(i)")
            kinds.insert(history.expected.kind)
        }
        XCTAssertEqual(kinds, ["capture", "not_enough", "tempo_quick", "tempo_slow", "choose"])
    }

    func testTheRetestVerdictsAgree() {
        var verdicts = Set<String>()
        for (i, set) in Self.golden.sets.enumerated() {
            let mine = compareSwings(Self.rules, set.before, set.after, metric: set.metric, direction: set.direction)
            check(mine, set.expected, "set \(i)")
            verdicts.insert(set.expected.verdict)
        }
        XCTAssertEqual(verdicts, ["improved", "worsened", "no_detectable_change", "not_comparable", "not_enough_swings"])
    }

    func testThreeSignificantFiguresPrintAsPythonPrintsThem() {
        for pair in Self.golden.g3 {
            guard case .number(let x) = pair[0], case .text(let text) = pair[1] else { return XCTFail("bad pair") }
            XCTAssertEqual(formatG3(x), text)
        }
    }

    func testTheCameraSignatureAgreesOnTheRealSwing() {
        let input = ParityTests.golden.input
        let sequence = PoseSequence(
            xy: input.xy.map { frame in frame.map { Point($0[0], $0[1]) } },
            visibility: input.visibility, detected: input.detected, times: input.times,
            width: input.width, height: input.height)
        let camera = Self.golden.camera
        for (frame, expected) in zip(camera.frames, camera.expected) {
            let mine = cameraSignature(sequence, addressFrame: frame)
            guard let expected else { XCTAssertNil(mine, "frame \(frame)"); continue }
            guard let mine else { XCTFail("frame \(frame): no signature"); continue }
            XCTAssertEqual(mine.orientation, expected.orientation)
            // Python reads the landmarks in float32; Swift in Double.
            for (a, b) in [(mine.bodyHeight, expected.bodyHeight), (mine.centreX, expected.centreX),
                           (mine.shoulderRatio!, expected.shoulderRatio!), (mine.frameRate!, expected.frameRate!)] {
                XCTAssertEqual(a, b, accuracy: 1e-5 * max(1, abs(b)), "frame \(frame)")
            }
        }
    }

    func testAPlanPlayedThroughMatchesTheDesktop() throws {
        for plan in Self.golden.plans {
            let practiceSwing = { (s: Golden.Swing) in
                PracticeSwing(ok: s.ok, refusal: nil, detectionRate: s.detection_rate, handedness: s.handedness,
                              club: s.club, camera: s.camera, metrics: s.metrics.compactMapValues { $0 },
                              slowedBy: nil)
            }
            var log = PracticeLog()
            for swing in plan.before { log.add(practiceSwing(swing)) }
            XCTAssertEqual(log.insight(Self.rules, upTo: 6), plan.expected.insight, plan.focus)
            let started = try XCTUnwrap(log.startPlan(Self.rules, focus: plan.focus, from: 6))
            XCTAssertEqual(started.baseline, plan.expected.baseline, plan.focus)
            XCTAssertEqual(started.club, plan.expected.club, plan.focus)
            for swing in plan.after { log.add(practiceSwing(swing), forPlan: true) }

            // Kept and read back, as the app does.
            let encoder = JSONEncoder(), decoder = JSONDecoder()
            encoder.dateEncodingStrategy = .iso8601
            decoder.dateDecodingStrategy = .iso8601
            let reopened = try decoder.decode(PracticeLog.self, from: encoder.encode(log))
            let active = try XCTUnwrap(reopened.activePlan)
            XCTAssertEqual(active.retest, plan.expected.retest)
            let change = try XCTUnwrap(reopened.change(Self.rules, plan: active))
            check(change, try XCTUnwrap(plan.expected.change), plan.focus)

            var closing = reopened
            XCTAssertTrue(closing.closePlan("completed"))
            XCTAssertNil(closing.activePlan)
            XCTAssertFalse(closing.closePlan("completed"))
        }
    }

    private func swing(_ tempo: Double, _ key: String) -> PracticeSwing {
        PracticeSwing(ok: true, refusal: nil, detectionRate: 0.98, handedness: "right", club: "7 iron",
                      camera: nil, metrics: ["tempo_ratio": tempo], slowedBy: nil, clipKey: key)
    }

    /// tests/test_browser_practice.py::test_one_clip_analysed_three_times_is_one_retest_swing (#22, #29)
    func testOneClipAnalysedThreeTimesIsOneRetestSwing() throws {
        var log = PracticeLog()
        for (i, tempo) in [2.7, 2.9, 2.8].enumerated() { log.add(swing(tempo, "b\(i)")) }
        _ = try XCTUnwrap(log.startPlan(Self.rules, focus: "tempo_quick", from: 3))
        for _ in 0..<3 { log.add(swing(3.05, "same clip"), forPlan: true) }
        XCTAssertEqual(log.swings.count, 4)
        XCTAssertEqual(log.activePlan?.retest, [4])
        XCTAssertNotNil(log.swing(4)?.rereadAt)
        XCTAssertEqual(log.change(Self.rules, plan: try XCTUnwrap(log.activePlan))?.verdict, "not_enough_swings")
        // A baseline clip analysed again for the plan stays in the baseline only.
        log.add(swing(2.75, "b1"), forPlan: true)
        XCTAssertEqual(log.activePlan?.retest, [4])
        XCTAssertEqual(log.swing(2)?.metrics["tempo_ratio"], 2.75)
    }

    /// tests/test_browser_practice.py::test_a_refused_reread_keeps_the_analysed_reading (#26, #29)
    func testARefusedRereadKeepsTheAnalysedReading() throws {
        var log = PracticeLog()
        for (i, tempo) in [2.7, 2.9, 2.8].enumerated() { log.add(swing(tempo, "b\(i)")) }
        _ = try XCTUnwrap(log.startPlan(Self.rules, focus: "tempo_quick", from: 3))
        for (i, tempo) in [3.3, 3.4, 3.35].enumerated() { log.add(swing(tempo, "r\(i)"), forPlan: true) }
        let before = try XCTUnwrap(log.change(Self.rules, plan: try XCTUnwrap(log.activePlan)))
        XCTAssertEqual(before.verdict, "improved")
        XCTAssertEqual(before.nAfter, 3)
        let swings = log.swings
        let id = log.add(.refused("The handedness chosen does not match this swing.", detectionRate: 0.97,
                                  club: "7 iron", clipKey: "r0"), forPlan: true)
        XCTAssertEqual(id, 4)
        XCTAssertEqual(log.swings, swings)
        XCTAssertEqual(log.activePlan?.retest, [4, 5, 6])
        let after = try XCTUnwrap(log.change(Self.rules, plan: try XCTUnwrap(log.activePlan)))
        XCTAssertEqual(after.verdict, "improved")
        XCTAssertEqual(after.nAfter, 3)
        // A refusal is replaced by a later reading, and a refused re-read replaces a refusal.
        log.add(.refused("no swing found", detectionRate: 0.4, club: nil, clipKey: "x"))
        log.add(.refused("no body found", detectionRate: 0.2, club: nil, clipKey: "x"))
        XCTAssertEqual(log.swings.last?.refusal, "no body found")
        log.add(swing(3.0, "x"))
        XCTAssertEqual(log.swings.count, 7)
        XCTAssertEqual(log.swings.last?.ok, true)
    }

    func testACapturePlanCountsCleanRecordingsInARow() {
        var log = PracticeLog()
        log.add(.refused("no swing found", detectionRate: 0.4, club: nil))
        let plan = log.startPlan(Self.rules, focus: "capture", from: 1)!
        XCTAssertTrue(plan.baseline.isEmpty)
        let clean = PracticeSwing(ok: true, refusal: nil, detectionRate: 0.97, handedness: "right", club: nil,
                                  camera: nil, metrics: ["tempo_ratio": 3.1], slowedBy: nil)
        log.add(clean, forPlan: true)
        log.add(.refused("no swing found", detectionRate: 0.5, club: nil), forPlan: true)
        log.add(clean, forPlan: true)
        log.add(clean, forPlan: true)
        XCTAssertEqual(log.captureProgress(log.activePlan!).recorded, 4)
        XCTAssertEqual(log.captureProgress(log.activePlan!).cleanInARow, 2)
        XCTAssertNil(log.change(Self.rules, plan: log.activePlan!))
        log.remove(2)
        XCTAssertEqual(log.activePlan!.retest, [3, 4, 5])
    }
}
