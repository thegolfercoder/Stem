import SwiftUI
import SwingCore

/// The practice loop: one priority from the swings measured, one drill, a retest,
/// and a verdict on whether anything changed. The same rules as the desktop and
/// the browser, chosen by rules and never by a language model.
struct PracticeView: View {
    @EnvironmentObject private var practice: PracticeStore
    @EnvironmentObject private var history: HistoryStore
    @State private var confirmErase = false
    @State private var exported: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let rules = practice.rules {
                        if let plan = practice.log.activePlan {
                            PlanCard(plan: plan, rules: rules)
                        }
                        let latest = practice.log.swings.last?.id
                        PriorityCard(insight: practice.log.insight(rules, upTo: latest), swingId: latest,
                                     canStart: practice.log.activePlan == nil)
                    } else {
                        Text("The practice rules did not load with the model.").foregroundStyle(.red)
                    }
                    data
                }
                .padding()
            }
            .navigationTitle("Practice")
        }
    }

    private var data: some View {
        VStack(alignment: .leading, spacing: 8) {
            let kept = practice.log.swings.count
            Text("\(kept) clip\(kept == 1 ? "" : "s") kept on this iPhone, numbers only for the practice loop.")
                .font(.footnote).foregroundStyle(Theme.faint)
            // Analysed swings are removed from History; refused clips have no entry
            // there, so they are removed here.
            let refused = practice.log.swings.filter { !$0.ok }.reversed()
            if !refused.isEmpty {
                DisclosureGroup("Refused clips kept (\(refused.count))") {
                    ForEach(Array(refused)) { swing in
                        HStack {
                            Text("Swing \(swing.id): \(swing.refusal ?? "refused")")
                                .font(.caption).lineLimit(2)
                            Spacer()
                            Button("Remove", role: .destructive) { practice.remove(swing.id) }
                        }
                    }
                }
                .font(.footnote)
            }
            HStack {
                Button("Export") { exported = practice.exportFile() }
                if let exported {
                    ShareLink(item: exported) { Label("Share the export", systemImage: "square.and.arrow.up") }
                }
                Spacer()
                Button("Erase everything", role: .destructive) { confirmErase = true }
            }
            .buttonStyle(.bordered)
        }
        .confirmationDialog("Erase every swing, picture and plan on this iPhone?", isPresented: $confirmErase,
                            titleVisibility: .visible) {
            Button("Erase everything", role: .destructive) {
                practice.eraseAll()
                history.eraseAll()
                exported = nil
            }
        } message: {
            Text("This cannot be undone.")
        }
    }
}

/// How a stored value reads: two decimals from 1 up, three below.
func practiceReading(_ x: Double?) -> String {
    guard let x else { return "no reading" }
    return String(format: abs(x) >= 1 ? "%.2f" : "%.3f", x)
}

private func signed(_ x: Double) -> String { (x >= 0 ? "+" : "") + formatG3(x) }

let practiceMetricNames = [
    "tempo_ratio": "tempo", "head_movement": "head movement", "pelvis_sway": "pelvis sway",
    "shoulder_turn_foreshortened": "shoulder turn", "detection_rate": "body found",
]

struct Card<Content: View>: View {
    var eyebrow: String
    var tint: Color? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow).font(.caption).foregroundStyle(Theme.faint).textCase(.uppercase)
            content
        }
        .padding().frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint ?? .clear))
    }
}

struct DrillSteps: View {
    let drill: Drill

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(drill.title).font(.headline)
            ForEach(Array(drill.steps.enumerated()), id: \.offset) { index, step in
                Text("\(index + 1). \(step)").font(.subheadline)
            }
            Text("\(drill.reps). \(drill.whatCounts)").font(.footnote).foregroundStyle(Theme.faint)
        }
    }
}

/// The one thing to work on, with its evidence, limits and drill.
struct PriorityCard: View {
    let insight: Insight
    let swingId: Int?
    var canStart = true
    @EnvironmentObject private var practice: PracticeStore

