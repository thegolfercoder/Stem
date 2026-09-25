import Charts
import SwiftUI
import SwingCore

/// Every swing, with tempo over time. One reading is noisy - the measured spread
/// on a single tempo is about ±27% - so the chart shows the run of them, which is
/// where a real change shows.
struct HistoryView: View {
    @EnvironmentObject private var history: HistoryStore
    @State private var club = "All clubs"

    private var clubs: [String] {
        ["All clubs"] + Array(Set(history.records.compactMap(\.club))).sorted()
    }

    private var shown: [SwingRecord] {
        history.records.filter { club == "All clubs" || $0.club == club }
    }

    var body: some View {
        NavigationStack {
            List {
                if shown.count >= 2 {
                    Section {
                        Chart(shown.reversed().filter { $0.tempo != nil }) { record in
                            LineMark(x: .value("Date", record.date), y: .value("Tempo", record.tempo!))
                                .foregroundStyle(Theme.accent)
                            PointMark(x: .value("Date", record.date), y: .value("Tempo", record.tempo!))
                                .foregroundStyle(Theme.accent)
                        }
                        .chartYAxisLabel("tempo")
                        .frame(height: 180)
                        summary
                    } header: {
                        Text("Tempo over time")
                    }
                }
                Section {
                    ForEach(shown) { record in
                        NavigationLink(value: record.id) { SwingRow(record: record) }
                            .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                            .listRowBackground(Color.clear)
                    }
                    .onDelete { offsets in
                        for offset in offsets { history.delete(shown[offset].id) }
                    }
                }
            }
            .navigationTitle("History")
            .navigationDestination(for: UUID.self) { id in SwingDetailView(id: id) }
            .toolbar {
                Picker("Club", selection: $club) { ForEach(clubs, id: \.self) { Text($0) } }
            }
            .overlay {
                if history.records.isEmpty {
                    ContentUnavailableView("No swings yet", systemImage: "figure.golf",
                                           description: Text("Analyse a swing and it will appear here."))
                }
            }
        }
    }

    private var summary: some View {
        let tempos = shown.compactMap(\.tempo)
        let mean = tempos.reduce(0, +) / Double(max(1, tempos.count))
        let spread = (tempos.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(max(1, tempos.count))).squareRoot()
        return Text(String(format: "Average %.2f over %d swings, varying by ±%.2f.", mean, tempos.count, spread))
            .font(.footnote).foregroundStyle(Theme.faint)
    }
}
