import Foundation

/// The trained model as the desktop exports it (scripts/export_web_model.py):
/// architecture, weights, feature layout, thresholds and measured error bands.
///
/// The same file the browser app carries, so every platform runs the same
/// weights against the same thresholds, and the bands quoted are the ones that
/// were measured through exactly these weights.
public struct ModelPayload: Decodable {
    public struct Architecture: Decodable {
        public let inFeatures: Int
        public let channels: Int
        public let dilations: [Int]
        public let kernelSize: Int
        public let paddingMode: String
        public let groups: Int
        public let classes: Int

        enum CodingKeys: String, CodingKey {
            case inFeatures = "in_features", channels, dilations, kernelSize = "kernel_size"
            case paddingMode = "padding_mode", groups, classes
        }
    }

    public struct Tensor: Decodable {
        public let name: String
        public let shape: [Int]
        public let offset: Int
        public let count: Int
    }

    public struct Layout: Decodable {
        public let positions: [Int]
        public let velocities: [Int]
        public let speeds: [Int]
        public let visibility: [Int]
        public let angles: [Int]
        public let handsRelative: [Int]
        public let handVelocity: [Int]
        public let handSpeed: [Int]
        public let widths: [Int]
        public let total: Int

        enum CodingKeys: String, CodingKey {
            case positions, velocities, speeds, visibility, angles
            case handsRelative = "hands_relative", handVelocity = "hand_velocity"
            case handSpeed = "hand_speed", widths, total
        }
    }

    public struct Features: Decodable {
        public let canonicalRateHz: Double
        public let minVisibility: Double
        public let normaliseRoll: Bool
        public let layout: Layout

        enum CodingKeys: String, CodingKey {
            case canonicalRateHz = "canonical_rate_hz", minVisibility = "min_visibility"
            case normaliseRoll = "normalise_roll", layout
        }
    }

    public struct Thresholds: Decodable {
        public let minMeanConfidence: Double
        public let minCoreConfidence: Double
        public let minDetectionRate: Double
        public let plausibleBackswingS: [Double]
        public let plausibleDownswingS: [Double]
        public let plausibleTempo: [Double]

        enum CodingKeys: String, CodingKey {
            case minMeanConfidence = "min_mean_confidence"
            case minCoreConfidence = "min_core_confidence"
            case minDetectionRate = "min_detection_rate"
            case plausibleBackswingS = "plausible_backswing_s"
            case plausibleDownswingS = "plausible_downswing_s"
            case plausibleTempo = "plausible_tempo"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            minMeanConfidence = try c.decode(Double.self, forKey: .minMeanConfidence)
            // Older exports had no core threshold; zero keeps their behaviour.
            minCoreConfidence = try c.decodeIfPresent(Double.self, forKey: .minCoreConfidence) ?? 0
            minDetectionRate = try c.decode(Double.self, forKey: .minDetectionRate)
            plausibleBackswingS = try c.decode([Double].self, forKey: .plausibleBackswingS)
            plausibleDownswingS = try c.decode([Double].self, forKey: .plausibleDownswingS)
            plausibleTempo = try c.decode([Double].self, forKey: .plausibleTempo)
        }
    }

    public struct Calibration: Decodable {
        public struct Events: Decodable {
            public let coverage: Double
            public let canonicalRateHz: Double
            public let measuredOn: String
            public let confidenceEdges: [[Double]]
            public let halfWidthFrames: [[Double]]
            public let counts: [[Int]]

            enum CodingKeys: String, CodingKey {
                case coverage, canonicalRateHz = "canonical_rate_hz", measuredOn = "measured_on"
                case confidenceEdges = "confidence_edges", halfWidthFrames = "half_width_frames"
                case counts
            }
        }

        public struct Tempo: Decodable {
            public let halfWidthFraction: Double
            public let coverage: Double
            public let nCalibration: Int
            public let measuredOn: String

            enum CodingKeys: String, CodingKey {
                case halfWidthFraction = "half_width_fraction", coverage
                case nCalibration = "n_calibration", measuredOn = "measured_on"
            }
        }

        public let events: Events?
        public let tempo: Tempo?
    }

    public struct Member: Decodable {
        public let tensors: [Tensor]
        public let weightsBase64: String

        enum CodingKeys: String, CodingKey {
            case tensors, weightsBase64 = "weights_base64"
        }
    }

    public let architecture: Architecture
    public let tensors: [Tensor]
    public let weightsBase64: String
    public let features: Features
    public let thresholds: Thresholds
    public let calibration: Calibration?
    public let timeWarps: [Double]?
    public let members: [Member]?

    enum CodingKeys: String, CodingKey {
        case architecture, tensors, weightsBase64 = "weights_base64", features, thresholds
        case calibration, timeWarps = "time_warps", members
    }

    /// The model shipped with this package.
    public static func bundled() throws -> ModelPayload {
        guard let url = Bundle.module.url(forResource: "model", withExtension: "json") else {
            throw SwingError.missingResource("model.json")
        }
        return try load(url)
    }

    public static func load(_ url: URL) throws -> ModelPayload {
        try JSONDecoder().decode(ModelPayload.self, from: Data(contentsOf: url))
    }
}

public enum SwingError: Error, CustomStringConvertible {
    case missingResource(String)
    case badWeights(String)

    public var description: String {
        switch self {
        case .missingResource(let name): return "the app is missing \(name)"
        case .badWeights(let why): return "the model weights could not be read: \(why)"
        }
    }
}
