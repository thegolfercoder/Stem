import CoreImage
import SwingCore
import UIKit

/// A video in, an analysed swing out: the same steps as the browser app.
///
/// 1. Which way up: one frame drawn four ways, and the way the estimator finds an
///    upright body wins - whatever the rotation flag says or the decoder does.
/// 2. Where the swing is: a clip under twelve seconds is tracked whole; a longer
///    one is scanned six times a second and up to three candidate stretches are
///    tracked in full and put to the model, which picks.
/// 3. The swing model, measurements and error bands, in SwingCore.
final class ClipAnalyzer {
    struct Outcome {
        var verdict: Verdict
        /// The eight key frames with the skeleton drawn on, when a swing was found.
        var keyFrames: [UIImage]
        var sequence: PoseSequence
    }

    let analyzer: SwingAnalyzer
    private let scanAboveSeconds = 12.0

    init(analyzer: SwingAnalyzer) { self.analyzer = analyzer }

    func analyse(url: URL, handedness: Handedness?,
                 progress: @escaping (String, Double) -> Void) async throws -> Outcome {
        let reader = try await FrameReader(url: url)
        if reader.duration < 0.8 { throw PipelineError.tooShort }
        let tracker = try PoseTracker()

        progress("Working out which way up the clip is", 0.02)
        if let turn = probeOrientation(reader, tracker) { reader.orientation = turn }

        var windows: [(start: Double, end: Double)] = [(0, reader.duration)]
        if reader.duration > scanAboveSeconds {
            var samples: [ScanSample] = []
            var size = CGSize(width: 1, height: 1)
            let base = tracker.nextBase()
            try reader.read(minGap: 1.0 / 6) { time, frame in
                size = CGSize(width: frame.width, height: frame.height)
                let pose = tracker.detect(frame, at: time, base: base)
                samples.append(ScanSample(time: time, landmarks: pose?.points))
                progress("Looking for the swing", 0.05 + 0.2 * time / reader.duration)
                return true
            }
            let found = swingCandidates(samples, width: Double(size.width), height: Double(size.height),
                                        duration: reader.duration)
            if !found.isEmpty { windows = found }
        }

        var best: Outcome?
        for (index, window) in windows.enumerated() {
            let label = windows.count > 1 ? "Tracking stretch \(index + 1) of \(windows.count)" : "Finding the body in each frame"
            let (sequence, thumbnails) = try track(reader, tracker, window) { fraction in
                progress(label, 0.25 + 0.65 * (Double(index) + fraction) / Double(windows.count))
            }
            let verdict = analyzer.analyse(sequence, handedness: handedness)
            if best == nil || verdict.score > best!.verdict.score {
                best = Outcome(verdict: verdict, keyFrames: keyFrames(verdict, sequence, thumbnails),
                               sequence: sequence)
            }
            if let result = verdict.result, result.meanConfidence >= 0.5 { break }
        }
        progress("Done", 1)
        return best!
    }

    /// One frame, all four ways up; the one with a body standing upright wins.
    private func probeOrientation(_ reader: FrameReader, _ tracker: PoseTracker) -> CGImagePropertyOrientation? {
        let turns: [CGImagePropertyOrientation] = [.up, .right, .down, .left]
        for fraction in [0.35, 0.6, 0.15] {
            let at = fraction * reader.duration
            var scores: [(CGImagePropertyOrientation, Double)] = []
            for turn in turns {
                var frame: CGImage?
                try? reader.read(from: at, to: at + 0.5, minGap: 10, orientation: turn) { _, image in
                    frame = image
                    return false
                }
                guard let frame else { continue }
                // Twice: in video mode the estimator looks where the body last was.
                var pose: PoseTracker.Pose?
                for _ in 0..<2 { pose = tracker.detect(frame, at: 0, base: tracker.nextBase()) }
                scores.append((turn, upright(pose, width: Double(frame.width), height: Double(frame.height))))
            }
            if let best = scores.max(by: { $0.1 < $1.1 }), best.1 >= 0.35 { return best.0 }
        }
        return nil
    }

