import SwiftUI

struct LoginView: View {
    @EnvironmentObject var api: APIClient

    @State private var serverAddress = ""
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    /// The entered server address, normalized (https assumed for bare domains).
    /// Empty input means: use the stored/default server.
    private var normalizedServer: String? {
        let trimmed = serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : APIClient.normalizeServerURL(trimmed)
    }

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.03, green: 0.04, blue: 0.07)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // Brand Header
                        VStack(spacing: 12) {
                            Image("SmileLogo")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(height: 52)

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

                            // Server / Domain — optional; left empty the stored/default
                            // server is used. A typed address is normalized and stored on
                            // the device together with the login.
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Server / Domain")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)

                                TextField("Server / Domain (z. B. smile.schule.intern)", text: $serverAddress)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .keyboardType(.URL)
                                    .textContentType(.URL)
                                    .padding(14)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                    )

                                if let normalized = normalizedServer,
                                   normalized.hasPrefix("http://"),
                                   let host = URL(string: normalized)?.host,
                                   !APIClient.isLoopbackHost(host) {
                                    Label("Achtung: unverschlüsselte HTTP-Verbindung — Zugangsdaten werden im Klartext übertragen. Nur im vertrauenswürdigen Netz verwenden.", systemImage: "exclamationmark.triangle.fill")
                                        .font(.caption2)
                                        .foregroundStyle(.orange)
                                }
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
                            .disabled(isLoading || !canSubmit)

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

                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .task {
            // Prefill only the stored login name. The server field stays empty and
            // falls back to the stored/default server; the password lives in the Keychain.
            if username.isEmpty, let last = api.lastUsername {
                username = last
            }
        }
    }

    private func performLogin() async {
        errorMessage = nil

        // Empty server field = stored/default server; a typed address is normalized
        // (bare domains get https://; explicit http:// is restricted to local/private/
        // DDNS hosts by APIClient.normalizeServerURL) and persisted on the device.
        let serverInput = serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized: String
        if serverInput.isEmpty {
            normalized = api.baseURL
        } else if let candidate = APIClient.normalizeServerURL(serverInput) {
            normalized = candidate
        } else {
            errorMessage = "Ungültige Server-Adresse. Domain oder Host eingeben (z. B. smile.schule.intern, 172.16.1.11 oder http://smiletelfs.dpdns.org:3000). Ohne „http(s)://“ wird https:// angenommen; reines http:// ist nur für lokale/private Adressen und DDNS-Anbieter erlaubt."
            return
        }

        isLoading = true
        defer { isLoading = false }

        let cleanUser = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        do {
            // Persist the server address on the device; switching the server drops the
            // old session (cookies belong to the old host).
            try api.setBaseURL(normalized)
            _ = try await api.login(username: cleanUser, password: password)
            // Store the login on this device: username + server in UserDefaults,
            // password in the biometry-protected Keychain (scoped to this server).
            api.lastUsername = cleanUser
            if !api.isDemoMode {
                KeychainBiometricsService.save(username: cleanUser, password: password, serverURL: api.baseURL)
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
            // Replay the stored password only against the server it was saved for.
            if let savedServer = creds.serverURL,
               let normalized = APIClient.normalizeServerURL(savedServer),
               normalized != api.baseURL {
                try api.setBaseURL(normalized)
                serverAddress = normalized
            }
            username = creds.username
            _ = try await api.login(username: creds.username, password: creds.password)
            api.lastUsername = creds.username
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
            KeychainBiometricsService.save(username: user.username, password: newPassword, serverURL: api.baseURL)
            Haptics.notify(.success)
        } catch {
            Haptics.notify(.error)
            errorMessage = error.localizedDescription
        }
    }
}
