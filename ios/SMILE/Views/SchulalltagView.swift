import SwiftUI

struct SchulalltagView: View {
    @EnvironmentObject var api: APIClient
    let user: User
    var onActiveCountChanged: (Int) -> Void

    @State private var classes: [SchoolClass] = []
    @State private var selectedClassId: Int?
    @State private var pupils: [PupilWithData] = []
    @State private var classCards: [ClassCardItem] = []
    @State private var classTimeouts: [TimeoutIncident] = []
    @State private var timetable: TimetableResponse?

    @State private var searchQuery = ""
    @State private var selectedRankFilter: AssessmentRank? = nil
    @State private var isLoading = false
    @State private var errorMessage: String?

    @State private var pendingAction: PendingPupilAction?
    @State private var selectedPupilHistory: PupilWithData?

    struct PendingPupilAction: Identifiable {
        let id = UUID()
        let pupil: PupilWithData
        let kind: ActionKind

        enum ActionKind {
            case green
            case yellow
            case red
            case timeout
            case cooldown

            var title: String {
                switch self {
                case .green: return "Grüne Karte vergeben"
                case .yellow: return "Gelbe Karte vergeben"
                case .red: return "Rote Karte vergeben"
                case .timeout: return "Time-Out (Lernwerkstatt)"
                case .cooldown: return "Cool-Down (Beruhigungsphase)"
                }
            }

            var subtitle: String {
                switch self {
                case .green: return "Positive Anerkennung für besonderes Engagement oder Verhalten."
                case .yellow: return "Verwarnung im Unterricht (3 aktive Gelbe Karten = Rangabstufung)."
                case .red: return "Disziplinarkarte mit direkter Rangabstufung."
                case .timeout: return "Schüler*in mit Arbeitsauftrag in die Lernwerkstatt schicken."
                case .cooldown: return "Kurze Auszeit ohne Rangverlust oder Disziplinarfolge."
                }
            }

            var accentColor: Color {
                switch self {
                case .green: return .green
                case .yellow: return .yellow
                case .red: return .red
                case .timeout: return .orange
                case .cooldown: return .cyan
                }
            }
        }
    }

    private var currentClass: SchoolClass? {
        classes.first(where: { $0.id == selectedClassId })
    }

    private var displayedSubjectCode: String? {
        if let lesson = timetable?.currentLesson, lesson.classId == selectedClassId {
            return lesson.subjectCode
        }
        return nil
    }

