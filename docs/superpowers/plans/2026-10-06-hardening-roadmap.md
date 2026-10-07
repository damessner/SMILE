# Hardening Roadmap — Phases B through F

> Companion to `2026-10-06-assessment-integrity.md` (Phase A, detailed and ready to execute). This file records the remaining findings from the critical review in dependency order, so nothing is lost between sessions.

**Status:** Phase A is specified in full. Phases B–F are scoped but not yet specified task-by-task. Write the detailed plan for a phase when you are about to work it.

**Gate for every phase:** `npm.cmd test` green and `npm.cmd run typecheck --workspaces` at 0 errors. Phase A adds the client harness, so from Phase B onward client changes are testable too.

---

## Phase B — Security and data exposure

Start here after Phase A. Nothing in B depends on B's later tasks, so B can be split across sessions.

| # | Finding | Where | Notes |
|---|---|---|---|
| B1 | No `setErrorHandler`; Drizzle `DrizzleQueryError` returns full SQL plus bound values — pupil names, card justifications, teacher comments | `server/src/index.ts` | Highest value per line of any item here. Register `fastify.setErrorHandler`, log the detail server-side, return a German message. Add an integration test asserting a forced FK violation returns no SQL text. |
| B2 | CSRF origin check is a no-op when `CORS_ALLOWED_ORIGINS` is empty, which is the default | `server/src/plugins/security.ts:34` | The existing test masks this by setting an allowlist in `TEST_ENV`. Needs a second test with the allowlist unset. Also: the docstring claims the hook rejects cross-origin WebSocket upgrades, but line 74 returns early for `GET` and `/ws` is a `GET` (`index.ts:130`). Either implement the WS check or delete the claim. |
| B3 | Rate limiter's `keyGenerator` reads `request.authUser`, but the plugin defaults to an `onRequest` hook while `authenticate` is a `preHandler` — so every request buckets by IP | `server/src/index.ts:91-101` | Add `hook: 'preHandler'`. Verify with a test that two different authenticated users get independent buckets. |
| B4 | IDOR: `DELETE /api/pupils/:id/behavior-actions/:actionId` authorizes against the route param's pupil but deletes by `actionId` alone | `server/src/routes/pupils.ts:312-336` | Assert `existing.pupilId === pid` in the SELECT. Practically gated on knowing a UUID, but the predicate is provably wrong. |
| B5 | `POST /api/auth/request-reset` records a reset row and never locks the account; `password_resets` is never read to gate anything | `server/src/routes/auth.ts:204-221` | Decide the intent first: either set `users.must_change_password = true` and read the table at login, or delete the route and the table. A control that does nothing is worse than none. |
| B6 | `getGlobalAccess` returns `classIds: null` (= unrestricted) for any account without a `teacherId` | `server/src/lib/guards.ts:166-168` | Conflates "no teacher identity" with "principal". Fail closed: return an empty allowlist. |
| B7 | `GET /api/timeouts/active` is unscoped and unlimited — returns every active timeout school-wide to any authenticated account | `server/src/routes/timeouts.ts:149` | `/timeouts/history` 80 lines later *is* scoped. Add `getGlobalAccess`, a `LIMIT`, and a test. |
| B8 | Raw JWT still returned in the login and password-change response bodies | `server/src/routes/auth.ts:106,177` | The client ignores it, but it partly defeats the `httpOnly` design. Delete `token` from both payloads. |
| B9 | Three test files re-implement the logic they claim to test | `server/src/lib/access-rules.test.ts`, `server/src/ws/auth.test.ts`, `live-sync.test.ts:15-90` | **Do this before relying on any authz test as evidence.** Extract the decision logic into importable pure functions and rewrite the tests against the real code. This is a prerequisite for Phase B having any regression value. |
| B10 | **Subject-level authorization is missing on every evaluation write path.** `getClassAccess().canRate` is class-level only; `access.subjects` is computed then never consulted. A teacher assigned D only can write an `M` evaluation row attributed to themselves, and `onConflictDoUpdate`'s `set` never updates `teacher_id` | `evaluations.ts:196,273,423`, `live-sync.ts:323-325`, `guards.ts:254` | Needs a `canRateSubject(access, code)` helper in `guards.ts`, applied at the same point `canRate` is checked today. Same hole over WebSocket. |
| B11 | `index.test.ts` claims to enumerate "every endpoint that touches pupil data" but omits three: `POST /api/auth/logout`, `GET /api/pupils/:id/behavior-profile`, `POST /api/timeouts/:id/resolve` | `server/src/index.test.ts:42-89` | `POST /api/auth/logout` is the one genuinely unguarded mutating route. Add all three to `PROTECTED_ENDPOINTS`, and correct the comment so it does not overstate what it covers. |

