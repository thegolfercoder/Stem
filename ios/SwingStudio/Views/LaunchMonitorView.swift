import SwiftUI
import SwingCore

/// The ground radar unit: the link, and each shot as the unit sent it.
///
/// Ball speed, club speed and smash come only from the radar. Each number says
/// how the unit arrived at it; a refused reading shows the unit's own reason.
struct LaunchMonitorView: View {
    @EnvironmentObject private var launch: LaunchStore
    @EnvironmentObject private var link: RadarLink
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                connection
                if let notice = launch.unreadableNotice {
                    Text(notice).font(.footnote)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.warm.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
                }
                let shots = launch.recent()
                if let latest = shots.first {
                    RadarShotPanel(shot: latest.shot, summary: latest.summary, unit: settings.unit,
                                   demo: launch.demoRunning)
                    if !launch.demoRunning { battery(latest.summary) }
                    if shots.count > 1 {
                        Text("Earlier shots").font(.headline).padding(.top, 4)
                        ForEach(shots.dropFirst()) { item in
                            RadarShotRow(shot: item.shot, summary: item.summary, unit: settings.unit,
                                         demo: launch.demoRunning)
                        }
                    }
                } else {
                    Text(launch.demoRunning ? "The first synthetic shot is on its way."
                                            : "No shots yet. Each shot the unit analyses appears here.")
                        .foregroundStyle(Theme.faint)
                }
                demo
                Text(Self.about).font(.footnote).foregroundStyle(Theme.faint)
            }
            .padding()
        }
        .navigationTitle("Launch monitor")
        .navigationBarTitleDisplayMode(.inline)
    }

    private static let about = "Ball and club speed come only from the radar, never from the camera. They are "
        + "the unit's on-device preview: radial, along the radar's line of sight, not corrected for the ball's "
        + "direction. Each number carries the provenance the unit sent with it. The radar does not measure spin, "
        + "face angle, club path, attack angle or swing plane, and nothing here shows them."

    private static let keepOpen = "Keep Swing Studio open, or in the background, while you hit: it receives each "
        + "shot as the unit sends it, and puts it beside the clip of that swing by the clock."

    private static let demoNote = "Synthetic shots every few seconds, packed as the unit packs them, to see the "
        + "screen without a unit. They are not measurements: they are never saved and never put beside a swing."

    private var rejectedText: String? {
        let n = launch.rejectedCount
        guard n > 0, let why = launch.lastRejection else { return nil }
        let some = n == 1 ? "1 packet was" : "\(n) packets were"
        let them = n == 1 ? "it" : "them"
        return "\(some) not a shot this app can read, and nothing in \(them) is shown (the bytes are kept). "
            + "Last: \(why)."
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: link.state == .connected ? "dot.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                    .foregroundStyle(link.state == .connected ? Theme.good : Theme.faint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(LaunchMonitor.deviceName).font(.headline)
                    Text(link.state.text).font(.subheadline).foregroundStyle(Theme.faint)
                }
                Spacer()
            }
            if link.state.isActive {
                Button("Disconnect") { link.disconnect() }.buttonStyle(.bordered)
            } else {
                Button {
                    link.connect()
                } label: {
                    Label("Connect to the ground unit", systemImage: "dot.radiowaves.left.and.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            if let problem = link.problem {
                Text(problem).font(.footnote).foregroundStyle(Theme.warm)
            }
            if let rejected = rejectedText {
                Text(rejected).font(.footnote).foregroundStyle(Theme.faint)
            }
            Text(Self.keepOpen).font(.caption).foregroundStyle(Theme.faint)
        }
        .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
    }

    private func battery(_ summary: ShotSummary) -> some View {
        let b = summary.battery
        let unit = b.groundKnown
            ? String(format: "%.2f V%@", Double(b.groundMv) / 1000, b.groundLow ? ", low" : "")
            : "not read"
        let pod = b.podKnown ? String(format: "%.2f V, as last reported", Double(b.podMv) / 1000) : "no pod reported"
        let text: String = "Unit battery \(unit). Pod battery \(pod). Voltages as sent with the latest shot; "
            + "a voltage is not a percentage."
        return Text(text).font(.caption).foregroundStyle(Theme.faint)
    }

    private var demo: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("Demo", isOn: Binding(get: { launch.demoRunning }, set: { launch.setDemo($0) }))
            Text(Self.demoNote).font(.caption).foregroundStyle(Theme.faint)
        }
        .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// One shot's ball speed, club speed and smash, each with how the unit got it.
