import XCTest
@testable import SwingCore

/// The iPhone's frame timing (#47): each kept frame carries its own presentation
/// time, so frame i of a 30 fps clip is at i/30, and a 240 fps clip is tracked at
/// sixty a second. The desktop once timed frames by index and slipped a frame
/// partway through a clip (#40); this holds the iPhone to the frame's own time.
final class FrameGateTests: XCTestCase {
    /// Run `times` through a gate the way FrameReader does; the times it kept.
    private func kept(_ times: [Double], stop: Double, minGap: Double) -> [Double] {
        var gate = FrameGate(stop: stop, minGap: minGap)
        var out: [Double] = []
        for time in times {
            let verdict = gate.verdict(time)
            if verdict == .done { break }
            if verdict == .skip { continue }
            out.append(gate.took(time))
        }
        return out
    }

    func testEveryFrameOfA30FpsClipIsKeptAtItsOwnTime() {
        let times = (0..<211).map { Double($0) / 30 }
        let out = kept(times, stop: 7.0, minGap: 1.0 / 60)
        XCTAssertEqual(out.count, 211)
        for (i, time) in out.enumerated() {
            XCTAssertEqual(time, Double(i) / 30, accuracy: 1e-9, "frame \(i)")
        }
    }

    func testA240FpsClipIsTrackedAtSixtyFromItsOwnTimes() {
        let times = (0..<480).map { Double($0) / 240 }
        let out = kept(times, stop: 2.0, minGap: 1.0 / 60)
        XCTAssertEqual(out.count, 120)
        for (k, time) in out.enumerated() {
            XCTAssertEqual(time, Double(4 * k) / 240, accuracy: 1e-9, "kept frame \(k)")
        }
    }

    func testVariableFrameTimesAreKeptAsTheyAre() {
        // A phone clip's frames are not evenly spaced; their times are not rewritten.
        let times = [0.0, 0.034, 0.066, 0.101, 0.133, 0.167, 0.2]
        XCTAssertEqual(kept(times, stop: 1, minGap: 1.0 / 60), times)
    }

    func testFramesAfterTheEndStopTheRead() {
        let times = (0..<90).map { Double($0) / 30 }
        XCTAssertEqual(kept(times, stop: 1.0, minGap: 1.0 / 60).last ?? -1, 1.0, accuracy: 1e-9)
    }

    func testAFrameThatFailedToDecodeDoesNotPushTheNextOneOut() {
        var gate = FrameGate(stop: 1, minGap: 1.0 / 30)
        XCTAssertEqual(gate.verdict(0.0), .keep)        // decoded nothing: not taken
        XCTAssertEqual(gate.verdict(1.0 / 60), .keep)   // so the next is still due
    }
}
