import SwiftUI

/// Native Bewertung/Einstufung for one class and subject.
///
/// The web grid with all 18 rubric criteria stays on the web for the conference
/// preparation. This view covers the part teachers need every day: propose one of
/// the three ranks per pupil, submit the ballot, and reopen it before the deadline.
struct BewertungView: View {
    @EnvironmentObject var api: APIClient

    @State private var classes: [SchoolClass] = []
    @State private var selectedClassId: Int?
    @State private var selectedSubjectCode: String?
    @State private var pupils: [PupilWithData] = []
    @State private var subjects: [SubjectAssignment] = []
    @State private var canRate = false
    @State private var isLockedByConference = false
    @State private var submissionDeadline: Date?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var busyPupilId: Int?

    private var currentClass: SchoolClass? {
        classes.first(where: { $0.id == selectedClassId })
    }

    private var deadlinePassed: Bool {
        guard let submissionDeadline else { return false }
        return submissionDeadline < Date()
    }

    private var writable: Bool {
        canRate && !isLockedByConference && !deadlinePassed
    }

    private var submittedCount: Int {
        pupils.filter { subjectEvaluation(for: $0)?.isSubmitted == true }.count
    }

    private var deadlineText: String? {
        guard let submissionDeadline else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_AT")
        formatter.dateStyle = .short
        return "Frist \(formatter.string(from: submissionDeadline))"
    }

