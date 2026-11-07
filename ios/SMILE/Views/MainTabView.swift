import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var api: APIClient
    let user: User

    @State private var selectedTab: AppTab = .schulalltag
    @State private var activeTimeoutCount: Int = 0
    @State private var showAccountSheet = false

    enum AppTab: Hashable {
        case schulalltag
        case lernwerkstatt
        case statistik
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
        }
        .sheet(isPresented: $showAccountSheet) {
            AccountSheetView(user: user)
                .environmentObject(api)
        }
        .task {
            await refreshActiveBadge()
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
                    LabeledContent("Server", value: api.baseURL)
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
        .presentationDetents([.medium])
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
