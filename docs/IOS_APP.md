# SMILE — Native iOS / iPadOS App (`ios/`)

Die native SMILE App für **iPadOS & iOS (ab Version 17.0)** ist in **Swift & SwiftUI** geschrieben und greift direkt auf die SMILE REST-API (`https://172.16.1.11` bzw. `https://smile.schule.intern`) zu. Aktuelle App-Version: **2.1.0**.

Die App ist **kein Web-Wrapper**: keine `WKWebView`, keine gebündelten HTML/JS-Dateien. Alle Daten laufen über `URLSession` gegen dieselben `/api`-Endpunkte wie die Web-App.

---

## Funktionsumfang für Lehrpersonen

1. **Anmeldung & Sicherheit (`LoginView` & `KeychainBiometricsService`):**
   - **Face ID / Touch ID:** Nach der ersten Anmeldung werden die Zugangsdaten verschlüsselt in der iOS Keychain gespeichert und können im Unterricht per Face ID oder Touch ID entsperrt werden.
   - **Integriertes Schul-Zertifikat (`InternalCATrustDelegate`):** Das interne Caddy Root-CA-Zertifikat (`smile-internal-ca.cer`) ist direkt im App-Bundle eingebettet und wird per `SecTrustSetAnchorCertificates` validiert. Dadurch vertraut die App `https://172.16.1.11` und `https://smile.schule.intern` automatisch.
   - **Start-Passwort-Wechsel (`ForcePasswordChangeView`):** Unterstützt den verpflichtenden Erstpasswort-Wechsel direkt in der App.
   - **Session-Cookies:** Authentifizierung wie im Browser über `HTTPCookieStorage`; bei `401` wird die Sitzung geräumt.

2. **Schulalltag (`SchulalltagView`):**
   - **Automatische Stundenerkennung:** Liest `/api/timetable/current` aus, zeigt die laufende Unterrichtsstunde (Stunde, Uhrzeit, Klasse, Fach, Raum) als Banner an und wählt automatisch die aktuelle Klasse vor.
   - **Schülerkacheln mit Rangfarben** inkl. Karten-Abstufungen.
   - **5 Live-Zähler + 5 Schnellaktionen:** Grün, Gelb, Rot, Time-Out, Cool-Down.
   - **Nachtrag vergangener Stunden:** rückwirkende Time-Out-Einträge (Datum + Unterrichtsstunde).
   - **Karten-Historie & Widerruf:** Tippen auf einen Namen öffnet die Historie; Karten lassen sich per Swipe widerrufen.
   - **Auto-Refresh:** aktualisiert die offene Klasse und den Lernwerkstatt-Zähler alle 30 Sekunden (zusätzlich zu Pull-to-Refresh).

3. **Bewertung / Einstufung (`BewertungView`) — neu in 2.1.0:**
   - Klassen- und Fachauswahl (Fächer aus der eigenen Einteilung).
   - **Rangvorschlag** Lehrling / Geselle / Meister pro Schüler*in über einen Tipp.
   - **Abgeben** (`/api/evaluations/submit`) und **Zurückziehen** (`/api/evaluations/reopen`) vor der Frist.
   - Zeigt Frist, Konferenzsperre, „x/y abgegeben" und vorhandene Kommentare.
   - Bewusst eine Schnell-Einstufung: das vollständige 18-Kriterien-Raster bleibt vorerst im Web.

4. **Lernwerkstatt (`LernwerkstattView`):**
   - Live-Übersicht aller aktuellen Time-Outs/Cool-Downs inkl. Badge-Zähler.
   - **1-Tap Abschließen** mit optionaler Rückmeldungs-Notiz.
   - Umschalter zwischen aktiven Fällen und Verlauf, Auto-Refresh alle 30 Sekunden.

5. **Schulstatistik (`SchoolStatisticsView`):**
   - Standardmäßig **„Alle Klassen (Schulweit)"** (`selectedClassId = "all"`).
   - Faktenbasiert: Verteilungsbalken, zeitliche Verteilung, Klassenübersicht, durchsuchbare Schülertabelle.

6. **Alle Klassen (`SchoolWideBehaviorView`) — neu in 2.1.0:**
   - Schulweite Verhaltensübersicht – nur sichtbar, wenn der Server `schoolWideBehaviour` freigibt.
   - **Klassen-Buttons** mit Schülerzahl filtern die Liste und die Kennzahlen (statt einer bloßen Sammelansicht).
   - Dieselben fünf Schnellaktionen wie im Schulalltag; Aktionen sind auf `canRecord` begrenzt.
   - Auto-Refresh alle 30 Sekunden.

7. **Konto & Versionsverlauf (`MainTabView`/`ReleaseNotesView`):**
   - Konto-Sheet mit Name, Rolle, Server, App-Version.
   - **Versionsverlauf** mit allen App-Releases.
   - Nach einem Update erscheint einmalig „Was ist neu?" (Key pro Version und Benutzer*in in `UserDefaults`).

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
    │   ├── MainTabView.swift           # Tabs, Konto-Menü, Update-Hinweis
    │   ├── SchulalltagView.swift       # Unterrichts-Ansicht, Zähler & Kartenvergabe
    │   ├── BewertungView.swift         # Schnell-Einstufung pro Klasse/Fach
    │   ├── LernwerkstattView.swift     # Aktive Time-Outs/Cool-Downs & Abschluss
    │   ├── SchoolWideBehaviorView.swift# Schulweite Verhaltensübersicht
    │   ├── SchoolStatisticsView.swift  # Faktenbasierte Schul- & Klassenstatistik
    │   └── ReleaseNotesView.swift      # „Was ist neu?" & Versionsverlauf
    └── Resources/
        ├── Assets.xcassets/            # AppIcon & AccentColor
        └── smile-internal-ca.cer       # Eingebettetes Caddy Root-CA Zertifikat
```

---

## Veröffentlichung einer neuen Version

1. `ios/project.yml` → `MARKETING_VERSION` und `CURRENT_PROJECT_VERSION` erhöhen.
2. In `ios/SMILE/Views/ReleaseNotesView.swift` oben in `AppReleases.all` den neuen Release ergänzen (Version muss zu `MARKETING_VERSION` passen). Der einmalige Hinweis erscheint danach automatisch bei allen Lehrpersonen.
3. Die App nutzt bewusst dieselben Endpunkte wie das Web – keine Server-Änderung nötig.

---

## Noch nicht in der App (Roadmap)

Bewusst noch im Web, weil dort Konferenz- und Verwaltungs-Workflows liegen:

- Vollständiges 18-Kriterien-Raster inkl. Kommentar-Autosave (iPad-Querformat)
- Konferenzmodus / Notenbeschluss und Gesamtexport
- Schülerverwaltung, Konten- und Wiederherstellungs-Administration
- Offline-Zwischenspeicher und Push-Benachrichtigungen
- MDM-vorbelegte Server-Adresse (statt manueller Eingabe)

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
