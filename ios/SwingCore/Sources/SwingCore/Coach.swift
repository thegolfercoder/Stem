import Foundation

// The local coach's rules, shared with the desktop (swingml/coach): what the
// model is told, and the guard that keeps it to what one camera can measure.

/// Drops any sentence about club face, path, plane, spin, launch, speed or
/// distance - one phone camera on a body tracker cannot measure them - while
/// keeping sentences that say so. Works a sentence at a time, so it can sit on
/// a stream without ever showing a sentence and then taking it back.
public final class CoachGuard {
    static let unmeasurable = try! NSRegularExpression(
        pattern: "\\b(club\\s*face|clubface|face\\s+angle|face\\s+(?:is\\s+)?(?:open|closed|square)|"
            + "club\\s*path|swing\\s*path|in-to-out|out-to-in|inside[- ]out|outside[- ]in|"
            + "attack\\s+angle|angle\\s+of\\s+attack|swing\\s+plane|on\\s+plane|off\\s+plane|"
            + "(?:back|side)\\s*spin|spin\\s+(?:rate|axis)|\\bspin\\b|launch\\s+angle|"
            + "ball\\s+speed|club\\s*head\\s+speed|swing\\s+speed|smash\\s+factor|"
            + "carry\\s+distance|\\d+\\s*(?:yards|yds|mph|rpm))",
        options: [.caseInsensitive])
    static let admitsLimit = try! NSRegularExpression(
        pattern: "\\b(can(?:'|\u{2019})?t|cannot|can not|unable|impossible|not (?:possible|visible|able)|"
            + "(?:does|do)(?:n't|n\u{2019}t| not) (?:show|tell|capture|let)|no way to|beyond what)",
        options: [.caseInsensitive])
    static let sentenceEnd = try! NSRegularExpression(pattern: "([.!?])(\\s+|$)|\\n")

    private var buffer = ""
    public private(set) var dropped = 0

    public init() {}

    static func clean(_ sentence: String) -> Bool {
        let range = NSRange(sentence.startIndex..., in: sentence)
        return unmeasurable.firstMatch(in: sentence, range: range) == nil
            || admitsLimit.firstMatch(in: sentence, range: range) != nil
    }

    /// Add a piece of the reply; get back whatever complete, clean sentences it finished.
    public func feed(_ piece: String) -> String {
        buffer += piece
        var out = ""
        var last = buffer.startIndex
        let matches = Self.sentenceEnd.matches(in: buffer, range: NSRange(buffer.startIndex..., in: buffer))
        for match in matches {
            guard let end = Range(match.range, in: buffer)?.upperBound else { continue }
            let hasPunctuation = match.range(at: 1).location != NSNotFound
            let hasSpace = match.range(at: 2).location != NSNotFound && match.range(at: 2).length > 0
            // A full stop with nothing after it yet may be inside a number ("2.9").
            if hasPunctuation && !hasSpace && end == buffer.endIndex { break }
            let sentence = String(buffer[last..<end])
            last = end
            if Self.clean(sentence) { out += sentence } else { dropped += 1 }
        }
        buffer = String(buffer[last...])
        return out
    }

    /// Whatever was left when the reply ended.
    public func finish() -> String {
        let rest = buffer
        buffer = ""
        if rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return rest }
        if Self.clean(rest) { return rest }
        dropped += 1
        return ""
    }

    public var note: String? {
        dropped == 0 ? nil : "(\(dropped) sentence\(dropped == 1 ? "" : "s") about club face, path, plane or "
            + "spin \(dropped == 1 ? "was" : "were") left out: one camera cannot measure them.)"
    }
}

public enum CoachPrompts {
    static let rules = "Rules: speak to the golfer as 'you', in plain English. Only say what the pictures show "
        + "or the measurements say, and say which one each point comes from. Never state or estimate club face "
        + "angle, club path, attack angle, swing plane, spin, launch, ball speed, swing speed or distance: a "
        + "single phone camera on a body-pose tracker cannot measure any of them. Positions and times come from "
        + "a model and carry the error ranges given; do not treat a difference smaller than its range as real. "
        + "If a frame does not show the position its label says, say so instead of coaching from it."

