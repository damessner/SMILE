# ✨ SMILE — Collaborative Assessment & School Management
> **Moderne Schülerbeobachtung, Verhaltenserfassung & Klassenkonferenzen**  
> *MS Telfs Dr. Aloys Weissenbach (Schuljahr 2026/2027)*

---

## 🎯 Über SMILE

**SMILE** ist eine kollaborative Plattform für Lehrpersonen und Schulleitung, die den Schulalltag, die kontinuierliche Verhaltensbeobachtung und die Notenkonferenzen in einem modernen, intuitiven Interface vereint. 

Statt mühsam papierbasierte Bögen auszufüllen, arbeiten alle Lehrkräfte in Echtzeit zusammen — transparent, motivierend und transparent für Schülerinnen und Schüler.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🌟 MEISTER                 🛠️ GESELLE                  🌱 LEHRLING          │
│ Herausragende Leistungen   Solide & verlässliche       Fokus auf Begleitung │
│ & Vorbildfunktion          Mitarbeit im Schulalltag    & nächste Lernschritte│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ 1-Klick Proxmox Installation (LXC Helper Script)

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

## 🚀 Kernfunktionen im Überblick

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

### 🚨 3. SLC Time-Out Eskalationssystem (Mahnstufen 3, 6, 9...)
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

## 👥 Rollen- & Berechtigungskonzept

| Rolle | Zuständigkeit & Berechtigungen |
| :--- | :--- |
| 👑 **Schulleitung (`SLC`, `MED`)** | • Zugriff auf alle Klassen (`1B` bis `4G`)<br>• Konferenzmodus mit Beschlussrechten<br>• SLC: Time-Out Eskalations-Dashboard (Mahnstufen 3, 6, 9...)<br>• Vollständige Schulstatistiken |
| 🧑‍🏫 **Klassenvorstände (KVs)** | • Vollzugriff auf die eigene Stammklasse<br>• Mahnstufen-Warnungen (Gelbe Karten ≥ 2) für eigene Schüler<br>• Konferenz-Modus für die eigene Klasse |
| 📚 **Fachlehrpersonen (z. B. `ZIA`)** | • Zugriff auf die zugewiesenen Klassen laut Stundenplan<br>• Beobachtungsraster für eigene Fächer laut WebUntis<br>• Vergabe von Karten und Time-Outs im Schulalltag |
| 🛡️ **Administrator (`admin`)** | • Vollzugriff auf alle Systembereiche, Benutzerverwaltung und Backups/Restores |

---

## ⚡ Echtzeit-Kollaboration (Live-Sync)

- 🔄 **Kein Neuladen erforderlich:** Bewertet Lehrkraft A einen Schüler oder vergibt eine Karte, erscheint die Änderung in Bruchteilen einer Sekunde bei allen angemeldeten Kolleginnen und Kollegen.
- 🔒 **Smarte Zellensperren (Soft Locks):** Bearbeitet jemand gerade ein Kriterium, sehen andere ein dezentes Namens-Badge auf der Zelle, um Überschreiben zu verhindern.
- 🛑 **Klassen-Konferenzsperre:** Sobald die Konferenzleitung eine Klasse sperrt, wird das Raster für Fachlehrer in Echtzeit schreibgeschützt — unabhängig von anderen Klassen.
- 🏫 **Lernwerkstatt-Raum 999:** Multi-Room-Unterstützung für Live-Meldungen zwischen Klassenzimmern und der Betreuung in der Lernwerkstatt.