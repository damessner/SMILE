import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.scenePhase) private var scenePhase
    let user: User

    @State private var selectedTab: AppTab = .schulalltag
    @State private var activeTimeoutCount: Int = 0
    @State private var showAccountSheet = false
    @State private var showWhatsNew = false

    enum AppTab: Hashable {
        case schulalltag
        case bewertung
        case lernwerkstatt
        case statistik
        case alleKlassen
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                SchulalltagView(
                    user: user,
                    onActiveCountChanged: { count in activeTimeoutCount = count }
                )
                .toolbar { accountToolbarItem }
            }
            .tabItem {
                Label("Schulalltag", systemImage: "person.3.sequence.fill")
            }
            .tag(AppTab.schulalltag)

            NavigationStack {
                BewertungView()
                    .toolbar { accountToolbarItem }
            }
            .tabItem {
                Label("Bewertung", systemImage: "checklist")
            }
            .tag(AppTab.bewertung)

            NavigationStack {
                LernwerkstattView(
                    onActiveCountChanged: { count in activeTimeoutCount = count }
                )
                .toolbar { accountToolbarItem }
            }
            .tabItem {
                Label("Lernwerkstatt", systemImage: "clock.badge.exclamationmark")
            }
            .badge(activeTimeoutCount > 0 ? activeTimeoutCount : 0)
            .tag(AppTab.lernwerkstatt)

            NavigationStack {
                SchoolStatisticsView(user: user)
                    .toolbar { accountToolbarItem }
            }
            .tabItem {
                Label("Schulstatistik", systemImage: "chart.bar.xaxis")
            }
            .tag(AppTab.statistik)

            if user.schoolWideBehaviour == true {
                NavigationStack {
                    SchoolWideBehaviorView()
                        .toolbar { accountToolbarItem }
                }
                .tabItem {
                    Label("Alle Klassen", systemImage: "person.3.fill")
                }
                .tag(AppTab.alleKlassen)
            }
        }
        .safeAreaInset(edge: .top) {
            if user.viewAs == true {
                HStack(spacing: 8) {
                    Image(systemName: "eye.fill")
                    Text("Ansicht als \(user.actUsername ?? user.username) — schreibgeschützt.")
                        .font(.caption.weight(.semibold))
                    Spacer()
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.orange.opacity(0.30))
            }
        }
        .sheet(isPresented: $showAccountSheet) {
            AccountSheetView(user: user)
                .environmentObject(api)
        }
        .sheet(isPresented: $showWhatsNew) {
            WhatsNewSheet()
        }
        .task {
            if user.viewAs != true, !ReleaseNotesStore.hasSeen(username: user.username) {
                ReleaseNotesStore.markSeen(username: user.username)
                showWhatsNew = true
            }
            await refreshActiveBadge()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await refreshActiveBadge()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await refreshActiveBadge() }
            }
        }
    }

    @ToolbarContentBuilder
    private var accountToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showAccountSheet = true
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.blue.opacity(0.25))
                        .frame(width: 28, height: 28)
                        .overlay(
                            Text(user.shortBadge.prefix(3))
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.blue)
                        )
                    Text(user.shortBadge)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.primary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.white.opacity(0.06), in: Capsule())
            }
        }
    }

    private func refreshActiveBadge() async {
        if let active = try? await api.getActiveTimeouts() {
            activeTimeoutCount = active.count
        }
    }
}

struct AccountSheetView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let user: User

    var body: some View {
        NavigationStack {
            List {
                Section("Angemeldetes Konto") {
                    LabeledContent("Name", value: user.displayName)
                    LabeledContent("Kürzel / Login", value: user.shortBadge)
                    LabeledContent("Rolle", value: roleLabel(user.role))
                    LabeledContent("Server", value: api.isDemoMode ? "Demo-Modus (Offline)" : api.baseURL)
                }

                Section("Über SMILE") {
                    LabeledContent("App-Version", value: AppReleases.bundleVersion)
                    NavigationLink("Versionsverlauf") {
                        ReleaseHistoryList()
                            .navigationTitle("Versionsverlauf")
                            .navigationBarTitleDisplayMode(.inline)
                    }
                }

                Section("Sicherheit") {
                    if KeychainBiometricsService.hasSavedCredentials {
                        Button(role: .destructive) {
                            KeychainBiometricsService.clear()
                            Haptics.notify(.warning)
                        } label: {
                            Label("Gespeicherte Face ID / Touch ID Daten löschen", systemImage: "faceid")
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task {
                            await api.logout()
                            dismiss()
                        }
                    } label: {
                        HStack {
                            Spacer()
                            Label("Abmelden", systemImage: "rectangle.portrait.and.arrow.right")
                                .fontWeight(.bold)
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Konto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func roleLabel(_ role: String) -> String {
        switch role {
        case "admin": return "Administrator"
        case "head_teacher": return "Schulleitung"
        case "teacher": return "Lehrperson"
        default: return role
        }
    }
}