    private func upright(_ pose: PoseTracker.Pose?, width: Double, height: Double) -> Double {
        guard let pose else { return 0 }
        let p = pose.points, v = pose.visibility
        let confidence = [11, 12, 23, 24, 27, 28].map { v[$0] }.reduce(0, +) / 6
        let dx = ((p[27].x + p[28].x) - (p[11].x + p[12].x)) / 2 * width
        let dy = ((p[27].y + p[28].y) - (p[11].y + p[12].y)) / 2 * height
        let length = hypot(dx, dy)
        return length > 0 ? confidence * max(0, dy / length) : 0
    }

    /// Track every frame of a stretch, keeping a small copy of each for the key frames.
    private func track(_ reader: FrameReader, _ tracker: PoseTracker, _ window: (start: Double, end: Double),
                       progress: (Double) -> Void) throws -> (PoseSequence, [Data]) {
        var xy: [[Point]] = [], visibility: [[Double]] = [], detected: [Bool] = [], times: [Double] = []
        // JPEGs, not bitmaps: four hundred 640-pixel frames held raw are 400 MB.
        var thumbnails: [Data] = []
        var size = CGSize(width: 1, height: 1)
        let base = tracker.nextBase()
        let span = max(window.end - window.start, 1e-3)
        try reader.read(from: window.start, to: window.end, minGap: 1.0 / 60) { time, frame in
            size = CGSize(width: frame.width, height: frame.height)
            let pose = tracker.detect(frame, at: time, base: base)
            // A frame with no body keeps the last pose at zero confidence rather than
            // being dropped: dropping it would squeeze the time axis tempo is read from.
            xy.append(pose?.points ?? xy.last ?? Array(repeating: Point(0, 0), count: Landmark.count))
            visibility.append(pose?.visibility ?? Array(repeating: 0, count: Landmark.count))
            detected.append(pose != nil)
            times.append(time + Double(times.count) * 1e-9)
            thumbnails.append(UIImage(cgImage: frame).jpegData(compressionQuality: 0.8) ?? Data())
            progress(min(1, (time - window.start) / span))
            return true
        }
        let sequence = PoseSequence(xy: xy, visibility: visibility, detected: detected, times: times,
                                    width: Double(size.width), height: Double(size.height))
        return (sequence, thumbnails)
    }

    private func keyFrames(_ verdict: Verdict, _ sequence: PoseSequence, _ thumbnails: [Data]) -> [UIImage] {
        guard let result = verdict.result else { return [] }
        return result.metrics.eventTimes.compactMap { time in
            let index = sequence.times.enumerated()
                .min(by: { abs($0.element - time) < abs($1.element - time) })!.offset
            guard let frame = UIImage(data: thumbnails[index])?.cgImage else { return nil }
            return drawPose(on: frame, points: sequence.xy[index], visibility: sequence.visibility[index])
        }
    }
}

/// A frame with the tracked skeleton drawn over it.
func drawPose(on frame: CGImage, points: [Point], visibility: [Double]) -> UIImage {
    let size = CGSize(width: frame.width, height: frame.height)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
        UIImage(cgImage: frame).draw(in: CGRect(origin: .zero, size: size))
        let cg = context.cgContext
        cg.setLineWidth(max(2, size.width / 180))
        cg.setLineCap(.round)
        cg.setStrokeColor(UIColor(red: 0.31, green: 0.76, blue: 0.97, alpha: 0.95).cgColor)
        for (a, b) in Landmark.bones where min(visibility[a], visibility[b]) >= 0.3 {
            cg.move(to: CGPoint(x: points[a].x * size.width, y: points[a].y * size.height))
            cg.addLine(to: CGPoint(x: points[b].x * size.width, y: points[b].y * size.height))
        }
        cg.strokePath()
    }
}
