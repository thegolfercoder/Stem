import Foundation

// Putting a radar shot beside a camera clip.
//
// The two never share a clock. The ground unit stamps impact on its own clock
// (`impact_ms`, milliseconds since it started); the clip's strike is a time into
// the video, and the video's recording start is a time of day in its metadata.
// The phone is the bridge: it notes, on its own clock, when each shot's packet
// arrived. So a shot and a clip are paired by the phone's clock, and only when
// exactly one shot falls inside a stated window around the clip's strike.
//
// This is not launchmon-py's fusion (launchmon/fusion/shot.py), which aligns one
// shot's sensors to the millisecond by the strike each of them sees. It answers
// an earlier question: which radar shot, if any, is this clip's swing? Nothing
// here changes or computes a number; a pairing only says which shot to show.

/// How a packet reached the phone.
public enum ShotArrival: String, Codable, Sendable {
    /// A notification, sent as the unit finished analysing the shot.
    case notified = "notify"
    /// A notification arrived cut short (a small BLE MTU) and the characteristic
    /// was read straight after it, as the results screen does. Timed by the
    /// notification.
    case readAfterShortNotification = "read after short notify"
    /// Read on connecting: the last shot the unit analysed, which may be from
    /// before this connection. When it happened is not known on the phone's clock.
    case readOnConnect = "read on connect"

    /// Whether the phone's clock at arrival says when the shot happened.
    public var isLive: Bool { self != .readOnConnect }
}

/// One packet as the phone received it. The bytes are kept exactly as sent, even
/// when they could not be read (raw data is kept); they are decoded when used.
public struct ReceivedShot: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let bytes: [UInt8]
    /// The phone's clock when the packet arrived.
    public let receivedAt: Date
    public let arrival: ShotArrival
    /// One Bluetooth connection. The unit's clock is only compared within one:
    /// a unit that restarted has a new clock.
    public let link: UUID

    public init(id: UUID = UUID(), bytes: [UInt8], receivedAt: Date, arrival: ShotArrival, link: UUID) {
        self.id = id
        self.bytes = bytes
        self.receivedAt = receivedAt
        self.arrival = arrival
        self.link = link
    }

    public var decoded: Result<ShotSummary, PacketRejection> { LaunchMonitor.decode(bytes) }
    public var summary: ShotSummary? { try? decoded.get() }

    // Seconds since 1970 as a number, not an ISO date: StoreFile writes dates to
    // the whole second, and arrival times are needed finer than that.
    enum CodingKeys: String, CodingKey {
        case id, packetHex = "packet_hex", receivedAt = "received_at_unix_s", arrival, link
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        let text = try c.decode(String.self, forKey: .packetHex)
        guard let bytes = LaunchMonitor.bytes(hex: text) else {
            throw DecodingError.dataCorruptedError(forKey: .packetHex, in: c, debugDescription: "not hex")
        }
        self.bytes = bytes
        receivedAt = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .receivedAt))
        arrival = try c.decode(ShotArrival.self, forKey: .arrival)
        link = try c.decode(UUID.self, forKey: .link)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(LaunchMonitor.hex(bytes), forKey: .packetHex)
        try c.encode(receivedAt.timeIntervalSince1970, forKey: .receivedAt)
        try c.encode(arrival, forKey: .arrival)
        try c.encode(link, forKey: .link)
    }
}

/// Every packet the phone has received from the unit, oldest first.
public struct ShotLog: Codable, Equatable, Sendable {
    public var shots: [ReceivedShot]

    public init(shots: [ReceivedShot] = []) { self.shots = shots }

    /// Adds a packet unless the same bytes are already held: the characteristic is
    /// also readable, and a read after reconnecting returns the last shot again.
    /// False when it was a repeat.
    @discardableResult
    public mutating func add(_ shot: ReceivedShot) -> Bool {
        if shots.contains(where: { $0.bytes == shot.bytes }) { return false }
        shots.append(shot)
        return true
    }
}

/// The windows pairing uses. Design bounds, not measured accuracies: no unit has
/// been built, so nothing here has been timed against one.
public struct PairingTolerance: Equatable, Sendable {
    /// How far the clip's recording start may be from the time its metadata
    /// gives, either way. iPhone video carries its creation date to the whole
    /// second (QuickTime `com.apple.quicktime.creationdate`), so a second covers
    /// the rounding. That the date is when recording started, and that the first
    /// frame follows it closely, is assumed, not yet checked on a device.
    public var recordingStartSlackS: Double
    /// The longest the unit may take from impact to the phone receiving its
    /// packet: the end of the 0.7 s capture, the on-device analysis and the
    /// Bluetooth delivery. The firmware times its analysis (`analysis_ms`) but
    /// sends that only on USB, and firmware/README.md's example of it, 910 ms, is
    /// a format example, not a result. Three seconds leaves room above that; a
    /// shot that took longer is refused here, never paired with a guess.
    public var maxDeliveryS: Double

