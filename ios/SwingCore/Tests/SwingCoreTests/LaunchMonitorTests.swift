import XCTest
@testable import SwingCore

/// The ground unit's ShotSummary, decoded as the browser results screen decodes it
/// (launchmon-hw/results/test/protocol.test.mjs: the same cases).
///
/// Packets are built here byte by byte from the firmware's struct, not with the
/// module's own encoder, so a layout mistake in LaunchMonitor.swift cannot hide itself:
///   ground_unit.ino  struct __attribute__((packed)) WireReading { float value; uint8_t prov; uint8_t refusal; };
///                    struct __attribute__((packed)) ShotSummary {
///                      uint8_t magic = 0x5A, version = 1; uint16_t shot_seq; uint32_t impact_ms;
///                      WireReading ball_speed_radial, club_speed_radial, smash, peak_shaft_rate, tempo_ratio;
///                      uint16_t battery_mv_ground, battery_mv_pod; };
/// ESP32-C3 (RISC-V) is little-endian; IEEE-754 binary32 for float.
final class LaunchMonitorTests: XCTestCase {
    private func u8(_ v: Int) -> [UInt8] { [UInt8(v & 0xff)] }
    private func u16le(_ v: Int) -> [UInt8] { [UInt8(v & 0xff), UInt8((v >> 8) & 0xff)] }
    private func u32le(_ v: Int) -> [UInt8] {
        [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)]
    }
    /// Little-endian float32 bytes, written out from the IEEE-754 bit pattern.
    private func f32le(_ v: Float) -> [UInt8] {
        let bits = v.bitPattern
        return [UInt8(bits & 0xff), UInt8((bits >> 8) & 0xff), UInt8((bits >> 16) & 0xff), UInt8(bits >> 24)]
    }
    private let nan32: [UInt8] = [0x00, 0x00, 0xc0, 0x7f]  // quiet NaN, as NAN is on the target
    private func reading(_ value: [UInt8], _ prov: Int, _ refusal: Int) -> [UInt8] {
        var b = value
        b += u8(prov)
        b += u8(refusal)
        return b
    }

    /// The example in firmware/README.md's JSON (format only, not a result), as the BLE packet.
    private func examplePacket() -> [UInt8] {
        var b: [UInt8] = [0x5a, 0x01]                     // magic, version
        b += u16le(3)                                     // shot_seq
        b += u32le(81234)                                 // impact_ms
        b += reading([0xcd, 0xcc, 0x74, 0x42], 3, 0)      // ball 61.2 m/s, low_confidence
        b += reading([0x9a, 0x99, 0x2f, 0x42], 3, 0)      // club 43.9 m/s, low_confidence
        b += reading(f32le(1.394), 2, 0)                  // smash, derived
        b += reading(nan32, 0, 10)                        // peak shaft rate refused: GYRO_CLIPPED
        b += reading(f32le(3.02), 2, 0)                   // tempo, derived
        b += u16le(3987)                                  // battery mV, ground
        b += u16le(4011)                                  // battery mV, pod
        return b
    }

    private func parse(_ bytes: [UInt8], file: StaticString = #filePath, line: UInt = #line) throws -> ShotSummary {
        switch LaunchMonitor.decode(bytes) {
        case .success(let summary): return summary
        case .failure(let rejection):
            XCTFail("rejected: \(rejection.message)", file: file, line: line)
            throw rejection
        }
    }

    private func rejection(_ bytes: [UInt8]) -> PacketRejection? {
        if case .failure(let r) = LaunchMonitor.decode(bytes) { return r }
        return nil
    }

    func testUUIDsAndNameMatchTheFirmware() {
        // ground_unit.ino cfg::BLE_NAME, UUID_GND_SVC, UUID_GND_SHOT.
        XCTAssertEqual(LaunchMonitor.deviceName, "STEM-RADAR")
        XCTAssertEqual(LaunchMonitor.serviceUUID, "7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10")
        XCTAssertEqual(LaunchMonitor.shotCharacteristicUUID, "7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10")
    }

    func testHandCodedFloatBytesAreWhatAFloat32WriterProduces() {
        XCTAssertEqual(f32le(61.2), [0xcd, 0xcc, 0x74, 0x42])
        XCTAssertEqual(f32le(43.9), [0x9a, 0x99, 0x2f, 0x42])
        XCTAssertEqual(f32le(.nan), nan32)
    }

    func testTheStructIs42Bytes() {
        XCTAssertEqual(examplePacket().count, 42)
        XCTAssertEqual(LaunchMonitor.packetBytes, 42)
    }

    func testParsesEveryFieldAtItsOffsetWithItsScaling() throws {
        let p = try parse(examplePacket())
        XCTAssertEqual(p.version, 1)
        XCTAssertEqual(p.shotSeq, 3)
        XCTAssertEqual(p.impactMs, 81234)

        XCTAssertTrue(p.ballSpeed.ok)
        XCTAssertEqual(p.ballSpeed.value, Float(61.2))
        XCTAssertEqual(p.ballSpeed.provenance, .lowConfidence)
        XCTAssertEqual(p.ballSpeed.provenance.name, "low_confidence")
        XCTAssertEqual(p.ballSpeed.field.unit, "m/s")
        XCTAssertEqual(p.ballSpeed.field.source, "radar-fw-preview")

        XCTAssertEqual(p.clubSpeed.value, Float(43.9))
        XCTAssertEqual(p.clubSpeed.provenance, .lowConfidence)

        XCTAssertEqual(p.smash.value, Float(1.394))
        XCTAssertEqual(p.smash.provenance, .derived)
        XCTAssertEqual(p[.tempoRatio].value, Float(3.02))
        XCTAssertEqual(p[.tempoRatio].provenance, .derived)

        XCTAssertEqual(p.battery.groundMv, 3987)
        XCTAssertTrue(p.battery.groundKnown)
        XCTAssertFalse(p.battery.groundLow)
        XCTAssertEqual(p.battery.podMv, 4011)
        XCTAssertTrue(p.battery.podKnown)
        XCTAssertEqual(p.bytes, examplePacket())
        XCTAssertTrue(p.impactFound)
    }

    func testARefusedReadingHasNoNumberAndCarriesTheFirmwareReason() throws {
        let r = try parse(examplePacket())[.peakShaftRate]
        XCTAssertFalse(r.ok)
        XCTAssertNil(r.value)
        XCTAssertEqual(r.status, .refused)
        XCTAssertEqual(r.refusalCode, 10)
        XCTAssertEqual(r.reason, "gyro at full scale (2000 dps) during the downswing")
        XCTAssertNil(r.anomaly)
        XCTAssertEqual(r.provenance, .none)
        XCTAssertNil(r.formatted(.mph))
    }

    func testSmashImplausibleRefusesBallAndSmashButKeepsClub() throws {
        var packet: [UInt8] = [0x5a, 0x01]
        packet += u16le(7)
        packet += u32le(100000)
        packet += reading(nan32, 0, 7)
        packet += reading(f32le(40.0), 3, 0)
        packet += reading(nan32, 0, 7)
        packet += reading(nan32, 0, 8)
        packet += reading(nan32, 0, 8)
        packet += u16le(3400)
        packet += u16le(0)
        let p = try parse(packet)
        XCTAssertFalse(p.ballSpeed.ok)
        XCTAssertEqual(p.ballSpeed.reason, "implied smash factor outside plausible bounds")
        XCTAssertFalse(p.smash.ok)
        XCTAssertTrue(p.clubSpeed.ok)
        XCTAssertEqual(p.clubSpeed.value, 40)
        XCTAssertEqual(p[.peakShaftRate].reason, "pod not connected")
        XCTAssertTrue(p.battery.groundLow, "3400 mV is under cfg::BATT_LOW_MV 3500")
        XCTAssertFalse(p.battery.podKnown, "0 mV means no pod status since boot")
    }

    func testARefusalThatCarriesANumberStillYieldsNoNumberFlaggedAsAnAnomaly() throws {
        var packet = examplePacket()
        packet[13] = 4  // ball: refusal BALL_TRACK_SHORT, but the value bytes still say 61.2 and prov 3
        let r = try parse(packet).ballSpeed
        XCTAssertFalse(r.ok)
        XCTAssertNil(r.value)
        XCTAssertEqual(r.reason, "ball tracked in too few frames")
        XCTAssertNotNil(r.anomaly)
    }

    func testUnknownRefusalCodeIsRefusedSaidSoNotGuessed() throws {
        var packet = examplePacket()
        packet[13] = 200
        let r = try parse(packet).ballSpeed
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason.contains("code 200"), r.reason)
    }

    func testNoRefusalButNaNProvenanceZeroOrANegativeValueIsInvalidWithNoNumber() throws {
        var nan = examplePacket()
        nan.replaceSubrange(8..<12, with: nan32)  // ball value NaN, prov 3, refusal 0
        XCTAssertEqual(try parse(nan).ballSpeed.status, .invalid)

        var inf = examplePacket()
        inf.replaceSubrange(8..<12, with: f32le(.infinity))
        XCTAssertFalse(try parse(inf).ballSpeed.ok)

        var prov0 = examplePacket()
        prov0[12] = 0
        XCTAssertEqual(try parse(prov0).ballSpeed.status, .invalid)

        var provBad = examplePacket()
        provBad[12] = 9
        XCTAssertFalse(try parse(provBad).ballSpeed.ok)

        var negative = examplePacket()
        negative.replaceSubrange(14..<18, with: f32le(-5))  // club
        let c = try parse(negative).clubSpeed
        XCTAssertFalse(c.ok)
        XCTAssertNil(c.value)
        XCTAssertNil(c.formatted(.mph))
    }

    func testShortPacketsAreRejectedWholeIncludingA20ByteTruncatedNotification() {
        let full = examplePacket()
        for n in [0, 1, 8, 20, 41] {
            XCTAssertEqual(rejection(Array(full.prefix(n)))?.code, .short, "length \(n)")
        }
    }

    func testGarbledPacketsAreRejectedNotMisparsed() {
        var badMagic = examplePacket()
        badMagic[0] = 0xa7  // a pod packet's magic
        XCTAssertEqual(rejection(badMagic)?.code, .magic)

        var badVersion = examplePacket()
        badVersion[1] = 2
        XCTAssertEqual(rejection(badVersion)?.code, .version)

        XCTAssertEqual(rejection(examplePacket() + [0x00])?.code, .length)

        let noise = (0..<42).map { UInt8(($0 * 73 + 11) & 0xff) }
        XCTAssertNotNil(rejection(noise))
    }

    func testAcceptsADataSliceAtAnOffset() throws {
        // CoreBluetooth hands over Data; a slice of a larger buffer starts at a non-zero index.
        let backing = Data(repeating: 0, count: 5) + Data(examplePacket()) + Data(repeating: 0, count: 3)
        let slice = backing[5..<47]
        XCTAssertEqual(slice.startIndex, 5)
        guard case .success(let p) = LaunchMonitor.decode(slice) else { return XCTFail("rejected") }
        XCTAssertEqual(p.shotSeq, 3)
    }

    func testTheDemoEncoderProducesTheFirmwareBytesExactly() throws {
        let parsed = try parse(examplePacket())
        let out = LaunchMonitor.encode(
            shotSeq: parsed.shotSeq, impactMs: parsed.impactMs,
            readings: parsed.readings.map {
                $0.ok ? .number($0.value!, $0.provenance) : .refused($0.refusalCode)
            },
            groundMv: parsed.battery.groundMv, podMv: parsed.battery.podMv)
        XCTAssertEqual(out, examplePacket())
    }

    func testUnitConversions() throws {
        XCTAssertEqual(SpeedUnit.mph.convert(0.44704), 1)
        XCTAssertEqual(try XCTUnwrap(SpeedUnit.mph.convert(44.704)), 100, accuracy: 1e-9)
        XCTAssertEqual(SpeedUnit.kmh.convert(10), 36)
        XCTAssertEqual(SpeedUnit.mps.convert(12.5), 12.5)
        XCTAssertNil(SpeedUnit.mph.convert(nil))
        XCTAssertNil(SpeedUnit.mph.convert(.nan))

        let p = try parse(examplePacket())
        XCTAssertEqual(p.ballSpeed.formatted(.mph), "137")   // 61.2 m/s = 136.9 mph
        XCTAssertEqual(p.ballSpeed.formatted(.mps), "61.2")
        XCTAssertEqual(p.ballSpeed.formatted(.kmh), "220")   // 220.3 km/h
        XCTAssertEqual(p.clubSpeed.formatted(.mph), "98")    // 98.2 mph
        XCTAssertEqual(p.smash.formatted(.kmh), "1.39", "smash is unitless")
        XCTAssertEqual(p[.tempoRatio].formatted(.mph), "3.0")
        XCTAssertEqual(p.ballSpeed.unitLabel(.kmh), "km/h")
        XCTAssertEqual(p.smash.unitLabel(.mph), "")
    }

    func testEveryRefusalCodeInEnumClassRefusalHasItsText() {
        XCTAssertEqual(LaunchMonitor.refusalTexts.count, 13)
        XCTAssertEqual(LaunchMonitor.refusalText(0), "")
        XCTAssertEqual(LaunchMonitor.refusalText(12), "depends on a refused reading")
        XCTAssertNil(LaunchMonitor.refusalText(13))
    }

    func testProvenanceWireCodesAndWordsMatchLaunchmonQuantity() {
        // launchmon.quantity.Provenance and the firmware's enum class Prov / provText().
        let pinned: [(UInt8, String)] = [(0, "none"), (1, "measured"), (2, "derived"),
                                         (3, "low_confidence"), (4, "modelled")]
        XCTAssertEqual(Provenance.allCases.count, pinned.count)
        for (code, word) in pinned { XCTAssertEqual(Provenance(rawValue: code)?.name, word) }
        XCTAssertEqual(Provenance.lowConfidence.label, "low confidence")
        XCTAssertEqual(Provenance.none.label, "no reading")
    }

    func testNoImpactIsSeenFromTheIMUReadings() throws {
        // analyseRadar found no impact: ball and smash NO_IMPACT, the IMU analysis never ran.
        var packet = examplePacket()
        for o in [8, 20, 26, 32] {
            packet.replaceSubrange(o..<(o + 4), with: nan32)
            packet[o + 4] = 0
            packet[o + 5] = 3
        }
        XCTAssertFalse(try parse(packet).impactFound)
    }

    func testHexRoundTrips() {
        let bytes = examplePacket()
        let text = LaunchMonitor.hex(bytes)
        XCTAssertEqual(text.count, 84)
        XCTAssertTrue(text.hasPrefix("5a010300"))
        XCTAssertEqual(LaunchMonitor.bytes(hex: text), bytes)
        XCTAssertNil(LaunchMonitor.bytes(hex: "5a0"))
        XCTAssertNil(LaunchMonitor.bytes(hex: "zz"))
    }
}
