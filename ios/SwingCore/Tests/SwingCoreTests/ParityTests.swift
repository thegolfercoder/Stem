import XCTest
@testable import SwingCore

/// The Swift analysis held to the browser engine's answers on a real swing, and
/// through it to the Python pipeline. Regenerate the reference with
/// Tests/make_golden.py after exporting a new model.
final class ParityTests: XCTestCase {
    struct Golden: Decodable {
        struct Input: Decodable {
            let xy: [[[Double]]]
            let visibility: [[Double]]
            let detected: [Bool]
            let times: [Double]
            let width: Double
            let height: Double
        }
        struct Row: Decodable { let t: Int; let values: [Double] }
        struct Case: Decodable {
            let n: Int
            let width: Int
            let featureRows: [Row]
            let logits: [Double]
            let ok: Bool
            let frames: [Int]?
            let subframe: [Double]?
            let confidence: [Double]?
            let meanConfidence: Double?
            let metrics: SwingMetrics?
        }
        let input: Input
        let resampledTimes: [Double]
        let cases: [String: Case]
    }

    static var golden: Golden = {
        let url = Bundle.module.url(forResource: "golden_real_swing_01", withExtension: "json",
                                    subdirectory: "Resources")!
        return try! JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }()

    static let analyzer = try! SwingAnalyzer.bundled()

    var sequence: PoseSequence {
        let input = Self.golden.input
        return PoseSequence(
            xy: input.xy.map { frame in frame.map { Point($0[0], $0[1]) } },
            visibility: input.visibility, detected: input.detected, times: input.times,
            width: input.width, height: input.height)
    }

    func testResamplingMatches() {
        let resampled = resamplePose(sequence, rateHz: 60)
        XCTAssertEqual(resampled.count, Self.golden.resampledTimes.count)
        for (a, b) in zip(resampled.times, Self.golden.resampledTimes) { XCTAssertEqual(a, b, accuracy: 1e-9) }
    }

    func testFeaturesMatch() {
        let resampled = resamplePose(sequence, rateHz: 60)
        let config = Self.analyzer.payload.features
        for (name, hand) in [("right", Handedness.right), ("left", Handedness.left)] {
            let expected = Self.golden.cases[name]!
            let features = extractFeatures(resampled, handedness: hand, config: config)
            XCTAssertEqual(features.count, expected.n * expected.width)
            var worst = 0.0
            for row in expected.featureRows {
                for (f, value) in row.values.enumerated() {
                    worst = max(worst, abs(Double(features[row.t * expected.width + f]) - value))
                }
            }
            XCTAssertLessThan(worst, 1e-5, "\(name)-handed features differ by \(worst)")
        }
    }

    func testNetworkScoresMatch() {
        let resampled = resamplePose(sequence, rateHz: 60)
        let expected = Self.golden.cases["right"]!
        let logits = Self.analyzer.logits(resampled, handedness: .right)
        XCTAssertEqual(logits.count, expected.logits.count)
        var worst = 0.0
        for (a, b) in zip(logits, expected.logits) { worst = max(worst, abs(Double(a) - b)) }
        XCTAssertLessThan(worst, 1e-3, "scores differ by \(worst)")
    }

    func testDecodedPositionsAndMetricsMatch() {
        let resampled = resamplePose(sequence, rateHz: 60)
        for (name, hand) in [("right", Handedness.right), ("left", Handedness.left)] {
            let expected = Self.golden.cases[name]!
            let payload = Self.analyzer.payload
            let decoded = decodeEvents(Self.analyzer.logits(resampled, handedness: hand), n: resampled.count,
                                       classes: 9, minMeanConfidence: payload.thresholds.minMeanConfidence,
                                       minCoreConfidence: payload.thresholds.minCoreConfidence)
            guard let events = decoded.events else { return XCTFail("\(name): no swing decoded") }
            XCTAssertEqual(events.frames, expected.frames!)
            for (a, b) in zip(events.confidence, expected.confidence!) { XCTAssertEqual(a, b, accuracy: 1e-4) }
            for (a, b) in zip(events.subframe, expected.subframe!) { XCTAssertEqual(a, b, accuracy: 1e-3) }
            let metrics = computeMetrics(resampled, events, config: payload.features)
            let m = expected.metrics!
            XCTAssertEqual(metrics.tempoRatio!, m.tempoRatio!, accuracy: 1e-3)
            XCTAssertEqual(metrics.backswingMs, m.backswingMs, accuracy: 0.05)
            XCTAssertEqual(metrics.downswingMs, m.downswingMs, accuracy: 0.05)
            XCTAssertEqual(metrics.peakHandSpeedMs, m.peakHandSpeedMs, accuracy: 1e-6)
            XCTAssertEqual(metrics.shoulderTurnDeg!, m.shoulderTurnDeg!, accuracy: 1e-6)
            XCTAssertEqual(metrics.hipTurnDeg!, m.hipTurnDeg!, accuracy: 1e-6)
            XCTAssertEqual(metrics.headMovement!, m.headMovement!, accuracy: 1e-9)
            XCTAssertEqual(metrics.pelvisSway!, m.pelvisSway!, accuracy: 1e-9)
            XCTAssertEqual(metrics.feetInShot, m.feetInShot)
        }
    }

