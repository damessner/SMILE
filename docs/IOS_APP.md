# SMILE — Native iOS / iPadOS App (`ios/`)

Die native SMILE App für **iPadOS & iOS (ab Version 17.0)** ist in **Swift & SwiftUI** geschrieben und greift direkt auf die SMILE REST-API (`https://172.16.1.11` bzw. `https://smile.schule.intern`) zu.

---

## Funktionsumfang für Lehrpersonen

1. **Anmeldung & Sicherheit (`LoginView` & `KeychainBiometricsService`):**
   - **Face ID / Touch ID:** Nach der ersten Anmeldung werden die Zugangsdaten verschlüsselt in der iOS Keychain gespeichert und können im Unterricht per Face ID oder Touch ID entsperrt werden.
   - **Integriertes Schul-Zertifikat (`InternalCATrustDelegate`):** Das interne Caddy Root-CA-Zertifikat (`smile-internal-ca.cer`) ist direkt im App-Bundle eingebettet und wird per `SecTrustSetAnchorCertificates` validiert. Dadurch vertraut die App `https://172.16.1.11` und `https://smile.schule.intern` automatisch.
   - **Start-Passwort-Wechsel (`ForcePasswordChangeView`):** Unterstützt den verpflichtenden Erstpasswort-Wechsel direkt in der App.

2. **Schulalltag (`SchulalltagView`):**
   - **Automatische Stundenerkennung:** Liest `/api/timetable/current` aus, zeigt die laufende Unterrichtsstunde (Stunde, Uhrzeit, Klasse, Fach, Raum) als Banner an und wählt automatisch die aktuelle Klasse vor.
   - **Schülerkacheln mit Rangfarben:** Zeigt den aktuellen Rang (*Meister*, *Geselle*, *Lehrling*, *Ausstehend*) inkl. Karten-Abstufungen.
   - **5 Live-Zähler + 5 Schnellaktionen:** Direkt links neben den 5 Aktionsbuttons befinden sich die kompakten Zähler für **Grün**, **Gelb**, **Rot**, **Time-Out** und **Cool-Down**.
   - **Nachtrag vergangener Stunden:** Unterstützt rückwirkende Time-Out-Einträge (Datum + Unterrichtsstunde).
   - **Karten-Historie & Widerruf:** Tippen auf einen Schülernamen öffnet die bisherige Karten- und Lernwerkstatt-Historie; Karten können per Wischgeste (*Swipe*) widerrufen werden.

3. **Lernwerkstatt (`LernwerkstattView`):**
   - Live-Übersicht aller aktuell im **Time-Out** oder **Cool-Down** befindlichen Schüler*innen (inklusive Badge-Zähler im Tab-Balken).
   - **1-Tap Abschließen:** Rücksendung in die Stammklasse mit optionaler Rückmeldungs-Notiz.
   - Umschalter zwischen aktiven Fällen und dem abgeschlossenen Verlauf.

4. **Schulstatistik (`SchoolStatisticsView`):**
   - Öffnet standardmäßig immer **„Alle Klassen (Schulweit)“** (`selectedClassId = "all"`).
   - Rein faktenbasiert, wertungsfrei und ohne Konferenz-Begriffe.
   - Farbige Verteilungsbalken (Grün, Gelb, Rot, Time-Out, Cool-Down), zeitliche Verteilung nach Wochentag und Unterrichtsstunde, Klassenübersicht und durchsuchbare Schülertabelle.

---

## Projektstruktur

```text
ios/
├── project.yml                         # XcodeGen Projektdefinition
└── SMILE/
    ├── Info.plist                      # iOS Berechtigungen (Face ID, Orientierungen)
    ├── SMILEApp.swift                  # App-Einstiegspunkt & Session-Check
    ├── Models/
    │   └── Models.swift                # Codable-Modelle passend zum Fastify-Backend
    ├── Services/
    │   ├── APIClient.swift             # URLSession + Cookie-Auth + Caddy Root-CA Pinning
    │   ├── KeychainBiometricsService.swift # iOS Keychain + Face ID / Touch ID
    │   └── Haptics.swift               # Natives haptisches Feedback
    ├── Views/
    │   ├── LoginView.swift             # Login, Face ID & Startpasswort-Änderung
    │   ├── MainTabView.swift           # Tab-Navigation & Konto-Menü
    │   ├── SchulalltagView.swift       # Unterrichts-Ansicht, Zähler & Kartenvergabe
    │   ├── LernwerkstattView.swift     # Aktive Time-Outs/Cool-Downs & Abschluss
    │   └── SchoolStatisticsView.swift  # Faktenbasierte Schul- & Klassenstatistik
    └── Resources/
        ├── Assets.xcassets/            # AppIcon & AccentColor
        └── smile-internal-ca.cer       # Eingebettetes Caddy Root-CA Zertifikat
```

---

## Kompilieren & Bereitstellen (2 Wege)

### Weg A: Automatischer Cloud-Build über GitHub Actions (ohne Mac vor Ort)
Die Datei [`.github/workflows/ios-build.yml`](../.github/workflows/ios-build.yml) kompiliert die iOS-App bei jedem Push automatisch auf einem macOS-15-Runner in GitHub:
1. Generiert das `.xcodeproj` mit `xcodegen`.
2. Kompiliert die App mit `xcodebuild` und prüft alle Swift-Typen.
3. Erzeugt das Artefakt **`SMILE-iOS-App` (`SMILE-unsigned.ipa`)** sowie **`SMILE-xcodeproj`** zum Download unter dem Reiter **Actions** auf GitHub.

### Weg B: Lokal auf einem Mac mit Xcode
```bash
cd ios
brew install xcodegen
xcodegen generate
open SMILE.xcodeproj
```
In Xcode:
1. Unter **Signing & Capabilities** das Apple-Konto der Schule (**Signing Team**) auswählen.
2. Für direkten Test auf einem per USB/WLAN verbundenen Lehrer-iPad: Gerät oben auswählen und **Run (`⌘R`)** drücken.
3. Für **Microsoft Intune** Verteilung: **Product → Archive → Distribute App → Enterprise / Custom App** wählen, um die signierte `SMILE.ipa` zu exportieren und in Intune unter **Apps → iOS/iPadOS → Line-of-business app** hochzuladen.