struct RadarShotPanel: View {
    let shot: ReceivedShot
    let summary: ShotSummary
    let unit: SpeedUnit
    var demo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Radar shot #\(summary.shotSeq)").font(.headline)
                Spacer()
                Text(demo ? "DEMO · SYNTHETIC, NOT A MEASUREMENT" : "UNIT'S ON-DEVICE PREVIEW")
                    .font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                    .foregroundStyle(demo ? Theme.warm : Theme.faint)
                    .overlay(Capsule().stroke(demo ? Theme.warm : Theme.faint))
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                      alignment: .leading, spacing: 10) {
                ForEach([summary.ballSpeed, summary.clubSpeed, summary.smash], id: \.field) { reading in
                    RadarReadingCell(reading: reading, unit: unit)
                }
            }
            Text(arrivalText).font(.caption2).foregroundStyle(Theme.faint)
        }
        .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
    }

    private var arrivalText: String {
        let time = shot.receivedAt.formatted(date: .omitted, time: .standard)
        switch shot.arrival {
        case .notified: return "Received \(time)"
        case .readAfterShortNotification: return "Received \(time) (read after a cut-short notification)"
        case .readOnConnect: return "Read on connecting at \(time): the unit's last shot, from before then"
        }
    }
}

/// A number with its unit and provenance, or "no reading" with the unit's reason.
struct RadarReadingCell: View {
    let reading: RadarReading
    let unit: SpeedUnit

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(Theme.faint).textCase(.uppercase)
            if let value = reading.formatted(unit) {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value).font(.title3.bold().monospacedDigit())
                    Text(reading.unitLabel(unit)).font(.caption).foregroundStyle(Theme.faint)
                }
                Text(reading.provenance.label).font(.caption2.bold())
                    .foregroundStyle(reading.provenance == .measured ? Theme.good : Theme.faint)
            } else {
                Text("no reading").font(.subheadline.bold()).foregroundStyle(Theme.faint)
                Text(reading.reason).font(.caption2).foregroundStyle(Theme.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let anomaly = reading.anomaly, reading.status == .refused {
                Text("(the packet was inconsistent: \(anomaly))").font(.caption2).foregroundStyle(Theme.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var title: String {
        switch reading.field {
        case .ballSpeedRadial: return "Ball speed"
        case .clubSpeedRadial: return "Club speed"
        case .smash: return "Smash"
        default: return reading.field.label
        }
    }
}

/// A shot in the list: the three numbers in a line.
struct RadarShotRow: View {
    let shot: ReceivedShot
    let summary: ShotSummary
    let unit: SpeedUnit
    var demo = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("#\(summary.shotSeq)\(demo ? " · demo" : "")").font(.subheadline.bold())
                Text(shot.receivedAt.formatted(date: .omitted, time: .shortened))
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            Spacer()
            ForEach([summary.ballSpeed, summary.clubSpeed, summary.smash], id: \.field) { reading in
                VStack(alignment: .trailing, spacing: 0) {
                    Text(reading.formatted(unit) ?? "-").font(.body.monospacedDigit().bold())
                    Text(Self.shortName(reading.field)).font(.caption2).foregroundStyle(Theme.faint)
                }
                .frame(minWidth: 52, alignment: .trailing)
            }
        }
        .padding(12).background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    private static func shortName(_ field: ShotField) -> String {
        switch field {
        case .ballSpeedRadial: return "ball"
        case .clubSpeedRadial: return "club"
        case .smash: return "smash"
        default: return field.label
        }
    }
}

/// The link's state in one line, opening the launch monitor screen.
struct RadarStatusRow: View {
    @EnvironmentObject private var link: RadarLink
    @EnvironmentObject private var launch: LaunchStore

    var body: some View {
        NavigationLink {
            LaunchMonitorView()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(link.state == .connected ? Theme.good : Theme.faint)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch monitor").font(.subheadline.bold())
                    Text(launch.demoRunning ? "Demo running: synthetic shots" : link.state.text)
                        .font(.caption).foregroundStyle(Theme.faint)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.faint)
            }
            .padding(12).background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

/// On a swing's page: the radar shot paired with this clip, or why there is none.
struct PairedShotSection: View {
    let record: SwingRecord
    @EnvironmentObject private var launch: LaunchStore
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        let outcome = launch.pairing(for: record)
        VStack(alignment: .leading, spacing: 10) {
            Text("Launch monitor").font(.title3.bold())
            switch outcome {
            case .paired(let pairing):
                RadarShotPanel(shot: pairing.shot, summary: pairing.summary, unit: settings.unit)
                Text(evidence(pairing)).font(.caption).foregroundStyle(Theme.faint)
            case .refused(let reason):
                Text("No radar shot is shown for this swing: \(reason).")
                    .font(.subheadline).foregroundStyle(Theme.faint)
            }
        }
    }

    /// How the shot was matched to the clip, and what that assumed.
    private func evidence(_ pairing: ShotPairing) -> String {
        let window = PairingTolerance.standard.window
        let gap = pairing.gapS
        var text = String(format: "Paired by the clock: the unit's shot is placed %.1f s ", abs(gap))
        text += gap < 0 ? "before" : "after"
        text += String(format: " this clip's strike, and it is the only shot from %.1f s before to %.1f s after it.",
                       -window.lowerBound, window.upperBound)
        for note in pairing.notes {
            text += " " + note.prefix(1).uppercased() + String(note.dropFirst()) + "."
        }
        return text
    }
}
