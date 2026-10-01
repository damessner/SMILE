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

### 📋 4. Beobachtungsraster & Bewertung
Das Herzstück für die formative Beurteilung der überfachlichen Kompetenzen:

- 🧩 **18 Beobachtungsmerkmale in 6 Schlüsselbereichen:**
  1. 🗂️ **Arbeitsorganisation:** Arbeitsauftrag kennen, selbstständiger Start, Material- und Zeiteinteilung.
  2. 💡 **Fragen & Problemlösen:** Gezieltes Nachfragen, präzise Problemformulierung, eigene Lösungsansätze.
  3. 🎯 **Arbeitshaltung:** Konzentration, Ausdauer, Mitschüler nicht stören, Dranbleiben bei Hürden.
  4. 🤝 **Verantwortung:** Regeln einhalten, zu Entscheidungen stehen, verantwortungsvoller Umgang mit Freiräumen.
  5. 🪞 **Reflexion:** Realistische Selbsteinschätzung, Stärken/Schwächen erkennen, nächste Lernschritte benennen.
  6. 🔍 **Verstehen statt Erledigen:** Echtes Verständnis prüfen, Fehler konstruktiv aufarbeiten, Qualität vor Quantität.

- 😊 **5 Smiley-Bewertungsstufen:**
  - 👑 **Krone:** Herausragend erfüllt
  - 😊 **Lächeln:** Gut & verlässlich erfüllt
  - 😖 **Angestrengt:** Teilweise / mit Unterstützung erfüllt
  - 😢 **Traurig:** Noch nicht erfüllt
  - 🔄 **Neustart:** Zurücksetzen / Neu ansetzen
  - *(Leer):* Keine Beurteilung abgegeben

- ⚡ **Schnellauswahl & Sofort-Rang:**
  - Ganze Kategorien mit einem einzigen Smiley-Klick füllen.
  - Schnellbuttons: *„Meister füllen“*, *„Geselle füllen“*, *„Reset“*.
- 📂 **Zwei-Ordner-Workflow:**
  - **Offen:** Noch zu bewertende Schülerinnen und Schüler.
  - **Bewertet:** Bereits eingereichte Bewertungen mit Zeitstempel.
  - Nach Klick auf *„Ranking einreichen“* springt die Ansicht automatisch zur nächsten Person.

---

### ⚖️ 5. Konferenz-Modus (Klassenkonferenz & Abstimmung)
Spezieller Vollbildmodus für die Beschlussfassung am Notenkonferenztag:

- 🖥️ **Präsentationsansicht:** Für Beamer und Großbildschirme optimiert.
- 📊 **Farbbalken pro Schüler:**
  - 🟨 **Gelb:** Meister-Vorschlag
  - 🟦 **Blau:** Gesellen-Vorschlag
  - 🟥 **Rot:** Lehrlings-Vorschlag
- 🗳️ **Demokratische Beschlussfassung:**
  - Zeigt die Stimmen aller unterrichtenden Lehrpersonen einer Klasse.
  - Button **`[ Angenommen ]`** mit Live-Anzeige der Gegenstimmen (basierend auf der Anzahl der unterrichtenden Lehrkräfte).
  - Fehlklicks können jederzeit per Klick wieder rückgängig gemacht werden.
  - Zum Stichtag werden alle Beschlüsse revisionssicher fixiert.

---

### 📊 6. Schul- & Klassenstatistik
Transparente Kennzahlen für Lehrkräfte und Schulleitung:

- 📈 **Übersichtliche Balkendiagramme:** Anteil von Lehrlingen, Gesellen und Meistern auf Klassen- und Schulebene.
- 🎯 **Verteilungsquoten:** Schneller Überblick über Förderschwerpunkte und Klassenentwicklungen über das Schuljahr.

---

### 🖨️ 7. 1-Seiten Klassenexport (PDF / Druck)
Kompakter Überblick für Konferenzen, Elterngespräche (KEL) und Notizen:

- 📄 **1 Seite pro Klasse:** Alle Notizen, Rangempfehlungen und Kriterienübersichten komprimiert auf einer DIN-A4-Druckseite.
- 🖨️ **Druckoptimiert:** Klares Layout ohne störende Seitenelemente für den schnellen Ausdruck im Lehrerzimmer.

---

## 👥 Rollen- & Berechtigungskonzept

| Rolle | Zuständigkeit & Berechtigungen |
| :--- | :--- |
| 👑 **Schulleitung (`SLC`, `MED`)** | • Zugriff auf alle Klassen (`1B` bis `4G`)<br>• Konferenzmodus mit Beschlussrechten<br>• SLC: Time-Out Eskalations-Dashboard (Mahnstufen 3, 6, 9...)<br>• Vollständige Schulstatistiken |
| 🧑‍🏫 **Klassenvorstände (KVs)** | • Vollzugriff auf die eigene Stammklasse<br>• Mahnstufen-Warnungen (Gelbe Karten ≥ 2) für eigene Schüler<br>• Konferenz-Modus für die eigene Klasse |
| 📚 **Fachlehrpersonen (z. B. `ZIA`)** | • Zugriff auf die zugewiesenen Klassen laut Stundenplan<br>• Beobachtungsraster für Hauptfächer (D, M, E; z. B. SD+D als eine Einheit)<br>• Vergabe von Karten und Time-Outs im Schulalltag |
| 🛡️ **Administrator (`admin`)** | • Vollzugriff auf alle Systembereiche, Benutzer und Backups |

---

## ⚡ Echtzeit-Kollaboration (Live-Sync)

- 🔄 **Kein Neuladen erforderlich:** Bewertet Lehrkraft A einen Schüler oder vergibt eine Karte, erscheint die Änderung in Bruchteilen einer Sekunde bei allen angemeldeten Kolleginnen und Kollegen.
- 🔒 **Smarte Zellensperren (Soft Locks):** Bearbeitet jemand gerade ein Kriterium, sehen andere ein dezentes Namens-Badge auf der Zelle, um Überschreiben zu verhindern.
- 🛑 **Konferenz-Sperre:** Sobald die Konferenzleitung eine Klasse sperrt, wird das Raster für Fachlehrer in Echtzeit schreibgeschützt.