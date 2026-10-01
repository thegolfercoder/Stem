import Foundation
import XCTest
@testable import SwingCore

/// The phone's two store files are never lost to a decode failure (#46).
///
/// `Resources/stores/` holds a swings.json and a practice.json as the app wrote
/// them before files carried a version. They must keep decoding: a new required
/// field on SwingRecord, SwingResult, SwingMetrics, PracticeSwing or PracticeLog
/// without a default fails here, in CI, instead of wiping a phone.
final class StoreFileTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("storefile-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    private func fixture(_ name: String) throws -> URL {
        try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json",
                                        subdirectory: "Resources/stores"))
    }

    // MARK: the formats earlier builds wrote

    func testSwingsWrittenBeforeVersionsStillDecode() throws {
        let copy = folder.appendingPathComponent("swings.json")
        try FileManager.default.copyItem(at: fixture("swings"), to: copy)
        guard case .read(let records) = StoreFile.load([SwingRecord].self, from: copy) else {
            return XCTFail("today's swings.json no longer decodes")
        }
        XCTAssertEqual(records.count, 2)
        XCTAssertNotNil(records[0].tempo)
        XCTAssertEqual(records[0].keyFrames.count, 8)
        XCTAssertEqual(records[1].coach?.model, "gemma3:4b")
    }

    func testPracticeLogWrittenBeforeVersionsStillDecodes() throws {
        let copy = folder.appendingPathComponent("practice.json")
        try FileManager.default.copyItem(at: fixture("practice"), to: copy)
        guard case .read(let log) = StoreFile.load(PracticeLog.self, from: copy) else {
            return XCTFail("today's practice.json no longer decodes")
        }
        XCTAssertEqual(log.swings.count, 4)
        XCTAssertNotNil(log.activePlan)
    }

    // MARK: what is written now

    func testWhatIsSavedIsVersionedAndReadsBack() throws {
        let url = folder.appendingPathComponent("practice.json")
        var log = PracticeLog()
        log.add(Self.practiceSwing(1, tempo: 3.0))
        XCTAssertTrue(StoreFile.save(log, to: url, pretty: true))
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(json["version"] as? Int, StoreFile.version)
        guard case .read(let back) = StoreFile.load(PracticeLog.self, from: url) else {
            return XCTFail("a saved log did not read back")
        }
        XCTAssertEqual(back, log)
    }

    func testAMissingFileIsEmptyNotAnError() {
        let url = folder.appendingPathComponent("swings.json")
        guard case .missing = StoreFile.load([SwingRecord].self, from: url) else {
            return XCTFail("a missing file should read as missing")
        }
    }

    // MARK: never overwrite what cannot be read

    func testAnUnreadableFileIsKeptAndTheNextSaveGoesBesideIt() throws {
        let url = folder.appendingPathComponent("swings.json")
        let damaged = Data(#"[{"id": "truncated"#.utf8)
        try damaged.write(to: url)
        guard case .unreadable(let keptAs) = StoreFile.load([SwingRecord].self, from: url) else {
            return XCTFail("a damaged file was read")
        }
        let aside = try XCTUnwrap(keptAs)
        XCTAssertTrue(aside.lastPathComponent.hasPrefix("swings.json.unreadable-"))
        XCTAssertEqual(try Data(contentsOf: aside), damaged)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        // The store starts afresh beside it; the damaged file is untouched.
        XCTAssertTrue(StoreFile.save([SwingRecord](), to: url))
        XCTAssertEqual(try Data(contentsOf: aside), damaged)
        XCTAssertTrue(StoreFile.notice("swings", keptAs: aside).contains(aside.lastPathComponent))
    }

    func testAFileFromANewerBuildIsSetAsideNotRead() throws {
        let url = folder.appendingPathComponent("practice.json")
        let newer = try JSONSerialization.data(withJSONObject: [
            "version": StoreFile.version + 1, "items": ["next": 1, "swings": [], "plans": []],
        ])
        try newer.write(to: url)
        guard case .unreadable(let keptAs) = StoreFile.load(PracticeLog.self, from: url) else {
            return XCTFail("a newer build's file was read and would be overwritten")
        }
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(keptAs)), newer)
    }

    // MARK: the fixtures, written once from this build's types

    /// Writes Resources/stores/*.json when STORE_FIXTURES_OUT names a folder.
    /// Run once, with the format as earlier builds wrote it (no version), and commit.
    func testWriteFixturesWhenAsked() throws {
        guard let out = ProcessInfo.processInfo.environment["STORE_FIXTURES_OUT"] else { return }
        let folder = URL(fileURLWithPath: out, isDirectory: true)
        let result = try XCTUnwrap(ParityTests.analyzer.analyse(Self.sequence, handedness: .right).result)
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        let records = [
            SwingRecord(id: UUID(uuidString: "6F1C2B4E-0000-4000-8000-000000000001")!, date: date,
                        club: "7 iron", label: nil, sourceName: "IMG_0412.MOV", result: result,
                        keyFrames: (0..<8).map { "A-\($0).jpg" }, coach: nil, practiceId: 2),
            SwingRecord(id: UUID(uuidString: "6F1C2B4E-0000-4000-8000-000000000002")!,
                        date: date.addingTimeInterval(-600), club: nil, label: "range", sourceName: "IMG_0409.MOV",
                        result: result, keyFrames: (0..<8).map { "B-\($0).jpg" },
                        coach: CoachRead(model: "gemma3:4b", text: "Hold the finish.", sawPictures: true,
                                         at: date),
                        practiceId: nil),
        ]
        let history = JSONEncoder()
        history.dateEncodingStrategy = .iso8601
        try history.encode(records).write(to: folder.appendingPathComponent("swings.json"))

        let rules = try XCTUnwrap(ParityTests.analyzer.payload.practice)
        var log = PracticeLog()
        for (i, tempo) in [2.6, 2.7, 2.5].enumerated() { log.add(Self.practiceSwing(i + 1, tempo: tempo)) }
        log.startPlan(rules, focus: "tempo_quick", from: nil)
        log.add(Self.practiceSwing(4, tempo: 2.9), forPlan: true)
        let practice = JSONEncoder()
        practice.dateEncodingStrategy = .iso8601
        practice.outputFormatting = [.prettyPrinted, .sortedKeys]
        try practice.encode(log).write(to: folder.appendingPathComponent("practice.json"))
    }

    static var sequence: PoseSequence {
        let input = ParityTests.golden.input
        return PoseSequence(
            xy: input.xy.map { frame in frame.map { Point($0[0], $0[1]) } },
            visibility: input.visibility, detected: input.detected, times: input.times,
            width: input.width, height: input.height)
    }

    static func practiceSwing(_ n: Int, tempo: Double) -> PracticeSwing {
        PracticeSwing(
            at: Date(timeIntervalSince1970: 1_790_000_000 + Double(n) * 60), ok: true, refusal: nil,
            detectionRate: 0.97, handedness: "right", club: "7 iron",
            camera: CameraSignature(orientation: "portrait", bodyHeight: 0.6, centreX: 0.5,
                                    shoulderRatio: 0.95, frameRate: 60),
            metrics: ["tempo_ratio": tempo], slowedBy: nil, clipKey: "clip-\(n)")
    }
}
