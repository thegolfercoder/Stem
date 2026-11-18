import CoreBluetooth
import Foundation
import SwingCore

/// The phone's end of the Bluetooth link to the ground radar unit (`STEM-RADAR`).
///
/// Scans for the unit's service, connects, subscribes to the shot
/// characteristic and reads it once on connecting, as the browser results screen
/// does (launchmon-hw/results). If the link drops, it asks to connect again at
/// once: CoreBluetooth keeps that request open until the unit is back in range.
/// Every packet goes to `onPacket` as it arrived, bytes untouched, with the
/// phone's clock at arrival; reading them is SwingCore's job (LaunchMonitor.swift).
///
/// The central runs on the main queue, so every delegate callback is already on
/// the main actor; the callbacks say so with `MainActor.assumeIsolated`.
@MainActor
final class RadarLink: NSObject, ObservableObject {
    enum State: Equatable {
        /// Not asked to connect.
        case idle
        /// Bluetooth cannot be used, and why.
        case unavailable(String)
        case scanning
        case connecting
        case connected
        /// The link dropped; waiting for the unit to come back.
        case reconnecting

        var text: String {
            switch self {
            case .idle: return "Not connected"
            case .unavailable(let why): return why
            case .scanning: return "Looking for \(LaunchMonitor.deviceName)…"
            case .connecting: return "Connecting…"
            case .connected: return "Connected to \(LaunchMonitor.deviceName)"
            case .reconnecting: return "Link lost. Reconnecting when the unit is back in range…"
            }
        }

        var isActive: Bool {
            switch self {
            case .idle, .unavailable: return false
            default: return true
            }
        }
    }

    @Published private(set) var state: State = .idle
    /// The last thing that went wrong on the link itself, for the connection screen.
    @Published private(set) var problem: String?

    /// Each packet as it arrived. Called on the main actor.
    var onPacket: (@MainActor (ReceivedShot) -> Void)?

    private static let serviceID = CBUUID(string: LaunchMonitor.serviceUUID)
    private static let shotID = CBUUID(string: LaunchMonitor.shotCharacteristicUUID)
    /// Whether the golfer left the link on: it is then reopened when the app starts.
    private static let wantedKey = "radarWanted"

    private var central: CBCentralManager?
    private var unit: CBPeripheral?
    private var shotCharacteristic: CBCharacteristic?
    private var wanted = false
    /// One connection: shots are only compared on the unit's clock within one.
    private var link = UUID()
    /// What the next value read back is: the read on connecting, or the read
    /// after a notification arrived cut short (timed by that notification).
    private var pendingRead: (arrival: ShotArrival, at: Date)?

    var wasLeftOn: Bool { UserDefaults.standard.bool(forKey: Self.wantedKey) }

    /// Starts looking for the unit. The first call asks for Bluetooth permission.
    func connect() {
        wanted = true
        UserDefaults.standard.set(true, forKey: Self.wantedKey)
        problem = nil
        if let central {
            resume(central)
        } else {
            // nil queue: the main queue, so callbacks arrive on the main actor.
            central = CBCentralManager(delegate: self, queue: nil)
        }
    }

    func disconnect() {
        wanted = false
        UserDefaults.standard.set(false, forKey: Self.wantedKey)
        central?.stopScan()
        if let unit { central?.cancelPeripheralConnection(unit) }
        unit = nil
        shotCharacteristic = nil
        pendingRead = nil
        state = .idle
    }

    private func resume(_ central: CBCentralManager) {
        guard wanted else { return }
        switch central.state {
        case .poweredOn: break
        case .unauthorized:
            state = .unavailable("Bluetooth is not allowed for Swing Studio. Allow it in Settings, Privacy & "
                                 + "Security, Bluetooth.")
            return
        case .poweredOff: state = .unavailable("Bluetooth is off."); return
        case .unsupported: state = .unavailable("This device has no Bluetooth Low Energy."); return
        default: state = .unavailable("Bluetooth is not ready yet."); return
        }
        if let unit {
            if unit.state == .connected { return }
            state = .reconnecting
            central.connect(unit)
            return
        }
        state = .scanning
        central.scanForPeripherals(withServices: [Self.serviceID], options: nil)
    }

