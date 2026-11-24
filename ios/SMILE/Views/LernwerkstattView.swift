import SwiftUI

struct LernwerkstattView: View {
    @EnvironmentObject var api: APIClient
    var onActiveCountChanged: (Int) -> Void

    @State private var activeItems: [TimeoutIncident] = []
    @State private var historyItems: [TimeoutIncident] = []
    @State private var showHistory = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    @State private var resolvingItem: TimeoutIncident?
    @State private var resolutionNote = ""
    @State private var resolveError: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Ansicht", selection: $showHistory) {
                Text("Aktuell in der LW (\(activeItems.count))").tag(false)
                Text("Verlauf (\(historyItems.count))").tag(true)
            }
            .pickerStyle(.segmented)
            .padding()
            .background(Color(red: 0.05, green: 0.07, blue: 0.12))

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(8)
            }

            let items = showHistory ? historyItems : activeItems

            if isLoading && items.isEmpty {
                Spacer()
                ProgressView("Lernwerkstatt wird geladen…")
                Spacer()
            } else if items.isEmpty {
                ContentUnavailableView(
                    showHistory ? "Noch keine abgeschlossenen Einträge" : "Lernwerkstatt ist aktuell frei",
                    systemImage: showHistory ? "clock" : "checkmark.seal.fill",
                    description: Text(
                        showHistory
                            ? "Abgeschlossene Time-Outs und Cool-Downs erscheinen hier."
                            : "Momentan befindet sich kein*e Schüler*in im Time-Out oder Cool-Down."
                    )
                )
            } else {
                List {
                    ForEach(items) { item in
                        incidentRow(item)
                            .listRowBackground(Color(red: 0.06, green: 0.08, blue: 0.13))
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(red: 0.03, green: 0.04, blue: 0.07))
                .refreshable {
                    await loadData()
                }
            }
        }
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
        .navigationTitle("Lernwerkstatt")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $resolvingItem) { item in
            NavigationStack {
                Form {
                    Section("Schüler*in") {
                        LabeledContent("Name", value: item.pupil_name ?? "Schüler*in #\(item.pupil_id)")
                        LabeledContent("Klasse", value: item.class_name ?? "–")
                        LabeledContent("Art", value: item.isCooldown ? "❄️ Cool-Down" : "⏱️ Time-Out")
                    }

                    Section("Rückmeldung aus der Lernwerkstatt (optional)") {
                        TextField("z. B. Arbeitsauftrag ruhig erledigt…", text: $resolutionNote, axis: .vertical)
                            .lineLimit(3...5)
                    }

                    if let resolveError {
                        Section {
                            Text(resolveError)
                                .foregroundStyle(.red)
                                .font(.footnote)
                        }
                    }
                }
                .navigationTitle("Zurück in die Klasse")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Abbrechen") { resolvingItem = nil }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Abschließen") {
                            Task {
                                await completeResolve(item)
                            }
                        }
                        .fontWeight(.bold)
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .task {
            await loadData()
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { break }
                await loadData()
            }
        }
    }

    private func incidentRow(_ item: TimeoutIncident) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: item.isCooldown ? "snowflake" : "clock.fill")
                        .foregroundStyle(item.isCooldown ? .cyan : .orange)
                    Text(item.isCooldown ? "Cool-Down" : "Time-Out")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(item.isCooldown ? .cyan : .orange)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background((item.isCooldown ? Color.cyan : Color.orange).opacity(0.18), in: Capsule())

                if let clsName = item.class_name {
                    Text("Klasse \(clsName)")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.blue.opacity(0.2), in: Capsule())
                        .foregroundStyle(.blue)
                }

                Spacer()

                Text("von \(item.sent_by_short ?? "–")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(item.pupil_name ?? "Schüler*in #\(item.pupil_id)")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)

            if !item.task_assignment.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.isCooldown ? "Notiz:" : "Arbeitsauftrag:")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(item.task_assignment)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.9))
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            }

            HStack {
                Text(formatTimestamp(item.sent_at))
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Spacer()

                if item.status == "active" {
                    Button {
                        Haptics.impact(.medium)
                        resolutionNote = ""
                        resolveError = nil
                        resolvingItem = item
                    } label: {
                        Label("Abschließen", systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .controlSize(.small)
                } else if let resNote = item.resolution_note, !resNote.isEmpty {
                    Text("Rückmeldung: \(resNote)")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func loadData() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let activeReq = api.getActiveTimeouts()
            async let historyReq = try? api.getTimeoutHistory()

            let (active, history) = try await (activeReq, historyReq)
            self.activeItems = active
            self.historyItems = history ?? []
            onActiveCountChanged(active.count)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func completeResolve(_ item: TimeoutIncident) async {
        resolveError = nil
        do {
            try await api.resolveTimeout(id: item.id, resolutionNote: resolutionNote)
            Haptics.notify(.success)
            resolvingItem = nil
            await loadData()
        } catch {
            Haptics.notify(.error)
            // Keep the sheet open and show the reason inside it; the banner behind
            // the sheet is not visible while the modal is up.
            resolveError = error.localizedDescription
        }
    }

    private func formatTimestamp(_ iso: String) -> String {
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
