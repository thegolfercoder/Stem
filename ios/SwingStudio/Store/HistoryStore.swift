import Foundation
import SwingCore
import UIKit

/// A coach's read, kept with the swing it is about.
struct CoachRead: Codable {
    var model: String
    var text: String
    var sawPictures: Bool
    var at: Date
}

/// One analysed swing, as it is kept on this iPhone.
struct SwingRecord: Codable, Identifiable {
    var id: UUID
    var date: Date
    var club: String?
    var label: String?
    var sourceName: String
    var result: SwingResult
    /// File names of the eight key frames, in order.
    var keyFrames: [String]
    var coach: CoachRead?

    var tempo: Double? { result.metrics.tempoRatio }
}

/// Every swing, newest first, in the app's own folder. Nothing leaves the phone.
@MainActor
final class HistoryStore: ObservableObject {
    @Published private(set) var records: [SwingRecord] = []
    private let folder: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        folder = base.appendingPathComponent("Swings", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
    }

    private var index: URL { folder.appendingPathComponent("swings.json") }

    private func load() {
        guard let data = try? Data(contentsOf: index) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        records = (try? decoder.decode([SwingRecord].self, from: data)) ?? []
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(records) { try? data.write(to: index, options: .atomic) }
    }

    @discardableResult
    func add(result: SwingResult, keyFrames: [UIImage], sourceName: String, club: String?) -> SwingRecord {
        let id = UUID()
        let names = keyFrames.enumerated().compactMap { index, image -> String? in
            let name = "\(id.uuidString)-\(index).jpg"
            guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
            try? data.write(to: folder.appendingPathComponent(name))
            return name
        }
        let record = SwingRecord(id: id, date: Date(), club: club, label: nil, sourceName: sourceName,
                                 result: result, keyFrames: names, coach: nil)
        records.insert(record, at: 0)
        save()
        return record
    }

    func image(_ name: String) -> UIImage? {
        UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
    }

    func images(for record: SwingRecord) -> [UIImage] { record.keyFrames.compactMap(image) }

    func setCoach(_ read: CoachRead, for id: UUID) {
        guard let i = records.firstIndex(where: { $0.id == id }) else { return }
        records[i].coach = read
        save()
    }

    func update(_ id: UUID, club: String?, label: String?) {
        guard let i = records.firstIndex(where: { $0.id == id }) else { return }
        records[i].club = club
        records[i].label = label
        save()
    }

    func delete(_ id: UUID) {
        guard let i = records.firstIndex(where: { $0.id == id }) else { return }
        for name in records[i].keyFrames { try? FileManager.default.removeItem(at: folder.appendingPathComponent(name)) }
        records.remove(at: i)
        save()
    }
}

/// What the person chose in Settings.
final class AppSettings: ObservableObject {
    @Published var ollamaAddress: String {
        didSet { UserDefaults.standard.set(ollamaAddress, forKey: "ollamaAddress") }
    }
    @Published var preferredModel: String {
        didSet { UserDefaults.standard.set(preferredModel, forKey: "preferredModel") }
    }
    /// "auto", "right" or "left".
    @Published var handedness: String {
        didSet { UserDefaults.standard.set(handedness, forKey: "handedness") }
    }

    init() {
        let defaults = UserDefaults.standard
        ollamaAddress = defaults.string(forKey: "ollamaAddress") ?? ""
        preferredModel = defaults.string(forKey: "preferredModel") ?? ""
        handedness = defaults.string(forKey: "handedness") ?? "auto"
    }

    var chosenHandedness: Handedness? {
        handedness == "left" ? .left : handedness == "right" ? .right : nil
    }
}
