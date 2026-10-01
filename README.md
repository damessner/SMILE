# README — SMILE

**MS Telfs Dr. Aloys Weissenbach (Schuljahr 2026/2027)**

SMILE ist eine Web-Plattform zur kollaborativen Schülerbeobachtung, Verhaltenserfassung,
Klassenkonferenz und zum täglichen Klassenmanagement.

> **Before deploying:** read [`docs/SECURITY.md`](docs/SECURITY.md). The previous
> version shipped live credentials and shared passwords in this repository. Those
> secrets must be rotated, and the manual steps are listed there.

---

## Systemübersicht

```
[ Client: React 19 + Vite 8 + Tailwind CSS 4 ]
                     │
        HTTP/REST   │  WebSocket (/ws, authentifiziert)
                     ▼
[ Backend: Fastify 5 + TypeScript + JWT (httpOnly Cookie) ]
                     │
        Drizzle ORM │  node-postgres Pool (lazy)
                     ▼
[ Database: PostgreSQL 17 · Schema via versionierte Migrationen ]
```

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Vite. Compact responsive tables,
  accessible modals, error boundary.
- **Backend:** Fastify 5, `@fastify/websocket`, `@fastify/jwt`, `@fastify/cookie`,
  `@fastify/rate-limit`, `@fastify/static`.
- **Datenbank:** PostgreSQL. The schema is owned by a single source of truth
  (`server/src/db/schema.ts`) and applied through generated Drizzle migrations. There
  is no hand-written DDL.

---

## Erste Einrichtung

```bash
npm install

# Secrets: keine Defaults, der Server startet sonst nicht.
cp .env.example .env
# Werte eintragen. Zwei Secrets generieren:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"   # INITIAL_USER_PASSWORD

# Schema anlegen und Stammdaten aus export/ importieren
npm run db:migrate
npm run seed

npm run build
npm start
```

### Zugänge

Es gibt **keine** gemeinsamen Standardpasswörter mehr. `npm run seed` erstellt jedes Konto
mit einem individuellen Startpasswort aus `INITIAL_USER_PASSWORD` und setzt
`must_change_password`. Bis zum Ändern des Passworts sind schreibende Zugriffe
serverseitig gesperrt.

Ein erneuter `npm run seed` überschreibt **keine** bestehenden Passwörter.

Passwort vergessen: Die Schulleitung ruft `POST /api/auth/request-reset` auf. Es gibt
bewusst keinen Self-Service-Reset, da im Schulnetz kein Mailversand stattfindet.