    var body: some View {
        Card(eyebrow: swingId.map { "The priority after swing \($0) · confidence: \(insight.confidence)" }
             ?? "The priority") {
            Text(insight.title).font(.title3.bold())
            Text(insight.summary).font(.subheadline)
            ForEach(Array(insight.evidence.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline) {
                    Text(item.label).font(.footnote)
                    Text(item.value).font(.footnote.bold().monospacedDigit())
                    Text(item.provenance.uppercased()).font(.caption2).foregroundStyle(Theme.faint)
                }
            }
            if let drill = insight.drill { DrillSteps(drill: drill).padding(.top, 4) }
            Text("Retest: \(insight.retest) What counts: \(insight.success)").font(.footnote)
            if !insight.limitations.isEmpty {
                Text("What this cannot tell").font(.caption.bold()).foregroundStyle(Theme.faint)
                ForEach(insight.limitations, id: \.self) { Text("• " + $0).font(.caption).foregroundStyle(Theme.faint) }
            }
            if canStart {
                if let drill = insight.drill {
                    Button("Start this drill as a plan") { practice.startPlan(focus: drill.focus, from: swingId) }
                        .buttonStyle(.borderedProminent)
                }
                if !insight.choices.isEmpty {
                    Text("Choose a focus").font(.caption.bold()).foregroundStyle(Theme.faint)
                    ForEach(insight.choices, id: \.self) { choice in
                        Button(choice[1]) { practice.startPlan(focus: choice[0], from: swingId) }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}

/// The running plan: its swings, and whether the retest shows a change.
struct PlanCard: View {
    let plan: PracticePlan
    let rules: PracticeRules
    @EnvironmentObject private var practice: PracticeStore

    private static let verdictTitles = [
        "improved": "Yes: it moved the way the drill aims",
        "worsened": "It moved, the opposite way to the drill",
        "no_detectable_change": "No change the swings can show yet",
        "not_comparable": "These swings cannot be compared",
        "not_enough_swings": "Not enough swings to tell yet",
    ]

    var body: some View {
        let drill = rules.drill(id: plan.drillId)
        VStack(alignment: .leading, spacing: 12) {
            Card(eyebrow: "Your plan, started " + plan.createdAt.formatted(date: .abbreviated, time: .omitted)
                 + (plan.club.map { " · \($0)" } ?? "")) {
                Text(drill?.title ?? plan.focus).font(.title3.bold())
                Text("Measured by \(practiceMetricNames[plan.metric] ?? plan.metric), aiming to \(plan.direction) it. "
                     + "Analyse clips with \"Count as a retest swing\" on to add to it.")
                    .font(.subheadline)
                values("Before the drill", plan.baseline)
                values("Retest swings", plan.retest)
                HStack {
                    Button("Finish plan") { practice.closePlan("completed") }
                    Button("Stop", role: .destructive) { practice.closePlan("abandoned") }
                }
                .buttonStyle(.bordered)
            }
            if drill?.focus == "capture" {
                let progress = practice.log.captureProgress(plan)
                Card(eyebrow: "Is it working?", tint: progress.cleanInARow >= 3 ? Theme.good : nil) {
                    Text(progress.cleanInARow >= 3 ? "Done: three clean recordings in a row"
                         : "\(progress.cleanInARow) of 3 clean recordings in a row").font(.headline)
                    Text("\(progress.recorded) retest swing(s) recorded for this plan.").font(.subheadline)
                }
            } else if let change = practice.log.change(rules, plan: plan) {
                verdict(change)
            }
            if let drill { Card(eyebrow: "The drill") { DrillSteps(drill: drill) } }
        }
    }

    private func values(_ title: String, _ ids: [Int]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if !ids.isEmpty {
                Text(title).font(.caption.bold()).foregroundStyle(Theme.faint)
                ForEach(ids, id: \.self) { id in
                    let swing = practice.log.swing(id)
                    Text("Swing \(id): " + (swing.map { $0.ok ? practiceReading($0.metrics[plan.metric]) : "refused" }
                                            ?? "deleted"))
                        .font(.footnote.monospacedDigit())
                }
            }
        }
    }

    private func verdict(_ change: Change) -> some View {
        Card(eyebrow: "Is it working?",
             tint: change.verdict == "improved" ? Theme.good
                 : ["worsened", "not_comparable"].contains(change.verdict) ? Theme.warm : nil) {
            Text(Self.verdictTitles[change.verdict] ?? change.verdict).font(.headline)
            Text(change.explanation).font(.subheadline)
            if let difference = change.difference, let interval = change.interval {
                HStack(spacing: 16) {
                    VStack(alignment: .leading) {
                        Text("Before (\(change.nBefore))").font(.caption).foregroundStyle(Theme.faint)
                        Text(practiceReading(change.meanBefore)).font(.title3.bold().monospacedDigit())
                    }
                    VStack(alignment: .leading) {
                        Text("After (\(change.nAfter))").font(.caption).foregroundStyle(Theme.faint)
                        Text(practiceReading(change.meanAfter)).font(.title3.bold().monospacedDigit())
                    }
                    VStack(alignment: .leading) {
                        Text("Change, 95%").font(.caption).foregroundStyle(Theme.faint)
                        Text(signed(difference)).font(.title3.bold().monospacedDigit())
                        Text("\(signed(interval[0])) to \(signed(interval[1]))").font(.caption2.monospacedDigit())
                    }
                }
            }
            ForEach(change.comparability.blocking, id: \.self) { Text("• " + $0).font(.footnote) }
            ForEach(change.comparability.warnings, id: \.self) {
                Text("• " + $0).font(.footnote).foregroundStyle(Theme.faint)
            }
        }
    }
}
