import MediaPipeTasksVision
import SwingCore
import UIKit

/// Google's MediaPipe pose landmarker, heavy model, in video mode: the same
/// estimator and model the desktop and browser apps use, so the swing model sees
/// the same kind of landmarks everywhere.
final class PoseTracker {
    private let landmarker: PoseLandmarker
    /// Video mode refuses any timestamp not after the last one it saw, across its
    /// whole life, so every pass through a clip continues from here.
    private var clockMs = 0

    init() throws {
        guard let path = Bundle.main.path(forResource: "pose_landmarker_heavy", ofType: "task") else {
            throw PipelineError.noPoseModel
        }
        let options = PoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = path
        options.baseOptions.delegate = .GPU
        options.runningMode = .video
        options.numPoses = 1
        options.minPoseDetectionConfidence = 0.5
        options.minPosePresenceConfidence = 0.5
        options.minTrackingConfidence = 0.5
        let made: PoseLandmarker
        do {
            made = try PoseLandmarker(options: options)
        } catch {
            // No usable GPU path: the processor is slower but always there.
            options.baseOptions.delegate = .CPU
            made = try PoseLandmarker(options: options)
        }
        landmarker = made
    }

    struct Pose {
        var points: [Point]
        var visibility: [Double]
    }

    /// The body in one frame, or nil if none was found.
    func detect(_ frame: CGImage, at seconds: Double, base: Int) -> Pose? {
        var stamp = base + Int((seconds * 1000).rounded())
        if stamp <= clockMs { stamp = clockMs + 1 }
        clockMs = stamp
        guard let image = try? MPImage(uiImage: UIImage(cgImage: frame)),
              let result = try? landmarker.detect(videoFrame: image, timestampInMilliseconds: stamp),
              let marks = result.landmarks.first, marks.count >= Landmark.count
        else { return nil }
        return Pose(
            points: marks.map { Point(Double($0.x), Double($0.y)) },
            visibility: marks.map { mark in
                min(mark.visibility?.doubleValue ?? 1, mark.presence?.doubleValue ?? 1)
            })
    }

    /// A clock value comfortably after everything seen so far, to start a new pass.
    func nextBase() -> Int { clockMs + 1000 }
}
