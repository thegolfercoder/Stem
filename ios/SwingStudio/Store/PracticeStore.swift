import Foundation
import SwingCore

/// The practice loop's log on this iPhone: every clip's numbers, refusals
/// included, and every plan. The rules are SwingCore's (Practice.swift), held to
/// the desktop's by tests; this only keeps the log and saves it. Nothing leaves
/// the phone except an export the golfer asks for.
@MainActor
final class PracticeStore: ObservableObject {
    @Published private(set) var log = PracticeLog()
    /// Set when practice.json could not be read; shown to the golfer.
    @Published private(set) var unreadableNotice: String?
    /// True when an unreadable file could not be moved aside: then nothing is saved.
    private var saveBlocked = false
    private let file: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("Swings", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        file = folder.appendingPathComponent("practice.json")
        load()
    }

    /// The drills, reference and tolerances shipped with the model.
    var rules: PracticeRules? { (try? SharedAnalyzer.shared.get())?.payload.practice }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }

    private func load() {
        switch StoreFile.load(PracticeLog.self, from: file) {
        case .missing: log = PracticeLog()
        case .read(let kept): log = kept
        case .unreadable(let keptAs):
            log = PracticeLog()
            saveBlocked = keptAs == nil
            unreadableNotice = StoreFile.notice("practice log", keptAs: keptAs)
        }
    }

    private func save() {
        guard !saveBlocked else { return }
        StoreFile.save(log, to: file, pretty: true)
    }

    /// Keep one clip; with `forPlan` it is also a retest swing for the active plan.
    @discardableResult
    func record(_ swing: PracticeSwing, forPlan: Bool) -> Int {
        let id = log.add(swing, forPlan: forPlan)
        save()
        return id
    }

    func startPlan(focus: String, from id: Int?) {
        guard let rules else { return }
        log.startPlan(rules, focus: focus, from: id)
        save()
    }

    func closePlan(_ status: String) {
        log.closePlan(status)
        save()
    }

    func remove(_ id: Int) {
        log.remove(id)
        save()
    }

    func eraseAll() {
        log = PracticeLog()
        try? FileManager.default.removeItem(at: file)
    }

    /// Everything kept, as a file the golfer can share.
    func exportFile() -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("swing-practice.json")
        guard let data = try? Self.encoder.encode(log), (try? data.write(to: url, options: .atomic)) != nil else {
            return nil
        }
        return url
    }
}
