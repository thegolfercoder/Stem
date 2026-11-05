import Foundation

/// A file the app keeps the golfer's swings or practice log in (#46).
///
/// Written as `{"version": n, "items": …}`. Read back as that, or as the bare
/// value earlier builds wrote. A file that exists but cannot be read (truncated,
/// or written by a build whose types this one does not know) is never
/// overwritten: it is moved aside under a dated name and the caller is told, so
/// the next save starts a new file next to it instead of over it. If even the
/// move fails, the caller must not save at all.
public enum StoreFile {
    /// The format written now. A file with a higher version is from a newer build
    /// and is set aside rather than read, so it cannot be overwritten by this one.
    public static let version = 1

    public enum Loaded<Value> {
        case missing
        case read(Value)
        /// `keptAs` is where the unreadable file now is, or nil if it could not be
        /// moved, in which case it is still at its own path and must not be saved over.
        case unreadable(keptAs: URL?)
    }

    struct Envelope<Value: Codable>: Codable {
        let version: Int
        let items: Value
    }

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    public static func load<Value: Codable>(_ type: Value.Type, from url: URL, now: Date = Date())
        -> Loaded<Value>
    {
        guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
        if let data = try? Data(contentsOf: url) {
            if let envelope = try? decoder.decode(Envelope<Value>.self, from: data) {
                if envelope.version <= version { return .read(envelope.items) }
            } else if let bare = try? decoder.decode(Value.self, from: data) {
                return .read(bare)  // written before files carried a version
            }
        }
        return .unreadable(keptAs: setAside(url, now: now))
    }

    /// Moves the file to `<name>.unreadable-<UTC time>` beside it; nil if it could not.
    public static func setAside(_ url: URL, now: Date = Date()) -> URL? {
        let stamp = ISO8601DateFormatter().string(from: now).replacingOccurrences(of: ":", with: "-")
        let aside = url.deletingLastPathComponent()
            .appendingPathComponent("\(url.lastPathComponent).unreadable-\(stamp)")
        do {
            try FileManager.default.moveItem(at: url, to: aside)
            return aside
        } catch {
            return nil
        }
    }

    public static func encode<Value: Codable>(_ items: Value, pretty: Bool = false) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if pretty { encoder.outputFormatting = [.prettyPrinted, .sortedKeys] }
        return try encoder.encode(Envelope(version: version, items: items))
    }

    @discardableResult
    public static func save<Value: Codable>(_ items: Value, to url: URL, pretty: Bool = false) -> Bool {
        guard let data = try? encode(items, pretty: pretty) else { return false }
        return (try? data.write(to: url, options: .atomic)) != nil
    }

    /// What to tell the golfer when a file could not be read.
    public static func notice(_ what: String, keptAs: URL?) -> String {
        if let keptAs {
            return "Your earlier \(what) could not be read by this version of the app. They have "
                + "been kept, not deleted, as \(keptAs.lastPathComponent) in the app's folder; "
                + "new ones are saved alongside."
        }
        return "Your earlier \(what) could not be read by this version of the app, and could not "
            + "be moved aside, so nothing new will be saved until the app is updated."
    }
}

/// A coach's read, kept with the swing it is about.
public struct CoachRead: Codable, Equatable {
    public var model: String
    public var text: String
    public var sawPictures: Bool
    public var at: Date

    public init(model: String, text: String, sawPictures: Bool, at: Date) {
        self.model = model
        self.text = text
        self.sawPictures = sawPictures
        self.at = at
    }
}

/// One analysed swing, as it is kept on the iPhone (`swings.json`). In SwingCore so
/// a test can hold the kept format to what earlier builds wrote (#46).
public struct SwingRecord: Codable, Identifiable, Hashable {
    public var id: UUID
    public var date: Date
    public var club: String?
    public var label: String?
    public var sourceName: String
    public var result: SwingResult
    /// File names of the eight key frames, in order.
    public var keyFrames: [String]
    public var coach: CoachRead?
    /// This swing's entry in the practice log, when it has one.
    public var practiceId: Int?

    public var tempo: Double? { result.metrics.tempoRatio }

    public init(id: UUID, date: Date, club: String?, label: String?, sourceName: String,
                result: SwingResult, keyFrames: [String], coach: CoachRead?, practiceId: Int?) {
        self.id = id
        self.date = date
        self.club = club
        self.label = label
        self.sourceName = sourceName
        self.result = result
        self.keyFrames = keyFrames
        self.coach = coach
        self.practiceId = practiceId
    }

    public static func == (a: SwingRecord, b: SwingRecord) -> Bool { a.id == b.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
