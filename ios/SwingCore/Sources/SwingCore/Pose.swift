import Foundation

/// MediaPipe's 33-landmark body model, by the indices the features use.
public enum Landmark {
    public static let nose = 0, leftEar = 7, rightEar = 8
    public static let leftShoulder = 11, rightShoulder = 12
    public static let leftElbow = 13, rightElbow = 14
    public static let leftWrist = 15, rightWrist = 16
    public static let leftIndex = 19, rightIndex = 20
    public static let leftHip = 23, rightHip = 24
    public static let leftKnee = 25, rightKnee = 26
    public static let leftAnkle = 27, rightAnkle = 28
    public static let leftFootIndex = 31, rightFootIndex = 32
    public static let count = 33

    /// The subset the features are built from, in the order the model was trained
    /// with. A different order would not fail; it would shuffle the inputs.
    public static let swing: [Int] = [
        nose, leftEar, rightEar, leftShoulder, rightShoulder, leftElbow, rightElbow,
        leftWrist, rightWrist, leftIndex, rightIndex, leftHip, rightHip,
        leftKnee, rightKnee, leftAnkle, rightAnkle, leftFootIndex, rightFootIndex,
    ]

    /// Lines drawn between landmarks to show the tracked skeleton.
    public static let bones: [(Int, Int)] = [
        (11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
        (23, 25), (25, 27), (27, 29), (29, 31), (24, 26), (26, 28), (28, 30), (30, 32),
        (0, 7), (0, 8),
    ]
}

public enum SwingEvent: Int, CaseIterable {
    case address, toeUp, midBackswing, top, midDownswing, impact, midFollowThrough, finish

    public var name: String {
        ["Address", "Toe Up", "Mid Backswing", "Top", "Mid Downswing", "Impact",
         "Mid Follow Through", "Finish"][rawValue]
    }

    /// Toe-up and mid-follow-through are defined by the club shaft, which a body
    /// tracker does not see; they are placed from the body's motion instead.
    public var clubDefined: Bool { self == .toeUp || self == .midFollowThrough }
}

public enum Handedness: String, Codable {
    case right, left
}

public struct Point: Codable, Equatable {
    public var x: Double
    public var y: Double
    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
}

/// Landmarks for a clip, one row per tracked frame.
///
/// `xy` is image-normalised as the estimator reports it, so x and y are in
/// different units unless the frame is square; `squareXY` fixes that.
public struct PoseSequence {
    public var xy: [[Point]]
    public var visibility: [[Double]]
    public var detected: [Bool]
    public var times: [Double]
    public var width: Double
    public var height: Double

    public init(xy: [[Point]], visibility: [[Double]], detected: [Bool], times: [Double],
                width: Double, height: Double) {
        self.xy = xy
        self.visibility = visibility
        self.detected = detected
        self.times = times
        self.width = width
        self.height = height
    }

    public var count: Int { times.count }
    public var aspect: Double { width / height }

    public func squareXY() -> [[Point]] {
        let a = aspect
        return xy.map { frame in frame.map { Point($0.x * a, $0.y) } }
    }
}
