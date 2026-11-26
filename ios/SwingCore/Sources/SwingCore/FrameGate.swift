/// Which decoded frames the iPhone's `FrameReader` keeps, and at what time (#47).
///
/// Each frame keeps its own presentation time, read from the file, never an index
/// times a nominal rate: the desktop's reader once timed frames from their index
/// and slipped one frame early partway through a clip, which cost 38 points of
/// within-one-frame accuracy (#40). Frames closer than `minGap` to the last one
/// kept are skipped, so a 240 fps clip is tracked at sixty a second. Kept apart
/// from AVFoundation so it is tested on any platform.
public struct FrameGate {
    public let stop: Double
    public let minGap: Double
    private var kept = -Double.infinity

    public init(stop: Double, minGap: Double) {
        self.stop = stop
        self.minGap = minGap
    }

    public enum Verdict: Equatable { case keep, skip, done }

    /// What to do with the next decoded frame, presented at `time` seconds.
    public func verdict(_ time: Double) -> Verdict {
        if time > stop + 1e-3 { return .done }
        if time - kept < minGap - 2e-3 { return .skip }
        return .keep
    }

    /// A kept frame was used: the next must be `minGap` after it. Called only once
    /// the frame decoded, so a frame that failed to does not push the next one out.
    /// Returns the time to give the frame: its own.
    @discardableResult
    public mutating func took(_ time: Double) -> Double {
        kept = time
        return time
    }
}