    public init(recordingStartSlackS: Double, maxDeliveryS: Double) {
        self.recordingStartSlackS = recordingStartSlackS
        self.maxDeliveryS = maxDeliveryS
    }

    public static let standard = PairingTolerance(recordingStartSlackS: 1.0, maxDeliveryS: 3.0)

    /// A shot pairs when (its impact, as placed on the phone's clock) minus (the
    /// clip's strike on the phone's clock) is inside this range, in seconds. The
    /// placed impact is never earlier than the true one and at most
    /// `maxDeliveryS` later; the strike is within `recordingStartSlackS` either way.
    public var window: ClosedRange<Double> { -recordingStartSlackS...(maxDeliveryS + recordingStartSlackS) }
}

/// The unit's clock, mapped onto the phone's.
///
/// Every live packet gives one equation: arrival on the phone = impact on the
/// unit + the clocks' offset + that shot's delivery time, which is never
/// negative. So the smallest (arrival - impact) among a run of shots on one clock
/// is the offset plus the quickest delivery, and placing every shot with it
/// takes out the part of the delay that varies from shot to shot. What is left
/// is one constant: each placed impact is late by the run's quickest delivery,
/// between zero and `maxDeliveryS`.
///
/// A run is the shots of one connection whose offsets agree to within
/// `maxDeliveryS`. A jump beyond that means the unit's clock jumped (it
/// restarted, or `impact_ms` wrapped), and a new run starts.
public enum UnitClock {
    /// The phone-clock time of each live shot's impact, by shot id. Shots read on
    /// connecting, and packets that could not be read, are not placed.
    public static func place(_ shots: [ReceivedShot], maxDeliveryS: Double) -> [UUID: Date] {
        var placed: [UUID: Date] = [:]
        let live = shots.compactMap { shot -> (shot: ReceivedShot, impactS: Double)? in
            guard shot.arrival.isLive, let summary = shot.summary else { return nil }
            return (shot, Double(summary.impactMs) / 1000)
        }
        for link in Set(live.map(\.shot.link)) {
            let ordered = live.filter { $0.shot.link == link }.sorted { $0.shot.receivedAt < $1.shot.receivedAt }
            var run: [(shot: ReceivedShot, impactS: Double, offset: Double)] = []
            func close() {
                guard let offset = run.map(\.offset).min() else { return }
                for item in run { placed[item.shot.id] = Date(timeIntervalSince1970: item.impactS + offset) }
                run = []
            }
            for item in ordered {
                let offset = item.shot.receivedAt.timeIntervalSince1970 - item.impactS
                if let low = run.map(\.offset).min(), abs(offset - low) > maxDeliveryS { close() }
                run.append((item.shot, item.impactS, offset))
            }
            close()
        }
        return placed
    }
}

/// Where the strike is in a clip, in seconds from its first frame.
public enum ClipStrike: Equatable, Sendable {
    /// The onset of the strike's sound (launchmon-py `fusion/audio.py`). Late by
    /// the sound's travel from ball to phone, which is removed when the distance
    /// is known. Nothing in SwingCore finds it yet.
    case audio(seconds: Double)
    /// The swing model's impact position. Seen, not heard: no travel to remove.
    case impactEvent(seconds: Double)

    public var seconds: Double {
        switch self {
        case .audio(let s), .impactEvent(let s): return s
        }
    }
}

/// What pairing needs to know about a clip.
public struct ClipTiming: Equatable, Sendable {
    /// When recording started, on the phone's clock, from the clip's metadata.
    public var recordingStarted: Date?
    public var strike: ClipStrike
    /// Set when the clip only read as slow motion (`SwingMetrics.slowedBy`).
    public var slowedBy: Double?

    public init(recordingStarted: Date?, strike: ClipStrike, slowedBy: Double? = nil) {
        self.recordingStarted = recordingStarted
        self.strike = strike
        self.slowedBy = slowedBy
    }

    /// An analysed swing as the phone keeps it: the model's impact position, since
    /// the app does not find the strike in the audio.
    public init(record: SwingRecord) {
        let times = record.result.metrics.eventTimes
        self.init(recordingStarted: record.clipStartedAt,
                  strike: .impactEvent(seconds: times.count > SwingEvent.impact.rawValue
                                       ? times[SwingEvent.impact.rawValue] : .nan),
                  slowedBy: record.result.metrics.slowedBy)
    }
}

