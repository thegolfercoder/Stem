import AVFoundation
import CoreImage
import ImageIO
import UIKit

/// Every frame of a video file, decoded in order, the right way up and shrunk.
///
/// AVAssetReader decodes each frame explicitly - H.264, HEVC, 10-bit HDR, slow
/// motion - so none are dropped the way playback drops them on a busy phone, and
/// the answer does not change from one run to the next. Frames are shrunk to
/// `maxSide` pixels because the pose estimator works at a few hundred pixels
/// whatever it is given, and the swing model was trained on landmarks from small
/// video. Frames closer together than `minGap` are skipped: the model looks at
/// sixty a second, so a 240 fps clip is tracked at sixty.
final class FrameReader {
    let asset: AVURLAsset
    let track: AVAssetTrack
    let duration: Double
    let naturalSize: CGSize
    /// How far the file says to turn its frames, from the track's transform.
    let flagOrientation: CGImagePropertyOrientation
    /// Set once the orientation probe has asked the pose estimator.
    var orientation: CGImagePropertyOrientation
    private let context = CIContext(options: [.cacheIntermediates: false])

    init(url: URL) async throws {
        asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw PipelineError.noVideo
        }
        self.track = track
        duration = try await asset.load(.duration).seconds
        naturalSize = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let degrees = (atan2(transform.b, transform.a) * 180 / .pi).rounded()
        switch Int(degrees) {
        case 90: flagOrientation = .right
        case -90, 270: flagOrientation = .left
        case 180, -180: flagOrientation = .down
        default: flagOrientation = .up
        }
        orientation = flagOrientation
    }

    /// Frames from `start` to `end` seconds, `minGap` apart at least, each handed
    /// over as an upright CGImage no larger than `maxSide`.
    func read(from start: Double = 0, to end: Double? = nil, minGap: Double,
              maxSide: CGFloat = 640, orientation override: CGImagePropertyOrientation? = nil,
              onFrame: (Double, CGImage) throws -> Bool) throws {
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        let stop = end ?? duration
        reader.timeRange = CMTimeRange(
            start: CMTime(seconds: max(0, start), preferredTimescale: 600),
            end: CMTime(seconds: stop + 0.05, preferredTimescale: 600))
        guard reader.startReading() else { throw reader.error ?? PipelineError.unreadable }
        defer { reader.cancelReading() }
        var kept = -Double.infinity
        let turn = override ?? orientation
        while let sample = output.copyNextSampleBuffer() {
            let time = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            if time > stop + 1e-3 { break }
            if time - kept < minGap - 2e-3 { continue }
            guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
            var image = CIImage(cvPixelBuffer: pixels).oriented(turn)
            let longest = max(image.extent.width, image.extent.height)
            if longest > maxSide {
                let scale = maxSide / longest
                image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            }
            guard let frame = context.createCGImage(image, from: image.extent) else { continue }
            kept = time
            if try !onFrame(time, frame) { break }
        }
        if reader.status == .failed { throw reader.error ?? PipelineError.unreadable }
    }
}

enum PipelineError: LocalizedError {
    case noVideo, unreadable, noPoseModel, tooShort

    var errorDescription: String? {
        switch self {
        case .noVideo: return "That file has no video track."
        case .unreadable: return "This video could not be decoded on this iPhone."
        case .noPoseModel: return "The pose model is missing from the app. Run setup.sh again before building."
        case .tooShort: return "The clip is too short to hold a swing."
        }
    }
}
