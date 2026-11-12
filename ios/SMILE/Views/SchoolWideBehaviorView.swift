import SwiftUI

/// School-wide behaviour board ("Alle Klassen").
///
/// Mirrors the web surface: one row per active pupil with the five quick actions,
/// a class selector at the top and live totals for the selected class. It polls
/// every 30 seconds so cards issued on the web or by colleagues appear without a
/// manual refresh.
struct SchoolWideBehaviorView: View {
    @EnvironmentObject var api: APIClient

    @State private var overview: BehaviorOverview?
    @State private var selectedClassId: Int?
    @State private var searchQuery = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var lastUpdated: Date?
    @State private var pendingAction: SchulalltagView.PendingPupilAction?

    private var scopedPupils: [BehaviorOverviewPupil] {
        (overview?.pupils ?? []).filter { selectedClassId == nil || $0.classId == selectedClassId }
    }

    private var visiblePupils: [BehaviorOverviewPupil] {
        guard !searchQuery.isEmpty else { return scopedPupils }
        return scopedPupils.filter { $0.fullName.localizedCaseInsensitiveContains(searchQuery) }
    }

    private var classCounts: [Int: Int] {
        Dictionary(grouping: overview?.pupils ?? [], by: \.classId).mapValues { $0.count }
    }

    private var summary: BehaviorOverviewCounts {
        var green = 0
        var yellow = 0
        var red = 0
        var timeout = 0
        var cooldown = 0
        for pupil in scopedPupils {
            green += pupil.counts.green
            yellow += pupil.counts.yellow
            red += pupil.counts.red
            timeout += pupil.counts.timeout
            cooldown += pupil.counts.cooldown
        }
        return BehaviorOverviewCounts(
            green: green,
            yellow: yellow,
            red: red,
            timeout: timeout,
            cooldown: cooldown
        )
    }

    private var summaryLine: String {
        if let id = selectedClassId,
           let cls = (overview?.classes ?? []).first(where: { $0.id == id }) {
            return "Klasse \(cls.name) · \(visiblePupils.count) von \(scopedPupils.count) Schüler*innen"
        }
        return "\(visiblePupils.count) von \(overview?.pupils.count ?? 0) Schüler*innen"
    }

    private var lastUpdateText: String {
        guard let updated = lastUpdated else { return "–" }
        return updated.formatted(date: .omitted, time: .shortened)
    }

