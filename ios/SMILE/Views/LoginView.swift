import SwiftUI

struct LoginView: View {
    @EnvironmentObject var api: APIClient

    @State private var username = ""
    @State private var password = ""
    @State private var rememberBiometrics = true
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showServerSettings = false
    @State private var customURL = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.03, green: 0.04, blue: 0.07)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // Brand Header
                        VStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .fill(
                                        LinearGradient(
                                            colors: [
                                                Color(red: 0.23, green: 0.51, blue: 0.96),
                                                Color(red: 0.12, green: 0.35, blue: 0.80)
                                            ],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(width: 76, height: 76)
                                    .shadow(color: .blue.opacity(0.35), radius: 16, y: 8)

                                Image(systemName: "sparkles")
                                    .font(.system(size: 34, weight: .bold))
                                    .foregroundStyle(.white)
                            }

                            Text("SMILE")
                                .font(.system(size: 32, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)

                            Text("Mittelschule Telfs · Schulalltag & Statistik")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 36)

                        // Login Card
                        VStack(spacing: 18) {
                            if let error = errorMessage {
                                HStack(spacing: 10) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundStyle(.red)
                                    Text(error)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(.red)
                                    Spacer()
                                }
                                .padding(12)
                                .background(Color.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                Text("Benutzername / Kürzel")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)

                                TextField("z. B. mes oder Lehrerkürzel", text: $username)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textContentType(.username)
                                    .padding(14)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                    )
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                Text("Passwort")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)

                                SecureField("Passwort eingeben", text: $password)
                                    .textContentType(.password)
                                    .padding(14)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                    )
                                    .onSubmit {
                                        Task { await performLogin() }
                                    }
                            }

                            Toggle(isOn: $rememberBiometrics) {
                                Label(
                                    "Für \(KeychainBiometricsService.biometricTypeLabel) speichern",
                                    systemImage: "faceid"
                                )
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            }
                            .tint(.blue)

                            Button {
                                Task { await performLogin() }
                            } label: {
                                HStack(spacing: 10) {
                                    if isLoading {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Image(systemName: "arrow.right.circle.fill")
                                        Text("Anmelden")
                                            .fontWeight(.bold)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 15)
                                .background(Color.blue, in: RoundedRectangle(cornerRadius: 14))
                                .foregroundStyle(.white)
                            }
                            .disabled(isLoading || username.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)

                            if KeychainBiometricsService.hasSavedCredentials {
                                Button {
                                    Task { await performBiometricLogin() }
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "faceid")
                                            .font(.title3)
                                        Text("Mit \(KeychainBiometricsService.biometricTypeLabel) anmelden")
                                            .fontWeight(.semibold)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 13)
                                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                                    .foregroundStyle(.white)
                                }
                                .disabled(isLoading)
                            }
                        }
                        .padding(24)
                        .frame(maxWidth: 440)
                        .background(Color(red: 0.07, green: 0.09, blue: 0.15), in: RoundedRectangle(cornerRadius: 22))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )

                        // Server Endpoint Configuration
                        VStack(spacing: 10) {
                            Button {
                                withAnimation {
                                    customURL = api.baseURL
                                    showServerSettings.toggle()
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "network")
                                    Text("Server: \(api.baseURL)")
                                    Image(systemName: showServerSettings ? "chevron.up" : "chevron.down")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }

                            if showServerSettings {
                                VStack(spacing: 10) {
                                    HStack(spacing: 8) {
                                        Button("172.16.1.11 (Standard)") {
                                            api.baseURL = "https://172.16.1.11"
                                            customURL = api.baseURL
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)

                                        Button("smile.schule.intern") {
                                            api.baseURL = "https://smile.schule.intern"
                                            customURL = api.baseURL
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    }

                                    HStack {
                                        TextField("https://172.16.1.11", text: $customURL)
                                            .textInputAutocapitalization(.never)
                                            .autocorrectionDisabled()
                                            .font(.caption)
                                            .padding(8)
                                            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))

                                        Button("Speichern") {
                                            api.baseURL = customURL
                                            showServerSettings = false
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .controlSize(.small)
                                    }
                                }
                                .padding(14)
                                .frame(maxWidth: 440)
                                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func performLogin() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        let cleanUser = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        do {
            _ = try await api.login(username: cleanUser, password: password)
            if rememberBiometrics {
                KeychainBiometricsService.save(username: cleanUser, password: password)
            }
            Haptics.notify(.success)
        } catch {
            Haptics.notify(.error)
            errorMessage = error.localizedDescription
        }
    }

    private func performBiometricLogin() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        do {
            let creds = try await KeychainBiometricsService.unlockWithBiometrics()
            username = creds.username
            _ = try await api.login(username: creds.username, password: creds.password)
            Haptics.notify(.success)
        } catch {
            Haptics.notify(.error)
            errorMessage = error.localizedDescription
        }
    }
}

struct ForcePasswordChangeView: View {
    @EnvironmentObject var api: APIClient
    let user: User

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Willkommen, \(user.displayName)! Bitte legen Sie aus Sicherheitsgründen ein persönliches Passwort fest (mindestens 12 Zeichen, Groß-/Kleinbuchstaben und Ziffer).")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }

                Section("Passwort ändern") {
                    SecureField("Bisheriges Start-Passwort", text: $currentPassword)
                    SecureField("Neues Passwort (mind. 12 Zeichen)", text: $newPassword)
                    SecureField("Neues Passwort wiederholen", text: $confirmPassword)
                }

                Section {
                    Button {
                        Task { await updatePassword() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSaving {
                                ProgressView()
                            } else {
                                Text("Passwort speichern & weiter")
                                    .fontWeight(.bold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(isSaving || currentPassword.isEmpty || newPassword.count < 12 || newPassword != confirmPassword)
                }
            }
            .navigationTitle("Start-Passwort ändern")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abmelden") {
                        Task { await api.logout() }
                    }
                }
            }
        }
    }

    private func updatePassword() async {
        guard newPassword == confirmPassword else {
            errorMessage = "Die neuen Passwörter stimmen nicht überein."
            return
        }
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }

        do {
            _ = try await api.changePassword(currentPassword: currentPassword, newPassword: newPassword)
            KeychainBiometricsService.save(username: user.username, password: newPassword)
            Haptics.notify(.success)
        } catch {
            Haptics.notify(.error)
            errorMessage = error.localizedDescription
        }
    }
}
