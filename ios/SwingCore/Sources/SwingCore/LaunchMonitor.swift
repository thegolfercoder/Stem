import Foundation

// The ground radar unit's shot summary, as it arrives over Bluetooth.
//
// Source of truth: launchmon-hw/firmware/ground_unit/ground_unit.ino (ground
// firmware 0.2), `struct WireReading`, `struct ShotSummary`, `wire()`,
// `enum class Prov`, `enum class Refusal` and `refusalText()`; the layout is also
// in launchmon-hw/docs/wiring_schematic.md section 3.3. Packed, little-endian,
// 42 bytes:
//
//   0  u8   magic 0x5A          8  reading ball_speed_radial, m/s
//   1  u8   version 1          14  reading club_speed_radial, m/s
//   2  u16  shot_seq           20  reading smash, ratio
//   4  u32  impact_ms          26  reading peak_shaft_rate, deg/s
//                              32  reading tempo_ratio, ratio
//                              38  u16 battery_mv_ground
//                              40  u16 battery_mv_pod
//
// A reading is {value f32, provenance u8, refusal u8}. The firmware sends a
// refused reading as NaN with provenance 0 (`wire()`).
//
// The behaviour mirrors the browser results screen (launchmon-hw/results/
// protocol.js and its tests): a packet of the wrong length, magic or version is
// rejected whole, a refusal shows the firmware's reason word for word, and a
// reading whose fields contradict each other is no reading. No CoreBluetooth
// here, so all of it is tested on Linux.

/// Where a launch-monitor number came from: `launchmon.quantity.Provenance`, with
/// the wire codes the ground unit sends (`enum class Prov`).
///
/// SwingCore had no provenance type before this; the swing side labels its
/// numbers with the same words ("measured", "derived") as plain strings.
public enum Provenance: UInt8, CaseIterable, Sendable {
    case none = 0
    case measured = 1
    case derived = 2
    case lowConfidence = 3
    case modelled = 4

    /// The wire word, as `launchmon.quantity.Provenance` and the firmware's
    /// `provText()` spell it.
    public var name: String {
        switch self {
        case .none: return "none"
        case .measured: return "measured"
        case .derived: return "derived"
        case .lowConfidence: return "low_confidence"
        case .modelled: return "modelled"
        }
    }

    /// The words shown beside a number (protocol.js `provenanceLabel`).
    public var label: String {
        switch self {
        case .none: return "no reading"
        case .lowConfidence: return "low confidence"
        default: return name
        }
    }
}

/// The five readings of a shot summary, in wire order.
public enum ShotField: Int, CaseIterable, Sendable {
    case ballSpeedRadial = 0
    case clubSpeedRadial
    case smash
    case peakShaftRate
    case tempoRatio

    public enum Kind: Sendable { case speed, ratio, rate }

    /// The firmware's field name.
    public var key: String {
        switch self {
        case .ballSpeedRadial: return "ball_speed_radial"
        case .clubSpeedRadial: return "club_speed_radial"
        case .smash: return "smash"
        case .peakShaftRate: return "peak_shaft_rate"
        case .tempoRatio: return "tempo_ratio"
        }
    }

    public var label: String {
        switch self {
        case .ballSpeedRadial: return "Ball speed"
        case .clubSpeedRadial: return "Club speed"
        case .smash: return "Smash factor"
        case .peakShaftRate: return "Peak shaft rate"
        case .tempoRatio: return "Tempo"
        }
    }

    /// The unit the firmware sends the value in.
    public var unit: String {
        switch self {
        case .ballSpeedRadial, .clubSpeedRadial: return "m/s"
        case .smash, .tempoRatio: return "ratio"
        case .peakShaftRate: return "deg/s"
        }
    }

    public var kind: Kind {
        switch self {
        case .ballSpeedRadial, .clubSpeedRadial: return .speed
        case .smash, .tempoRatio: return .ratio
        case .peakShaftRate: return .rate
        }
    }

    /// The source tag the firmware's USB JSON gives the reading.
    public var source: String {
        switch self {
        case .ballSpeedRadial, .clubSpeedRadial, .smash: return "radar-fw-preview"
        case .peakShaftRate: return "imu"
        case .tempoRatio: return "imu+radar"
        }
    }

