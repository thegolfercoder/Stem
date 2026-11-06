import XCTest
@testable import SwingCore

/// Pairing a radar shot with a camera clip by the phone's clock (ShotPairing.swift):
/// the unit's clock placed on the phone's, the window, and every refusal.
final class ShotPairingTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let link = UUID()

    /// A version 1 ShotSummary, from the encoder (the decoder's own tests build them byte by byte).
    private func packet(seq: UInt16, impactMs: UInt32, impact: Bool = true) -> [UInt8] {
        let refused = LaunchMonitor.WireValue.refused(LaunchMonitor.noImpactRefusal)
        let readings: [LaunchMonitor.WireValue] = impact
            ? [.number(61.2, .lowConfidence), .number(43.9, .lowConfidence), .number(1.394, .derived),
               .refused(8), .refused(8)]
            : [refused, .refused(1), refused, refused, refused]
        return LaunchMonitor.encode(shotSeq: seq, impactMs: impactMs, readings: readings,
                                    groundMv: 3987, podMv: 0)
    }

    private func shot(_ seq: UInt16, impactMs: UInt32, at seconds: Double, arrival: ShotArrival = .notified,
                      link: UUID? = nil, impact: Bool = true) -> ReceivedShot {
        ReceivedShot(bytes: packet(seq: seq, impactMs: impactMs, impact: impact),
                     receivedAt: t0.addingTimeInterval(seconds), arrival: arrival, link: link ?? self.link)
    }

    /// A clip whose strike, by its metadata and impact position, is at t0 + `strikeAt` seconds.
    private func clip(strikeAt: Double, slowedBy: Double? = nil) -> ClipTiming {
        ClipTiming(recordingStarted: t0.addingTimeInterval(strikeAt - 3.2), strike: .impactEvent(seconds: 3.2),
                   slowedBy: slowedBy)
    }

    private func reason(_ outcome: PairingOutcome) -> String? {
        if case .refused(let reason) = outcome { return reason }
        return nil
    }

    // MARK: the unit's clock on the phone's

    func testTheQuickestDeliveryInARunPlacesEveryShot() throws {
        // Impacts 30 s apart on the unit's clock; the first took 1.2 s to arrive, the second 1.0 s.
        let a = shot(1, impactMs: 100_000, at: 1.2), b = shot(2, impactMs: 130_000, at: 31.0)
        let placed = UnitClock.place([a, b], maxDeliveryS: 3)
        // The smaller delay (1.0 s) is the run's; each impact is placed 30 s apart, as the unit timed them.
        XCTAssertEqual(try XCTUnwrap(placed[a.id]).timeIntervalSince(t0), 1.0, accuracy: 1e-6)
        XCTAssertEqual(try XCTUnwrap(placed[b.id]).timeIntervalSince(t0), 31.0, accuracy: 1e-6)
    }

    func testAJumpInTheUnitsClockStartsANewRun() throws {
        // impact_ms wrapped (or the unit restarted): the third shot's offset is unlike the first two.
        let a = shot(1, impactMs: 100_000, at: 1.2), b = shot(2, impactMs: 130_000, at: 31.0)
        let c = shot(3, impactMs: 500, at: 61.4)
        let placed = UnitClock.place([a, b, c], maxDeliveryS: 3)
        XCTAssertEqual(try XCTUnwrap(placed[b.id]).timeIntervalSince(t0), 31.0, accuracy: 1e-6)
        // On its own in its run, the shot is placed at its own arrival: never earlier than the truth allows.
        XCTAssertEqual(try XCTUnwrap(placed[c.id]).timeIntervalSince(t0), 61.4, accuracy: 1e-6)
    }

    func testConnectionsDoNotShareAClock() throws {
        let a = shot(1, impactMs: 100_000, at: 1.2, link: UUID())
        let b = shot(2, impactMs: 130_000, at: 31.0, link: UUID())
        let placed = UnitClock.place([a, b], maxDeliveryS: 3)
        XCTAssertEqual(try XCTUnwrap(placed[a.id]).timeIntervalSince(t0), 1.2, accuracy: 1e-6)
        XCTAssertEqual(try XCTUnwrap(placed[b.id]).timeIntervalSince(t0), 31.0, accuracy: 1e-6)
    }

    func testShotsReadOnConnectingAndUnreadablePacketsAreNotPlaced() {
        let read = shot(1, impactMs: 100_000, at: 1.2, arrival: .readOnConnect)
        let garbled = ReceivedShot(bytes: Array(packet(seq: 2, impactMs: 1).prefix(20)), receivedAt: t0,
                                   arrival: .notified, link: link)
        XCTAssertTrue(UnitClock.place([read, garbled], maxDeliveryS: 3).isEmpty)
    }

    func testAReadAfterAShortNotificationIsTimedLikeANotification() {
        let s = shot(1, impactMs: 100_000, at: 1.2, arrival: .readAfterShortNotification)
        XCTAssertTrue(s.arrival.isLive)
        XCTAssertNotNil(UnitClock.place([s], maxDeliveryS: 3)[s.id])
    }

    // MARK: pairing

    func testTheOneShotInTheWindowIsPaired() throws {
        let a = shot(1, impactMs: 100_000, at: 1.2), b = shot(2, impactMs: 130_000, at: 31.0)
        let outcome = pairShot(clip(strikeAt: 0.4), shots: [a, b])
        let pairing = try XCTUnwrap(outcome.pairing, reason(outcome) ?? "")
        XCTAssertEqual(pairing.summary.shotSeq, 1)
        XCTAssertEqual(pairing.gapS, 0.6, accuracy: 1e-6)
        XCTAssertEqual(pairing.strikeAt.timeIntervalSince(t0), 0.4, accuracy: 1e-6)
        XCTAssertTrue(pairing.notes.contains { $0.contains("impact position") })

        XCTAssertEqual(pairShot(clip(strikeAt: 30.5), shots: [a, b]).pairing?.summary.shotSeq, 2)
    }

    func testTheWindowIsOneSecondBeforeToFourAfterAndItsEdgesCount() {
        XCTAssertEqual(PairingTolerance.standard.window, -1.0...4.0)
        let s = shot(1, impactMs: 100_000, at: 10)  // alone in its run: placed at its arrival, t0 + 10
        XCTAssertNotNil(pairShot(clip(strikeAt: 6.0), shots: [s]).pairing, "placed 4.0 s after the strike")
        XCTAssertNotNil(pairShot(clip(strikeAt: 11.0), shots: [s]).pairing, "placed 1.0 s before the strike")
        XCTAssertNil(pairShot(clip(strikeAt: 5.9), shots: [s]).pairing)
        XCTAssertNil(pairShot(clip(strikeAt: 11.1), shots: [s]).pairing)
    }

    func testTwoShotsInTheWindowAreRefusedNotTheNearerChosen() throws {
        let a = shot(4, impactMs: 100_000, at: 1.0), b = shot(5, impactMs: 102_000, at: 3.0)
        let why = try XCTUnwrap(reason(pairShot(clip(strikeAt: 0.5), shots: [a, b])))
        XCTAssertTrue(why.contains("2 radar shots (#4, #5)"), why)
        XCTAssertTrue(why.contains("none is shown"), why)
    }

    func testNoShotInTheWindowIsRefusedWithTheNearest() throws {
        let a = shot(7, impactMs: 100_000, at: 1.0)
        let why = try XCTUnwrap(reason(pairShot(clip(strikeAt: 20.0), shots: [a])))
        XCTAssertTrue(why.contains("nearest (#7) was 19.0 s before it"), why)
        XCTAssertTrue(why.contains("1.0 s before to 4.0 s after"), why)
    }

    func testNoLiveShotIsRefusedAndShotsReadOnConnectingAreSaidToBeUnplaced() throws {
        XCTAssertEqual(reason(pairShot(clip(strikeAt: 1), shots: [])), "no radar shot was received live on this phone")
        let read = shot(1, impactMs: 100_000, at: 1.2, arrival: .readOnConnect)
        let why = try XCTUnwrap(reason(pairShot(clip(strikeAt: 1), shots: [read])))
        XCTAssertTrue(why.contains("1 shot was read on connecting"), why)
    }

    func testAClipWithNoRecordingTimeIsRefused() throws {
        let timing = ClipTiming(recordingStarted: nil, strike: .impactEvent(seconds: 3.2))
        let why = try XCTUnwrap(reason(pairShot(timing, shots: [shot(1, impactMs: 1, at: 0)])))
        XCTAssertTrue(why.contains("no recording time"), why)
    }

    func testASlowMotionClipIsRefused() throws {
        let why = try XCTUnwrap(reason(pairShot(clip(strikeAt: 0.4, slowedBy: 4),
                                                shots: [shot(1, impactMs: 100_000, at: 1.2)])))
        XCTAssertTrue(why.contains("slow motion"), why)
    }

    func testAClipWithNoStrikeTimeIsRefused() {
        let timing = ClipTiming(recordingStarted: t0, strike: .impactEvent(seconds: .nan))
        XCTAssertNotNil(reason(pairShot(timing, shots: [shot(1, impactMs: 1, at: 0)])))
    }

    func testSoundTravelIsRemovedFromAnAudioStrikeWhenTheDistanceIsKnown() throws {
        let s = shot(1, impactMs: 100_000, at: 2.0)
        let heard = ClipTiming(recordingStarted: t0, strike: .audio(seconds: 1.5))
        let corrected = try XCTUnwrap(pairShot(heard, shots: [s], camera: .elsewhere(distanceMetres: 3.43)).pairing)
        XCTAssertEqual(corrected.strikeAt.timeIntervalSince(t0), 1.49, accuracy: 1e-6)  // 3.43 m / 343 m/s
        XCTAssertTrue(corrected.notes.contains { $0.contains("sound travel over 3.4 m removed") })
        XCTAssertFalse(corrected.notes.contains { $0.contains("assumed") }, "a given distance is not an assumption")

        let left = try XCTUnwrap(pairShot(heard, shots: [s], camera: .unknown).pairing)
        XCTAssertEqual(left.strikeAt.timeIntervalSince(t0), 1.5, accuracy: 1e-6)
        XCTAssertTrue(left.notes.contains { $0.contains("sound travel left in") })

        XCTAssertNotNil(reason(pairShot(heard, shots: [s], camera: .elsewhere(distanceMetres: -1))))
        XCTAssertNotNil(reason(pairShot(heard, shots: [s], camera: .onUnit(distanceMetres: .nan))))
    }

    func testByDefaultThePhoneIsOnTheUnitAtItsSetUpDistance() throws {
        XCTAssertEqual(CameraPlacement.standard, .onUnit(distanceMetres: 1.4))
        XCTAssertEqual(CameraPlacement.onUnit().distanceMetres, groundUnitBehindBallM)
        XCTAssertNil(CameraPlacement.unknown.distanceMetres)

        let s = shot(1, impactMs: 100_000, at: 2.0)
        let heard = ClipTiming(recordingStarted: t0, strike: .audio(seconds: 1.5))
        let pairing = try XCTUnwrap(pairShot(heard, shots: [s]).pairing)
        XCTAssertEqual(pairing.strikeAt.timeIntervalSince(t0), 1.5 - 1.4 / 343, accuracy: 1e-6)  // 4.1 ms
        XCTAssertTrue(pairing.notes.contains { $0.contains("sound travel over 1.4 m removed") }, "\(pairing.notes)")
        XCTAssertTrue(pairing.notes.contains { $0.contains("on the ground unit, 1.40 m behind the ball")
                && $0.contains("configured, not measured") }, "\(pairing.notes)")

        // A unit set up at another distance carries it.
        let further = try XCTUnwrap(pairShot(heard, shots: [s], camera: .onUnit(distanceMetres: 1.715)).pairing)
        XCTAssertEqual(further.strikeAt.timeIntervalSince(t0), 1.495, accuracy: 1e-6)
    }

    func testWhereTheCameraWasDoesNotMoveASeenStrike() throws {
        let s = shot(1, impactMs: 100_000, at: 1.0)
        for camera in [CameraPlacement.standard, .elsewhere(distanceMetres: 3), .unknown] {
            let pairing = try XCTUnwrap(pairShot(clip(strikeAt: 0.4), shots: [s], camera: camera).pairing)
            XCTAssertEqual(pairing.strikeAt.timeIntervalSince(t0), 0.4, accuracy: 1e-9)
            XCTAssertFalse(pairing.notes.contains { $0.contains("sound travel") })
        }
    }

    func testACaptureWithNoImpactPairsSayingItsTimeIsTheCapturesStart() throws {
        let s = shot(1, impactMs: 100_000, at: 1.0, impact: false)
        let pairing = try XCTUnwrap(pairShot(clip(strikeAt: 0.5), shots: [s]).pairing)
        XCTAssertFalse(pairing.summary.ballSpeed.ok)
        XCTAssertTrue(pairing.notes.contains { $0.contains("no impact") })
    }

    func testAKeptSwingIsTimedByItsImpactPosition() {
        let metrics = SwingMetrics(eventTimes: [0.2, 0.5, 0.8, 1.1, 1.3, 1.45, 1.7, 2.4], tempoRatio: 3.6,
                                   backswingMs: 900, downswingMs: 250, wholeMs: nil, peakHandSpeedMs: -20,
                                   shoulderTurnDeg: nil, hipTurnDeg: nil, headMovement: nil, pelvisSway: nil,
                                   pelvisLift: nil, feetInShot: true)
        let result = SwingResult(handedness: .right, handednessFrom: "detected", frames: [], subframe: [],
                                 confidence: [], meanConfidence: 0.8, metrics: metrics, detectionRate: 1, grid: [])
        let record = SwingRecord(id: UUID(), date: t0, club: nil, label: nil, sourceName: "clip", result: result,
                                 keyFrames: [], coach: nil, practiceId: nil, clipStartedAt: t0)
        let timing = ClipTiming(record: record)
        XCTAssertEqual(timing.strike, .impactEvent(seconds: 1.45))
        XCTAssertEqual(timing.recordingStarted, t0)
        XCTAssertNil(timing.slowedBy)
    }

    // MARK: the log

    func testTheLogKeepsEachPacketOnceAndRawBytesExactly() throws {
        var log = ShotLog()
        let a = shot(1, impactMs: 100_000, at: 1.2)
        XCTAssertTrue(log.add(a))
        // The same shot read again after reconnecting.
        XCTAssertFalse(log.add(ReceivedShot(bytes: a.bytes, receivedAt: t0.addingTimeInterval(50),
                                            arrival: .readOnConnect, link: UUID())))
        let garbled = ReceivedShot(bytes: [0x5a, 0x01, 0x02], receivedAt: t0.addingTimeInterval(60.123),
                                   arrival: .notified, link: link)
        XCTAssertTrue(log.add(garbled))
        XCTAssertEqual(log.shots.count, 2)

        // Through the app's store file and back: bytes as sent, arrival to the millisecond.
        let data = try StoreFile.encode(log)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("shots-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try data.write(to: url)
        guard case .read(let back) = StoreFile.load(ShotLog.self, from: url) else { return XCTFail("not read") }
        XCTAssertEqual(back.shots.map(\.id), log.shots.map(\.id))
        XCTAssertEqual(back.shots.map(\.bytes), log.shots.map(\.bytes))
        XCTAssertEqual(back.shots.map(\.arrival), log.shots.map(\.arrival))
        XCTAssertEqual(back.shots.map(\.link), log.shots.map(\.link))
        for (kept, sent) in zip(back.shots, log.shots) {
            // Seconds as a number, not StoreFile's whole-second ISO date.
            XCTAssertEqual(kept.receivedAt.timeIntervalSince(sent.receivedAt), 0, accuracy: 1e-6)
        }
        XCTAssertNil(back.shots[1].summary)
        XCTAssertEqual(back.shots[0].summary?.shotSeq, 1)
    }
}