    var body: some View {
        VStack(spacing: 0) {
            if !classes.isEmpty {
                controls
            }

            if let error = errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button("Erneut") {
                        if let cid = selectedClassId {
                            Task { await loadClass(classId: cid) }
                        } else {
                            Task { await loadClasses() }
                        }
                    }
                    .font(.caption.bold())
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.12))
            }

            rosterContent
        }
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
        .navigationTitle("Bewertung")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadClasses()
        }
        .onChange(of: selectedClassId) { _, newValue in
            if let cid = newValue {
                Task { await loadClass(classId: cid) }
            }
        }
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
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

            if !subjects.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(subjects, id: \.code) { subject in
                            subjectChip(subject)
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                if isLockedByConference {
                    Label("Konferenz gesperrt", systemImage: "lock.fill")
                        .foregroundStyle(.orange)
                }
                if deadlinePassed {
                    Label("Frist abgelaufen", systemImage: "clock.badge.xmark")
                        .foregroundStyle(.red)
                }
                if let statusMessage {
                    Text(statusMessage)
                        .foregroundStyle(.secondary)
                }
            }
            .font(.caption2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(red: 0.05, green: 0.07, blue: 0.12))
    }

    private func subjectChip(_ subject: SubjectAssignment) -> some View {
        let isSelected = subject.code == selectedSubjectCode
        return Button {
            Haptics.impact(.light)
            selectedSubjectCode = subject.code
        } label: {
            Text("\(subject.name) (\(subject.code))")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    isSelected ? Color.white.opacity(0.20) : Color.white.opacity(0.06),
                    in: Capsule()
                )
                .foregroundStyle(isSelected ? .white : .secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Roster

    @ViewBuilder
    private var rosterContent: some View {
        if isLoading && pupils.isEmpty {
            Spacer()
            ProgressView("Bewertung wird geladen…")
            Spacer()
        } else if classes.isEmpty && !isLoading {
            ContentUnavailableView(
                "Keine Klassen freigeschaltet",
                systemImage: "person.3",
                description: Text("Für dieses Konto sind keine Klassen sichtbar.")
            )
        } else if pupils.isEmpty {
            ContentUnavailableView(
                "Keine Schüler*innen",
                systemImage: "person.slash",
                description: Text("Die Klasse hat keine aktiven Schüler*innen.")
            )
        } else if !canRate {
            ContentUnavailableView(
                "Keine Bewertungsrechte",
                systemImage: "lock.fill",
                description: Text("Sie dürfen in dieser Klasse nicht bewerten.")
            )
        } else if subjects.isEmpty {
            ContentUnavailableView(
                "Kein Fach zugewiesen",
                systemImage: "book.closed",
                description: Text("Für diese Klasse ist kein bewertbares Fach hinterlegt.")
            )
        } else {
            List {
                Section {
                    ForEach(pupils) { pupil in
                        pupilRow(pupil)
                            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                            .listRowBackground(Color(red: 0.06, green: 0.08, blue: 0.13))
                    }
                } header: {
                    HStack {
                        Text("\(submittedCount)/\(pupils.count) abgegeben")
                            .font(.caption.weight(.bold))
                        Spacer()
                        if let deadlineText {
                            Text(deadlineText)
                                .font(.caption2)
                                .foregroundStyle(deadlinePassed ? .red : .secondary)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable {
                if let cid = selectedClassId {
                    await loadClass(classId: cid, keepSubject: true)
                }
            }
        }
    }

    private func pupilRow(_ pupil: PupilWithData) -> some View {
        let evaluation = subjectEvaluation(for: pupil)
        let isSubmitted = evaluation?.isSubmitted == true
        let rank = currentRank(for: pupil)
        let isBusy = busyPupilId == pupil.id

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(pupil.fullName)
                    .font(.subheadline.weight(.bold))
                    .lineLimit(1)
                if isSubmitted {
                    Label("Abgegeben", systemImage: "checkmark.seal.fill")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.green)
                }
                Spacer()
                if isBusy {
                    ProgressView()
                        .controlSize(.mini)
                }
            }

            HStack(spacing: 6) {
                ForEach(
                    [AssessmentRank.lehrling, AssessmentRank.geselle, AssessmentRank.meister],
                    id: \.self
                ) { option in
                    rankButton(
                        option,
                        isSelected: rank == option,
                        disabled: !writable || isSubmitted
                    ) {
                        Task { await setRank(option, for: pupil) }
                    }
                }

                Spacer(minLength: 4)

                if isSubmitted {
                    Button("Zurückziehen") {
                        Task { await reopen(pupil) }
                    }
                    .font(.caption2.weight(.bold))
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(.orange)
                    .disabled(isBusy || !writable)
                } else {
                    Button("Abgeben") {
                        Task { await submit(pupil) }
                    }
                    .font(.caption2.weight(.bold))
                    .buttonStyle(.borderedProminent)
                    .controlSize(.mini)
                    .disabled(rank == nil || !writable || isBusy)
                }
            }

            if let comment = evaluation?.comment, !comment.isEmpty {
                Text(comment)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }

    private func rankButton(
        _ rank: AssessmentRank,
        isSelected: Bool,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Circle()
                    .fill(rank.color)
                    .frame(width: 7, height: 7)
                Text(rank.rawValue)
                    .font(.caption2.weight(.bold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                isSelected ? rank.color.opacity(0.28) : Color.white.opacity(0.06),
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .stroke(isSelected ? rank.color.opacity(0.75) : Color.clear, lineWidth: 1)
            )
            .foregroundStyle(disabled ? Color.secondary : rank.color)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    // MARK: - Data

    private func subjectEvaluation(for pupil: PupilWithData) -> Evaluation? {
        guard let code = selectedSubjectCode else { return nil }
        return pupil.evaluations?.first {
            $0.subjectCode.caseInsensitiveCompare(code) == .orderedSame
        }
    }

    private func currentRank(for pupil: PupilWithData) -> AssessmentRank? {
        guard let status = subjectEvaluation(for: pupil)?.proposedStatus,
              let rank = AssessmentRank(rawValue: status) else {
            return nil
        }
        return rank
    }

    private func setRank(_ rank: AssessmentRank, for pupil: PupilWithData) async {
        guard let cid = selectedClassId, let subject = selectedSubjectCode, writable else { return }

        busyPupilId = pupil.id
        errorMessage = nil
        do {
            try await api.saveProposedRank(
                pupilId: pupil.id,
                classId: cid,
                subjectCode: subject,
                rank: rank.rawValue
            )
            Haptics.impact(.light)
            await loadClass(classId: cid, keepSubject: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.notify(.error)
        }
        busyPupilId = nil
    }

    private func submit(_ pupil: PupilWithData) async {
        guard let cid = selectedClassId,
              let subject = selectedSubjectCode,
              let rank = currentRank(for: pupil),
              writable else {
            return
        }

        busyPupilId = pupil.id
        errorMessage = nil
        do {
            try await api.submitEvaluation(
                pupilId: pupil.id,
                classId: cid,
                subjectCode: subject,
                rank: rank.rawValue
            )
            Haptics.notify(.success)
            await loadClass(classId: cid, keepSubject: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.notify(.error)
        }
        busyPupilId = nil
    }

    private func reopen(_ pupil: PupilWithData) async {
        guard let cid = selectedClassId, let subject = selectedSubjectCode, writable else { return }

        busyPupilId = pupil.id
        errorMessage = nil
        do {
            try await api.reopenEvaluation(
                pupilId: pupil.id,
                classId: cid,
                subjectCode: subject
            )
            Haptics.impact(.medium)
            await loadClass(classId: cid, keepSubject: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.notify(.error)
        }
        busyPupilId = nil
    }

    private func loadClasses() async {
        isLoading = true
        errorMessage = nil
        do {
            let loaded = try await api.getClasses()
            classes = loaded.filter { $0.id != 999 }
            if selectedClassId == nil {
                selectedClassId = classes.first?.id
            }
            if let cid = selectedClassId {
                await loadClass(classId: cid)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func loadClass(classId: Int, keepSubject: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await api.getClassPupils(classId: classId)
            pupils = response.pupils
            canRate = response.canRate == true
            isLockedByConference = response.isLockedByConference == true
            submissionDeadline = parseISO(response.submissionDeadline)

            let loadedSubjects = response.mySubjects
                ?? classes.first(where: { $0.id == classId })?.mySubjects
                ?? []
            subjects = loadedSubjects

            if keepSubject,
               let code = selectedSubjectCode,
               loadedSubjects.contains(where: { $0.code == code }) {
                // Keep the subject the teacher was looking at.
            } else {
                selectedSubjectCode = loadedSubjects.first?.code
            }

            statusMessage = response.isLockedByConference == true
                ? "Die Klassenkonferenz ist gesperrt."
                : nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func parseISO(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
