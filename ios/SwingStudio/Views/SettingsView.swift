import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @State private var models: [OllamaModel] = []
    @State private var checking = false
    @State private var result = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Golfer") {
                    Picker("Handedness", selection: $settings.handedness) {
                        Text("Detect").tag("auto")
                        Text("Right-handed").tag("right")
                        Text("Left-handed").tag("left")
                    }
                }
                Section {
                    TextField("http://192.168.1.20:11434", text: $settings.ollamaAddress)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button(checking ? "Checking…" : "Check connection") { Task { await check() } }
                        .disabled(checking)
                    if !result.isEmpty { Text(result).font(.footnote) }
                    if !models.isEmpty {
                        Picker("Model", selection: $settings.preferredModel) {
                            Text("Choose automatically").tag("")
                            ForEach(models) { model in
                                Text("\(model.name)\(model.vision ? " - sees pictures" : "")").tag(model.name)
                            }
                        }
                    }
                } header: {
                    Text("Coach (Ollama on your computer)")
                } footer: {
                    Text("""
                    1. Install Ollama from ollama.com on your Mac or PC.
                    2. Run: ollama pull gemma3:4b  (a bigger model such as gemma3:12b coaches better if your \
                    computer can run it)
                    3. Let it listen on your Wi-Fi: quit Ollama, then run OLLAMA_HOST=0.0.0.0 ollama serve
                    4. Enter your computer's address above.
                    Nothing is sent to the internet: the phone talks only to your computer.
                    """)
                }
                Section("About") {
                    Text("The pose tracker, the swing model and every measurement run on this iPhone. The model "
                         + "and its error bands are the same ones the desktop and browser apps use.")
                        .font(.footnote)
                }
            }
            .navigationTitle("Settings")
        }
    }

    @MainActor
    private func check() async {
        checking = true
        defer { checking = false }
        do {
            let client = try OllamaClient(address: settings.ollamaAddress)
            models = try await client.models()
            let seeing = models.filter(\.vision).count
            result = models.isEmpty
                ? "Connected, but Ollama has no models. Run: ollama pull gemma3:4b"
                : "Connected: \(models.count) model\(models.count == 1 ? "" : "s"), \(seeing) that can see pictures."
        } catch {
            result = error.localizedDescription
            models = []
        }
    }
}