    public static func measurementLines(_ result: SwingResult, tempoBand: Double?) -> [String] {
        let m = result.metrics
        var lines = ["Golfer: \(result.handedness.rawValue)-handed."]
        if let tempo = m.tempoRatio {
            let spread = tempoBand.map { String(format: " (measured 80%% error range about +/-%.0f%%)", $0 * 100) } ?? ""
            lines.append(String(format: "Tempo, backswing time over downswing time: %.2f", tempo) + spread
                + ". The downswing is always the shorter of the two; good players are usually quoted near 3.")
        }
        lines.append(String(format: "Timing: backswing %.0f ms, downswing %.0f ms, address to finish %.0f ms.",
                            m.backswingMs, m.downswingMs, m.wholeMs))
        lines.append(String(format: "Hands fastest %.0f ms %@ impact.", abs(m.peakHandSpeedMs),
                            m.peakHandSpeedMs < 0 ? "before" : "after"))
        if let turn = m.shoulderTurnDeg {
            lines.append(String(format: "Shoulder turn at the top, from how much the shoulders foreshorten in the "
                + "picture (reads low; compare only with swings filmed from the same spot): about %.0f degrees.", turn))
        }
        if let hips = m.hipTurnDeg {
            lines.append(String(format: "Hip turn at the top, same method: about %.0f degrees.", hips))
        }
        if let head = m.headMovement, let sway = m.pelvisSway, let lift = m.pelvisLift {
            lines.append(String(format: "Address to impact, in body lengths: head moved %.3f, pelvis swayed %.3f, "
                + "pelvis rose or dropped %.3f.", head, sway, lift))
        }
        let stamps = zip(SwingEvent.allCases, m.eventTimes).map { String(format: "%@ %.2fs", $0.name, $1) }
        lines.append("Positions found at: " + stamps.joined(separator: ", ") + ".")
        return lines
    }

    /// The coach's request for one swing; the contact sheet goes with it when the
    /// model can see pictures.
    public static func coach(_ result: SwingResult, tempoBand: Double?, club: String?, withPicture: Bool) -> String {
        let picture = withPicture
            ? "The image is a contact sheet of eight frames from the video, numbered in order: "
                + SwingEvent.allCases.map { "\($0.rawValue + 1) \($0.name)" }.joined(separator: ", ")
                + ". The lines drawn on it are a body tracker's skeleton, not the club.\n\n"
            : "No pictures are available; work from the measurements only.\n\n"
        let clubLine = club.map { "Club: \($0).\n" } ?? ""
        return "A golfer filmed one swing on a phone and an app measured it from that single camera.\n\n"
            + picture + clubLine + "What the app measured:\n- "
            + measurementLines(result, tempoBand: tempoBand).joined(separator: "\n- ")
            + "\n\nWrite a short coaching read:\n"
            + "1. What stands out: two or three observations, each naming the frame or measurement it comes from.\n"
            + "2. The one thing to work on first, and one simple drill for it.\n"
            + "3. In one sentence, what this footage cannot tell.\n\n"
            + rules + " Plain text with the three numbered parts, under 230 words."
    }

    /// The chat's standing context: every stored swing as one line, newest first.
    public static func chatContext(_ swings: [(date: Date, club: String?, label: String?, result: SwingResult)],
                                   tempoBand: Double?) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        var rows = ["n | date | club | label | tempo | backswing ms | downswing ms | shoulder turn | head movement"]
        for (i, swing) in swings.prefix(60).enumerated() {
            let m = swing.result.metrics
            rows.append([
                "\(i + 1)", formatter.string(from: swing.date), swing.club ?? "-", swing.label ?? "-",
                m.tempoRatio.map { String(format: "%.2f", $0) } ?? "-",
                String(format: "%.0f", m.backswingMs), String(format: "%.0f", m.downswingMs),
                m.shoulderTurnDeg.map { String(format: "%.0f deg", $0) } ?? "-",
                m.headMovement.map { String(format: "%.3f", $0) } ?? "-",
            ].joined(separator: " | "))
        }
        let band = tempoBand.map {
            String(format: " Tempo readings carry a measured 80%% error range of about +/-%.0f%% each, so a change "
                + "between two single swings smaller than that is not evidence of anything; trends over several "
                + "swings are.", $0 * 100)
        } ?? ""
        return "You are a golf coach answering questions about one golfer's own swings. Each was filmed on a phone "
            + "and measured by an app from that single camera. Here is every swing on record, newest first:\n\n"
            + rows.joined(separator: "\n")
            + "\n\nTempo is backswing time over downswing time, a ratio with no unit (not seconds); good players "
            + "are usually quoted near 3. Shoulder turn is measured in the 2D picture, so compare it only between "
            + "swings filmed from the same place. Head movement is in body lengths from address to impact."
            + band + " Refer to swings by their number and date. " + rules + " Keep answers short unless asked for detail."
    }
}

/// One line of Ollama's streamed /api/chat reply.
public enum OllamaEvent: Equatable {
    case text(String)
    case done
    case failure(String)

    public static func parse(_ line: String) -> OllamaEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let error = object["error"] as? String { return .failure(error) }
        if let message = object["message"] as? [String: Any], let content = message["content"] as? String,
           !content.isEmpty {
            return .text(content)
        }
        if object["done"] as? Bool == true { return .done }
        return nil
    }
}