    private var filteredPupils: [PupilWithData] {
        pupils.filter { p in
            let matchesSearch = searchQuery.isEmpty || p.fullName.localizedCaseInsensitiveContains(searchQuery)
            let matchesRank = selectedRankFilter == nil || p.effectiveRank(forSubject: displayedSubjectCode) == selectedRankFilter
            return matchesSearch && matchesRank
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Top Timetable & Class Controls
            headerBar

            if let error = errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button("Erneut") {
                        Task { await loadInitialData() }
                    }
                    .font(.caption.bold())
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.12))
            }

            if isLoading && pupils.isEmpty {
                Spacer()
                ProgressView("Schülerliste wird geladen…")
                Spacer()
            } else if filteredPupils.isEmpty {
                ContentUnavailableView(
                    "Keine Schüler*innen gefunden",
                    systemImage: "person.slash",
                    description: Text("Passen Sie die Suche oder den Rang-Filter an.")
                )
            } else {
                List {
                    Section {
                        ForEach(filteredPupils) { pupil in
                            pupilRow(for: pupil)
                                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                                .listRowBackground(Color(red: 0.06, green: 0.08, blue: 0.13))
                        }
                    } header: {
                        HStack {
                            Text("Klasse \(currentClass?.name ?? "") · \(filteredPupils.count) Schüler*innen")
                                .font(.caption.weight(.bold))
                            Spacer()
                            Text("Zähler links · Aktion rechts")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(red: 0.03, green: 0.04, blue: 0.07))
                .refreshable {
                    if let cid = selectedClassId {
                        await loadClassDetails(classId: cid)
                    }
                }
            }
        }
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
        .navigationTitle("Schulalltag")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchQuery, prompt: "Schüler*in suchen…")
        .sheet(item: $pendingAction) { action in
            if let cid = selectedClassId {
                ActionConfirmSheet(
                    action: action,
                    classId: cid,
                    onSuccess: {
                        Task { await loadClassDetails(classId: cid) }
                    }
                )
                .environmentObject(api)
            }
        }
        .sheet(item: $selectedPupilHistory) { pupil in
            PupilHistorySheet(
                pupil: pupil,
                cards: classCards.filter { $0.pupil_id == pupil.id && $0.card_type != "cooldown" },
                timeouts: classTimeouts.filter { $0.pupil_id == pupil.id },
                onRevokeCard: { cardId in
                    Task {
                        try? await api.revokeCard(cardId: cardId)
                        Haptics.notify(.success)
                        if let cid = selectedClassId {
                            await loadClassDetails(classId: cid)
                        }
                    }
                }
            )
        }
        .task {
            await loadInitialData()
        }
        .task {
            // Lightweight live refresh: another teacher's cards/time-outs appear
            // without leaving the class. Pull-to-refresh remains available.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { break }
                await refreshFromServer()
            }
        }
        .onChange(of: selectedClassId) { _, newId in
            if let cid = newId {
                Task { await loadClassDetails(classId: cid) }
            }
        }
    }

    // MARK: - Subviews

    private var headerBar: some View {
        VStack(spacing: 10) {
            // Current Lesson Banner
            if let lesson = timetable?.currentLesson {
                HStack(spacing: 10) {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(lesson.period). Stunde · Klasse \(lesson.className) · \(lesson.subjectCode)")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                        if let pInfo = timetable?.periodInfo {
                            Text("\(pInfo.start)–\(pInfo.end) Uhr\(lesson.room != nil ? " · Raum \(lesson.room!)" : "")")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if selectedClassId != lesson.classId {
                        Button("Zur Stunde") {
                            selectedClassId = lesson.classId
                        }
                        .font(.caption.weight(.bold))
                        .buttonStyle(.borderedProminent)
                        .controlSize(.mini)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.blue.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.blue.opacity(0.35), lineWidth: 1)
                )
            }

            // Class Picker & Rank Filters
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(classes) { cls in
                            Button {
                                selectedClassId = cls.id
                            } label: {
                                HStack {
                                    Text("Klasse \(cls.name)")
                                    if cls.id == selectedClassId {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "graduationcap.fill")
                            Text("Klasse \(currentClass?.name ?? "–")")
                                .fontWeight(.bold)
                            Image(systemName: "chevron.down")
                                .font(.caption2)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.blue.opacity(0.22), in: Capsule())
                        .foregroundStyle(.white)
                    }

                    Divider().frame(height: 20)

                    rankFilterChip(title: "Alle", rank: nil)
                    rankFilterChip(title: "Meister", rank: .meister)
                    rankFilterChip(title: "Geselle", rank: .geselle)
                    rankFilterChip(title: "Lehrling", rank: .lehrling)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(red: 0.05, green: 0.07, blue: 0.12))
    }

    private func rankFilterChip(title: String, rank: AssessmentRank?) -> some View {
        let isSelected = selectedRankFilter == rank
        return Button {
            Haptics.impact(.light)
            selectedRankFilter = isSelected ? nil : rank
        } label: {
            HStack(spacing: 5) {
                if let rank = rank {
                    Circle()
                        .fill(rank.color)
                        .frame(width: 7, height: 7)
                }
                Text(title)
                    .font(.caption.weight(.semibold))
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(isSelected ? Color.white.opacity(0.18) : Color.white.opacity(0.06), in: Capsule())
            .foregroundStyle(isSelected ? .white : .secondary)
        }
    }

    private func pupilRow(for pupil: PupilWithData) -> some View {
        let rank = pupil.effectiveRank(forSubject: displayedSubjectCode)
        let greenCount = classCards.filter { $0.pupil_id == pupil.id && $0.card_type == "green" }.count
        let yellowCount = classCards.filter { $0.pupil_id == pupil.id && $0.card_type == "yellow" }.count
        let redCount = classCards.filter { $0.pupil_id == pupil.id && $0.card_type == "red" }.count
        let timeoutCount = classTimeouts.filter { $0.pupil_id == pupil.id && !$0.isCooldown }.count
        let cooldownCount = classTimeouts.filter { $0.pupil_id == pupil.id && $0.isCooldown }.count
        let activeIncident = classTimeouts.first { $0.pupil_id == pupil.id && $0.status == "active" }

        return ViewThatFits(in: .horizontal) {
            // Wide layout (iPad / Landscape)
            HStack(spacing: 10) {
                pupilNameTile(pupil: pupil, rank: rank, activeIncident: activeIncident)
                Spacer(minLength: 4)
                countersBlock(green: greenCount, yellow: yellowCount, red: redCount, timeout: timeoutCount, cooldown: cooldownCount)
                actionButtonsBlock(for: pupil, activeIncident: activeIncident)
            }

            // Compact layout (iPhone Portrait)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    pupilNameTile(pupil: pupil, rank: rank, activeIncident: activeIncident)
                    Spacer()
                    countersBlock(green: greenCount, yellow: yellowCount, red: redCount, timeout: timeoutCount, cooldown: cooldownCount)
                }
                HStack {
                    Spacer()
                    actionButtonsBlock(for: pupil, activeIncident: activeIncident)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func pupilNameTile(pupil: PupilWithData, rank: AssessmentRank, activeIncident: TimeoutIncident?) -> some View {
        Button {
            selectedPupilHistory = pupil
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(rank.color)
                    .frame(width: 5, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text(pupil.fullName)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(rank.rawValue)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(rank.color)

                        if let active = activeIncident {
                            Text(active.isCooldown ? "❄️ Im Cool-Down" : "⏱️ Im Time-Out")
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background((active.isCooldown ? Color.cyan : Color.orange).opacity(0.2), in: Capsule())
                                .foregroundStyle(active.isCooldown ? .cyan : .orange)
                        }
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// Compact 5-counter block directly left of the 5 action buttons (🟢 🟡 🔴 ⏱️ ❄️)
    private func countersBlock(green: Int, yellow: Int, red: Int, timeout: Int, cooldown: Int) -> some View {
        HStack(spacing: 4) {
            counterPill(count: green, color: .green, icon: nil)
            counterPill(count: yellow, color: .yellow, icon: nil)
            counterPill(count: red, color: .red, icon: nil)
            counterPill(count: timeout, color: .orange, icon: "clock.fill")
            counterPill(count: cooldown, color: .cyan, icon: "snowflake")
        }
        .padding(4)
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.07), lineWidth: 1)
        )
    }

    private func counterPill(count: Int, color: Color, icon: String?) -> some View {
        HStack(spacing: 3) {
            if let icon = icon {
                Image(systemName: icon)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(count > 0 ? color : .secondary.opacity(0.5))
            } else {
                Circle()
                    .fill(count > 0 ? color : Color.gray.opacity(0.35))
                    .frame(width: 6, height: 6)
            }
            Text("\(count)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(count > 0 ? color : .secondary.opacity(0.6))
        }
        .frame(minWidth: 28, minHeight: 26)
        .padding(.horizontal, 4)
        .background(
            count > 0 ? color.opacity(0.16) : Color.white.opacity(0.03),
            in: RoundedRectangle(cornerRadius: 7)
        )
    }

    private func actionButtonsBlock(for pupil: PupilWithData, activeIncident: TimeoutIncident?) -> some View {
        HStack(spacing: 6) {
            cardActionButton(title: "Grün", color: .green, icon: "hand.thumbsup.fill") {
                Haptics.impact(.light)
                pendingAction = PendingPupilAction(pupil: pupil, kind: .green)
            }

            cardActionButton(title: "Gelb", color: .yellow, icon: "exclamationmark.triangle.fill") {
                Haptics.impact(.medium)
                pendingAction = PendingPupilAction(pupil: pupil, kind: .yellow)
            }

            cardActionButton(title: "Rot", color: .red, icon: "octagon.fill") {
                Haptics.impact(.heavy)
                pendingAction = PendingPupilAction(pupil: pupil, kind: .red)
            }

            cardActionButton(
                title: "Time-Out",
                color: .orange,
                icon: "clock.arrow.circlepath",
                disabled: activeIncident != nil
            ) {
                Haptics.impact(.medium)
                pendingAction = PendingPupilAction(pupil: pupil, kind: .timeout)
            }

            cardActionButton(
                title: "Cool-Down",
                color: .cyan,
                icon: "snowflake",
                disabled: activeIncident != nil
            ) {
                Haptics.impact(.light)
                pendingAction = PendingPupilAction(pupil: pupil, kind: .cooldown)
            }
        }
    }

    private func cardActionButton(
        title: String,
        color: Color,
        icon: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                Text(title)
                    .font(.system(size: 9, weight: .bold))
                    .lineLimit(1)
            }
            .frame(width: 48, height: 38)
            .background(color.opacity(disabled ? 0.06 : 0.18), in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(disabled ? .gray : color)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(color.opacity(disabled ? 0.1 : 0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    // MARK: - Data Loading

    private func loadInitialData() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let classesReq = api.getClasses()
            async let timetableReq = try? api.getCurrentTimetable()
            async let activeReq = try? api.getActiveTimeouts()

            let loadedClasses = try await classesReq
            let loadedTimetable = await timetableReq
            let activeTimeouts = await activeReq

            self.classes = loadedClasses.filter { $0.id != 999 }
            self.timetable = loadedTimetable
            if let active = activeTimeouts {
                onActiveCountChanged(active.count)
            }

            // Default to the teacher's current lesson class if available
            if let lessonClassId = loadedTimetable?.currentLesson?.classId,
               self.classes.contains(where: { $0.id == lessonClassId }) {
                self.selectedClassId = lessonClassId
            } else if selectedClassId == nil {
                self.selectedClassId = self.classes.first?.id
            }

            if let cid = self.selectedClassId {
                await loadClassDetails(classId: cid)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadClassDetails(classId: Int) async {
        do {
            async let pupilsRes = api.getClassPupils(classId: classId)
            async let cardsRes = api.getClassCards(classId: classId)
            async let timeoutsRes = api.getClassTimeouts(classId: classId)
            async let activeRes = try? api.getActiveTimeouts()

            let (pData, cData, tData, activeData) = try await (pupilsRes, cardsRes, timeoutsRes, activeRes)
            self.pupils = pData.pupils
            self.classCards = cData
            self.classTimeouts = tData
            if let active = activeData {
                onActiveCountChanged(active.count)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Refresh the timetable, the Lernwerkstatt badge and the open class without
    /// showing the full-screen loading state.
    private func refreshFromServer() async {
        async let timetableReq = try? api.getCurrentTimetable()
        async let activeReq = try? api.getActiveTimeouts()

        self.timetable = await timetableReq
        if let active = await activeReq {
            onActiveCountChanged(active.count)
        }
        if let cid = selectedClassId {
            await loadClassDetails(classId: cid)
        }
    }
}

// MARK: - Action Confirmation Sheet (Card / Time-Out / Cool-Down)

struct ActionConfirmSheet: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    let action: SchulalltagView.PendingPupilAction
    let classId: Int
    let onSuccess: () -> Void

    @State private var note = ""
    @State private var isRetroactive = false
    @State private var retroactiveDate = Date()
    @State private var retroactivePeriod = 1
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(action.kind.accentColor.opacity(0.2))
                            .frame(width: 44, height: 44)
                            .overlay(
                                Image(systemName: "person.fill")
                                    .foregroundStyle(action.kind.accentColor)
                            )
                        VStack(alignment: .leading, spacing: 3) {
                            Text(action.pupil.fullName)
                                .font(.headline)
                            Text(action.kind.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }

                Section(action.kind == .timeout ? "Arbeitsauftrag für die Lernwerkstatt (Pflichtfeld)" : "Notiz / Begründung (optional)") {
                    TextField(
                        action.kind == .timeout
                            ? "z. B. Buch S. 42 Nr. 1–4 fertigstellen"
                            : "Kurze Notiz zum Vorfall…",
                        text: $note,
                        axis: .vertical
                    )
                    .lineLimit(3...5)
                }

                if action.kind == .timeout {
                    Section("Zeitpunkt") {
                        Toggle("Nachtrag für vergangene Stunde", isOn: $isRetroactive)
                        if isRetroactive {
                            DatePicker(
                                "Datum",
                                selection: $retroactiveDate,
                                in: Calendar.current.date(byAdding: .day, value: -6, to: Date())!...Date(),
                                displayedComponents: .date
                            )
                            Picker("Unterrichtsstunde", selection: $retroactivePeriod) {
                                ForEach(1...10, id: \.self) { p in
                                    Text("\(p). Stunde").tag(p)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(action.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") {
                        Task { await submit() }
                    }
                    .fontWeight(.bold)
                    .disabled(isSubmitting || (action.kind == .timeout && note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            switch action.kind {
            case .green:
                try await api.issueCard(pupilId: action.pupil.id, classId: classId, cardType: "green", note: note)
            case .yellow:
                try await api.issueCard(pupilId: action.pupil.id, classId: classId, cardType: "yellow", note: note)
            case .red:
                try await api.issueCard(pupilId: action.pupil.id, classId: classId, cardType: "red", note: note)
            case .timeout:
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd"
                let dateKey = isRetroactive ? formatter.string(from: retroactiveDate) : nil
                let periodVal = isRetroactive ? retroactivePeriod : nil
                try await api.sendToTimeout(
                    pupilId: action.pupil.id,
                    classId: classId,
                    taskAssignment: note.trimmingCharacters(in: .whitespacesAndNewlines),
                    retroactiveDate: dateKey,
                    retroactivePeriod: periodVal
                )
            case .cooldown:
                try await api.sendToCooldown(pupilId: action.pupil.id, classId: classId, note: note)
            }
            Haptics.notify(.success)
            onSuccess()
            dismiss()
        } catch {
            Haptics.notify(.error)
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Pupil Card & Timeout History Sheet

struct PupilHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    let pupil: PupilWithData
    let cards: [ClassCardItem]
    let timeouts: [TimeoutIncident]
    let onRevokeCard: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Karten (\(cards.count))") {
                    if cards.isEmpty {
                        Text("Noch keine Karten vergeben.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(cards) { card in
                            HStack(alignment: .top, spacing: 10) {
                                Circle()
                                    .fill(cardColor(card.card_type))
                                    .frame(width: 10, height: 10)
                                    .padding(.top, 5)

                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(cardLabel(card.card_type))
                                            .font(.subheadline.weight(.bold))
                                        Spacer()
                                        Text(card.teacher_short ?? "")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                    }
                                    if let note = card.note, !note.isEmpty {
                                        Text(note)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(formatISO(card.created_at))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    onRevokeCard(card.id)
                                    dismiss()
                                } label: {
                                    Label("Widerrufen", systemImage: "arrow.uturn.backward")
                                }
                            }
                        }
                    }
                }

                Section("Lernwerkstatt: Time-Out & Cool-Down (\(timeouts.count))") {
                    if timeouts.isEmpty {
                        Text("Keine Lernwerkstatt-Einträge.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(timeouts) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(item.isCooldown ? "❄️ Cool-Down" : "⏱️ Time-Out")
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(item.isCooldown ? .cyan : .orange)
                                    Spacer()
                                    Text(item.status == "active" ? "Aktiv" : "Erledigt")
                                        .font(.caption2.weight(.bold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(
                                            (item.status == "active" ? Color.orange : Color.green).opacity(0.2),
                                            in: Capsule()
                                        )
                                }
                                if !item.task_assignment.isEmpty {
                                    Text(item.task_assignment)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text("\(item.sent_by_short ?? "") · \(formatISO(item.sent_at))")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
            .navigationTitle(pupil.fullName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
    }

    private func cardColor(_ type: String) -> Color {
        switch type {
        case "green": return .green
        case "yellow": return .yellow
        case "red": return .red
        default: return .cyan
        }
    }

    private func cardLabel(_ type: String) -> String {
        switch type {
        case "green": return "Grüne Karte"
        case "yellow": return "Gelbe Karte"
        case "red": return "Rote Karte"
        default: return "Cool-Down"
        }
    }

    private func formatISO(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) {
            let out = DateFormatter()
            out.locale = Locale(identifier: "de_AT")
            out.dateStyle = .short
            out.timeStyle = .short
            return out.string(from: date)
        }
        return String(iso.prefix(16))
    }
}
