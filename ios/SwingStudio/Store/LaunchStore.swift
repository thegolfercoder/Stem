import Foundation
import SwingCore

/// Every packet the ground radar unit has sent this iPhone, kept raw in the
/// app's folder (`shots.json`), and the demo's synthetic shots, which are kept
/// apart: never saved, never paired with a clip, never shown as a measurement.
///
/// The speeds here are the radar's own. Nothing from the camera goes into them,
/// and none of them goes into the swing analysis, the practice log or the coach.
@MainActor
final class LaunchStore: ObservableObject {
    @Published private(set) var log = ShotLog()
    /// Synthetic packets from the demo, newest last. In memory only.
    @Published private(set) var demoShots: [ReceivedShot] = []
    @Published private(set) var demoRunning = false
    /// Packets that were not a version 1 ShotSummary: counted, kept raw, never read.
    @Published private(set) var lastRejection: String?
    /// Set when shots.json could not be read; shown on the launch monitor screen.
    @Published private(set) var unreadableNotice: String?

    let link = RadarLink()
    private var saveBlocked = false
    private let file: URL
    private var demoTask: Task<Void, Never>?

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("Swings", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        file = folder.appendingPathComponent("shots.json")
        switch StoreFile.load(ShotLog.self, from: file) {
        case .missing: log = ShotLog()
        case .read(let kept): log = kept
        case .unreadable(let keptAs):
            saveBlocked = keptAs == nil
            unreadableNotice = StoreFile.notice("radar shots", keptAs: keptAs)
        }
        link.onPacket = { [weak self] shot in self?.receive(shot) }
        // Left on last time: open the link again, as the golfer had it.
        if link.wasLeftOn { link.connect() }
    }

    private func receive(_ shot: ReceivedShot) {
        if case .failure(let rejection) = shot.decoded { lastRejection = rejection.message }
        guard log.add(shot) else { return }  // the same shot read again after reconnecting
        if !saveBlocked { StoreFile.save(log, to: file) }
    }

    /// Received packets that were rejected whole.
    var rejectedCount: Int { log.shots.filter { $0.summary == nil }.count }

    /// Readable shots, newest first: the demo's while it runs, else the unit's.
    func recent(_ limit: Int = 20) -> [RecentShot] {
        let source = demoRunning ? demoShots : log.shots
        let readable = source.reversed().compactMap { shot -> RecentShot? in
            guard let summary = shot.summary else { return nil }
            return RecentShot(shot: shot, summary: summary)
        }
        return Array(readable.prefix(limit))
    }

    /// The unit's shot for a kept swing, or why there is none. Only real packets
    /// take part: a demo shot is never put beside a real swing.
    ///
    /// The app finds no strike in the clip's audio, so the strike is the swing
    /// model's impact position, which sound travel does not affect: no camera
    /// distance is needed or asked for.
    func pairing(for record: SwingRecord) -> PairingOutcome {
        pairShot(ClipTiming(record: record), shots: log.shots)
    }

    // MARK: demo

    func setDemo(_ on: Bool) {
        demoTask?.cancel()
        demoTask = nil
        demoRunning = on
        demoShots = []
        guard on else { return }
        demoTask = Task { [weak self] in
            var seq: UInt16 = 0
            while !Task.isCancelled {
                seq &+= 1
                self?.addDemoShot(seq)
                try? await Task.sleep(for: .seconds(6))
            }
        }
    }

    /// One synthetic packet, packed as the firmware packs one and read back through
    /// the same decoder, with now and then a refusal of a kind the unit makes.
    private func addDemoShot(_ seq: UInt16) {
        let club = Float.random(in: 36...46)
        let smash = Float.random(in: 1.36...1.47)
        var readings: [LaunchMonitor.WireValue] = [
            .number(club * smash, .lowConfidence), .number(club, .lowConfidence), .number(smash, .derived),
            .refused(8), .refused(8),  // pod not connected
        ]
        if seq % 5 == 0 {
            readings[0] = .refused(5)   // ball track rose after launch
            readings[2] = .refused(12)  // depends on a refused reading
        }
        let bytes = LaunchMonitor.encode(shotSeq: seq, impactMs: UInt32(seq) * 30_000, readings: readings,
                                         groundMv: 3950, podMv: 0)
        demoShots.append(ReceivedShot(bytes: bytes, receivedAt: Date(), arrival: .notified, link: UUID()))
        if demoShots.count > 50 { demoShots.removeFirst(demoShots.count - 50) }
    }
}

/// A received packet that decoded, with what it says.
struct RecentShot: Identifiable {
    let shot: ReceivedShot
    let summary: ShotSummary
    var id: UUID { shot.id }
}