    /// Byte offset of the reading in the packet.
    public var offset: Int { 8 + rawValue * LaunchMonitor.readingBytes }
}

/// One reading from the unit: a number with its provenance, or no number and why.
public struct RadarReading: Equatable, Sendable {
    public enum Status: String, Sendable {
        /// A number, with a provenance.
        case ok
        /// The unit refused it, and the reason is the firmware's.
        case refused
        /// The fields contradict each other, so it is not read as a number.
        case invalid
    }

    public let field: ShotField
    /// The number exactly as sent (float32), only when `status` is `.ok`.
    public let value: Float?
    /// `.none` unless `status` is `.ok`.
    public let provenance: Provenance
    public let provenanceCode: UInt8
    public let refusalCode: UInt8
    public let status: Status
    /// Empty for a number; the firmware's reason for a refusal; what was wrong
    /// for an invalid reading.
    public let reason: String
    /// Set when the fields were not what the firmware sends, even for a refusal.
    public let anomaly: String?

    public var ok: Bool { status == .ok }
    public var doubleValue: Double? { value.map(Double.init) }
}

/// A packet that was not read at all.
public struct PacketRejection: Error, Equatable, Sendable, CustomStringConvertible {
    public enum Code: String, Sendable { case short, magic, version, length }
    public let code: Code
    public let message: String
    public var description: String { message }
}

/// One `ShotSummary` from the ground unit, decoded.
public struct ShotSummary: Equatable, Sendable {
    public struct Battery: Equatable, Sendable {
        public let groundMv: UInt16
        /// The unit treats 1000 mV or less as "not read" (`batt_known`).
        public let groundKnown: Bool
        /// Under the unit's own `BATT_LOW_MV`.
        public let groundLow: Bool
        /// 0 until a pod status arrived since boot. The unit keeps the last value
        /// after the pod disconnects, so non-zero is "last reported".
        public let podMv: UInt16
        public let podKnown: Bool
    }

    public let version: UInt8
    public let shotSeq: UInt16
    /// Impact on the unit's own clock, in milliseconds. Not related to the phone's
    /// clock except through when the packet arrived (`UnitClock`).
    public let impactMs: UInt32
    /// The five readings, in `ShotField` order.
    public let readings: [RadarReading]
    public let battery: Battery
    /// The packet exactly as received.
    public let bytes: [UInt8]

    public subscript(field: ShotField) -> RadarReading { readings[field.rawValue] }
    public var ballSpeed: RadarReading { self[.ballSpeedRadial] }
    public var clubSpeed: RadarReading { self[.clubSpeedRadial] }
    public var smash: RadarReading { self[.smash] }
    public var hex: String { LaunchMonitor.hex(bytes) }

    /// False when the unit found no impact in the capture. The firmware then sets
    /// both IMU readings to NO_IMPACT without running the IMU analysis
    /// (`ir.peak_rate = ir.tempo = Reading::no(Refusal::NO_IMPACT)`), and
    /// `impact_ms` is the capture's start, not a strike.
    public var impactFound: Bool {
        !(self[.peakShaftRate].refusalCode == LaunchMonitor.noImpactRefusal
            && self[.tempoRatio].refusalCode == LaunchMonitor.noImpactRefusal)
    }
}

public enum LaunchMonitor {
    /// ground_unit.ino `cfg::BLE_NAME`, `UUID_GND_SVC`, `UUID_GND_SHOT`.
    public static let deviceName = "STEM-RADAR"
    public static let serviceUUID = "7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10"
    public static let shotCharacteristicUUID = "7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10"

    public static let magic: UInt8 = 0x5A
    public static let version: UInt8 = 1
    public static let packetBytes = 42
    public static let readingBytes = 6

    /// The unit treats a battery reading at or below this as "not read".
    public static let groundBatteryKnownAboveMv: UInt16 = 1000
    /// `cfg::BATT_LOW_MV`.
    public static let groundBatteryLowMv: UInt16 = 3500

    /// `Refusal::NO_IMPACT`.
    public static let noImpactRefusal: UInt8 = 3

