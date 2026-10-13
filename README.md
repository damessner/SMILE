# ✨ SMILE — Collaborative Assessment & School Management

> **Moderne Schülerbeobachtung, Verhaltenserfassung & Klassenkonferenzen**
> *MS Telfs Dr. Aloys Weissenbach (Schuljahr 2026/2027)*

[![CI](https://github.com/damessner/SMILE/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/damessner/SMILE/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-5FA04E?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Lizenz](https://img.shields.io/badge/Lizenz-propriet%C3%A4r-lightgrey)

---

## Inhaltsverzeichnis

- [Über SMILE](#über-smile)
- [Funktionsumfang](#funktionsumfang)
- [Tech-Stack](#tech-stack)
- [Architektur](#architektur)
- [1-Klick-Installation (Proxmox LXC)](#1-klick-installation-proxmox-lxc)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Tests & Qualitätssicherung](#tests--qualitätssicherung)
- [Deployment & Betrieb](#deployment--betrieb)
- [Backup & Wiederherstellung](#backup--wiederherstellung)
- [Rollen & Berechtigungen](#rollen--berechtigungen)
- [Echtzeit-Kollaboration (Live-Sync)](#echtzeit-kollaboration-live-sync)
- [Dokumentation](#dokumentation)
- [Lizenz](#lizenz)

---

## Über SMILE

**SMILE** ist eine kollaborative Plattform für Lehrpersonen und Schulleitung, die den Schulalltag, die kontinuierliche Verhaltensbeobachtung und die Notenkonferenzen in einem modernen, intuitiven Interface vereint.

Statt mühsam papierbasierte Bögen auszufüllen, arbeiten alle Lehrkräfte in Echtzeit zusammen — transparent, motivierend und für Schülerinnen und Schüler nachvollziehbar.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🌟 MEISTER                 🛠️ GESELLE                  🌱 LEHRLING          │
│ Herausragende Leistungen   Solide & verlässliche       Fokus auf Begleitung │
│ & Vorbildfunktion          Mitarbeit im Schulalltag    & nächste Lernschritte│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Funktionsumfang

Die folgenden Module decken den Schulalltag von der ersten Unterrichtsstunde bis zum Konferenzbeschluss ab.

### 🏫 1. Schulalltag — Minimalistisches Klassenmanagement
Die zentrale Arbeitsfläche für Lehrpersonen während jeder Unterrichtsstunde. Entwickelt für maximale Übersicht und minimale Ablenkung:

- 📋 **Kompakte Listenansicht:** Alle Schülerinnen und Schüler einer Klasse auf einen Blick — kein langes Scrollen mehr!
  - 👤 **Name:** Schnelle Erkennung mit dezenten Live-Badges für aktives Time-Out (`⏱️ LW`) oder Mahnstufen-Warnung (`⚠️`).
  - 🏅 **RANG:** Sofort sichtbar als `👑 Meister`, `🛠️ Geselle` oder `🌱 Lehrling` (inklusive automatischer Anzeige von Rangverlusten `-1`).
  - 🚦 **Karten-Zähler:** Direkte Zählerübersicht für 🟢 Grüne, 🟡 Gelbe und 🔴 Rote Karten.
  - ⚡ **1-Klick Schnell-Aktionen:** Direkte Buttons pro Zeile: `[+ Grün]`, `[+ Gelb]`, `[+ Rot]` und `[⏱️ TIMEOUT]`.
- 🔍 **Detailansicht per Zeilenklick:**
  - Klick auf die Zeile klappt direkt darunter das Detail-Panel auf.
  - Zeigt erfüllte Beobachtungskriterien (z. B. *14 von 18 positiv*).
  - Vollständige chronologische Historie aller Karten mit Datum, Uhrzeit, Lehrperson und Begründung.
  - Fehlerhaft vergebene Karten können mit einem Klick auf `[X]` wieder zurückgezogen werden.
  - Schnelles Notizfeld für spontane Beobachtungen im Unterricht.
- 🕒 **Automatische Stundenplan-Erkennung:**
  - Erkennt anhand des Stundenplans automatisch die aktuelle Klasse der Lehrperson und schlägt diese direkt vor.

---

### ⏱️ 2. Time-Out & Lernwerkstatt (LW) System
Disziplinäre Vorfälle werden pädagogisch sinnvoll und nachvollziehbar gelöst:

- 🚪 **Time-Out Button im Unterricht:**
  - Bei schwerwiegenden Störungen klickt die Lehrkraft auf `[ ⏱️ TIMEOUT (LW) ]`.
  - Eingabe eines verpflichtenden **Arbeitsauftrags** für die Lernwerkstatt.
  - Gilt automatisch als **Rote Karte** (sofortiger Rangverlust: Meister ➔ Geselle, Geselle ➔ Lehrling) und wird revisionssicher im Protokoll vermerkt.
- 🛠️ **Lernwerkstatt Live-View:**
  - Betreuungspersonen in der Lernwerkstatt sehen alle anwesenden Schülerinnen und Schüler live.
  - Zeigt genau an: *Wer hat den Schüler geschickt? Um welche Uhrzeit? Welcher Arbeitsauftrag ist zu erledigen?*
  - Button **`[ ✓ Arbeitsauftrag erledigt / Zurück in die Klasse ]`** beendet das Time-Out und sendet den Schüler mit Erledigungsvermerk zurück.

---

### 🚨 3. SLC Time-Out Eskalationssystem (Mahnstufen 3, 6, 9 ...)
Ein strukturierter Stufenplan für die Schulleitung zur frühen Elternarbeit:

- 🔔 **Direkte Benachrichtigung:** Schulleiter **SLC** (und Admin) sehen einen roten Zähler auf dem `[ ⏱️ Time-Out ]`-Button in der Navigationsleiste.
- 📈 **Automatische Schwellenwerte:** Erreicht ein Schüler das **3., 6., 9., 12. ...** Time-Out, schlägt das System automatisch Alarm.
- 📞 **Elternvereinbarung:**
  - Schulleitung kontaktiert die Eltern und klickt auf **`[ Eltern verständigt & Nachholtermin am Nachmittag vereinbart ]`**.
  - Eingabe des vereinbarten Termins und kurzer Notizen.
  - Der Schüler gilt für diese Stufe als erledigt, bis die nächste 3er-Schwelle erreicht wird.

---

### 📋 4. Beobachtungsraster & Bewertung (Minimalistisches Bewertungs-UI)
Das Herzstück für die formative Beurteilung der überfachlichen Kompetenzen — optimiert für schnelles, unterbrechungsfreies Arbeiten:

- ⚡ **1-Klick Schnellbewertung & Auto-Save:**
  - Für 90 % der Schüler*innen genügt ein einziger Klick auf die Stufe: `🔴 Lehrling`, `🔵 Geselle` oder `🟡 Meister`.
  - Jeder Klick wird verzögerungsfrei per WebSocket und OCC atomic increment im Hintergrund gespeichert.
- 💬 **Optionale Konferenznotiz:**
  - Kurzes Notizfeld direkt unter der Stufenwahl für wichtige pädagogische Beobachtungen, die automatisch im Konferenzprotokoll erscheinen.
- 🧩 **Beobachtungsbogen (18 Kriterien & Merkmale):**
  - Auf Klick aufklappbares Akkordeon mit den 6 Kompetenzbereichen (Arbeitsorganisation, Problemlösen, Sozialkompetenz, Kommunikation, Regeln, Ausdauer).
  - 4 Bewertungsstufen mit Smileys/Symbolen (`++`, `+`, `-`, `--`).
  - Schnellauswahl über Zeilen-Buttons `[ALLE]` oder Sofort-Füllungen (`Meister füllen`, `Geselle füllen`, `Reset`).
- 🌟 **Smarte Mehrfach-Fächer-Auswahl:**
  - Unterrichtet eine Lehrkraft mehrere Fächer in einer Klasse (z. B. Deutsch + Förderunterricht + Biologie), schaltet der Header zwischen **🌟 Gesamt (alle Fächer)** und **Einzelfächern** um.
  - Ermöglicht sowohl einheitliche Gesamtbewertungen mit einem Klick als auch differenzierte Einzelbewertungen pro Fach.
- 📂 **Zwei-Ordner-Workflow & Auto-Advance:**
  - **📁 Offen:** Noch zu bewertende Schülerinnen und Schüler.
  - **📁 Bewertet:** Fertig eingereichte Bewertungen mit Zeitstempel.
  - Nach Klick auf *„Ranking einreichen“* springt die Ansicht automatisch zur nächsten Person.

---

### ⚖️ 5. Konferenz-Modus & Stundengewichtetes Voting
Spezieller Präsentations- und Beschlussmodus für den Notenkonferenztag:

- 🖥️ **Präsentationsansicht:** Für Beamer und Großbildschirme optimiert (`BeamerMode`).
- ⚖️ **Stundengewichtung nach offiziellem Stundenplan (WebUntis):**
  - Jede Fachbewertung wird mit den realen Wochenstunden gewichtet (z. B. 4h Deutsch = Gewicht 4, 2h Biologie = Gewicht 2).
  - **Team-Teaching-Garantie (D, E, M):** Gibt in einem Team-Teaching-Hauptfach nur eine Lehrkraft ab, wird ihr Stimmgewicht automatisch verdoppelt (8h), damit das Fach kein Stimmgewicht verliert.
- 🔒 **Klassenspezifische Konferenz-Sperren (`class_round_locks`):**
  - Konferenzleitung sperrt Klassen einzeln nach Beschlussfassung. Andere Klassen bleiben für Fachlehrerinnen und Fachlehrer weiterhin editierbar.
- 🚨 **Automatischer Rangabzug bei Roter Karte:**
  - Liegt eine aktive Rote Karte vor, dekrementiert das System den Rang automatisch um eine Stufe (*Meister ➔ Geselle*, *Geselle ➔ Lehrling*), ausgewiesen als `(Rangabzug Karte)`.
- 🖨️ **Klassen- & Mehrebenen-Export:**
  - 1-Seiten-Kompaktexport pro Klasse sowie klassenübergreifender Gesamt-Export aller 15 Klassen der MS Weissenbach.

---

### 📊 6. Schul- & Klassenstatistik
Transparente Kennzahlen für Lehrkräfte und Schulleitung:

- 📈 **Übersichtliche Balkendiagramme:** Anteil von Lehrlingen, Gesellen und Meistern auf Klassen- und Schulebene.
- 🎯 **Verteilungsquoten:** Schneller Überblick über Förderschwerpunkte und Klassenentwicklungen über das Schuljahr.

---

### 📖 7. SMILE Bewertungs-Leitfaden (3-Seiten PDF)
Für Lehrkräfte steht ein kompakter, visuell aufbereiteter Schnell-Leitfaden zur Verfügung:

- 📄 **[`docs/SMILE_Bewertungs_Guide.pdf`](docs/SMILE_Bewertungs_Guide.pdf):**
  - **Seite 1:** Navigation, Klassen- & Fachauswahl, 1-Klick Schnellbewertung.
  - **Seite 2:** Beobachtungsbogen mit 18 Kriterien, Gesamt- vs. Einzelfach-Differenzierung, Einreichungs-Workflow.
  - **Seite 3:** Wie zählt meine Stimme? Stundengewichtung laut WebUntis, Team-Teaching-Regel und Konferenztopf-Akkumulation.

---

### ☁️ 8. Microsoft 365 Cloud-Backup & Desaster-Recovery
Revisionssicheres, automatisiertes Backup direkt in den Cloud-Speicher der Schule:

- ⏱️ **10-Minuten Taktung:** Systemd-Timer (`smile-m365-backup.timer`) sichert die Datenbank verschlüsselt auf OneDrive.
- 🛡️ **Direkter Graph API Upload:** Automatisierte Übertragung via Microsoft Graph API mit Preflight-Prüfung (`backup_m365.py --check`).
- 🔐 **Strenge Verschlüsselung:** Alle Dumps werden vor der Übertragung mit AES/GPG verschlüsselt.
- 📅 **7-Tage Cloud-Retention & 19:00 Tagesschluss-Sicherung:** Automatische Bereinigung abgelaufener Snapshots.
- 🔄 **Admin Restore Modal:** Grafische Wiederherstellungs- und Backup-Verwaltung direkt in der SMILE-Weboberfläche.

---

## Tech-Stack

| Bereich | Technologie |
| :--- | :--- |
| **Frontend** | React 19 · Vite 8 · TypeScript 5.7 · Tailwind CSS 4 · lucide-react |
| **Backend** | Node.js ≥ 22 · Fastify 5 · TypeScript 5.7 · Drizzle ORM |
| **Datenbank** | PostgreSQL 17 |
| **Echtzeit** | WebSocket (`@fastify/websocket`) für Live-Sync, Soft-Locks und Konferenz-Sperren |
| **Sicherheit** | JWT in HttpOnly-Cookies, bcrypt, Rate-Limits, strikte Rollen-Guards |
| **Tests** | Vitest 3 (Server & Client) · Testing Library · Python `unittest` (Ops-Skripte) |
| **Betrieb** | Proxmox LXC + systemd · Release-Deployment (`scripts/deploy.py`) mit Health-Check & Rollback · M365 Cloud-Backup |

---

## Architektur

```
┌─────────────────────┐      REST /api/*  +  WebSocket /ws      ┌──────────────────────┐
│  Client (React 19)  │ ◄─────────────────────────────────────► │  Server (Fastify 5)  │
│  Vite · TypeScript  │                                         │  Drizzle ORM         │
└─────────────────────┘                                         └───────────┬──────────┘
                                                                             │
                                                                 ┌───────────▼──────────┐
                                                                 │    PostgreSQL 17     │
                                                                 └──────────────────────┘
```

- **Monorepo** mit npm Workspaces (`client/`, `server/`). Im Produktivbetrieb liefert Fastify das gebaute Frontend direkt mit aus — es ist kein separater Webserver nötig.
- **Release-Layout:** `/opt/smile` ist ein Symlink auf `/opt/smile-releases/<UTC-Zeitstempel>`. Ein Deployment legt eine neue Release-Version an, installiert die Produktions-Dependencies, schaltet den Symlink atomar um und prüft den Health-Endpoint — schlägt etwas fehl, wird automatisch auf die vorherige Release zurückgerollt.
- **Betriebsdaten:** Secrets liegen außerhalb der Releases in `/opt/smile-shared/.env`; Backups unter `/var/backups/smile`; Service unter `smile.service` (systemd).
- **Architektur-Review & Codestand:** [`docs/archive/SMILE_ARCHITECTURE_AND_CODE_REVIEW.md`](docs/archive/SMILE_ARCHITECTURE_AND_CODE_REVIEW.md)

---

## 1-Klick-Installation (Proxmox LXC)

Erstelle und starte eine vollständige SMILE-Instanz in einem neuen Proxmox LXC-Container mit einem einzigen Befehl direkt in der **Proxmox VE Shell** (Root-Knoten):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/damessner/SMILE/main/install-lxc.sh)"
```

> 💡 **Automatischer Ablauf:**
> - 🐧 Erstellt einen unprivilegierten Debian 12 LXC Container (2 Cores, 2 GB RAM, 16 GB Disk, `nesting=1`).
> - 🐘 Installiert **PostgreSQL 17** und **Node.js 22 LTS**.
> - 🔐 Erzeugt individuelle kryptographische Secrets & Passwörter in `.env`.
> - 🚀 Baut Frontend & Backend und richtet den Autostart-Dienst (`smile.service`) ein.
> - 🔄 *Optional:* Bietet bei Bedarf die Übernahme bestehender Daten aus einem vorherigen Container an.

---

## Lokale Entwicklung

**Voraussetzungen:** Node.js ≥ 22, PostgreSQL 17, Git.

```bash
# 1) Repository & Abhängigkeiten
git clone https://github.com/damessner/SMILE.git
cd SMILE
npm ci

# 2) Konfiguration anlegen (DATABASE_URL, JWT_SECRET, ... anpassen)
cp server/.env.example .env

# 3) Datenbank vorbereiten (laufende PostgreSQL-Instanz vorausgesetzt)
npm run db:migrate
npm run seed            # optional: Basisdaten anlegen

# 4) Entwicklung starten (API + Frontend parallel)
npm run dev
```

- **API:** `http://localhost:3000` · **Frontend:** `http://localhost:5173` (Vite-Dev-Server mit Proxy auf `/api` und `/ws`).
- Alle verfügbaren Skripte:

| Befehl | Zweck |
| :--- | :--- |
| `npm run dev` | Server (`tsx watch`) und Client (Vite) parallel starten |
| `npm run build` | Produktions-Build beider Workspaces |
| `npm start` | Server aus `server/dist` starten |
| `npm run typecheck --workspaces` | TypeScript-Prüfung ohne Emit |
| `npm test` | Vitest-Suiten für Server & Client |
| `npm run seed` | Datenbank mit Basisdaten befüllen |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle-Migrationen erzeugen, anwenden, erkunden |
| `npm run timetable:import` | WebUntis-Stundenplan importieren |

---

## Tests & Qualitätssicherung

```bash
npm test                        # Server- & Client-Suiten (Vitest)
npm run typecheck --workspaces  # TypeScript-Prüfung
npm run build                   # Produktions-Build
python -m unittest discover -s scripts/test   # Ops- & Backup-Skripte
```

- Die Server-Suite erwartet eine gesetzte `PORT`-Umgebungsvariable (z. B. `PORT=3000 npm test`). Integrationstests laufen zusätzlich gegen eine Wegwerf-Datenbank (`TEST_DATABASE_URL`) und werden ohne diese Konfiguration übersprungen.
- **CI (GitHub Actions):** Typecheck, Tests gegen PostgreSQL 17, Python-Tests und Build — bei jedem Push auf `main`, `feature/**`, `fix/**`, `review/**` sowie bei Pull Requests auf `main`.

---

## Deployment & Betrieb

- **Erstinstallation:** siehe [1-Klick-Installation](#1-klick-installation-proxmox-lxc).
- **Updates / neue Releases** (aus dem lokalen Checkout, SSH-Key-Auth zum Proxmox-Host):

```bash
npm ci
npm run build
python scripts/deploy.py
```

Ablauf des Deployments: Pre-Flight-Backup → Bundle-Upload in den Container → neue Release-Version inkl. Produktions-Dependencies → atomarer Symlink-Wechsel + `systemctl restart smile.service` → Health-Check mit automatischem Rollback auf die vorherige Release → Aufräumen & Retention-Pruning. Zielumgebung steuerbar über `PROXMOX_HOST`, `LXC_CONTAINER_ID` und `PROXMOX_USER`.

---

## Backup & Wiederherstellung

- **Automatisches Backup:** verschlüsselter 10-Minuten-Takt in die schulische Microsoft-365-Cloud (Graph API), zusätzlich eine 19:00-Tagesschluss-Sicherung; konfigurierbare Retention für lokale und Cloud-Snapshots.
- **Restore:** direkt im Admin-Bereich der SMILE-Weboberfläche. Unterstützt werden PostgreSQL-Custom-Dumps (`*.dump`, verschlüsselt `*.dump.enc`); vor jedem Restore erstellt das System automatisch eine Sicherheitskopie, bei Fehlern wird automatisch zurückgerollt, und jedes Ergebnis landet im Audit-Log.
- **Details:** [`docs/BACKUP.md`](docs/BACKUP.md) · **Sicherheitsmodell:** [`docs/SECURITY.md`](docs/SECURITY.md)

---

## Rollen- & Berechtigungskonzept

| Rolle | Zuständigkeit & Berechtigungen |
| :--- | :--- |
| 👑 **Schulleitung (`SLC`, `MED`)** | • Zugriff auf alle Klassen (`1B` bis `4G`)<br>• Konferenzmodus mit Beschlussrechten<br>• SLC: Time-Out Eskalations-Dashboard (Mahnstufen 3, 6, 9...)<br>• Vollständige Schulstatistiken |
| 🧑‍🏫 **Klassenvorstände (KVs)** | • Vollzugriff auf die eigene Stammklasse<br>• Mahnstufen-Warnungen (Gelbe Karten ≥ 2) für eigene Schüler<br>• Konferenz-Modus für die eigene Klasse |
| 📚 **Fachlehrpersonen (z. B. `ZIA`)** | • Zugriff auf die zugewiesenen Klassen laut Stundenplan<br>• Beobachtungsraster für eigene Fächer laut WebUntis<br>• Vergabe von Karten und Time-Outs im Schulalltag |
| 🛡️ **Administrator (`admin`)** | • Vollzugriff auf alle Systembereiche, Benutzerverwaltung und Backups/Restores |

---

## Echtzeit-Kollaboration (Live-Sync)

- 🔄 **Kein Neuladen erforderlich:** Bewertet Lehrkraft A einen Schüler oder vergibt eine Karte, erscheint die Änderung in Bruchteilen einer Sekunde bei allen angemeldeten Kolleginnen und Kollegen.
- 🔒 **Smarte Zellensperren (Soft Locks):** Bearbeitet jemand gerade ein Kriterium, sehen andere ein dezentes Namens-Badge auf der Zelle, um Überschreiben zu verhindern.
- 🛑 **Klassen-Konferenzsperre:** Sobald die Konferenzleitung eine Klasse sperrt, wird das Raster für Fachlehrer in Echtzeit schreibgeschützt — unabhängig von anderen Klassen.
- 🏫 **Lernwerkstatt-Raum 999:** Multi-Room-Unterstützung für Live-Meldungen zwischen Klassenzimmern und der Betreuung in der Lernwerkstatt.

---

## Dokumentation

| Dokument | Inhalt |
| :--- | :--- |
| [`docs/BACKUP.md`](docs/BACKUP.md) | Backup-Architektur, Restore-Ablauf, M365-Anbindung (Graph API) |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Authentifizierung, Session-Sicherheit, bekannte Grenzen |
| [`docs/history/invariants-history.md`](docs/history/invariants-history.md) | Historie der System-Invarianten |
| [`AGENTS.md`](AGENTS.md) · [`AI.md`](AI.md) · [`IF_YOU_ARE_AN_AI.md`](IF_YOU_ARE_AN_AI.md) | Entwicklungsrichtlinien und Leitplanken für Mitwirkende |
| [`docs/archive/`](docs/archive/) | Archivierte Architektur- und Review-Dokumente |
| [`docs/SMILE_Bewertungs_Guide.pdf`](docs/SMILE_Bewertungs_Guide.pdf) | 3-seitiger Bewertungs-Leitfaden für Lehrkräfte |
| [`docs/SMILE_Benutzerhandbuch.pdf`](docs/SMILE_Benutzerhandbuch.pdf) | Benutzerhandbuch |

---

## Lizenz

Proprietär — © 2026 MS Telfs Dr. Aloys Weissenbach. Alle Rechte vorbehalten.
Details siehe [`LICENSE`](LICENSE).