**Sequencing note:** B9 first. Every other item in B is only protected against regression once the tests touch real code.

---

## Phase C — Schema and migration integrity

| # | Finding | Where | Risk |
|---|---|---|---|
| C1 | `pupil_behavior_actions` and the `pupil_id_seq` sequence are in `schema.ts` but absent from the only migration; `0000_snapshot.json` has `"sequences": {}` | `server/drizzle/`, `server/src/db/schema.ts:12,256` | A fresh `npm run db:migrate && npm run seed` produces a database where `POST /api/pupils` fails with `relation "pupil_id_seq" does not exist`. **Verify against a real scratch database before touching LXC 115.** |
| C2 | The subject-code data migration lives in gitignored `scratch/` and is incomplete | `scratch/migrate_subject_codes.py` | Maps only 10 of 28 canonical codes; does not touch `teaching_assignments.subject_code` or `timetable_lessons.subject_code`, which is the actual root cause of the `hours: 0` bug; and its `UPDATE ... WHERE subject_code IN ('SD',…)` will **violate the unique index** and abort the whole transaction wherever an `SD` row already coexists with a `D` row. Needs a dedupe step and a real home in `server/drizzle/`. **This is the owner of the fifth review-focus case: a legacy `SD` row coexisting with a `D` row must not double-count a pupil's positives.** |
| C3 | Plaintext production root SSH password on disk | `scratch/migrate_subject_codes.py:6` | **Rotate first — this cannot be fixed in code.** `1MatteoMessner2026!` against `172.16.1.54` as root. `LEAKED_SECRETS` covers two other secrets; nothing scans for this one. Check whether it is reused anywhere. |
| C4 | All five tracked deploy scripts use `AutoAddPolicy()` — no SSH host-key verification | `scripts/deploy.py:66`, `deploy_to_production.py:55`, `lxc-inspect.py:25`, `lxc-migration-check.py:13`, `lxc-predeploy.py:31` | Ship known-hosts and use `RejectPolicy`. Silent MITM exposure on production deployment paths. |
| C5 | `.env.example` omits `STATISTICS_SCHOOL_WIDE` and `STATISTICS_SHOW_FOREIGN_COMMENTS` | `.env.example` | The two most consequential policy toggles are undocumented for operators. |
| C6 | Dead config: `wsSoftLockTtlMs` and `sessionGraceSeconds` have zero uses | `server/src/config.ts:188,172` | Both are documented as features that do not exist. Either implement (Phase E covers the soft lock) or delete. |
| C7 | `teacherId ?? 0` written into `NOT NULL REFERENCES teachers(id)` at 11 sites | 6 route files + `live-sync.ts:414` | Any account without a `teacherId` hits an FK violation on every write; swallowed at `live-sync.ts:417-434` as "Bewertung konnte nicht angelegt werden". Make the column nullable, or reject at login. |
| C8 | Two `backup_*.zip` archives containing the full pupil database remain in a OneDrive-synced working tree | project root | `docs/SECURITY.md` item 5 already flags this as outstanding. Move to controlled storage with retention. **Task 7's implementer found a THIRD archive, `backup.zip` (31.8 MB), which no guard covers at all** — `scripts/verify-env.mjs` only checks the two `backup_*`-prefixed ones. Verify and remove or relocate all three. |
| C9 | The `subject_code` write-path fallback can still mint an unbounded code from user input | `server/src/utils/subject.ts:163` | Settled during Task 7: `subject.ts:163` coerces any unrecognized string via `toUpperCase().replace(/[^A-Z0-9]/g,'_')`, `subject.test.ts:79` pins that behaviour, and **five write paths insert the result unchecked** (`evaluations.ts:76,210,287,440`, `live-sync.ts:265`) with no `CHECK` constraint. A forged code adds rating mass (`ranking.ts:63`) and a conference vote (`conferences.ts:505`, which has no subject filter). Fix by rejecting unknown codes at the write boundary — the same treatment `validateBatchItems` now gets for item keys. |

---

## Phase D — Round and conference model