    private func found(_ peripheral: CBPeripheral, advertisedName: String?) {
        guard wanted, unit == nil, let central else { return }
        // The scan already asks for the unit's service; a name, when one came, must be the unit's too.
        let name = advertisedName ?? peripheral.name
        if let name, name != LaunchMonitor.deviceName { return }
        central.stopScan()
        unit = peripheral
        peripheral.delegate = self
        state = .connecting
        central.connect(peripheral)
    }

    private func didConnect(_ peripheral: CBPeripheral) {
        guard peripheral == unit else { return }
        link = UUID()
        pendingRead = nil
        state = .connected
        peripheral.discoverServices([Self.serviceID])
    }

    private func didDrop(_ peripheral: CBPeripheral, error: Error?) {
        guard peripheral == unit else { return }
        shotCharacteristic = nil
        pendingRead = nil
        if let error { problem = error.localizedDescription }
        guard wanted, let central else { state = .idle; return }
        state = .reconnecting
        central.connect(peripheral)  // stays pending until the unit is back
    }

    private func subscribe(_ peripheral: CBPeripheral) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceID }) else {
            problem = "The unit does not offer the shot service."
            return
        }
        peripheral.discoverCharacteristics([Self.shotID], for: service)
    }

    private func characteristicsFound(_ peripheral: CBPeripheral, _ service: CBService) {
        guard let shot = service.characteristics?.first(where: { $0.uuid == Self.shotID }) else {
            problem = "The unit does not offer the shot characteristic."
            return
        }
        shotCharacteristic = shot
        peripheral.setNotifyValue(true, for: shot)
        // The last shot the unit analysed, which may be from before this connection.
        pendingRead = (.readOnConnect, Date())
        peripheral.readValue(for: shot)
    }

    private func valueArrived(_ peripheral: CBPeripheral, _ characteristic: CBCharacteristic, _ data: Data?,
                              error: Error?) {
        let now = Date()
        if let error {
            problem = error.localizedDescription
            pendingRead = nil
            return
        }
        guard let data, !data.isEmpty else {
            pendingRead = nil  // nothing analysed since the unit started
            return
        }
        let bytes = [UInt8](data)
        let arrival: ShotArrival
        let at: Date
        if let pending = pendingRead {
            pendingRead = nil
            arrival = pending.arrival
            at = pending.arrival == .readAfterShortNotification ? pending.at : now
        } else if bytes.count < LaunchMonitor.packetBytes {
            // Cut to the link's MTU. A read is not cut short, so read the shot
            // instead; the notification's arrival still says when it happened.
            pendingRead = (.readAfterShortNotification, now)
            peripheral.readValue(for: characteristic)
            return
        } else {
            arrival = .notified
            at = now
        }
        onPacket?(ReceivedShot(bytes: bytes, receivedAt: at, arrival: arrival, link: link))
    }
}

extension RadarLink: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        MainActor.assumeIsolated {
            if central.state != .poweredOn, state.isActive || wanted {
                // A link lost to Bluetooth going off is reopened when it comes back.
                unit = nil
                shotCharacteristic = nil
            }
            resume(central)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                                    advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        MainActor.assumeIsolated { found(peripheral, advertisedName: name) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        MainActor.assumeIsolated { didConnect(peripheral) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                                    error: Error?) {
        MainActor.assumeIsolated { didDrop(peripheral, error: error) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                                    error: Error?) {
        MainActor.assumeIsolated { didDrop(peripheral, error: error) }
    }
}

extension RadarLink: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        MainActor.assumeIsolated {
            if let error { problem = error.localizedDescription; return }
            subscribe(peripheral)
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                                error: Error?) {
        MainActor.assumeIsolated {
            if let error { problem = error.localizedDescription; return }
            characteristicsFound(peripheral, service)
        }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                                error: Error?) {
        // Copied here: the characteristic's value changes with the next packet.
        let data = characteristic.value
        MainActor.assumeIsolated { valueArrived(peripheral, characteristic, data, error: error) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
                                error: Error?) {
        MainActor.assumeIsolated {
            if let error { problem = "Could not subscribe to shots: \(error.localizedDescription)" }
        }
    }
}
