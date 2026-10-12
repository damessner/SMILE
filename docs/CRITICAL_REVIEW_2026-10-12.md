# Critical Review & Hardening Session — 2026-10-12

**Scope:** full repository review (server, client, scripts, docs, CI, production state), followed by an
authorized fix pass, CI repair, and production deployment.
**Supersedes:** `CRITICAL_REVIEW_SMILE.md` (early AI-generated review; contains now-stale claims, e.g.
"BeobachtungsGrid.tsx not found" and unverified invariant status).

## 1. Verified evidence

| Check | Result |
| --- | --- |
| `npm test` (server) | 581 passed + 27 PostgreSQL-skipped / 41 files |
| `npm test` (client) | 241 passed / 19 files |
| `npm run typecheck --workspaces` | clean |
| `npm run build` | clean (client bundle `index-vjGu06BJ.js`, 528.83 kB / gzip 137.89 kB) |
| CI | run `38278008091` fully green (incl. the 27 PostgreSQL integration tests and the Python backup tests) |
| Merge | PR #1 → `main` = `bb60c6d` |
| Production | deployed to LXC 115; `smile.service` active; `GET /health` → 200; serves the bundle above |
| Admin-actor preflight | read-only SQL run against the production DB — clean (see §5) |

## 2. Documentation-vs-code drift (headline finding)

The documented invariant status was wrong in both directions and had gone stale after fixes landed:

- **Invariant 5** (`IF_YOU_ARE_AN_AI.md`) described an *open* "any-positive merge" violation in four
  client components. The merge had already been removed in commit `9dfce72`; all four views score
  per subject via `scoreSubject` (`client/src/lib/pupilItems.ts`). Documented line numbers matched
  neither the old nor the new code.
- **Invariant 2 "known sharp edge"** (WS defaulting `expectedVersion` to 1, batch-items never reading
  a version) was stale: WS requires a safe-integer `expectedVersion`, and the HTTP fallback is
  version-aware with conflict reconciliation.
- **Trap 6** ("wiring-unpinned") was stale: behavioral rank-forgery tests exist in
  `server/src/routes/evaluations.integration.test.ts` and run in CI.
- **`bugfix.md`** still listed the class-scoped conference lock as open (shipped in migration
  `0005_class_round_locks` + `server/src/lib/class-round-lock.ts`) and the unbounded rank merge as open.
- **`server/src/lib/rubric.ts`** carried a comment claiming four client implementations still flatMap
  across subjects.

All of the above were reconciled on 2026-10-12 across `IF_YOU_ARE_AN_AI.md`, `AI.md`, `AGENTS.md`,
`bugfix.md`, `docs/SECURITY.md` and the rubric comment.

## 3. Security findings (fixed)

1. **Deactivated accounts kept access until token expiry.** `teachers.active` was checked only at login;
   an account deactivated afterwards kept full REST + WS access (up to 8 h). Now enforced on every
   request (`buildSessionGuard` reads `teachers.active` through the cached session state → 403
   `ACCOUNT_DEACTIVATED` + cookie cleared) and on WebSocket messages (close 1008). Admin accounts are
   exempt because their placeholder teacher rows are `active: false` by design (migration `0002`) —
   **validated in production**, where the sole admin is linked to inactive teacher row 315.
2. **No rate limiting on WebSocket frames.** WS messages bypass the HTTP limiter. Added a per-socket
   token bucket (`WS_RATE_LIMIT_PER_SECOND` / `WS_RATE_LIMIT_BURST`, defaults 10/40): one `RATE_LIMITED`
   error, then close 1008 after repeated violations.
3. **Silent `subjectCode` defaults.** `/status`, `/submit`, `/reopen`, `/batch-items` and the WS
   `UPDATE_RATING` path silently wrote to Deutsch (`'D'`) when the subject was omitted. All defaults
   removed; missing or unknown codes now fail `normalizeKnownSubject` with 400
   `Ungültiges Unterrichtsfach.` Regression-tested.
4. **`COOKIE_SECURE` off by default with no boot signal.** Added a non-fatal boot warning
   (`insecureConfigWarnings`) — visible in the production journal while the LAN deployment runs plain
   HTTP.

