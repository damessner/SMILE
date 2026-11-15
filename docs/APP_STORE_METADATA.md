# SMILE – App Store Connect Ausfüllhilfe

Kopierfertige Angaben für alle Pflichtfelder in [App Store Connect](https://appstoreconnect.apple.com/apps/6833989418) (Deutsch / Österreich).

---

## 1. App-Informationen (`App Information`)

- **Primary Category (Hauptkategorie):** `Bildung` (`Education`)
- **Secondary Category (Zweitkategorie, optional):** `Produktivität` (`Productivity`)
- **Content Rights (Inhaltsrechte):**
  - *„Enthält Ihre App Inhalte Dritter …?“* → **Nein**, alle Rechte liegen bei der Mittelschule Telfs Dr. Aloys Weissenbach (bzw. „Diese App enthält keine Inhalte von Dritten …“).
- **Age Rating (Altersfreigabe / Fragebogen):**
  - Alle Inhaltsfragen (Gewalt, Glücksspiel, medizinische Themen, Webzugriff ohne Einschränkung, nutzergenerierte öffentliche Inhalte usw.) mit **Keine / Nein** beantworten → ergibt **`4+`**.
  - Hinweis zu *„Uneingeschränkter Webzugang“*: **Nein** (die App ist kein Browser und lädt keine beliebigen Webseiten).

---

## 2. Preise und Verfügbarkeit (`Pricing and Availability`)

- **Price Schedule / Price Tier:** **`EUR 0,00` (Kostenlos / Free)**
- **Verfügbarkeit:** Nach Wunsch *Alle Länder* oder nur *Österreich (AT)* (empfohlen: *Österreich*, falls nur für die eigene Schule gedacht – oder *Unlisted App / Nicht gelistete App* bzw. *Apple School Manager*, siehe Abschnitt 6).

---

## 3. App-Datenschutz (`App Privacy` – Admin-Rolle erforderlich)

> **Wichtig:** Nur ein Account mit der Rolle **Admin** oder **Account Holder** in App Store Connect darf diesen Bereich ausfüllen.

1. **Datenschutzrichtlinie-URL (`Privacy Policy URL`):**
   - Öffentliche HTTPS-URL zu [docs/privacy.html](privacy.html) eintragen, z. B.:
     - Entweder auf der Schulwebsite hochgeladen: `https://ms-telfs.at/smile/privacy.html`
     - Oder über GitHub Pages (falls Repository öffentlich & Pages unter *Settings → Pages → main /docs* aktiv): `https://damessner.github.io/SMILE/privacy.html`
2. **Datenerfassung („Get Started / Los geht's“):**
   - **Ja, wir erfassen Daten aus dieser App** *(da Lehrpersonen sich mit Benutzername/Kürzel anmelden und Unterrichtsdaten am Schulserver speichern)*:
   - **Kontaktdaten / Kennungen (`Identifiers` → `User ID`):**
     - Verwendet für: **App-Funktionalität** (`App Functionality`)
     - Mit Identität verknüpft: **Ja**
     - Tracking: **Nein**
   - **Nutzerinhalte (`User Content` → `Other User Content`, optional falls als App-Daten deklariert):**
     - Verwendet für: **App-Funktionalität** (`App Functionality`)
     - Mit Identität verknüpft: **Ja**
     - Tracking: **Nein**
   - **Diagnosedaten / Analyse / Werbung:** **Nicht ausgewählt** (keine Drittanbieter-SDKs, kein Tracking).
   - Auf **Veröffentlichen (`Publish`)** klicken!

---

## 4. App Store-Version `2.1.1` (`Distribution → iOS App`)

### Beschreibung (`German - Description`)
```text
SMILE ist die Begleit-App für Lehrpersonen der Mittelschule Telfs Dr. Aloys Weissenbach im täglichen Unterricht.

Funktionen im Überblick:
• Schulalltag: Automatische Erkennung der aktuellen Unterrichtsstunde, Klassenübersicht mit Kompetenzrängen und Schnellaktionen für Verhaltenskarten (Grün, Gelb, Rot), Time-Out und Cool-Down.
• Bewertung: Fachbezogene und gebündelte Rangvorschläge (Meister, Geselle, Lehrling) inklusive Abgabe und Rücknahme vor der Frist.
• Lernwerkstatt: Übersicht über aktive Time-Outs und Cool-Downs mit direkter Erledigungsmeldung und Verlauf.
• Schüler-Historie: Einsicht in vergebene Karten, Verhaltensstufe, Verhaltensnote und pädagogische Maßnahmen.
• Schulstatistik & Alle Klassen: Faktenbasierte Klassen- und Schulauswertungen im Schulnetzwerk.
• Sicherheit: Verschlüsselte Verbindung zum schuleigenen SMILE-Server und Anmeldung per Face ID / Touch ID.

Hinweis: Zur Nutzung wird ein aktives Lehrpersonen-Konto der Mittelschule Telfs benötigt.
```

### Schlagwörter (`German - Keywords` – 95 von max. 100 Zeichen)
```text
SMILE,Schule,Mittelschule,Telfs,Schulalltag,Lernwerkstatt,Bewertung,Verhalten,Lehrer,Unterricht
```

### Support-URL (`German - Support URL`)
Öffentliche HTTPS-URL zu [docs/support.html](support.html), z. B.:
- `https://ms-telfs.at/smile/support.html` oder `https://damessner.github.io/SMILE/support.html`

### Copyright (`Copyright`)
```text
© 2026 Mittelschule Telfs Dr. Aloys Weissenbach
```

### Neuheiten in dieser Version (`What's New in This Version` – `2.1.1`)
```text
• Gesamt-Modus in der Bewertung für gebündelte Rangvorschläge über mehrere Fächer
• Anzeige von Verhaltensstufe, Rang und pädagogischen Maßnahmen in der Schüler-Historie
• Automatische Aktualisierung des Lernwerkstatt-Zählers beim App-Wechsel und alle 30 Sekunden
• Verbesserte Keychain-/Face-ID-Sicherheit und Validierung der Server-URL
```

### Kontaktinformationen (`App Review Information → Contact Information`)
- **First Name / Last Name:** Name der verantwortlichen Lehrperson / Admin
- **Phone Number:** Dienstliche Telefonnummer (mit Ländervorwahl `+43...`)
- **Email Address:** `smile@ms-telfs.at` (oder Admin-Adresse)

---

## 5. Screenshots (`iPhone Dynamic Island` & `13-inch iPad`)

Apple verlangt **sRGB PNG (ohne Transparenz/Alpha) oder JPEG**:
- **iPhone with Dynamic Island (medium / 6.3"):** `1206 × 2622` px (oder `1179 × 2556` px; alternativ `1290 × 2796` / `1320 × 2868` px für 6.9")
- **13-inch iPad displays:** `2064 × 2752` px (oder `2048 × 2732` px)

### Automatische Erstellung über GitHub Actions (ohne Mac vor Ort)
Im Repository existiert der manuelle Workflow [`.github/workflows/ios-screenshots.yml`](../.github/workflows/ios-screenshots.yml):
1. Auf GitHub **Actions → SMILE iOS App Store Screenshots → Run workflow** ausführen.
2. Nach Abschluss das Artefakt **`SMILE-appstore-screenshots`** herunterladen und entpacken.
3. Inhalt von `iphone/` in den iPhone-Screenshot-Bereich und `ipad-13/` in den 13-Zoll-iPad-Bereich in App Store Connect ziehen.

---

## 6. Wichtiger Hinweis für das Apple App Review (`Sign-in required`)

Die App verbindet sich standardmäßig mit der schulinternen Adresse `https://172.16.1.11`.
Während des **Apple App Reviews** muss das Apple-Review-Team die App jedoch testen können:
- **Option A (Test-Zugang für Apple Review):** Ein kurzzeitig erreichbares HTTPS-Demo-System + Test-Benutzername/Passwort im Abschnitt **Sign-in required** eintragen (Apple wählt den Server über *„Server: …“* auf dem Login-Bildschirm).
- **Option B (Interne Verteilung ohne öffentlichen App Store):** Falls die App ausschließlich für Lehrpersonen-/Schul-iPads gedacht ist, prüfen Sie **Apple School Manager (Custom Apps)** oder **TestFlight**, da öffentliche App-Store-Apps laut App-Review-Richtlinie 2.1 für den Reviewer anmeldbar sein müssen.
