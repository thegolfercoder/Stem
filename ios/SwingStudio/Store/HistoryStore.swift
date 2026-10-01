import Foundation
import SwingCore
import UIKit

// SwingRecord and CoachRead live in SwingCore (StoreFile.swift), so a test can hold
// the kept format to what earlier builds wrote (#46).

/// Every swing, newest first, in the app's own folder. Nothing leaves the phone.
@MainActor
final class HistoryStore: ObservableObject {
    @Published private(set) var records: [SwingRecord] = []
    /// Set when swings.json could not be read; shown to the golfer.
    @Published private(set) var unreadableNotice: String?
    /// True when an unreadable file could not even be moved aside: then nothing is
    /// saved, so it is never overwritten.
    private var saveBlocked = false
    private let folder: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        folder = base.appendingPathComponent("Swings", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
    }

    private var index: URL { folder.appendingPathComponent("swings.json") }

    private func load() {
        switch StoreFile.load([SwingRecord].self, from: index) {
        case .missing: records = []
        case .read(let kept): records = kept
        case .unreadable(let keptAs):
            records = []
            saveBlocked = keptAs == nil
            unreadableNotice = StoreFile.notice("swings", keptAs: keptAs)
        }
    }

    private func save() {
        guard !saveBlocked else { return }
        StoreFile.save(records, to: index)
    }

    @discardableResult
    func add(result: SwingResult, keyFrames: [UIImage], sourceName: String, club: String?,
             practiceId: Int? = nil) -> SwingRecord {
        let id = UUID()
        let names = keyFrames.enumerated().compactMap { index, image -> String? in
            let name = "\(id.uuidString)-\(index).jpg"
            guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
            try? data.write(to: folder.appendingPathComponent(name))
            return name
        }
        let record = SwingRecord(id: id, date: Date(), club: club, label: nil, sourceName: sourceName,
                                 result: result, keyFrames: names, coach: nil, practiceId: practiceId)
        // The same clip analysed again replaces its practice reading (PracticeLog.add),
        // so its earlier entry here goes too, pictures and all.
        if let practiceId {
            for earlier in records where earlier.practiceId == practiceId {
                for name in earlier.keyFrames {
                    try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
                }
            }
            records.removeAll { $0.practiceId == practiceId }
        }
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

    /// Every swing and every picture of one, gone.
    func eraseAll() {
        for record in records {
            for name in record.keyFrames { try? FileManager.default.removeItem(at: folder.appendingPathComponent(name)) }
        }
        records = []
        try? FileManager.default.removeItem(at: index)
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