    /// `refusalText()`, word for word, indexed by `enum class Refusal`'s code.
    public static let refusalTexts: [String] = [
        "",
        "capture held no usable shot",
        "club band not resolved before impact",
        "no tone appeared above the club band",
        "ball tracked in too few frames",
        "ball track rose after launch",
        "tone outside the front-end passband",
        "implied smash factor outside plausible bounds",
        "pod not connected",
        "no pod samples cover the impact",
        "gyro at full scale (2000 dps) during the downswing",
        "takeaway or top of swing not found",
        "depends on a refused reading",
    ]

    /// The firmware's reason for a refusal code, or nil for one this app does not know.
    public static func refusalText(_ code: UInt8) -> String? {
        Int(code) < refusalTexts.count ? refusalTexts[Int(code)] : nil
    }

    /// Reads one notification or characteristic value. Anything that is not a
    /// version 1 `ShotSummary` of exactly 42 bytes is rejected whole: nothing in
    /// it is read, so nothing is misread.
    public static func decode<Bytes: Collection>(_ input: Bytes) -> Result<ShotSummary, PacketRejection>
        where Bytes.Element == UInt8
    {
        let b = Array(input)
        if b.count < packetBytes {
            return .failure(PacketRejection(code: .short,
                message: "short packet: \(b.count) of \(packetBytes) bytes"))
        }
        if b[0] != magic {
            return .failure(PacketRejection(code: .magic,
                message: "wrong magic byte 0x\(hex([b[0]])) (expected 0x5a)"))
        }
        if b[1] != version {
            return .failure(PacketRejection(code: .version,
                message: "unknown packet version \(b[1]) (this app reads version \(version))"))
        }
        if b.count != packetBytes {
            return .failure(PacketRejection(code: .length,
                message: "version 1 packet is \(packetBytes) bytes, got \(b.count)"))
        }
        let readings = ShotField.allCases.map { reading(b, $0) }
        let groundMv = u16(b, 38), podMv = u16(b, 40)
        let groundKnown = groundMv > groundBatteryKnownAboveMv
        return .success(ShotSummary(
            version: b[1], shotSeq: u16(b, 2), impactMs: u32(b, 4), readings: readings,
            battery: .init(groundMv: groundMv, groundKnown: groundKnown,
                           groundLow: groundKnown && groundMv < groundBatteryLowMv,
                           podMv: podMv, podKnown: podMv > 0),
            bytes: b))
    }

    private static func reading(_ b: [UInt8], _ field: ShotField) -> RadarReading {
        let o = field.offset
        let value = Float(bitPattern: u32(b, o))
        let provCode = b[o + 4], refusalCode = b[o + 5]

        if refusalCode != 0 {
            // The firmware sends NaN and provenance 0 with every refusal. Anything
            // else is not what it sends: say so, but the reading is refused either way.
            let consistent = value.isNaN && provCode == 0
            return RadarReading(
                field: field, value: nil, provenance: .none, provenanceCode: provCode, refusalCode: refusalCode,
                status: .refused,
                reason: refusalText(refusalCode) ?? "refused, code \(refusalCode) (unknown to this app)",
                anomaly: consistent ? nil : "refusal carried a value or a provenance")
        }
        func invalid(_ reason: String, _ anomaly: String) -> RadarReading {
            RadarReading(field: field, value: nil, provenance: .none, provenanceCode: provCode,
                         refusalCode: 0, status: .invalid, reason: reason, anomaly: anomaly)
        }
        guard let provenance = Provenance(rawValue: provCode), provenance != .none else {
            return invalid("invalid: provenance code \(provCode) on a reading with no refusal", "bad provenance")
        }
        if !value.isFinite { return invalid("invalid: no number in a reading with no refusal", "non-finite value") }
        if value < 0 { return invalid("invalid: negative value", "negative value") }
        return RadarReading(field: field, value: value, provenance: provenance, provenanceCode: provCode,
                            refusalCode: 0, status: .ok, reason: "", anomaly: nil)
    }

    /// One reading as the demo packs it: a number with a provenance code, or a refusal code.
    public struct WireValue: Sendable {
        public var value: Float
        public var provenanceCode: UInt8
        public var refusalCode: UInt8

