import Foundation
import SwingCore
import UIKit

/// Ollama on the person's own computer, over their Wi-Fi.
///
/// A phone cannot run a vision language model worth the name, but the computer
/// at home can: Ollama listens on port 11434, and once it is told to listen beyond
/// itself (OLLAMA_HOST=0.0.0.0) the phone can use it. Nothing goes to the internet.
struct OllamaModel: Identifiable, Hashable {
    var id: String { name }
    let name: String
    let vision: Bool
    let sizeGB: Double
}

enum OllamaProblem: LocalizedError {
    case noAddress, unreachable(String), refused(String)

    var errorDescription: String? {
        switch self {
        case .noAddress:
            return "Set your computer's Ollama address in Settings, for example http://192.168.1.20:11434."
        case .unreachable(let why):
            return "Could not reach Ollama (\(why)). Is it running on your computer, started with "
                + "OLLAMA_HOST=0.0.0.0, and is this iPhone on the same Wi-Fi?"
        case .refused(let why):
            return "Ollama refused the request: \(why)"
        }
    }
}

struct OllamaClient {
    let base: URL

    init(address: String) throws {
        var text = address.trimmingCharacters(in: .whitespaces)
        if text.isEmpty { throw OllamaProblem.noAddress }
        if !text.contains("://") { text = "http://" + text }
        if !text.contains(":11434"), URL(string: text)?.port == nil { text += ":11434" }
        guard let url = URL(string: text) else { throw OllamaProblem.noAddress }
        base = url
    }

    private func json(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 5)
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        } catch {
            throw OllamaProblem.unreachable(error.localizedDescription)
        }
    }

    /// The installed models, each asked whether it can see pictures.
    func models() async throws -> [OllamaModel] {
        let tags = try await json("api/tags")
        let entries = tags["models"] as? [[String: Any]] ?? []
        var found: [OllamaModel] = []
        for entry in entries {
            guard let name = entry["name"] as? String else { continue }
            let shown = try? await json("api/show", body: ["model": name])
            let capabilities = shown?["capabilities"] as? [String] ?? []
            found.append(OllamaModel(name: name, vision: capabilities.contains("vision"),
                                     sizeGB: Double(entry["size"] as? Int ?? 0) / 1e9))
        }
        return found
    }

    /// Stream a reply, sentence by sentence through the guard; returns the whole of it.
    @discardableResult
    func chat(model: String, messages: [[String: Any]], guard guardian: CoachGuard,
              onText: @escaping (String) -> Void) async throws -> String {
        var request = URLRequest(url: base.appendingPathComponent("api/chat"), timeoutInterval: 600)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model, "messages": messages, "stream": true,
            "options": ["temperature": 0.4, "num_ctx": 8192],
        ])
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await URLSession.shared.bytes(for: request)
        } catch {
            throw OllamaProblem.unreachable(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw OllamaProblem.refused("status \(http.statusCode)")
        }
        var text = ""
        for try await line in bytes.lines {
            switch OllamaEvent.parse(line) {
            case .text(let piece)?:
                let released = guardian.feed(piece)
                if !released.isEmpty { text += released; onText(text) }
            case .failure(let why)?:
                throw OllamaProblem.refused(why)
            case .done?:
                text += guardian.finish()
                if let note = guardian.note { text += "\n\n" + note }
                onText(text)
                return text
            case nil:
                continue
            }
        }
        text += guardian.finish()
        onText(text)
        return text
    }
}

/// The eight key frames on one JPEG, four across, numbered - what the coach sees.
func contactSheet(_ frames: [UIImage]) -> String? {
    guard frames.count == 8, let first = frames.first else { return nil }
    let cellHeight: CGFloat = 360
    let cellWidth = (cellHeight * first.size.width / first.size.height).rounded()
    let size = CGSize(width: cellWidth * 4, height: cellHeight * 2)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let sheet = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        UIColor.black.setFill()
        UIRectFill(CGRect(origin: .zero, size: size))
        for (i, frame) in frames.enumerated() {
            let origin = CGPoint(x: CGFloat(i % 4) * cellWidth, y: CGFloat(i / 4) * cellHeight)
            frame.draw(in: CGRect(origin: origin, size: CGSize(width: cellWidth, height: cellHeight)))
            let label = "\(i + 1) \(SwingEvent(rawValue: i)!.name)" as NSString
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 16), .foregroundColor: UIColor.white,
                .backgroundColor: UIColor.black.withAlphaComponent(0.7),
            ]
            label.draw(at: CGPoint(x: origin.x + 6, y: origin.y + 6), withAttributes: attributes)
        }
    }
    return sheet.jpegData(compressionQuality: 0.85)?.base64EncodedString()
}
