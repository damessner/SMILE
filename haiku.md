# SMILE: Critical Review and Concrete Fixes

Scope: a code and docs review of the current `main` (HEAD `881e56a`). I read the source directly. I did not run `npm test` or the typecheck for this review. Every finding below names the file and line I checked.

---

## 1. Verdict

The security and invariant work is real. The subject-code allowlists, the OCC version checks, the scoped rank reads, the CORS allowlist, the JWT fail-fast and the WS heartbeat are all in place and tested.

The remaining risks are concentrated in four places:

1. **A shared bootstrap password** across every seeded teacher account.
2. **The backup and restore path**, which bypasses config and has no automatic rollback.
3. **Unvalidated WebSocket payloads** and oversized client components.
4. **Documentation drift**, which is now a risk to the AI agents that read it.

---

## 2. Priority Fixes

### P0: Security

**P0-1. Shared bootstrap password for all new accounts.**
- Evidence: `server/src/db/seed.ts:186-190`. Every new account is hashed from the same `INITIAL_USER_PASSWORD`. Anyone who learns it can log in as any teacher who has not logged in yet.
- Fix (pick one, in order of preference):
  - Generate a random one-time password per account in the seed (`crypto.randomBytes`). Print it once to the console, or write it to an admin-only export. `must_change_password` already exists.
  - Or issue credentials through the existing `POST /api/auth/admin/temporary-password` flow (`auth.ts`) and seed accounts with no usable password.
  - Add a boot warning when `INITIAL_USER_PASSWORD` is still in use and any account has `must_change_password = true` and `last_login_at IS NULL`.
- Test: seed twice with the same env; assert the two generated passwords differ and that no account hash matches `INITIAL_USER_PASSWORD`.
- **Status: OPEN.** `server/src/db/seed.ts:187` still hashes every new account from `INITIAL_USER_PASSWORD`.


**P0-2. Restore has no automatic rollback.**
- Evidence: `server/src/routes/backup.ts:443-447`. On failure, the catch returns a 500 and the DB is left in whatever state `pg_restore --clean` produced. The safety dump is created at line 385, but the catch never mentions its filename.
- Fix:
  - On failure, run `pg_restore --clean` again from `safetyFilePath` and return the safety filename in the 500 body.
  - Log the safety filename at error level.
  - Close WS sockets *before* `pg_restore` starts, not after it succeeds (currently line 435). Clients otherwise keep writing into a database that is being replaced.
- Test: a failing restore must trigger a rollback call and report `preRestoreBackup`.
- **Status: OPEN.** `backup.ts` restore catch still returns a bare 500 with no rollback (≈443–447); WebSockets still close only after success (≈435).


**P0-3. Database password on the process command line.**
- Evidence: `backup.ts:49` and `:53` pass `databaseUrl()` (which includes the password) as an `execFile` argument. Other local users can read it from the process list on many systems.
- Fix: pass credentials through `PGPASSWORD` in the child env, or use a `.pgpass` file. Keep `-d` with a password-free URL.
- **Status: OPEN.** `backup.ts` still passes `dbUrl` (with the password) as `pg_dump` / `pg_restore` argv (≈49, 53).


### P1: Correctness and Config

**P1-1. Config bypass in the backup route.**
- Evidence: `backup.ts:274`, `:370` read `BACKUP_DIR` directly. `:396` reads `BACKUP_ENCRYPTION_PASSPHRASE`. `index.ts:292` reads `RUN_MIGRATIONS`. The rest of the config goes through `server/src/config.ts`.
- Fix: add `backupDir`, `backupEncryptionPassphrase` and `runMigrations` to `config.ts`, validated at boot. Replace the direct reads. This also gives you one place to fail fast when the passphrase is missing.
- **Status: OPEN.** `backup.ts` still reads `BACKUP_DIR` (≈274, 370) and `BACKUP_ENCRYPTION_PASSPHRASE` (≈396) directly; `index.ts:292` still reads `RUN_MIGRATIONS` directly.