    var body: some View {
        VStack(spacing: 0) {
            controls

            if let error = errorMessage {
                errorBanner(error)
            }

            content
        }
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
        .navigationTitle("Alle Klassen")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchQuery, prompt: "Schüler*in suchen…")
        .sheet(item: $pendingAction) { action in
            ActionConfirmSheet(
                action: action,
                classId: action.pupil.classId,
                onSuccess: { Task { await load(silently: true) } }
            )
            .environmentObject(api)
        }
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { break }
                await load(silently: true)
            }
        }
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    classChip(nil, title: "Alle", count: overview?.pupils.count ?? 0)
                    ForEach(overview?.classes ?? []) { cls in
                        classChip(cls.id, title: cls.name, count: classCounts[cls.id] ?? 0)
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    stat("Schüler*innen", scopedPupils.count, color: .gray)
                    stat("Grün", summary.green, color: .green)
                    stat("Gelb", summary.yellow, color: .yellow)
                    stat("Rot", summary.red, color: .red)
                    stat("Time-Out", summary.timeout, color: .orange)
                    stat("Cool-Down", summary.cooldown, color: .cyan)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(red: 0.05, green: 0.07, blue: 0.12))
    }

    private func classChip(_ id: Int?, title: String, count: Int) -> some View {
        let isSelected = selectedClassId == id
        return Button {
            Haptics.impact(.light)
            selectedClassId = id
        } label: {
            HStack(spacing: 6) {
                Text(title)
                    .font(.caption.weight(.bold))
                Text("\(count)")
                    .font(.caption2.weight(.semibold))
                    .opacity(0.75)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(
                isSelected ? Color.blue.opacity(0.30) : Color.white.opacity(0.06),
                in: Capsule()
            )
            .foregroundStyle(isSelected ? .white : .secondary)
        }
        .buttonStyle(.plain)
    }

    private func stat(_ label: String, _ value: Int, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text("\(value)")
                .font(.caption.weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - List

    @ViewBuilder
    private var content: some View {
        if isLoading && overview == nil {
            Spacer()
            ProgressView("Klassenübersicht wird geladen…")
            Spacer()
        } else if visiblePupils.isEmpty {
            ContentUnavailableView(
                "Keine Schüler*innen gefunden",
                systemImage: "person.slash",
                description: Text("Klassenauswahl oder Suche anpassen.")
            )
        } else {
            List {
                Section {
                    ForEach(visiblePupils) { pupil in
                        pupilRow(pupil)
                            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                            .listRowBackground(Color(red: 0.06, green: 0.08, blue: 0.13))
                    }
                } header: {
                    HStack {
                        Text(summaryLine)
                            .font(.caption.weight(.bold))
                        Spacer()
                        Text("Stand \(lastUpdateText)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable {
                await load(silently: true)
            }
        }
    }

    private func pupilRow(_ pupil: BehaviorOverviewPupil) -> some View {
        let rank = AssessmentRank(rawValue: pupil.rank ?? "") ?? .ausstehend
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(rank.color)
                    .frame(width: 5, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(pupil.fullName)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text("Klasse \(pupil.className)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(rank.rawValue)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(rank.color)
                        if let stage = pupil.stage {
                            Text(stageText(stage))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                if let incident = pupil.activeIncident {
                    Text(incident.isCooldown ? "❄️ Cool-Down" : "⏱️ Time-Out")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            (incident.isCooldown ? Color.cyan : Color.orange).opacity(0.2),
                            in: Capsule()
                        )
                        .foregroundStyle(incident.isCooldown ? .cyan : .orange)
                }
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    counters(for: pupil)
                    Spacer(minLength: 4)
                    actionButtons(for: pupil)
                }

                VStack(alignment: .leading, spacing: 6) {
                    counters(for: pupil)
                    HStack {
                        Spacer()
                        actionButtons(for: pupil)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func stageText(_ stage: BehaviorOverviewStage) -> String {
        let levelText = stage.level > 0 ? "+\(stage.level)" : "\(stage.level)"
        return "Stufe \(levelText)"
    }

    private func counters(for pupil: BehaviorOverviewPupil) -> some View {
        HStack(spacing: 4) {
            counterPill(pupil.counts.green, color: .green, icon: nil)
            counterPill(pupil.counts.yellow, color: .yellow, icon: nil)
            counterPill(pupil.counts.red, color: .red, icon: nil)
            counterPill(pupil.counts.timeout, color: .orange, icon: "clock.fill")
            counterPill(pupil.counts.cooldown, color: .cyan, icon: "snowflake")
        }
    }

    private func counterPill(_ count: Int, color: Color, icon: String?) -> some View {
        HStack(spacing: 3) {
            if let icon = icon {
                Image(systemName: icon)
                    .font(.system(size: 9, weight: .bold))
            } else {
                Circle()
                    .fill(count > 0 ? color : Color.gray.opacity(0.35))
                    .frame(width: 6, height: 6)
            }
            Text("\(count)")
                .font(.caption2.weight(.bold))
        }
        .foregroundStyle(count > 0 ? color : Color.gray.opacity(0.6))
        .frame(minWidth: 26, minHeight: 24)
        .padding(.horizontal, 4)
        .background(
            count > 0 ? color.opacity(0.16) : Color.white.opacity(0.03),
            in: RoundedRectangle(cornerRadius: 7)
        )
    }

    private func actionButtons(for pupil: BehaviorOverviewPupil) -> some View {
        HStack(spacing: 6) {
            actionButton("Grün", "hand.thumbsup.fill", .green, disabled: !pupil.canRecord) {
                Haptics.impact(.light)
                request(.green, for: pupil)
            }
            actionButton("Gelb", "exclamationmark.triangle.fill", .yellow, disabled: !pupil.canRecord) {
                Haptics.impact(.medium)
                request(.yellow, for: pupil)
            }
            actionButton("Rot", "octagon.fill", .red, disabled: !pupil.canRecord) {
                Haptics.impact(.heavy)
                request(.red, for: pupil)
            }
            actionButton(
                "Time-Out",
                "clock.arrow.circlepath",
                .orange,
                disabled: !pupil.canRecord || pupil.activeIncident != nil
            ) {
                Haptics.impact(.medium)
                request(.timeout, for: pupil)
            }
            actionButton(
                "Cool-Down",
                "snowflake",
                .cyan,
                disabled: !pupil.canRecord || pupil.activeIncident != nil
            ) {
                Haptics.impact(.light)
                request(.cooldown, for: pupil)
            }
        }
    }

    private func actionButton(
        _ title: String,
        _ icon: String,
        _ color: Color,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 8, weight: .bold))
                    .lineLimit(1)
            }
            .frame(width: 46, height: 36)
            .background(
                color.opacity(disabled ? 0.06 : 0.18),
                in: RoundedRectangle(cornerRadius: 9)
            )
            .foregroundStyle(disabled ? .gray : color)
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(color.opacity(disabled ? 0.1 : 0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func request(
        _ kind: SchulalltagView.PendingPupilAction.ActionKind,
        for pupil: BehaviorOverviewPupil
    ) {
        pendingAction = SchulalltagView.PendingPupilAction(
            pupil: PupilWithData(overviewPupil: pupil),
            kind: kind
        )
    }

    private func errorBanner(_ message: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.caption)
                .foregroundStyle(.red)
            Spacer()
            Button("Erneut") {
                Task { await load() }
            }
            .font(.caption.bold())
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.12))
    }

    // MARK: - Loading

    private func load(silently: Bool = false) async {
        if !silently {
            isLoading = true
        }
        do {
            let loaded = try await api.getBehaviorOverview()
            overview = loaded
            lastUpdated = Date()
            errorMessage = nil

            if let selected = selectedClassId,
               !loaded.classes.contains(where: { $0.id == selected }) {
                selectedClassId = nil
            }
        } catch {
            if !silently {
                errorMessage = error.localizedDescription
            }
        }
        if !silently {
            isLoading = false
        }
    }
}
