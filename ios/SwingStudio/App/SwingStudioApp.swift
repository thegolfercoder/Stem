import SwiftUI
import SwingCore

@main
struct SwingStudioApp: App {
    @StateObject private var history = HistoryStore()
    @StateObject private var settings = AppSettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(history)
                .environmentObject(settings)
                .tint(Theme.accent)
                .preferredColorScheme(.dark)
        }
    }
}

enum Theme {
    static let accent = Color(red: 0.31, green: 0.76, blue: 0.97)
    static let warm = Color(red: 1.0, green: 0.72, blue: 0.30)
    static let good = Color(red: 0.35, green: 0.82, blue: 0.60)
    static let panel = Color(white: 0.11)
    static let faint = Color(white: 0.55)
}

/// The swing model, loaded once for the life of the app.
enum SharedAnalyzer {
    static let shared: Result<SwingAnalyzer, Error> = Result { try SwingAnalyzer.bundled() }
}

struct RootView: View {
    var body: some View {
        TabView {
            AnalyseView()
                .tabItem { Label("Analyse", systemImage: "figure.golf") }
            HistoryView()
                .tabItem { Label("History", systemImage: "chart.xyaxis.line") }
            ChatView()
                .tabItem { Label("Coach", systemImage: "bubble.left.and.text.bubble.right") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
