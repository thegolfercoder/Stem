import XCTest
@testable import SwingCore

final class CoachTests: XCTestCase {
    let reply = [
        "1. What stands out: your tempo of 2.9 is quicker ",
        "than most. Your club path looks out-to-in at the top. ",
        "Frame 4 shows a full shoulder turn.\n",
        "2. Work on: a smoother transition. Try a pause-at-the-top drill.\n",
        "3. One camera cannot see the club face.",
    ]

    func testTheGuardDropsWhatOneCameraCannotMeasureButKeepsSayingSo() {
        let guardian = CoachGuard()
        let text = reply.map { guardian.feed($0) }.joined() + guardian.finish()
        XCTAssertFalse(text.lowercased().contains("club path"))
        XCTAssertTrue(text.contains("tempo of 2.9"))
        XCTAssertTrue(text.contains("cannot see the club face"))
        XCTAssertEqual(guardian.dropped, 1)
        XCTAssertNotNil(guardian.note)
    }

    func testTheGuardIsTheSameHoweverTheReplyIsSplit() {
        let whole = reply.joined()
        let one = CoachGuard()
        let expected = one.feed(whole) + one.finish()
        let guardian = CoachGuard()
        var streamed = ""
        var index = whole.startIndex
        while index < whole.endIndex {
            let next = whole.index(index, offsetBy: 5, limitedBy: whole.endIndex) ?? whole.endIndex
            streamed += guardian.feed(String(whole[index..<next]))
            index = next
        }
        streamed += guardian.finish()
        XCTAssertEqual(streamed, expected)
        XCTAssertEqual(guardian.dropped, one.dropped)
    }

    func testTheUsualWaysOfSayingItAreCaught() {
        for sentence in ["Your clubface is open at impact.", "That carries 230 yards.",
                         "Expect about 2500 rpm of backspin.", "Your attack angle is negative."] {
            XCTAssertFalse(CoachGuard.clean(sentence), sentence)
        }
    }

    func testOllamaLinesAreRead() {
        XCTAssertEqual(OllamaEvent.parse(#"{"message":{"role":"assistant","content":"Hi"},"done":false}"#), .text("Hi"))
        XCTAssertEqual(OllamaEvent.parse(#"{"message":{"content":""},"done":true}"#), .done)
        XCTAssertEqual(OllamaEvent.parse(#"{"error":"model not found"}"#), .failure("model not found"))
        XCTAssertNil(OllamaEvent.parse(""))
    }

    func testThePromptCarriesTheMeasurementsAndTheRules() throws {
        let analyzer = try SwingAnalyzer.bundled()
        let golden = ParityTests.golden.input
        let sequence = PoseSequence(xy: golden.xy.map { $0.map { Point($0[0], $0[1]) } },
                                    visibility: golden.visibility, detected: golden.detected,
                                    times: golden.times, width: golden.width, height: golden.height)
        let result = try XCTUnwrap(analyzer.analyse(sequence).result)
        let prompt = CoachPrompts.coach(result, tempoBand: analyzer.tempoBand, club: "Driver", withPicture: true)
        XCTAssertTrue(prompt.contains("Tempo, backswing time over downswing time: 3.20"))
        XCTAssertTrue(prompt.contains("club face angle"))
        XCTAssertTrue(prompt.contains("Club: Driver"))
        let context = CoachPrompts.chatContext([(Date(), "Driver", nil, result)], tempoBand: analyzer.tempoBand)
        XCTAssertTrue(context.contains("| Driver |"))
    }
}