        public static func number(_ value: Float, _ provenance: Provenance) -> WireValue {
            WireValue(value: value, provenanceCode: provenance.rawValue, refusalCode: 0)
        }

        public static func refused(_ code: UInt8) -> WireValue {
            WireValue(value: .nan, provenanceCode: 0, refusalCode: code)
        }
    }

    /// Packs a summary exactly as the firmware's struct does (for the demo source,
    /// whose packets then go through `decode` like real ones). A refusal is packed
    /// as `wire()` packs it: NaN and provenance 0.
    public static func encode(shotSeq: UInt16, impactMs: UInt32, readings: [WireValue],
                              groundMv: UInt16, podMv: UInt16) -> [UInt8] {
        precondition(readings.count == ShotField.allCases.count, "five readings, in wire order")
        var b: [UInt8] = [magic, version]
        b += le(shotSeq)
        b += le(impactMs)
        for r in readings {
            let refused = r.refusalCode != 0
            b += le((refused ? Float.nan : r.value).bitPattern)
            b.append(refused ? 0 : r.provenanceCode)
            b.append(r.refusalCode)
        }
        b += le(groundMv)
        b += le(podMv)
        return b
    }

    public static func hex<Bytes: Sequence>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// The bytes of a hex string as `hex` writes it, or nil if it is not one.
    public static func bytes(hex text: String) -> [UInt8]? {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    private static func nibble(_ c: UInt8) -> UInt8? {
        switch c {
        case 48...57: return c - 48
        case 97...102: return c - 87
        case 65...70: return c - 55
        default: return nil
        }
    }

    private static func u16(_ b: [UInt8], _ o: Int) -> UInt16 { UInt16(b[o]) | UInt16(b[o + 1]) << 8 }

    private static func u32(_ b: [UInt8], _ o: Int) -> UInt32 {
        UInt32(b[o]) | UInt32(b[o + 1]) << 8 | UInt32(b[o + 2]) << 16 | UInt32(b[o + 3]) << 24
    }

    private static func le<T: FixedWidthInteger>(_ v: T) -> [UInt8] {
        (0..<(T.bitWidth / 8)).map { UInt8(truncatingIfNeeded: v >> ($0 * 8)) }
    }
}

// MARK: - Units

/// Speeds in the unit the golfer chose. 1 mph = 0.44704 m/s exactly (the
/// international mile); 1 km/h = 1/3.6 m/s. The decimals shown are a display
/// choice, not an accuracy.
public enum SpeedUnit: String, CaseIterable, Sendable {
    case mph, mps, kmh

    public var label: String {
        switch self {
        case .mph: return "mph"
        case .mps: return "m/s"
        case .kmh: return "km/h"
        }
    }

    public var perMps: Double {
        switch self {
        case .mph: return 1 / 0.44704
        case .mps: return 1
        case .kmh: return 3.6
        }
    }

    public var decimals: Int { self == .mps ? 1 : 0 }

    /// Nil when there is no number to convert.
    public func convert(_ mps: Double?) -> Double? {
        guard let mps, mps.isFinite else { return nil }
        return mps * perMps
    }
}

extension RadarReading {
    /// Display text for the number, or nil when there is none: speeds in `unit`,
    /// smash to 0.01, tempo to 0.1, shaft rate to a whole deg/s (protocol.js
    /// `formatReading`).
    public func formatted(_ unit: SpeedUnit = .mph) -> String? {
        guard ok, let v = doubleValue else { return nil }
        switch field {
        case .ballSpeedRadial, .clubSpeedRadial:
            guard let converted = unit.convert(v) else { return nil }
            return String(format: "%.\(unit.decimals)f", converted)
        case .smash: return String(format: "%.2f", v)
        case .tempoRatio: return String(format: "%.1f", v)
        case .peakShaftRate: return String(format: "%.0f", v)
        }
    }

    /// The unit shown after the number.
    public func unitLabel(_ unit: SpeedUnit = .mph) -> String {
        switch field.kind {
        case .speed: return unit.label
        case .rate: return "deg/s"
        case .ratio: return ""
        }
    }
}