---

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Server und Client parallel starten |
| `npm run dev:server` | Nur der Server (`tsx watch`) |
| `npm run dev:client` | Nur der Vite-Dev-Server auf Port 5173 |
| `npm run build` | Server (`tsc`) und Client (`vite build`) bauen |
| `npm start` | Gebauten Server starten |
| `npm test` | Testsuite (94 Tests) |
| `npm run typecheck` | Typecheck für beide Workspaces |
| `npm run db:generate` | Neue Migration aus `schema.ts` erzeugen |
| `npm run db:migrate` | Ausstehende Migrationen anwenden |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed` | Stammdaten aus `export/` importieren |

Nach jeder `npm install` läuft `scripts/verify-env.mjs`: Der Check bricht mit Exit-Code 1
ab, wenn `.env` noch die alten, kompromittierten Secrets enthält oder Backup-Archive mit
Schülerdaten im Arbeitsverzeichnis liegen.

---

## Rollen und Berechtigungen

Die Berechtigungslogik liegt zentral in `server/src/lib/guards.ts`
(`getClassAccess`). Jede Route prüft gegen dieses Ergebnis; es gibt keine
route-lokalen Kopien mehr.

| Rolle | Zugriff |
| :--- | :--- |
| **Administrator (`admin`)** | Alle Klassen, Konferenzen, Backups, Benutzerverwaltung |
| **Schulleitung (`SLC`, `MED`)** | Alle Klassen, Konferenzmodus, Eskalations-Dashboard, Statistiken |
| **Klassenvorstand** | Vollzugriff auf die eigene Stammklasse; Schüleranlage/-bearbeitung; Konferenzmodus für diese Klasse |
| **Fachlehrperson** | Nur zugewiesene Klassen laut Stundenplan; Karten und Time-Outs dort; Bewertungsraster nur für Hauptfächer (D, M, E) |

`canRead` / `canRecord` / `canRate` / `canManagePupils` / `canRunConference` sind getrennt
vorhanden, damit eine Route nur die Berechtigung prüft, die sie tatsächlich braucht.

Karten-Aktionen: Eine Karte kann nur von der ausstellenden Lehrperson, dem
Klassenvorstand oder der Schulleitung zurückgezogen werden.

---

## Konferenzmodus

- Zugriff: Schulleitung sowie die Klassenvorstände der jeweiligen Klasse.
- Eine Bestätigung wird gegen `pupilId ∈ classId` geprüft. Ein Beschluss für einen
  Schüler einer anderen Klasse wird abgelehnt.
- Beschlüsse tragen den Konferenzzeitstempel aus `OFFICIAL_CONFERENCE_DATE`.
- `vote-all` läuft als eine Transaktion: die Klasse ist entweder ganz oder gar nicht
  bestätigt.

---

## Bewertungslogik

Die Rangberechnung liegt einmalig in `server/src/lib/ranking.ts`. Vorher war sie in
zwei Routendateien dupliziert, mit fest verdrahteten Schwellen von 14/8.

```
positiv bewertet >= RANK_THRESHOLD_MEISTER  -> Meister
positiv bewertet >= RANK_THRESHOLD_GESELLE  -> Geselle
sonst                                       -> Lehrling
aktive Rote Karte                           -> eine Stufe abwärts
```

`RANK_AGGREGATION` steuert, was "positiv bewertet" über mehrere Fachlehrkräfte hinweg
bedeutet:

- `total` (Vorgabe, bisheriges Verhalten): Summe aller positiven Merkmale über alle
  Bewertungen. Die Summe wächst mit der Zahl der beteiligten Lehrkräfte.
- `normalized`: Jede Bewertung wird auf 18 Merkmale normiert, bevor gemittelt wird. "14"
  bedeutet dann unabhängig von der Lehrkraftzahl 14 von 18.

Beide Werte sind in `.env` konfigurierbar, ebenso die Schwellen selbst.

---

## Echtzeit-Synchronisierung

`/ws` ist authentifiziert. Eine nicht angemeldete Verbindung wird mit 401 abgelehnt,
bevor der Socket geöffnet wird. Die Identität stammt ausschließlich aus dem verifizierten
JWT; Angaben aus der Nachricht (`teacherId`, `teacherName`) werden ignoriert.

- **Zellen-Sperren:** Wer eine Zelle bearbeitet, sieht einen Hinweis bei den Kolleginnen.
- **Konflikte:** Bewertungen werden mit einem atomaren Versionsvergleich geschrieben.
  Zwei gleichzeitige Taps können nicht beide gewinnen; der Verlierer bekommt ein
  `CONFLICT` mit dem aktuellen Stand.
- **Heartbeat:** 30 Sekunden. Sockets, die ohne TCP-FIN verschwinden, werden entfernt.
- **Räume:** maximal `WS_ROOM_MAX_CLIENTS` Verbindungen pro Klasse.

---

## Datenbank und Migrationen

Das Schema liegt in `server/src/db/schema.ts`. Änderungen laufen über:

```bash
npm run db:generate   # erzeugt server/drizzle/000N_*.sql
npm run db:migrate    # wendet sie an
```

Migrationen werden beim Serverstart automatisch angewendet, bevor Traffic angenommen wird.

Indisizes auf heißen Pfaden (Karten je Schüler, Time-Outs, Stundenplan je Lehrkraft und
Tag, Klassenzugriffsprüfungen) und Unique-Indizes, die doppelte Bewertungen und
Beschlüsse unter Nebenläufigkeit verhindern, sind Teil des generierten Schemas.

---

## Backup

- `GET /api/backup/export-json` — vollständiger Datenexport, **nur für `admin`**. Der
  Audit-Log ist vollständig enthalten (vorher auf 500 Zeilen gekürzt).
- `GET /api/backup/verify` — Erreichbarkeit und Zeilenzahlen.
- `GET /api/backup/audit-log` — Audit-Log paginiert durchsuchbar.

Ein Wiederherstellen ist **nicht** implementiert. Ein JSON-Export ersetzt kein
`pg_dump`: Er hängt an der ORM-Abbildung und erfasst keine Schemaänderungen.

Automatische Backups über Cron oder PBS sind in `PLAN.md` §7 beschrieben, aber nicht
umgesetzt.

---

## Tests

```bash
npm test
```

Abgedeckt: Konfigurationsvalidierung (inklusive Ablehnung der kompromittierten Secrets),
Berechtigungslogik für Klassenvorstand und Rollen, Rangberechnung und
Rangdemotion, WebSocket-Autorisierung (einschließlich der Regressionen „teacherId
weglassen" und „teacherId fälschen"), Sicherheitsheader, CSRF-Origin-Prüfung und die
Authentifizierungspflicht jeder einzelnen Route.

---

## Verzeichnisstruktur

```
SMILE/
├── client/
│   └── src/
│       ├── components/     # UI
│       ├── hooks/          # useLiveSync
│       ├── services/       # api.ts (Cookie-Session)
│       └── types.ts
├── server/
│   ├── drizzle/            # generierte Migrationen
│   └── src/
│       ├── config.ts       # Env-Validierung, keine Secret-Defaults
│       ├── db/             # schema.ts, Migrationen, Seed
│       ├── lib/            # guards.ts, ranking.ts, session.ts
│       ├── plugins/        # security.ts
│       ├── routes/         # REST-Endpunkte
│       └── ws/live-sync.ts
├── docs/SECURITY.md        # Findings und offene Punkte
├── export/                 # WebUntis-Exporte (Eingang für den Seed)
└── scripts/verify-env.mjs  # Post-Install-Secrets-Check
```

---

## Infrastruktur

| Parameter | Wert |
| :--- | :--- |
| Proxmox Host | `192.168.178.87:8006` |
| LXC Container | `115` (`smile`) |
| Anwendung | `http://192.168.178.54:3000` |
| OS | Debian 12 |
| Node.js | 22+ |
| PostgreSQL | 17 auf `127.0.0.1:5432` |
| Datenbank | `smile_db` |
| Verzeichnis | `/opt/smile` |
| Service | `smile.service` |

```bash
pct exec 115 -- systemctl status smile.service
pct exec 115 -- journalctl -u smile.service -f
```

---

## Offene Punkte

- Kein TLS. Das Schulnetz liefert HTTP; der Session-Cookie ist `httpOnly` und
  `SameSite=Strict`, aber im Klartext unterwegs. `COOKIE_SECURE=true` und ein
  TLS-Terminierender Proxy sind empfohlen.
- Kein automatisierter Backup-Zyklus.
- Kein Wiederherstellen aus dem Export.
- `PLAN.md` beschreibt teilweise den alten Stand (Stack, Standardpasswörter).
- Keine CI-Pipeline; Tests laufen lokal.