    func testTheAnalyzerFindsTheSwingAndTheHandedness() {
        let verdict = Self.analyzer.analyse(sequence)
        guard let result = verdict.result else { return XCTFail("refused: \(verdict)") }
        XCTAssertEqual(result.handedness, .right)
        XCTAssertEqual(result.handednessFrom, "detected")
        XCTAssertEqual(result.frames, Self.golden.cases["right"]!.frames!)
        XCTAssertNotNil(Self.analyzer.band(event: 5, confidence: result.confidence[5]))
        XCTAssertNotNil(Self.analyzer.tempoBand)
    }

    func testStandingStillIsRefused() {
        // The golfer at address, repeated: no swing to find.
        var still = sequence
        let frame = still.xy[0], vis = still.visibility[0]
        still.xy = Array(repeating: frame, count: still.count)
        still.visibility = Array(repeating: vis, count: still.count)
        if case .swing = Self.analyzer.analyse(still) { XCTFail("found a swing in a still clip") }
    }

    /// The real swing stretched to four times its length, as a phone's slow-motion
    /// export plays it. Refused at playback speed (a three-second backswing), it has
    /// to be read as slow motion, as the Python and browser engines do, with every
    /// duration withheld because the real speed-up cannot be known.
    func testASlowMotionClipIsReadAsSlowMotionWithNoDurations() {
        var slowed = sequence
        slowed.times = sequence.times.map { $0 * 4 }
        let verdict = Self.analyzer.analyse(slowed, handedness: .right)
        guard let result = verdict.result else { return XCTFail("slow motion refused: \(verdict)") }
        guard let factor = result.metrics.slowedBy else { return XCTFail("not read as slow motion") }
        XCTAssert(Self.analyzer.payload.thresholds.slowMotionFactors.contains(factor))
        XCTAssertFalse(result.metrics.hasDurations)
        // Event times are back on the clip's own, slowed, timeline.
        XCTAssertGreaterThan(result.metrics.eventTimes[5], result.metrics.eventTimes[0])
        XCTAssertLessThanOrEqual(result.metrics.eventTimes[7], slowed.times.last! + 1e-6)
        XCTAssertGreaterThanOrEqual(result.metrics.eventTimes[0], slowed.times[0] - 1e-6)
    }

    /// Slowed only two or three times, the swing passes every gate at playback
    /// speed, and its durations used to be shown as measured (#32). The answered-clip
    /// check reads it as slow motion, as the Python and browser engines do.
    func testAClipSlowedTwoOrThreeTimesIsReadAsSlowMotion() {
        XCTAssertNotNil(Self.analyzer.payload.thresholds.slowMotionCheckBackswingS)
        for factor in [2.0, 3.0] {
            var slowed = sequence
            slowed.times = sequence.times.map { $0 * factor }
            guard let result = Self.analyzer.analyse(slowed, handedness: .right).result else {
                return XCTFail("slowed \(factor)x refused")
            }
            XCTAssertNotNil(result.metrics.slowedBy, "slowed \(factor)x read as real time")
            XCTAssertFalse(result.metrics.hasDurations)
        }
    }

    func testARealTimeClipIsNotTreatedAsSlowMotion() {
        guard let result = Self.analyzer.analyse(sequence, handedness: .right).result else {
            return XCTFail("the real swing was refused")
        }
        XCTAssertNil(result.metrics.slowedBy)
        XCTAssertTrue(result.metrics.hasDurations)
    }

    func testTheScanPointsAtTheSwing() {
        // The fixture sampled six times a second, as the app scans a long clip.
        let seq = sequence
        var samples: [ScanSample] = []
        var next = seq.times[0]
        for i in 0..<seq.count where seq.times[i] >= next {
            samples.append(ScanSample(time: seq.times[i], landmarks: seq.detected[i] ? seq.xy[i] : nil))
            next = seq.times[i] + 1.0 / 6
        }
        let windows = swingCandidates(samples, width: seq.width, height: seq.height,
                                      duration: seq.times.last! - seq.times[0])
        XCTAssertFalse(windows.isEmpty)
        let grid = Self.golden.resampledTimes
        let frames = Self.golden.cases["right"]!.frames!
        let impact = grid[frames[5]]
        XCTAssert(windows[0].start < impact && impact < windows[0].end, "\(windows[0]) misses \(impact)")
    }
}