| # | Finding | Where |
|---|---|---|
| D1 | `POST /api/conferences/:classId/lock` writes the **global** `observationRounds.isLocked`; `observation_rounds` has no class column, so locking one class disables rating school-wide | `conferences.ts:66-73` |
| D2 | Reads take the *latest* round while writes take the latest *unlocked* round — the roster can render one round while writes land in another | `classes.ts:212`, `conferences.ts:28`, `statistics.ts:76`, `live-sync.ts:131` |
| D3 | `confirmedAt` is written as `config.officialConferenceDate`, a constant — never the real time | `conferences.ts:185,196,287,298,317` |
| D4 | `defaultConferenceReason()` stamps that same constant into every `overrideReason` | `conferences.ts:647` |
| D5 | Votes fabricate consensus: `totalClassTeachers` counts all subject teachers, `votesYes = total - votesNo`, `votesNo` defaults to 0 → one KV click records a unanimous 12–0 | `conferences.ts:166-168` |
| D6 | The team-teaching doubling branch is unreachable — the unique index caps `coreTeacherCounts` at 0 or 1, so the "both teachers submitted" case can never occur | `conferences.ts:496-535` |
| D7 | `suggestedRankByHours` defaults to `Geselle` when no teacher has voted, so an unvoted pupil is *suggested* the middle rank; tie-breaks always favour the higher rank | `conferences.ts:572-579` |
| D8 | `RANK_AGGREGATION=normalized` is a mathematical no-op: `(positive/18)*18 === positive`; `rated` is computed and discarded; the branch has zero tests | `ranking.ts:69-73` |

**D1 and D2 need a schema change** (a per-class round-lock table or a `class_round_locks` join), so plan the migration with Phase C rather than separately.

**D3/D4 are one-line fixes with outsized effect on the audit trail** — cheap, do them early even though the rest of D is larger.

---

## Phase E — Live-sync and client correctness

| # | Finding | Where |
|---|---|---|
| **E0** | **Two live WebSocket events are name-mismatched, so they are silently dropped.** The server broadcasts `FINAL_RANK_CONFIRMED` (`conferences.ts:209`) and `TIMEOUT_ISSUED`; the client only handles `FINAL_RANK_LOCKED` and `TIMEOUT_CREATED` (`useLiveSync.ts:125,123`) — names the server never emits. Both server events hit `default: break` and vanish, and both client cases are dead. **Net effect: a confirmed conference rank and a newly issued Time-Out never reach co-teachers' screens until they reload.** Found by the Task 7 implementer while reconciling the directive docs, and independently verified by the controller. This is Invariant 3 of `IF_YOU_ARE_AN_AI.md` broken in shipped code — Trap 1 re-entered through a rename that did not propagate. | `conferences.ts:209`, `timeouts.ts`, `useLiveSync.ts:123,125` |
| E1 | No WebSocket reconnect, no backoff; the socket is only recreated on `classId`/`user` change. A Wi-Fi blip leaves the teacher on "Verbinde…" permanently | `useLiveSync.ts:144-156` |
| E2 | Soft locks never expire server-side, and `WS_SOFT_LOCK_TTL_MS` is dead config. A crashed colleague freezes cells for everyone, showing "XY tippt…" | `live-sync.ts`, `BeobachtungsGrid.tsx:1456` |
| E3 | Every server `ERROR` is swallowed to `console.warn`, including deadline-expired and not-authorized. The client shows "Gesichert" for writes the server rejected | `useLiveSync.ts:131-134` |
| E4 | The client never reads `canRate` (zero hits in `client/src`), so a read-only teacher sees fully enabled smileys | `BeobachtungsGrid.tsx:1456` |
| E5 | `CONFLICT` is rendered but `conflict.currentRating` is never applied — the grid keeps showing the value the server rejected | `useLiveSync.ts:93-103`, `BeobachtungsGrid.tsx:554-567` |
| E6 | The HTTP rating fallback persists the write but never updates local state, so the value does not move | `useLiveSync.ts:204-208` |
| E7 | `ConferenceVotingModal.loadData` resets to pupil 1 after every confirmation, and has no request sequencing | `ConferenceVotingModal.tsx:140-164,251,280` |
| E8 | Conference arrow keys hijack the number input — no `INPUT`/`TEXTAREA` guard (the correct pattern is at `Schulalltag.tsx:476-483`) | `ConferenceVotingModal.tsx:173-184` |
| E9 | No 401/expiry handling anywhere; `sessionExpiresAt()` is returned by the server and never consumed. `api.ts:154-158` turns a 500 on `getYellowCardAlerts` into "no alerts" | client-wide |
| E10 | Every rating tap is an immediate write — no debounce, so co-teacher races produce conflict spam | `BeobachtungsGrid.tsx` |
| E11 | The submission deadline is hardcoded **twice** in browser-local time: `new Date(2026, 9, 30, 23, 59, 59)` vs server `2026-10-30T21:59:59Z`. They agree only for a CEST browser; east of UTC+2 the client thinks the window is open while the server returns "Abgabefrist abgelaufen" | `BeobachtungsGrid.tsx:268`, `ClassOverview.tsx:47` | **Live-write correctness, not just drift.** Fix by sending the deadline from the server on `GET /api/classes/:id/pupils` (it already returns `round`) and reading it from props. Do this before the unification plan, since it is a correctness bug rather than a duplication. |
| E12 | WS OCC: an omitted `expectedVersion` defaults to `1`, so once an item is at `version = 2` every update from such a client matches zero rows and returns `CONFLICT`. The concurrent-insert path reports a benign race to the teacher as a conflict and drops the write instead of re-reading | `live-sync.ts:320-322,448-466` | Default `expectedVersion` to the current row's version, or use the unconditional `version = version + 1` form that the HTTP batch path already uses correctly (`evaluations.ts:145,483`). |

