import SwiftUI
import SwingCore

/// One swing: tempo first, then the eight positions, the measurements, and the
/// coach's read. Every figure says how it was obtained, and the error bands are
/// the ones measured on held-out real swings.
struct SwingDetailView: View {
    let id: UUID
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var settings: AppSettings
    @State private var coachText = ""
    @State private var coachStatus = ""
    @State private var coaching = false
    @State private var enlarged: Int?

    private var record: SwingRecord? { history.records.first { $0.id == id } }
    private var analyzer: SwingAnalyzer? { try? SharedAnalyzer.shared.get() }

    var body: some View {
        if let record {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    tempo(record)
                    positions(record)
                    measurements(record)
                    coach(record)
                    Text("Everything was measured on this iPhone from one camera. Nothing here is a club, ball "
                         + "or launch measurement: one camera on a body tracker cannot make those.")
                        .font(.footnote).foregroundStyle(Theme.faint)
                }
                .padding()
            }
            .navigationTitle(record.club ?? "Swing")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: Binding(get: { enlarged.map { Enlarged(index: $0) } }, set: { enlarged = $0?.index })) { item in
                FrameViewer(images: history.images(for: record), index: item.index)
            }
        } else {
            Text("This swing is no longer stored.")
        }
    }

    struct Enlarged: Identifiable { let index: Int; var id: Int { index } }

    private func tempo(_ record: SwingRecord) -> some View {
        let m = record.result.metrics
        return VStack(alignment: .leading, spacing: 6) {
            Text("Tempo").font(.caption).foregroundStyle(Theme.faint).textCase(.uppercase)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(m.tempoRatio.map { String(format: "%.2f", $0) } ?? "-").font(.system(size: 54, weight: .bold))
                Text(": 1").font(.title2).foregroundStyle(Theme.faint)
            }
            if let tempo = m.tempoRatio, let band = analyzer?.tempoBand {
                Text(String(format: "measured spread %.2f - %.2f, for 80%% of held-out real swings",
                            tempo * (1 - band), tempo * (1 + band)))
                    .font(.footnote).foregroundStyle(Theme.faint)
            }
            Text(String(format: "Backswing %.0f ms, downswing %.0f ms. Good players are usually quoted near 3 : 1.",
                        m.backswingMs, m.downswingMs))
                .font(.subheadline)
            Text("\(record.result.handedness.rawValue.capitalized)-handed (\(record.result.handednessFrom))")
                .font(.caption).foregroundStyle(Theme.faint)
        }
    }

    private func positions(_ record: SwingRecord) -> some View {
        let images = history.images(for: record)
        return VStack(alignment: .leading, spacing: 10) {
            Text("The eight positions").font(.title3.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                        let event = SwingEvent(rawValue: index)!
                        Button { enlarged = index } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Image(uiImage: image).resizable().scaledToFill()
                                    .frame(width: 120, height: 200).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                Text(event.name + (event.clubDefined ? "*" : "")).font(.caption.bold())
                                Text(String(format: "%.3f s", record.result.metrics.eventTimes[index]))
                                    .font(.caption2.monospacedDigit()).foregroundStyle(Theme.faint)
                                if let band = analyzer?.band(event: index, confidence: record.result.confidence[index]) {
                                    Text(String(format: "±%.0f ms", band.milliseconds))
                                        .font(.caption2).foregroundStyle(Theme.faint)
                                }
                            }
                            .frame(width: 120)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Text("* Placed from the body's motion: defined by the club shaft, which the tracker does not see.")
                .font(.caption2).foregroundStyle(Theme.faint)
        }
    }

    private func measurements(_ record: SwingRecord) -> some View {
        let m = record.result.metrics
        let cells: [(String, String, String)] = [
            ("Whole swing", String(format: "%.0f ms", m.wholeMs), "address to finish"),
            ("Hands fastest", String(format: "%.0f ms", m.peakHandSpeedMs), "relative to impact"),
            ("Shoulder turn", m.shoulderTurnDeg.map { String(format: "%.0f°", $0) } ?? "no reading", "from foreshortening"),
            ("Hip turn", m.hipTurnDeg.map { String(format: "%.0f°", $0) } ?? "no reading", "from foreshortening"),
            ("Head movement", m.headMovement.map { String(format: "%.3f", $0) } ?? "feet not in shot", "body lengths"),
            ("Pelvis sway", m.pelvisSway.map { String(format: "%.3f", $0) } ?? "feet not in shot", "body lengths"),
        ]
        return VStack(alignment: .leading, spacing: 10) {
            Text("Measurements").font(.title3.bold())
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(cells, id: \.0) { title, value, note in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(.caption).foregroundStyle(Theme.faint).textCase(.uppercase)
                        Text(value).font(.title3.bold().monospacedDigit())
                        Text(note).font(.caption2).foregroundStyle(Theme.faint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            Text("Turns are read from how much the shoulders and hips foreshorten: compare them only between "
                 + "swings filmed from the same spot.")
                .font(.caption2).foregroundStyle(Theme.faint)
        }
    }

    private func coach(_ record: SwingRecord) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("A coach's read").font(.title3.bold())
                Text("LOCAL AI").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                    .overlay(Capsule().stroke(Theme.faint))
            }
            Text("A model running on your own computer, through Ollama, looks at the eight positions and the "
                 + "numbers. It is an opinion, not a measurement.")
                .font(.footnote).foregroundStyle(Theme.faint)
            let shown = coachText.isEmpty ? (record.coach?.text ?? "") : coachText
            if !shown.isEmpty {
                Text(shown).font(.body).textSelection(.enabled)
                    .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
            }
            if let read = record.coach, coachText.isEmpty {
                Text("\(read.model), \(read.sawPictures ? "from the pictures and the numbers" : "from the numbers"), "
                     + read.at.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            if !coachStatus.isEmpty { Text(coachStatus).font(.footnote).foregroundStyle(Theme.faint) }
            Button(record.coach == nil ? "Get a coach's read" : "Ask again") { Task { await askCoach(record) } }
                .buttonStyle(.borderedProminent).disabled(coaching)
        }
    }

    @MainActor
    private func askCoach(_ record: SwingRecord) async {
        coaching = true
        coachText = ""
        coachStatus = "Thinking… a local model can take a minute."
        defer { coaching = false }
        do {
            let client = try OllamaClient(address: settings.ollamaAddress)
            let models = try await client.models()
            let preferred = models.first { $0.name == settings.preferredModel }
            guard let model = preferred ?? models.first(where: \.vision) ?? models.first else {
                coachStatus = "Ollama has no models yet. On your computer run: ollama pull gemma3:4b"
                return
            }
            let sheet = model.vision ? contactSheet(history.images(for: record)) : nil
            var message: [String: Any] = [
                "role": "user",
                "content": CoachPrompts.coach(record.result, tempoBand: analyzer?.tempoBand,
                                              club: record.club, withPicture: sheet != nil),
            ]
            if let sheet { message["images"] = [sheet] }
            let final = try await client.chat(model: model.name, messages: [message], guard: CoachGuard()) { text in
                Task { @MainActor in coachText = text; coachStatus = "" }
            }
            coachText = final
            history.setCoach(CoachRead(model: model.name, text: final, sawPictures: sheet != nil, at: Date()),
                             for: record.id)
            coachStatus = ""
        } catch {
            coachStatus = error.localizedDescription
        }
    }
}

/// The key frames full screen, swiped through.
struct FrameViewer: View {
    let images: [UIImage]
    @State var index: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TabView(selection: $index) {
                ForEach(Array(images.enumerated()), id: \.offset) { i, image in
                    Image(uiImage: image).resizable().scaledToFit().tag(i)
                }
            }
            .tabViewStyle(.page)
            .navigationTitle(SwingEvent(rawValue: index)?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
