import SwiftUI

// MARK: - Data

struct AppReleaseNote {
    enum Kind {
        case feature
        case improvement
        case fix

        var label: String {
            switch self {
            case .feature: return "Neu"
            case .improvement: return "Verbessert"
            case .fix: return "Behoben"
            }
        }

        var color: Color {
            switch self {
            case .feature: return .green
            case .improvement: return .blue
            case .fix: return .orange
            }
        }
    }

    let kind: Kind
    let title: String
    let text: String
}

struct AppRelease: Identifiable {
    let version: String
    let date: String
    let title: String
    let summary: String
    let notes: [AppReleaseNote]

    var id: String { version }
}

/// App-side changelog. Add the new release at the top when the app version is
/// bumped in `ios/project.yml`; the one-time notice is keyed to `all[0].version`.
enum AppReleases {
    static let all: [AppRelease] = [
        AppRelease(
            version: "2.1.2",
            date: "24.11.2026",
            title: "Server-Adresse direkt beim Login",
            summary: "Server/Domain, Benutzername und Passwort werden gemeinsam auf dem Gerät gespeichert; der Server lässt sich vorab testen und das Schul-Zertifikat wird nur für die konfigurierte Adresse vertraut.",
            notes: [
                AppReleaseNote(
                    kind: .feature,
                    title: "Server / Domain als Login-Feld",
                    text: "Domain oder IP (z. B. smile.schule.intern oder 172.16.1.11) direkt im Anmeldeformular eingeben — https:// wird automatisch ergänzt und die Adresse auf dem Gerät gespeichert. „Server testen“ prüft die Adresse vorab über den Gesundheits-Endpunkt. Explizit eingegebenes http:// (z. B. http://smiletelfs.dpdns.org:3000) ist für lokale/private Adressen und DDNS-Anbieter erlaubt und wird mit einem Warnhinweis versehen."
                ),
                AppReleaseNote(
                    kind: .feature,
                    title: "Login-Daten auf dem Gerät gespeichert",
                    text: "Server, Benutzername und Passwort werden nach erfolgreicher Anmeldung auf dem Gerät hinterlegt. Face ID / Touch ID meldet nur noch gegen den Server an, für den die Zugangsdaten gespeichert wurden."
                ),
                AppReleaseNote(
                    kind: .improvement,
                    title: "Schul-CA nur für den konfigurierten Server",
                    text: "Das eingebettete interne CA-Zertifikat wird nur noch für die eingestellte Server-Adresse als zusätzlicher Vertrauensanker verwendet, nicht mehr für beliebige Hosts."
                ),
                AppReleaseNote(
                    kind: .improvement,
                    title: "Immer aktuelle Serverdaten",
                    text: "Anfragen umgehen den lokalen Antwort-Cache; ein nicht erreichbarer Server beim Session-Check meldet nicht mehr fälschlich ab."
                ),
                AppReleaseNote(
                    kind: .fix,
                    title: "Kleinere Korrekturen",
                    text: "Fehler beim Abschließen eines Time-Outs erscheinen direkt im Dialog; „Ansicht als“-Sitzungen zeigen ein schreibgeschütztes Banner; doppeltes Laden der Klasse beim Start vermieden."
                ),
                AppReleaseNote(
                    kind: .fix,
                    title: "HTTP-Server über DDNS erreichbar",
                    text: "Explizit als http:// eingegebene Adressen (z. B. http://smiletelfs.dpdns.org:3000) werden akzeptiert, sofern sie lokal/privat oder ein unterstützter DDNS-Dienst sind; passende ATS-Ausnahmen in der Info.plist."
                ),
            ]
        ),
        AppRelease(
            version: "2.1.1",
            date: "15.11.2026",
            title: "Gesamt-Bewertung, Verhaltensprofil & Sicherheit",
            summary: "Mehrfachfach-Einstufung direkt im Gesamt-Modus, Verhaltensstufe in der Schülerhistorie und gehärtete Anmeldung.",
            notes: [
                AppReleaseNote(
                    kind: .feature,
                    title: "Gesamt-Modus in Bewertung",
                    text: "Neuer Chip „🌟 Gesamt“ bei mehreren Fächern, um Bewertungen gebündelt für alle Fächer zu vergeben und abzugeben."
                ),
                AppReleaseNote(
                    kind: .feature,
                    title: "Verhaltensstufe & Maßnahmen",
                    text: "Die Schüler-Historie zeigt nun aktuelle Verhaltensstufe, Rang, Verhaltensnote und dokumentierte pädagogische Maßnahmen."
                ),
                AppReleaseNote(
                    kind: .improvement,
                    title: "Automatische Badge-Aktualisierung",
                    text: "Der Lernwerkstatt-Zähler aktualisiert sich alle 30 Sekunden sowie sofort beim Zurückkehren in die App."
                ),
                AppReleaseNote(
                    kind: .fix,
                    title: "Keychain, Face ID & Server-URL",
                    text: "Biometrische Zugangsdaten werden mit aktuellem Biometrie-Schutz gesichert und benutzerdefinierte Server-URLs strenger geprüft."
                ),
            ]
        ),
        AppRelease(
            version: "2.1.0",
            date: "12.11.2026",
            title: "Alle Klassen, Bewertung & Live-Aktualisierung",
            summary: "Die App deckt jetzt den Schulalltag deutlich breiter ab: schulweite Verhaltensübersicht, Einstufung pro Fach und automatische Aktualisierung.",
            notes: [
                AppReleaseNote(
                    kind: .feature,
                    title: "Alle Klassen",
                    text: "Schulweite Verhaltensübersicht mit Klassenauswahl und denselben fünf Schnellaktionen wie im Schulalltag."
                ),
                AppReleaseNote(
                    kind: .feature,
                    title: "Bewertung in der App",
                    text: "Rangvorschlag pro Schüler*in und Fach setzen, abgeben und vor der Frist wieder zurückziehen."
                ),
                AppReleaseNote(
                    kind: .feature,
                    title: "Live-Aktualisierung",
                    text: "Schulalltag und Alle-Klassen-Ansicht aktualisieren sich alle 30 Sekunden; Ziehen zum Aktualisieren bleibt erhalten."
                ),
                AppReleaseNote(
                    kind: .improvement,
                    title: "Versionsverlauf",
                    text: "Neue Änderungen erscheinen einmalig nach dem Update; alle Versionen sind im Konto-Menü nachlesbar."
                ),
            ]
        ),
        AppRelease(
            version: "2.0.0",
            date: "07.11.2026",
            title: "Erste native SMILE-App",
            summary: "Schulalltag, Lernwerkstatt und Schulstatistik als native iPad-/iPhone-App.",
            notes: [
                AppReleaseNote(
                    kind: .feature,
                    title: "Native SwiftUI-App",
                    text: "Drei Bereiche mit Face ID/Touch ID, Keychain-Anmeldung und eingebettetem Schul-CA-Zertifikat."
                ),
                AppReleaseNote(
                    kind: .feature,
                    title: "Karten & Lernwerkstatt",
                    text: "Grün, Gelb, Rot, Time-Out und Cool-Down direkt aus dem Unterricht vergeben."
                ),
            ]
        ),
    ]