**E2 depends on C6** — either implement `WS_SOFT_LOCK_TTL_MS` or delete it, but do not leave it as a documented lie.

---

## Phase F — Performance and audit integrity

| # | Finding | Where | Scale |
|---|---|---|---|
| F1 | `GET /api/backup/export-json` pulls 17 full tables including `audit_logs` into the Node heap for one JSON response — `audit_logs` grows unboundedly | `backup.ts:44-79` | OOM risk on a long-lived deployment |
| F2 | `batch-default` runs ~540 serial round-trips inside one transaction (30 pupils × 18 items) | `evaluations.ts:112-161` | Holds one pool connection (`max: 20`) for the duration |
| F3 | `vote-all` validates with up to 200 sequential `getPupil` queries, outside the transaction that follows | `conferences.ts:258-266` | Replace with one `WHERE id = ANY($1)` |
| F4 | Audit writes sit outside the data transaction in 14 places; a failed audit insert leaves a committed change with no record | `cards.ts:76`, `conferences.ts:173-207`, `evaluations.ts:301,370`, `pupils.ts:103,143,277`, `timeouts.ts:202,393` | The `audit_logs` table is the system's evidence trail |
| F5 | No request-body schema validation anywhere — `{"fullName":123}` reaches `.trim()` and 500s | all routes | Pairs with B1 |
| F6 | No length caps on `evaluations.comment`, `nextStep`, `pupil_behavior_actions.notes`; `subject_code`'s fallback mints unbounded values into a unique-index column | `evaluations.ts:229`, `pupils.ts:282`, `subject.ts:164` | Row bloat, index bloat |
| F7 | `GET /api/classes` N+1s `getClassAccess` per class | `classes.ts:117` | |
| F8 | `accessCache` is written, never read, unbounded, keyed only by class id. `canAccessClass` and `visibleClassIds` are exported and used by no route | `classes.ts:29`, `guards.ts:197,339` | Delete |
| F9 | `cid === 999` short-circuits before `getClassAccess` | `classes.ts:187-196` | Harmless today; a trap for the next field added to that literal |
| F10 | `POST /api/evaluations/status` ignores `config.submissionDeadline` while every other write path enforces it | `evaluations.ts:179` | **Constrained by Phase A Task 6**, which depends on `/status` accepting comment-only writes after the deadline. Fix by restricting `/status` to comment-only when past the deadline. |
| F11 | `GET /api/statistics/overview` defaults both policy toggles fail-open — school-wide data plus every colleague's free-text comments | `statistics.ts:53,225` | A deliberate, documented school decision. Flag the defaults, do not silently flip them. |
| F12 | `ALLOWED_RATINGS` and `VALID_RATINGS` are duplicated across two files | `evaluations.ts:508`, `live-sync.ts:80` | Phase A Task 3 deletes the former — confirm this is done |

---

## Deferred: rank-logic unification

Agreed as a separate plan. The four implementations — `server/src/lib/ranking.ts`, `client/.../BeobachtungsGrid.tsx:255`, `client/.../Schulalltag.tsx:210`, `client/.../ClassOverview.tsx` — must collapse to one shared module. Blocked on Phase A, which lands `client/src/lib/pupilItems.ts` as the first client-side home for this logic.

Also deferred: accessibility (rating buttons have no accessible name or `aria-pressed`; modals lack `role="dialog"`, focus trap and Escape; expandable rows are `<div onClick>`), and the `Schulalltag.tsx` unbounded `flatMap` rank — the last of which Phase A records as a known violation rather than fixing, per Invariant 5 in `IF_YOU_ARE_AN_AI.md`.