/// A clip and the one radar shot that falls inside the window around its strike.
public struct ShotPairing: Equatable, Sendable {
    public let shot: ReceivedShot
    public let summary: ShotSummary
    /// The clip's strike on the phone's clock.
    public let strikeAt: Date
    /// The shot's impact, placed on the phone's clock (`UnitClock`).
    public let shotAt: Date
    /// What was assumed or left in, said where the pairing is shown.
    public let notes: [String]

    /// Seconds from the clip's strike to the placed impact.
    public var gapS: Double { shotAt.timeIntervalSince(strikeAt) }
}

public enum PairingOutcome: Equatable, Sendable {
    case paired(ShotPairing)
    case refused(reason: String)

    public var pairing: ShotPairing? {
        if case .paired(let p) = self { return p }
        return nil
    }
}

public let speedOfSoundMps = 343.0

/// The radar shot that goes with a clip, or the reason there is none.
///
/// Pairs only when exactly one live shot's placed impact is inside
/// `tolerance.window` of the clip's strike. Two inside it is a refusal, not a
/// choice of the nearer one: inside the window the clock cannot tell them apart.
public func pairShot(_ clip: ClipTiming, shots: [ReceivedShot], cameraToBallM: Double? = nil,
                     tolerance: PairingTolerance = .standard) -> PairingOutcome {
    guard let started = clip.recordingStarted else {
        return .refused(reason: "this clip carries no recording time, so it cannot be put beside the "
            + "radar's shots by the clock")
    }
    if clip.slowedBy != nil {
        return .refused(reason: "this clip read as slow motion, so time in it does not run at the clock's "
            + "rate and when the strike happened is not known")
    }
    let s = clip.strike.seconds
    guard s.isFinite, s >= 0 else { return .refused(reason: "the clip has no strike time to pair by") }

    var notes: [String] = []
    var strikeS = s
    if case .audio = clip.strike {
        if let d = cameraToBallM {
            guard d.isFinite, d >= 0 else {
                return .refused(reason: "the camera distance is not a usable number of metres")
            }
            strikeS -= d / speedOfSoundMps
            notes.append(String(format: "sound travel over %.1f m removed from the strike", d))
        } else {
            notes.append("sound travel left in the strike: no camera distance given (about 3 ms a metre)")
        }
    } else {
        notes.append("the clip's strike is the swing model's impact position")
    }
    let strikeAt = started.addingTimeInterval(strikeS)

    let placed = UnitClock.place(shots, maxDeliveryS: tolerance.maxDeliveryS)
    let byId = Dictionary(shots.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let window = tolerance.window
    var candidates: [(shot: ReceivedShot, summary: ShotSummary, at: Date)] = []
    var nearest: (seq: UInt16, gap: Double)?
    for (id, at) in placed {
        guard let shot = byId[id], let summary = shot.summary else { continue }
        let gap = at.timeIntervalSince(strikeAt)
        if window.contains(gap) { candidates.append((shot, summary, at)) }
        if nearest == nil || abs(gap) < abs(nearest!.gap) { nearest = (summary.shotSeq, gap) }
    }
    let windowText = String(format: "%.1f s before to %.1f s after", -window.lowerBound, window.upperBound)

    if candidates.count > 1 {
        let seqs = candidates.sorted { $0.at < $1.at }.map { "#\($0.summary.shotSeq)" }.joined(separator: ", ")
        return .refused(reason: "\(candidates.count) radar shots (\(seqs)) fall within \(windowText) this "
            + "clip's strike; the clock cannot tell which one this swing was, so none is shown")
    }
    guard let match = candidates.first else {
        var reason: String
        if let nearest {
            reason = String(format: "no radar shot within %@ this clip's strike; the nearest (#%d) was %.1f s %@ it",
                            windowText, Int(nearest.seq), abs(nearest.gap), nearest.gap < 0 ? "before" : "after")
        } else {
            reason = "no radar shot was received live on this phone"
        }
        let unplaced = shots.filter { !$0.arrival.isLive && $0.summary != nil }.count
        if unplaced > 0 {
            reason += ". \(unplaced) shot\(unplaced == 1 ? " was" : "s were") read on connecting, and when "
                + "\(unplaced == 1 ? "it" : "they") happened is not known on this phone's clock"
        }
        return .refused(reason: reason)
    }
    if !match.summary.impactFound {
        notes.append("the unit found no impact in this capture, so its time is the capture's start")
    }
    return .paired(ShotPairing(shot: match.shot, summary: match.summary, strikeAt: strikeAt,
                               shotAt: match.at, notes: notes))
}