Accepted/documented (see `docs/SECURITY.md` for the full list): plain HTTP without TLS, permissive
`STATISTICS_*` defaults (explicit school decision), logout clears the cookie but does not revoke the
token server-side, CELL_FOCUS/CELL_BLUR lack a pupil-in-class check (UI-only impact).

## 4. Data-integrity & hygiene findings (fixed)

- **Client subject alias typo.** A new sync tripwire test (`server/src/utils/subject-sync.test.ts`)
  compares the server `CANONICAL_MAP` with the hand-ported client `SUBJECT_ALIASES` table in both
  directions. It immediately caught `smilageographie` (should be `smilegeographie`, code `GWB`): the
  WebUntis subject "Smile Geographie" would have rendered an empty grid — silent data loss.
- **Backup archives in the synced working tree** (three `backup*.zip` files) blocked `npm install` via
  the `verify-env` postinstall guard. Moved out of the tree on 2026-10-12; `node scripts/verify-env.mjs`
  now exits 0; the guard remains to catch new archives.
- **Dead code:** `ClassOverview.tsx` (+ test) deleted (no production importer); unused
  `isPositiveRating` local removed from `BeobachtungsGrid.tsx`.
- **CI coverage:** pushes to `feature/**` never ran CI (only `main` + `fix/**`), and `main`'s first-ever
  CI run is this merge's. The workflow now covers `feature/**`.

## 5. CI repair (root causes found & fixed)

The test step had never been green. Six latent defects were exposed once the PostgreSQL integration
tests executed in CI:

| Test defect | Fix |
| --- | --- |
| `/status` asserted `res.json().evaluation.subjectCode`; the route returns the bare evaluation | assert `res.json().subjectCode` |
| Session-cache fixtures leaked: a raw SQL reset bypassed the in-process cache and deactivated teacher101 for every later test; pending resets also leaked for admin/teacher102 | invalidate the session-state cache in the tests and restore fixtures in `finally` blocks |
| WS reset test expected a `clientMutationId` on a server-initiated close (it never carries one) | assert `{ type: 'ERROR', code: 'PASSWORD_CHANGE_REQUIRED' }` |
| Conference steps used an ordinary teacher, but conference decisions require the Schulleitung | use a leadership (admin) token, per the guard |
| Statistics seed collided with evaluations left by earlier tests | make the seed idempotent (delete-then-insert) |
| `/batch-items` lock test used a non-rubric `itemKey` → 400 before the expected 423 | use a real rubric key |
| `timetable-import.test.ts` read `Stundenplan.TXT` at collection time even when the suite is skipped (file is gitignored) | lazily guard the read |
| `scripts/test/test_restore_drill.py` touched `/var/backups` (unwritable in CI) | isolate the destination in a temp dir; `backup_independent.py` now checks the certificate *before* creating directories |

## 6. Production deployment (authorized)

- Built locally (`npm run build`) and deployed via `scripts/deploy_to_production.py` to Proxmox host
  `172.16.1.54`, LXC 115 (`/opt/smile`, systemd `smile.service`).
- Post-deploy verification: service `active (running)`; migrations up to date; `GET /health` → 200;
  the served bundle matches the locally built one; boot log shows the new `COOKIE_SECURE` warning.
- **Read-only admin-actor preflight** (`docs/PREFLIGHT-admin-actor.sql`) against the production DB:
  zero `teacher_id = 0` sentinels across all five tables; no orphaned FK rows; no evaluations written
  yet; one admin account linked to the inactive placeholder teacher (id 315); `max(teachers.id) = 315`
  with the `9000000+` reserved range free.

## 7. Open items / recommendations

1. **Rotate the shared Proxmox root password** — it was supplied in plain text for this session's work
   (never written to any file).
2. **TLS**: serve over HTTPS and set `COOKIE_SECURE=true`; the boot warning should then disappear.
3. `RANK_AGGREGATION=total` semantics (unbounded multi-teacher tallies on server-side conference
   evidence) remain a product decision — see `bugfix.md` decision list.
4. Client bundle is ~529 kB without code splitting (warned by Vite); consider route-level splitting.
5. `CRITICAL_REVIEW_SMILE.md` at the repo root is superseded by this document; consider deleting it or
   adding a pointer note.