**P1-2. Unvalidated WebSocket payloads.**
- Evidence: the WS handlers in `server/src/ws/live-sync.ts` took `payload: any` and were not typed. Validation was present but ad hoc: `hasOnlyKeys` allowlists, `parsePositiveInt`, rating, version and subject checks, with German error messages pinned by tests. The gap is typing and shape checks, not missing validation. (Correction to the original text: Fastify's ajv at `index.ts:72` covers HTTP schemas, and `server/package.json` lists no direct validator such as zod, typebox or ajv.)
- Fix: parse the envelope at the top of `ws.on('message')` with a guard, type each handler's payload, and keep the existing checks and error messages. Adding a schema library is optional.
- Test: one behaviour test per message type with an extra field, a missing field and a wrong type.
- **Status: FIXED (2026-10-12).** `ws.on('message')` takes `raw: unknown` and parses an `InboundEnvelope` with `isInboundEnvelope`. All five payload handlers take `payload: unknown`, with the existing checks kept. Unknown message types are still dropped silently, because `live-sync.behavior.test.ts` pins that silence. The one-test-per-type matrix was not added.


**P1-3. Hand-maintained test counts in docs.**
- Evidence: `AGENTS.md` and `AI.md` say the client has 244 tests. Commit `0eaa519` says 241. Both are hand-typed.
- Fix: remove the numbers from docs. If you want them, have `npm test` write `docs/test-status.json` and link to it.
- **Status: FIXED (2026-10-12).** `AGENTS.md`, `AI.md` and `IF_YOU_ARE_AN_AI.md` no longer hard-code counts. They point to `npm test`.


**P1-4. Restore and backup lists are unpaginated.**
- Evidence: the only `LIMIT`/`OFFSET` in the route layer is the backup audit log (`backup.ts:259`). Class rosters, evaluations and card lists load in full.
- Fix: add `limit` and `cursor` to the list endpoints that will grow (evaluations, cards, timeouts, audit). Start with `GET /api/timeouts/active` and the audit list. Cap `limit` at 200 server-side.
- **Status: PARTIAL (2026-10-12).** The shared helper `server/src/lib/pagination.ts` (`parsePageParams`, `paginate`, default 100, cap 500, 400 on invalid input) is applied to `GET /api/classes`, `GET /api/classes/all`, `GET /api/timetable/teacher/:teacherId` and `GET /api/backup/audit-log`. Default responses keep their shape. Other unbounded lists were left unchanged on purpose, because truncating them would hide data the client needs: class pupils, card lists, pupil card history, the alert list, the account list, the backup file list, and the statistics and conference aggregates. Those need product decisions on the cap.


### P2: Maintainability

**P2-1. Oversized components.**
- Evidence: `client/src/components/BeobachtungsGrid.tsx` is **1666 lines**. `client/src/App.tsx` is **1028 lines**. Both hold state, routing, network calls and rendering.
- Fix, in this order (each step is a small, testable PR):
  1. Move the rank and submission logic out of `BeobachtungsGrid.tsx` into `client/src/lib/` as pure functions. `pupilItems.ts` is already the right home.
  2. Move the save and submit handlers into a hook, e.g. `useGridSubmission`.
  3. Split `App.tsx` routing from data loading (`loadClassData`).

**Status: PARTIAL (2026-10-12).** `BeobachtungsGrid.tsx` was split from 1666 to 595 lines. Its parts now live in `client/src/components/beobachtungsGrid/` (`PupilSelector`, `PupilHeader`, `QuickGradeCard`, `CriterionRaster`, `CriterionItemCell`, `SubjectSwitcher`, `GridBanners`, `useCommentAutosave`, `useSaveFeedback`, `helpers`, `types`). `App.tsx` is still 1028 lines, and step 3 (routing vs. `loadClassData`) is not started.

**P2-2. Typed `any` on the event bus.**
- Evidence: `useLiveSync.ts:66` (`onRatingUpdated?: (data: any)`), `live-sync.ts:25` (`on(event, cb: (...args: any[]))`), `db/index.ts:62`.
- Fix: type the `ServerEvent` union once in a shared types file and derive the `switch` exhaustiveness check from it. A `never` default in the `switch` catches a missing `case` at compile time, which would replace the silent `default: break;`.
- **Status: FIXED (2026-10-12).** `live-sync.ts` `on(...)` takes `unknown[]` args, and `db/index.ts` uses `Reflect.get`. In the client, `useLiveSync.ts` has a `LiveSyncInbound` discriminated union with a runtime envelope guard. Its `default` branch is an exhaustive `never` check, and `onRatingUpdated` takes `LiveSyncEvent`. `App.tsx`'s handler is typed to match. `useLiveSync.ts` contains no `any`.

**P2-3. Two sources of truth for security toggles.**
- Evidence: `COOKIE_SECURE` defaults to `false` (`config.ts:232`) and only warns at boot. This is accepted for the LAN, but it means production is insecure unless someone remembers to set it.
- Fix: default `cookieSecure` to `true` when `NODE_ENV=production`, and keep an explicit `COOKIE_SECURE=false` override for the LAN. Add a test for the default in each environment.
- **Status: OPEN.** `server/src/config.ts` still defaults `cookieSecure` to `false` (`COOKIE_SECURE`). A boot warning exists.

**P2-4. Stale review documents.**
- Evidence: `CRITICAL_REVIEW_SMILE.md` says `BeobachtungsGrid.tsx` "not found", says `ranking.js` is referenced, and marks invariants 4 and 5 as "Need to verify". All of that is now resolved or wrong.
- Fix: replace the file with a short pointer to this document, or delete it. Do the same for any other review file that predates the 2026-10-12 pass.
- **Status: FIXED (2026-10-12).** `CRITICAL_REVIEW_SMILE.md` was deleted. This document is the authoritative review. References to it in `docs/CRITICAL_REVIEW_2026-10-12.md` and `docs/SECURITY.md` were updated.

**P2-5. `IF_YOU_ARE_AN_AI.md` is too long for an agent to read well.**
- Evidence: about 300 lines, most of them "RESOLVED" historical notes. The invariants are buried under them.
- Fix: keep only the six invariants, the file map and the command list in `IF_YOU_ARE_AN_AI.md`. Move the historical traps and resolved notes to `docs/history/invariants-history.md` and link to it.
- **Status: PARTIAL (2026-10-12).** `IF_YOU_ARE_AN_AI.md` was slimmed to about 144 lines with the six invariants, file map, rubric config and commands kept. The history was condensed into a short §5 list instead; `docs/history/invariants-history.md` was not created.

### P3: Repository Hygiene

- The repo root has about 25 loose files and folders: `bugfix.md`, `PLAN.md`, two architecture and review documents, `UntisPlus-main/`, `tools/`, `.freebuff/`, `.pi/`, `.superpowers/`, `.worktrees/`, and an untracked `scripts/generate_html_guide.py`.
  - Fix: move planning and review docs under `docs/`. Commit or delete the untracked script. Confirm each tool folder is either needed or ignored.
- `export/` is git-ignored, but `Stundenplan.TXT` and `Unterricht.TXT` (real school data) sit in the working tree. They are ignored, which is correct. Confirm they are not included in any backup or sync folder beyond the school's own system.

**Status: PARTIAL (2026-10-12).** Done: `PLAN.md` was moved to `docs/archive/PLAN.md` (`git mv`), its references were updated, `.worktrees/` was added to `.gitignore`, and `.freebuff/`, `.pi/` and `.superpowers/` were already ignored. Still open, pending the owner's decision: `bugfix.md` (live backlog, referenced by docs), `SMILE_ARCHITECTURE_AND_CODE_REVIEW.md` (linked from `AI.md` and `IF_YOU_ARE_AN_AI.md`), `UntisPlus-main/` (65 MB third-party clone, ignored), `scripts/generate_html_guide.py` (untracked authored script: commit or delete), `.pi/` discarded patch, `Unterricht.TXT` (unreferenced school data), and the `export/*.sql` dumps. `scripts/deploy.py` bundles `Stundenplan.TXT` into the production deploy, so confirm that is intended.

---

## 3. What Is Already Good (Keep It)

- `normalizeKnownSubject` on every subject write path, with `canRateSubject` for authorization.
- Atomic `version = version + 1` and `WHERE version = $expected` on single-cell writes.
- `validateBatchItems` rejects forged item keys all-or-nothing.
- `config.ts` fails fast on a weak or committed `JWT_SECRET`, and on bad rank thresholds.
- CORS uses an explicit allowlist (`index.ts:85-87`) and the WS origin is checked.
- `bcryptjs` with a dummy compare on unknown users, which avoids a timing oracle.
- Backup restore uses `execFile` with argument arrays, not a shell, and sanitises the filename.
- Exported HTML escapes user content (`conferenceExportHtml.ts`, `escapeHtml`).
- The heartbeat drops dead sockets (`live-sync.ts:799`).
- Auth lives in HttpOnly cookies, not `localStorage` (`client/src/services/api.ts`).

---

## 4. Suggested Order of Work

1. **P0-1**: per-account credentials. This is the largest real risk and blocks any wider rollout.
2. **P0-2 and P0-3**: restore rollback and the password off the argv.
3. **P1-1 and P1-2**: config for backup values, and WS payload schemas.
4. **P1-3 and P2-4 and P2-5**: fix the docs so agents and humans read the same facts.
5. **P2-1**: split `BeobachtungsGrid.tsx` and `App.tsx` in small steps, each with its tests passing.
6. **P1-4 and P2-3**: pagination and the secure-cookie default.
7. **P3**: hygiene.

Before merging any item, run `npm test` (with `PORT` set), `npm run typecheck --workspaces` and `npm run build`, as the repo's own checklist requires.