    static var latest: AppRelease {
        all[0]
    }

    static var bundleVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? latest.version
    }
}

/// Remembers which release a teacher has already dismissed on this device.
enum ReleaseNotesStore {
    static func seenKey(username: String) -> String {
        "smile_ios_whatsnew_\(AppReleases.latest.version)_\(username.lowercased())"
    }

    static func hasSeen(username: String) -> Bool {
        UserDefaults.standard.bool(forKey: seenKey(username: username))
    }

    static func markSeen(username: String) {
        UserDefaults.standard.set(true, forKey: seenKey(username: username))
    }
}

// MARK: - Views

/// One-time notice after an update. Shows the newest release and links to the
/// full history; the seen flag is written by the caller before presenting.
struct WhatsNewSheet: View {
    @Environment(\.dismiss) private var dismiss

    private let release = AppReleases.latest

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 10) {
                        Image(systemName: "sparkles")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.yellow)
                            .frame(width: 42, height: 42)
                            .background(Color.yellow.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Version \(release.version)")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                            Text(release.title)
                                .font(.headline)
                        }
                    }

                    Text(release.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(release.notes.enumerated()), id: \.offset) { item in
                            noteRow(item.element)
                        }
                    }

                    Text("Dieser Hinweis erscheint nur einmal pro Update.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)

                    NavigationLink {
                        ReleaseHistoryList()
                            .navigationTitle("Versionsverlauf")
                            .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        Label("Alle Änderungen ansehen", systemImage: "clock.arrow.circlepath")
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.top, 4)
                }
                .padding(20)
            }
            .background(Color(red: 0.03, green: 0.04, blue: 0.07))
            .navigationTitle("Was ist neu?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Verstanden") {
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Full history, newest first. Used inside the what's-new sheet and from the
/// account screen, so it deliberately has no NavigationStack of its own.
struct ReleaseHistoryList: View {
    var body: some View {
        List {
            ForEach(AppReleases.all) { release in
                Section {
                    Text(release.summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    ForEach(Array(release.notes.enumerated()), id: \.offset) { item in
                        noteRow(item.element)
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("v\(release.version)")
                                .font(.caption.weight(.bold))
                            if release.version == AppReleases.latest.version {
                                Text("Aktuell")
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color.green.opacity(0.2), in: Capsule())
                                    .foregroundStyle(.green)
                            }
                            Spacer()
                            Text(release.date)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(release.title)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.primary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
    }
}

private func noteRow(_ note: AppReleaseNote) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(note.kind.label)
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(note.kind.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 5))
            .foregroundStyle(note.kind.color)

        Text(note.title)
            .font(.subheadline.weight(.bold))

        Text(note.text)
            .font(.caption)
            .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
}
