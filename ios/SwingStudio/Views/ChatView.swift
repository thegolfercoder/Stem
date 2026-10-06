import SwiftUI
import SwingCore

/// Questions about your own swings, answered by a model on your computer from the
/// measurements stored on this iPhone.
struct ChatView: View {
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var settings: AppSettings
    @State private var turns: [(role: String, text: String)] = []
    @State private var draft = ""
    @State private var answering = false
    @State private var problem = ""

    private let suggestions = [
        "Is my tempo getting more consistent?",
        "Which of my swings was the best, and why?",
        "What should I work on first?",
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            if turns.isEmpty {
                                Text("Ask about your \(history.records.count) swings. The answer comes from a model on "
                                     + "your computer, which reads your measurements, not your videos.")
                                    .foregroundStyle(Theme.faint)
                                ForEach(suggestions, id: \.self) { question in
                                    Button(question) { draft = question; Task { await send() } }
                                        .buttonStyle(.bordered)
                                }
                            }
                            ForEach(Array(turns.enumerated()), id: \.offset) { index, turn in
                                Text(turn.text.isEmpty ? "Thinking…" : turn.text)
                                    .padding(12)
                                    .background(turn.role == "user" ? Theme.accent.opacity(0.85) : Theme.panel,
                                                in: RoundedRectangle(cornerRadius: 14))
                                    .frame(maxWidth: .infinity, alignment: turn.role == "user" ? .trailing : .leading)
                                    .id(index)
                            }
                            if !problem.isEmpty { Text(problem).font(.footnote).foregroundStyle(.red) }
                        }
                        .padding()
                    }
                    .onChange(of: turns.count) { _, count in proxy.scrollTo(count - 1, anchor: .bottom) }
                }
                HStack {
                    TextField("Ask about your swings…", text: $draft, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...4)
                    Button("Ask") { Task { await send() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(answering || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding()
            }
            .navigationTitle("Ask the coach")
        }
    }

    @MainActor
    private func send() async {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        draft = ""
        problem = ""
        turns.append(("user", question))
        turns.append(("assistant", ""))
        answering = true
        defer { answering = false }
        do {
            let client = try OllamaClient(address: settings.ollamaAddress)
            let models = try await client.models()
            guard let model = models.first(where: { $0.name == settings.preferredModel }) ?? models.first else {
                problem = "Ollama has no models yet. On your computer run: ollama pull gemma3:4b"
                turns.removeLast()
                return
            }
            let analyzer = try? SharedAnalyzer.shared.get()
            let context = CoachPrompts.chatContext(
                history.records.map { ($0.date, $0.club, $0.label, $0.result) }, tempoBand: analyzer?.tempoBand)
            var messages: [[String: Any]] = [["role": "system", "content": context]]
            for turn in turns.dropLast().suffix(16) { messages.append(["role": turn.role, "content": turn.text]) }
            let reply = turns.count - 1
            let final = try await client.chat(model: model.name, messages: messages, guard: CoachGuard()) { text in
                Task { @MainActor in turns[reply].text = text }
            }
            turns[reply].text = final
        } catch {
            problem = error.localizedDescription
            if turns.last?.text.isEmpty == true { turns.removeLast() }
        }
    }
}
