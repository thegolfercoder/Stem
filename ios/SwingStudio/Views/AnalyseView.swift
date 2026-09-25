import PhotosUI
import SwiftUI
import SwingCore
import UniformTypeIdentifiers

/// A video picked from Photos, copied somewhere the app can read it.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}

struct AnalyseView: View {
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var settings: AppSettings
    @State private var picked: PhotosPickerItem?
    @State private var importing = false
    @State private var club = ""
    @State private var status = ""
    @State private var fraction = 0.0
    @State private var working = false
    @State private var refusal: (reason: String, advice: String)?
    @State private var failure: String?
    @State private var opened: SwingRecord?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Film a swing face on, whole body in shot, from before the takeaway to the held finish. "
                         + "Any phone video works: portrait or landscape, normal or slow motion.")
                        .foregroundStyle(Theme.faint)

                    PhotosPicker(selection: $picked, matching: .videos, preferredItemEncoding: .current) {
                        Label("Choose a swing from Photos", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(working)

                    Button {
                        importing = true
                    } label: {
                        Label("Choose from Files", systemImage: "folder").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(working)

                    TextField("Club (optional), e.g. 7 iron", text: $club)
                        .textFieldStyle(.roundedBorder)

                    if working {
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(value: fraction)
                            Text(status).font(.footnote).foregroundStyle(Theme.faint)
                        }
                        .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
                    }
                    if let refusal {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("No swing was found in this clip").font(.headline)
                            Text(refusal.reason).font(.subheadline)
                            Text("What to try: " + refusal.advice).font(.subheadline).foregroundStyle(Theme.faint)
                        }
                        .padding().frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
                    }
                    if let failure {
                        Text(failure).foregroundStyle(.red)
                    }
                    if let latest = history.records.first, !working {
                        Text("Latest").font(.headline).padding(.top, 8)
                        NavigationLink(value: latest.id) { SwingRow(record: latest) }
                    }
                }
                .padding()
            }
            .navigationTitle("Swing Studio")
            .navigationDestination(for: UUID.self) { id in SwingDetailView(id: id) }
            .navigationDestination(item: $opened) { record in SwingDetailView(id: record.id) }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let movie = try? await item.loadTransferable(type: PickedMovie.self) {
                        await run(url: movie.url, name: "Photos video")
                    } else {
                        failure = "That video could not be read from Photos."
                    }
                    picked = nil
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.movie]) { result in
                guard case .success(let url) = result else { return }
                Task {
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let copy = FileManager.default.temporaryDirectory
                        .appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
                    do {
                        try FileManager.default.copyItem(at: url, to: copy)
                        await run(url: copy, name: url.lastPathComponent)
                    } catch {
                        failure = error.localizedDescription
                    }
                }
            }
        }
    }

    @MainActor
    private func run(url: URL, name: String) async {
        working = true
        refusal = nil
        failure = nil
        fraction = 0
        status = "Starting"
        defer {
            working = false
            try? FileManager.default.removeItem(at: url)
        }
        let analyzer: SwingAnalyzer
        switch SharedAnalyzer.shared {
        case .success(let loaded): analyzer = loaded
        case .failure(let error): failure = error.localizedDescription; return
        }
        let handedness = settings.chosenHandedness
        do {
            let outcome = try await Task.detached(priority: .userInitiated) {
                try await ClipAnalyzer(analyzer: analyzer).analyse(url: url, handedness: handedness) { text, value in
                    Task { @MainActor in status = text; fraction = value }
                }
            }.value
            switch outcome.verdict {
            case .swing(let result):
                let clubName = club.trimmingCharacters(in: .whitespaces)
                opened = history.add(result: result, keyFrames: outcome.keyFrames, sourceName: name,
                                     club: clubName.isEmpty ? nil : clubName)
            case .refused(let reason, let advice, _):
                refusal = (reason, advice)
            }
        } catch {
            failure = error.localizedDescription
        }
    }
}

struct SwingRow: View {
    let record: SwingRecord

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.label ?? record.club ?? "Swing").font(.headline)
                Text(record.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption).foregroundStyle(Theme.faint)
            }
            Spacer()
            if let tempo = record.tempo {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(String(format: "%.2f", tempo)).font(.title2.monospacedDigit().bold())
                    Text("tempo").font(.caption2).foregroundStyle(Theme.faint)
                }
            }
        }
        .padding().background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}

extension SwingRecord: Hashable {
    static func == (a: SwingRecord, b: SwingRecord) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
