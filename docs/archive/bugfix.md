# SMILE System Bugfix Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for a single-person implementation, or `superpowers:subagent-driven-development` when the human explicitly chooses reviewed parallel handoffs. Do not implement the whole backlog in one pass. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close verified paths that can corrupt formal pupil rankings, fabricate conference results, disclose pupil records, or silently lose teacher input, while making tests and operations safe to run.

**Architecture:** Treat the PostgreSQL database as the source of truth; validate identity, class, subject, rubric key, and business deadline before every write. Make conference rounds, votes, and audit records explicit persisted facts rather than inferred UI state. Test migrations and destructive integration behaviour only against a verified disposable database. Keep the existing Fastify/Drizzle and React/Vite split; do not begin a cross-repository refactor until the domain decisions below are answered.

**Tech Stack:** Node.js `>=22`, Fastify v5, TypeScript ESM, Drizzle ORM, PostgreSQL, React 19, Vite 8, Vitest, Testing Library.

**Audit basis:** Current `main` at `4d0d1d0` (2026-10-07). The earlier `docs/superpowers/plans/2026-10-06-hardening-roadmap.md` remains useful history, but its status and several line references are stale. This file is the current implementation handoff for verified open work.

## Global Constraints

- `server/src` relative imports use `.js`; `client/src` follows the existing extensionless Vite import convention.
- **Never point a test at the production database.** The current PostgreSQL integration suite runs migrations and deletes rows from core tables. Do not run it until Task 0 makes the target fail-closed.
- Do not print, commit, copy into this document, or echo secrets, database URLs, pupil records, or backup contents. Credential rotation and archive relocation are operator actions; do not perform them without the owner's authorization.
- Keep user-facing text in German; keep identifiers and code symbols in English.
- Every new test must import/exercise the code under test. Structural source assertions are allowed only as a clearly labelled temporary supplement where a real database-backed test is not yet possible; they are not a substitute for behaviour tests.
- Prefer Fastify's built-in JSON Schema validation; do not add a runtime validation dependency without a separate review.
- Before accepting a fix, verify that the named test fails when that fix is locally reverted. Do not report mutation evidence unless the mutation was actually run and the test name is correct.
- Preserve compatibility with historical subject aliases on reads. Reject unknown subject values on writes; do not make the read normalizer destructive.
- Run `npm.cmd test`, `npm.cmd run typecheck --workspaces`, and `npm.cmd run build` before completing a phase. On PowerShell use `npm.cmd`.
- Do not deploy or run migrations against LXC 115 from this plan. Use a disposable PostgreSQL instance and an owner-approved deployment procedure.

## Review Focus

1. **Dangerous database target:** a typo or copied production URL must be rejected before the integration test connects, runs migrations, or deletes rows.
2. **Unknown or unauthorized subject:** an ordinary D-only teacher must not create an M or arbitrary-code evaluation, through either HTTP or WebSocket.
3. **Partial / missing votes:** an uncast conference ballot must never be recorded as a yes vote or presented as consensus.
4. **Same subject item key at different versions:** D at version 7 and M at version 3 must retain distinct versions, focus locks, and writes.
5. **Past deadline / failed request:** the client and API must agree which fields may still change, and must not tell a teacher that an unacknowledged write was saved.

---

## Audit Snapshot

### Verification run for this review

- `npm test` (from the repository root, `PORT` set): **581 server tests passed, 27 PostgreSQL
  integration tests skipped across 41 files**, **244 client tests passed across 19 files**
  (re-measured 2026-10-12). `SKIP_POSTGRES_INTEGRATION=true` was set; see `docs/SECURITY.md`
  for why a local opt-out is not integration evidence.
- `npm run typecheck --workspaces`: passed, 0 errors.
- **Correction (2026-10-08).** This section previously reported "159 server / 79 client tests" and
  claimed "No `.github/workflows` files are tracked; there is no CI workflow." Both statements were
  wrong when written: `.github/workflows/ci.yml` exists and runs typechecks, both test workspaces,
  the PostgreSQL suite against a disposable database, the Python SSH-security tests, and the
  production build. The counts below are current.
- **Also corrected:** the "Confirmed open findings" table immediately below was written against
  `main@4d0d1d0` and listed five items as P0 that are **already fixed in the tree this file
  describes** — the unknown-subject-code hole, the behaviour-action IDOR, the fabricated vote
  counts, the WebSocket name mismatch, and the JWT-in-response-body issue. Each is marked as fixed
  inline below. Treat the table as history, not as a work queue.

### Already fixed — preserve these behaviours

- `server/src/lib/rubric.ts` + `/batch-items`: item keys are checked against the rubric and `criterionId` is derived server-side.
- `client/src/lib/pupilItems.ts` + `BeobachtungsGrid`: item reads and submission state are subject-scoped; rating writes resolve their OCC version per subject.
- Conference-comment autosave persists, retries after failures, and does not display “Gesichert” until the API call resolves.
- `ClassOverview.tsx` was deleted on 2026-10-12 as dead code (only its own test imported it); its `getPupilRank` any-positive merge had already been removed in `9dfce72`. The canonical ranking implementation is `scoreSubject` in `client/src/lib/pupilItems.ts`.
- `/status` avoids a class-wide reload broadcast for comment-only writes; a report already open on a co-teacher's screen can still be stale (Task 13).
- Existing guards prevent many class/pupil mismatches; parameterized SQL is used in the reviewed raw-query sites. This audit found no SQL-injection vector in those parameterized queries.

### Findings from the `main@4d0d1d0` audit, with current status

Priority definitions (historical): P0 = stop-data-loss/unsafe-test-target or official-record
integrity; P1 = close before the next production deployment or conference; P2 = reliability and
user-facing correctness; P3 = scale, accessibility, documentation. “P0” does not authorize a
deployment or a live-data operation.

**Read the Status column before acting.** Several entries were open when this table was written and
are closed in the current tree. They are kept rather than deleted so the reasoning is not lost.

| Was | Finding | Status now |
|---|---|---|
| P0 | Integration test can migrate and clear an arbitrary configured database | **Fixed** — `test-db-guard` requires an explicit loopback `smile_db_test` target, and a local opt-out is rejected as evidence |
| P0 | Plaintext credentials in ignored local scripts; pupil-data archives in the synced tree | **Fixed (2026-10-12).** Scripts read credentials from the environment; all three archives were moved out of the working tree to owner-controlled storage and `node scripts/verify-env.mjs` exits 0 (`docs/SECURITY.md` item 5) |
| P0 | Unknown subject codes create unlimited evaluations; authorization class-wide, not subject-specific | **Fixed** — `normalizeKnownSubject()` on all write paths; `canRateSubject()` checks `access.subjects` |
| P0 | Conference vote counts claim uncast yes votes | **Fixed** — participation is derived from submitted evaluations; the hand-typed tally is gone |
| P1 | Class-scoped lock request updates one global round lock; readers/writers may pick different rounds | **Fixed (2026-10-09/10).** Migration `0005_class_round_locks` adds the per-class table; `lib/class-round-lock.ts` (`getClassRoundLockState`/`isClassRoundLocked`, OR-semantics) is used by `conferences.ts`, `evaluations.ts`, `live-sync.ts` and `classes.ts`; covered by `class-round-lock.test.ts`, `live-sync.locks.test.ts`, conference route tests and the PostgreSQL integration suite |
| P1 | `getGlobalAccess` treats a missing `teacherId` as unrestricted; `/timeouts/active` unscoped and unbounded | **Fixed** — fails closed; `/timeouts/active` refuses pupils and is `LIMIT 100`. **Its school-wide visibility is an open product decision**, not a code defect |
| P1 | Cross-pupil behaviour-action delete authorizes on `:id`, deletes `:actionId` | **Fixed** — the select filters on both `id` and `pupilId` |
| P1 | CSRF Origin check allows every origin with the default empty allowlist; `/ws` bypasses it | **Fixed** — same-origin is resolved against `request.headers.host`; the allowlist is additive; the WS upgrade is checked |
| P1 | Rate limiter buckets by IP because `authenticate` runs later | **Fixed** — `hook: 'preHandler'` |
| P1 | No global error handler; no body schemas | **Fixed** — `setErrorHandler` plus JSON Schemas with non-coercing AJV |
| P1 | Password-reset endpoint only inserts a request; JWT returned in JSON | **Fixed** — reset sets `must_change_password`; no token in any response body |
| P1 | `pupil_id_seq` missing from the only migration; `pupil_behavior_actions` created by runtime DDL | **Fixed (2026-10-08)** — migration `0003_pupil_id_sequence_and_behavior_actions`; the hand-written DDL is gone from `runMigrations()`; `server/src/db/migrations.test.ts` prevents recurrence |
| P1 | Administrative writes use `teacherId ?? 0` against non-null FKs | **Fixed (2026-10-11)** — migration `0002` gives admins a real teacher row; every write path fails closed with `SYSTEM_ACTOR_NOT_CONFIGURED`. The remaining `?? 0` sites in `timeouts.ts`, `cards.ts` (card issue) and `pupils.ts` (behavior-action record) now guard with `hasPersistedTeacherActor` before the insert; no `?? 0` actor write remains in non-test code |
| P1 | Two WebSocket message names do not match | **Fixed** — client now handles the server's names; all 20 emitted types have handlers |
| P1 | Rank semantics unbounded; client reports flatten all evaluations | **Fixed (2026-10-10).** The any-positive merge was removed in `9dfce72`; all report surfaces score per subject via `scoreSubject` (newest-`updatedAt`-wins) and no pupil-level merged rank is derived. `ClassOverview.tsx` deleted 2026-10-12. Server `summarizeRatings` remains additive by design under `RANK_AGGREGATION=total` (decision 5 below) — see `IF_YOU_ARE_AN_AI.md` Invariant 5 |
| **P0** | **Conference summary readable for any class by any teacher** (`!canRead && !teacherId && !admin` never refused a teacher) | **Fixed (2026-10-08)** — extracted `canReadConferenceSummary()`, unit-tested. Not in the original table; found in the 2026-10-08 review |
| **P0** | **Full-database export wrote no audit record** | **Fixed (2026-10-08)** — writes `FULL_DATA_EXPORTED`. Also from the 2026-10-08 review |
| P2 | No reconnect, swallowed socket errors, locks never expire, conflicts not applied | **Fixed** — reconnect with backoff, TTL locks, conflict reconciliation, correlated errors. A concurrent insert into an empty cell (unique-index race) now answers with the same reconcilable `CONFLICT` payload as a version race instead of a dead-end error (2026-10-11) |
| P2 | Audit writes sit outside the data transaction in 14 places | **Mostly fixed (2026-10-11)** — `/submit`, `/reopen` (`evaluations.ts`), `/vote` confirm/unconfirm (`conferences.ts`), card issue (`cards.ts`), behavior-action record (`pupils.ts`) and time-out resolve/escalation acknowledge (`timeouts.ts`) now write the data row and its audit row in one transaction; `/vote-all`, `/lock` and behavior-action delete already did. Still bare: card revoke, pupil roster writes and the backup-export audit rows |
| P2 | `batch-default` ~540 serial round trips; `vote-all` 200 sequential `getPupil` calls | **Fixed (2026-10-11)** — `/batch-default` writes the roster and all items in two multi-row statements; `/vote-all` resolves class membership in one `IN` query and upserts every decision in one statement |
| P2 | Stale docs and contradictory test totals | **Mostly fixed (2026-10-12)** — a docs-truth pass reconciled `IF_YOU_ARE_AN_AI.md`, `AI.md`, `docs/SECURITY.md` and this file with the code at `c76e652`: the Invariant 2/5 "open violation" notes are marked resolved, test totals now read 581 server (+27 PostgreSQL-skipped) / 244 client (2026-10-12), and the archive item is closed. The historical sections below still contain stale line references; treat them as history |

## Decisions Required Before the Related Implementation

Record the decision in the PR/issue before changing the corresponding data model. Do not infer school policy from the current UI.

1. **Conference voting:** Are actual individual yes/no/abstain ballots required, or is an authorized administrator recording a final decision? Current code labels a final rank with fabricated `votesYes`/`votesNo`. Recommended: store one signed ballot per eligible voter and compute the tally; if this is an override workflow, store no fictional tally and label it as an administrative decision.
2. **Co-teaching:** Should each co-teacher submit a distinct subject vote, or should co-teachers share one subject evaluation? Current natural key permits one row per pupil/subject, so the “both teachers submitted” branch is impossible and the first teacher attribution persists.
3. **Conference lock scope:** Does a lock apply school-wide or per class? The URL, broadcast, and comments indicate per-class; the database field is global. Recommended: per-class lock state.
4. **Rank across subjects — RESOLVED (per-subject ranks).** Gesamt mode now scores and submits each subject independently (`handleSubmitPupil` in `BeobachtungsGrid.tsx` scores every `targetSubjectCodes` entry via `scoreSubject`; an unrated subject submits nothing or inherits an explicit manual proposal). This implements roadmap E13 as recommended: per-subject rows are never finalized from a merged score.
5. **Rank aggregation:** Should the 14/8 threshold mean 14/8 of one 18-item raster, an average normalized per evaluation, or historical total positives across core subjects? The current default is unbounded `total`; “normalized” is currently a mathematical no-op.
6. **Lernwerkstatt active list:** Is `/timeouts/active` intentionally school-wide for any authenticated staff member, or only a scheduled LW supervisor? Recommended: explicit supervisor authorization and minimum necessary fields; do not rely on “any authenticated account.”
7. **Statistics policy:** `STATISTICS_SCHOOL_WIDE=true` and `STATISTICS_SHOW_FOREIGN_COMMENTS=true` are deliberate configuration defaults. Confirm the school’s intended visibility; do not silently flip them in code.
8. **Post-deadline comments:** Should comments remain editable after the submission deadline? The API permits comment-only writes, but the UI disables the textarea. Confirm whether comments remain open and whether they remain editable after conference lock.
9. **Comment ownership/concurrency:** one evaluation row holds one comment shared by all teachers of that subject, yet writes carry no comment version and comment-only writes no longer broadcast. Confirm whether comments are shared or author-specific. If shared, add a comment version/OCC conflict and a low-volume update event; if author-specific, store comments by teacher rather than overwriting one field.
1a. **Conference ballot semantics — RESOLVED (tally only).** Per-issuance ballots are not being built; the requirement was that an uncast vote must not count as agreement, and that weight follow lessons taught. Participation is now measured from submitted evaluations only, and the displayed split is the hours-weighted one the code already computed. The hand-typed `votesNo` counter and its API field are gone. Quorum remains open — see decision 12.
10. **KV subject authority — RESOLVED:** the user chose assigned subjects only. A Klassenvorstand without a teaching assignment in the class may manage the roster but may not write ratings/status for any subject.
11. **First-login credential delivery — RESOLVED (random one-time credential).** New seeded accounts still use the operator-supplied `INITIAL_USER_PASSWORD` and are forced to change it at first login. The Admin Konten panel reset now generates a fresh random one-time credential per issuance (`server/src/lib/temporary-credential.ts`), revokes current sessions, and requires a password change before any further writes. The value is shown once in the reset response, is never logged and is not copied to the clipboard; the administrator hands it to the account owner out of band. The previously published `smile2026` literal is no longer produced by any flow (the generator refuses known-leaked values).
12. **Conference quorum — OPEN.** A rank can still be confirmed when most teachers have not voted; confirmation remains an administrative act. Whether a quorum is required is school policy (does one absent teacher block the conference?). The screen now states how many submitted, so the chair can decide per pupil without the app guessing.

---

## Phase 0 — Protect Data and Make Tests Safe

### Task 0.1: Fail closed before PostgreSQL integration tests connect

**Files:** `server/src/routes/evaluations.integration.test.ts`, `server/package.json`, `.github/workflows/ci.yml` (new).

1. Replace silent discovery of `scratch/test_db_url.txt` with an explicit `TEST_DATABASE_URL`. Parse it without logging credentials. Require the database name to equal the dedicated test database name `smile_db_test` and require a dedicated least-privilege test role. After connecting, verify `current_database()` and `current_user` before migrating, deleting, or seeding. A URL for `smile_db` or any other database name must fail before the first write.
2. Do not clear entire `teachers`, `school_classes`, `pupils`, or rubric tables. Use a disposable database per run, or unique fixture rows and exact cleanup of only those rows. Do not share this database with deployment or manual school data. Keep the connection URL out of logs and test failure output.
3. In CI, require a PostgreSQL service and fail if the integration suite is not run. Local runs may skip only with an explicit opt-out and must print a visible skip reason. Do not silently report green while the core route integration suite was skipped.
4. Remove `pg-mem` if the test remains real-PostgreSQL-only; alternatively use it in a verified behavioral test and do not retain a duplicate unused dependency.
5. Add tests `rejects a non-test database name before connecting` and `cleans only its own fixture rows`; CI acceptance: all PostgreSQL integration tests execute against a fresh ephemeral `smile_db_test`, **zero skipped**, and no existing row outside the fixture is changed.

**Gate before this task lands:** until the guard is in place, run only with a forced unreachable `TEST_DATABASE_URL`; never let the integration test read the ignored scratch URL.

### Task 0.2: Resolve local secrets and pupil-data archives (operator + guard)

**Operator actions (not code):**

1. Rotate/revoke the SSH/WebUntis credentials found in ignored local scripts, check whether they were reused, then remove hardcoded values from those scripts (replace with an approved secret store or delete obsolete scripts). Treat previously committed secrets as compromised too. Never copy a literal into Git, an issue, or this plan.
2. After rotation and a verified restore, move all three root archives (`backup_date_time.zip`, `backup_2026-10-01_17-39-50.zip`, and `backup.zip`) out of the OneDrive-synced worktree into owner-approved encrypted storage with retention. Do not delete before a restore is verified.
3. Confirm the local `.env` uses rotated credentials and is not tracked.

**Files:** `scripts/verify-env.mjs`, the five SSH scripts under `scripts/`, `docs/SECURITY.md`.

1. Replace the two-name backup check with a safe directory scan for backup archives/dumps (`backup*.zip`, `.dump`, `.sql.gz`) while excluding documented fixtures. Report path and size only; never inspect or print file contents.
2. Replace `paramiko.AutoAddPolicy()` in tracked deployment/inspection scripts with pinned known-host verification (`load_system_host_keys`/explicit approved host keys and `RejectPolicy`). Document how the operator installs the host key; do not auto-trust a first connection.
3. Add tests for the guard finding all three archive names and for an unknown SSH host being rejected (a small pure host-policy helper may be unit tested). `npm.cmd install` must pass after the owner moves the archives; the guard must still fail if a new archive is placed back.

---

## Phase 1 — Protect Assessment and Conference Data

### Task 1.1: Validate subject codes and authorize the requested subject

**Files:** `server/src/utils/subject.ts`, `server/src/lib/guards.ts`, `server/src/routes/evaluations.ts`, `server/src/ws/live-sync.ts`, migrations after data preflight.

1. Keep `normalizeSubject()` tolerant for legacy reads. Add a separate strict write API, e.g. `normalizeKnownSubject(raw: unknown): NormalizedSubject | null`, which recognizes the existing alias table and returns `null` for unknowns. `normalizeSubject('Astronomie')` may remain useful for display/read grouping; it must not create a write code.
2. Add `canRateSubject(access, code)` with explicit policy: ordinary teachers may write only a subject assigned to them; administrative/headmaster/KV exceptions must match the product decision above. Apply it in `/batch-default`, `/status`, `/submit`, `/reopen`, `/batch-items`, and WS `UPDATE_RATING` before writes. Keep class-level `canRate` as the first gate.
3. Add a database migration adding a canonical-code `CHECK` to `evaluations.subject_code` **only after** a production-data inventory, alias-collision report, backup, and approved dedupe/merge rule. Do not apply `UPDATE` mappings blindly: `SD` and `D` may coexist under the existing unique key. Preserve comments, submission state, audit history, and conflicting item values according to an owner-approved deterministic rule.
4. Scan `teaching_assignments` and `timetable_lessons` for alias collisions too. Seed writes WebUntis subject text verbatim; keep legacy reads working and make seed/migration behavior explicit rather than silently rewriting historical assignments. Audit short aliases such as `ME`, `BE`, `IT`, `RE`, and `RI` against the current WebUntis export before changing their mappings; a short code may be ambiguous in another school.

**Tests:** unknown code returns 400 and creates no row on every HTTP/WS path; D-only teacher writing M receives 403; known aliases normalize to the assigned canonical subject; leadership exception tests match the recorded policy; migration preflight reports duplicate canonical natural keys before altering data.

### Task 1.2: Make rank aggregation mean what the rubric says

**Decision dependency:** choose the rank aggregation policy above before changing thresholds or stored/final rank behavior.

**Files:** `server/src/lib/ranking.ts`, `server/src/config.ts`, `server/src/lib/ranking.test.ts`, `server/src/routes/statistics.ts`, `server/src/routes/conferences.ts`, `client/src/components/Schulalltag.tsx`, `KelPdfModal.tsx`, `TeacherClassReportModal.tsx`, and shared client/server rank module design.

1. Fix the `normalized` formula: `(positive / rubricItemCount) * rubricItemCount` cancels to `positive`; define how `n.b.`/unrated items affect the denominator, then implement and test it. Test two evaluations with partial coverage, fully unrated evaluation, duplicate item key across subjects, and the configured thresholds.
2. Ensure a score used against 14/8 is bounded/normalized according to the approved rule. Current default `total` sums multiple subject evaluations; server conference/statistics and three report components can therefore exceed 18.
3. Consolidate rank threshold calculation into one importable module consumable by client and server. Remove `flatMap` counting from `Schulalltag`, `KelPdfModal`, and `TeacherClassReportModal`; preserve red-card demotion exactly once. Decide whether `ClassOverview` stays in use or is retired; it currently has tests but no `App.tsx` render path.
4. Remove the duplicated client literals for 14, 8, 18, instant-rank counts, yellow-card threshold, conference date, and deadline by sending the effective values from an authenticated server config endpoint or class data payload.

**Tests:** assert ranks at 7/8/13/14/18; assert all exposed client report counts are `0..18` under multi-subject data; assert server/client produce the same rank for one fixture; verify no data from out-of-scope subjects contributes.

### Task 1.3: Replace fabricated conference totals with recorded decisions

**Files:** `server/src/db/schema.ts`, new migration, `server/src/routes/conferences.ts`, `ConferenceVotingModal.tsx`, conference/statistics tests.

1. First record the conference-voting and co-teaching decisions above. Current `/vote` defaults `votesNo=0`, calculates `votesYes=totalClassTeachers-votesNo`, and persists the result as if every remaining teacher voted yes. `/vote-all` repeats the inference. Stop emitting inferred counts.
2. Recommended design if this is actual voting: persist one ballot per eligible voter and pupil/round (with `classId`, `teacherId`, vote/rank, timestamp; unique natural key), explicitly model abstentions and eligibility, derive counts from recorded ballots, and close/lock the vote transactionally. If the UI is only an authorized final override, persist the override and reason without claiming a ballot tally.
3. Co-teaching has the same modelling issue: `evaluations` is unique per `(round,pupil,class,subject)`, so two teachers cannot create two independent votes for one core subject. Either separate shared rubric ratings from individual subject proposals, or explicitly choose a single shared proposal. Preserve actual teacher identity/hours; do not claim a two-submitter branch that the unique key makes impossible.
4. Set `confirmedAt` to the actual database decision time (`NOW()`/`new Date()`); keep the official meeting date as separate business metadata in the reason/meeting field. Do not show the configured meeting date as if it were the moment a decision was recorded.
5. Define no-vote and tie behavior. Current `suggestedRankByHours` defaults to `Geselle` when no votes exist, and the tie branches favour `Geselle` or `Meister` based on comparison order.

**Tests:** no uncast vote is counted as yes; actual tally equals persisted ballots; duplicate ballot rejected/upserted according to policy; first and second core-subject co-teacher proposals retain the approved identities; timestamp is near current time and separate from meeting date; no-vote and tie behavior matches the written policy.

### Task 1.4: Scope conference lock and round selection consistently

**Decision dependency:** confirm class-scoped vs school-wide lock. Recommendation: class-scoped, matching `/:classId/lock` and its room broadcast.

**Files:** `server/src/db/schema.ts`, migration, `server/src/routes/conferences.ts`, `evaluations.ts`, `classes.ts`, `statistics.ts`, `ws/live-sync.ts`, client lock state.

1. Store class/round lock state in a table keyed by `(class_id, round_id)` (or another approved model); do not update the global `observation_rounds.is_locked` for a class-specific request.
2. Create one shared `resolveActiveRound(classId, operation)` decision: read routes, REST writes, and WS writes must refer to the same round and lock state. Current read handlers select latest-created; write handlers select latest-unlocked. That mismatch can display data for one round while writing another.
3. Broadcast the resulting scoped lock only after transaction commit. Return the effective `roundId` in class data so clients do not infer it.

**Tests:** lock class A and prove class B continues to read/write; lock selected round and prove REST/WS/roster all use the same round; two-round fixture with newer locked and older open must never mix displayed and written rounds.

---

## Phase 2 — Close Authorization and Security Gaps

### Task 2.1: Fail closed in global access and decide timeout visibility

**Files:** `server/src/lib/guards.ts`, `server/src/routes/timeouts.ts`, `cards.ts`, classes/list routes, guard/route integration tests.

1. Change `getGlobalAccess`: `classIds: null` is reserved for explicit admin/headmaster only. A non-admin staff account without a linked teacher row receives an empty scope or 403. A pupil role must never inherit unrestricted scope from `!teacherId`.
2. Record the LW visibility decision. Then scope `/timeouts/active` to an explicit LW supervisor role/duty or the approved class set; return only needed columns and paginate/limit. The current query returns every active timeout, pupil/class names, and free-text assignment with no `LIMIT`.
3. Audit other consumers (`/cards/alerts`, `/timeouts/history`, `/classes`) under the new fail-closed rule and verify explicit school-wide statistics remains controlled by its documented setting.

**Tests:** no-teacher teacher and pupil receive no global classes/cards/history; admin/headmaster remain unrestricted; ordinary teachers see only allowed classes; active timeout list rejects/limits/scope-correctly according to the approved LW policy; query does not return internal fields not needed in the UI.

### Task 2.2: Fix behavior-action IDOR

**Files:** `server/src/routes/pupils.ts`, `server/src/routes/pupils.test.ts` or route integration suite.

In `DELETE /:id/behavior-actions/:actionId`, select the action by both `id` and `pupilId`, or explicitly require `existing.pupilId === pid`; authorize against `existing.classId`, not only the pupil named in the URL. The “author” exception must not allow deletion in a different pupil/class after the route parameter is changed.

**Test:** a KV of class A supplies pupil A's id and an action UUID belonging to class B; expect 404/403 and assert the action remains. Add positive cases for author in same class, KV, headmaster/admin, and unauthorized teacher.

### Task 2.3: Make Origin, WebSocket, and rate-limit policy real

**Files:** `server/src/plugins/security.ts`, `server/src/index.ts`, `server/src/index.test.ts`.

1. With an empty `CORS_ALLOWED_ORIGINS`, reject a foreign `Origin`; the current branch returns `true` when the list is empty. Compare same-origin scheme/host exactly (respect only explicitly trusted proxy headers).
2. Check WebSocket `Origin` on the `/ws` upgrade itself. The current Origin hook skips all GET requests, including WebSocket upgrades. Reject foreign-origin cookie handshakes, including same-site sibling origins; do not put JWTs in query strings.
3. Make the global rate-limit key run after authentication is populated, or deliberately use an IP-based global bucket and document that policy. The current plugin's default `onRequest` hook runs before `buildAuthenticate`'s `preHandler`, so `request.authUser` is absent and the advertised per-user key falls back to IP.
4. Do not trust a client-supplied forwarded host unless `TRUST_PROXY` is enabled behind a controlled proxy.

**Tests:** empty allowlist + hostile POST is 403; allowed same-origin POST succeeds past the Origin gate; hostile-origin WebSocket upgrade is rejected; missing-Origin bearer client behavior is explicitly specified; two authenticated identities behind one injected IP get independent account limits if that remains the policy.

### Task 2.4: Add safe server error handling and body validation

**Files:** `server/src/index.ts`, route schemas under `server/src/routes`, server tests.

1. Add a global Fastify error handler. Return a stable German client message with request/correlation id; log full error details only server-side with password/cookie/query-parameter redaction. Never serialize Drizzle SQL, bind parameters, pupil names, comments, task assignments, or stack traces into an API response.
2. Add Fastify JSON schemas for request bodies at the write boundary. Use `type`, `required`, integer/range, enum, `maxLength`, and `additionalProperties: false` as appropriate. Do not treat TypeScript `as` casts as validation. `batchUpdateItems()` still sends a client `criterionId` for compatibility; either allow it as an ignored optional property or remove it from the client only after the server/client rollout is coordinated. Never trust it as the criterion source.
3. Add per-field limits for `comment`, `nextStep`, action notes/titles, timeout tasks and override reasons. Keep existing body-wide limit as a second guard.
4. Validate timeout milestone/stage values as positive integers in the configured/documented range; current modulo check accepts `-3` as a multiple of 3.

**Tests:** number where string expected and malformed id return 400, not 500; oversized text rejected; unknown properties do not alter DB rows; forced FK/unique errors produce generic response with no SQL/params/PII; valid existing client payloads still pass.

### Task 2.5: Complete password reset/session handling and remove body tokens

**Files:** `server/src/routes/auth.ts`, `server/src/lib/session.ts`, `server/src/lib/guards.ts`, client auth flow, auth tests.

1. `/request-reset` currently only inserts `password_resets`; it never locks `users.must_change_password` and the reset table is never consulted. Make the operation atomic: record request, set `must_change_password=true`, and invalidate existing sessions promptly. The current flag is trusted from the JWT, so changing the DB alone does not affect an already issued token. Use a persisted token/session version or fresh server-side check; do not wait up to eight hours for stale JWT claims to expire.
2. The login and password-change responses still include `{ token }` despite setting an HttpOnly cookie. Remove the token from JSON; verify the client only relies on the cookie and user/expiry fields.

**Tests:** admin reset forces next request from an already logged-in session to require password change; completing password change invalidates reset row/session state; login and password JSON have no `token`.

### Task 2.6: Encrypt the browser-to-server session in transit

**Files:** production reverse-proxy/deployment configuration, `.env.example`, `server/src/config.ts`, `server/src/lib/session.ts`, `server/src/plugins/security.ts`, deployment documentation.

The current deployment serves plain HTTP and `COOKIE_SECURE` defaults to `false`; an HttpOnly cookie still crosses an untrusted network in cleartext. Configure a TLS-terminating proxy with a valid certificate, set `COOKIE_SECURE=true`, and enable `TRUST_PROXY` only when that proxy is controlled and overwrites forwarded headers. Keep local HTTP development usable without weakening production defaults silently. HSTS must only be emitted for the HTTPS deployment.

**Tests/acceptance:** HTTPS deployment sets `Secure`, `HttpOnly`, and `SameSite=Strict`; HTTP development does not break; proxy headers from an untrusted direct client do not alter the inferred origin; document certificate renewal and rollback.

---

## Phase 3 — Make Database State and Audit History Reliable

### Task 3.1: Bring runtime schema, Drizzle schema, and migrations into agreement

**Files:** `server/src/db/schema.ts`, new `server/drizzle/0001_*.sql`, `server/drizzle/meta/*`, `server/src/db/index.ts`, `server/src/db/seed.ts`.

1. The only committed migration does not create `pupil_id_seq` or `pupil_behavior_actions`. `runMigrations()` has hand-written `CREATE TABLE IF NOT EXISTS` for behavior actions but no sequence creation; `pupils.ts` calls `nextval('pupil_id_seq')` and seed calls `setval`. Add generated/reviewed migration(s) for both objects, indexes, constraints, and all approved columns. Remove runtime DDL after migration covers it.
2. Preflight existing production schemas before deploying: table/sequence presence, sequence value above current max, action rows, sentinel teacher IDs, subject code collisions. Back up and test restore first.
3. Resolve `teacherId ?? 0`: seed creates an admin with no teacherId; multiple tables have `NOT NULL REFERENCES teachers(id)`. Decide whether admin/system actions use nullable actor FKs (recommended with “System” display) or a dedicated system teacher row. Migrate all affected columns consistently; never use `0` as an invented FK.
4. Test a clean database from `drizzle migrate` through `seed`, server boot, create pupil, issue card, rate pupil, record timeout, and record behavior action. Also test upgrading a copy of the existing schema without data loss.

### Task 3.2: Make data mutations and audit rows atomic

**Files:** `cards.ts`, `pupils.ts`, `evaluations.ts`, `conferences.ts`, `timeouts.ts`, integration tests.

For mutations whose audit record is part of the system's evidence trail, wrap the business write and audit insert in the same database transaction; broadcast only after commit. Current patterns include final rank upsert then audit, submit/reopen then audit, card issue/revoke, action delete, timeout resolve, and pupil edits. Preserve existing idempotency/unique constraints and do not emit a success event if the transaction rolled back.

**Tests:** force audit insert failure and prove the business mutation rolls back; prove a successful transaction has exactly one matching audit record; prove broadcasts happen only after commit.

### Task 3.3: Correct confirmation timestamps

**Files:** `server/src/routes/conferences.ts`, `client/src/components/ConferenceVotingModal.tsx`, `client/src/components/TeacherClassReportModal.tsx`, schema/migration only if a separate meeting-date column is needed, conference tests.

Set `final_ranks.confirmed_at` to actual persistence time. Keep `OFFICIAL_CONFERENCE_DATE` only as the meeting/business date in a separate field or the reason text. Test persisted confirmation time against a before/after window; test the meeting date independently. The current UI formats `confirmedAt`, but the server writes the configured date constant. Remove the remaining hardcoded meeting-date labels from reports, and make `formatTimestamp(null)` render “Zeitpunkt nicht gespeichert” rather than substituting today's date for a legacy row without a timestamp.

---

## Phase 4 — Restore Consistent Real-Time and Deadline Behaviour

### Task 4.1: Match emitted WebSocket event names and test symmetry

**Files:** `server/src/routes/conferences.ts`, `server/src/routes/timeouts.ts`, `client/src/hooks/useLiveSync.ts`, `client/src/App.tsx`, tests.

The server emits `FINAL_RANK_CONFIRMED` and `TIMEOUT_ISSUED`; client switches handle `FINAL_RANK_LOCKED` and `TIMEOUT_CREATED`. Pick one spelling per event, use it on both sides, and add a test that enumerates emitted event types against client handlers. Include `USER_JOINED`/`USER_LEFT` only if presence is intended; otherwise document/stop broadcasting them.

**Presence decision:** the current client has no presence UI or consumer; do not broadcast `USER_JOINED`/`USER_LEFT`.

**Tests:** a real emitted `FINAL_RANK_CONFIRMED` updates the co-teacher's final rank; `TIMEOUT_ISSUED` refreshes the LW and class views; unknown event is logged/tested rather than silently treated as a successful sync.

### Task 4.2: Expire/release subject-scoped soft locks; reconnect safely

**Files:** `server/src/ws/live-sync.ts`, `client/src/hooks/useLiveSync.ts`, `BeobachtungsGrid.tsx`, WebSocket tests.

1. Include `subjectCode` in `CELL_FOCUS`/`CELL_BLUR` and in the lock key; currently a D focus on `org_1` can disable M `org_1` in Gesamt mode.
2. Track lock ownership and expiry using `WS_SOFT_LOCK_TTL_MS` (currently dead config). Release a client's locks on blur, disconnect, timeout, and room unsubscribe. Do not leave lock state frozen in other clients after tab crash.
3. Add bounded reconnect with exponential backoff and resubscribe; stop retrying on 1008/password-change-required and surface login/connection state.
4. Surface WebSocket `ERROR`; on `CONFLICT`, apply/reload `currentRating` and `currentVersion` rather than only showing a banner. On HTTP fallback failure, show an error and reconcile local state.

**Tests:** D lock does not lock M; dead owner expires/unlocks; disconnect releases all owned locks; reconnect rejoins and gets `SYNCED`; conflict changes displayed value/version; failed/offline write never shows “Gesichert”.

### Task 4.3: Make deadline and save policies consistent

**Files:** `server/src/config.ts`, class-data response or config endpoint, `BeobachtungsGrid.tsx`, `ClassOverview.tsx`, `evaluations.ts`, client tests.

1. Remove browser-local `new Date(2026, 9, 30, 23, 59, 59)` literals and hardcoded display dates. Return the effective server UTC deadline (and official meeting date if needed) and compare timestamps in UTC/epoch milliseconds.
2. Resolve post-deadline `/status`: if comments stay open, permit **only** comment-only updates after the deadline; reject any `proposedStatus`/`nextStep` field. If comments close too, enforce that in API and UI. Do not rely on a disabled client textarea for security.
3. If comment-only updates remain allowed, make the textarea usable after deadline under the approved lock policy and ensure co-teacher report viewers get a targeted refresh/event without N full class reloads.
4. Implement the comment ownership/concurrency decision: when comments are shared, prevent a stale tab from silently overwriting a newer comment; when author-specific, do not make the last writer appear to own another teacher's note.

**Tests:** frozen-clock boundary immediately before/at/after deadline in `Europe/Vienna` and UTC; API accepts/rejects each field according to policy; client displays the same cutoff; comment-only write after deadline follows policy, rank/next-step cannot be rewritten.

---

## Phase 5 — Complete Authorization, Input, and Client Reliability

### Task 5.1: Validate WebSocket payloads strictly

**Files:** `server/src/ws/live-sync.ts`, `server/src/ws/live-sync.test.ts` and/or WebSocket integration tests.

Replace WebSocket `Number.parseInt` acceptance (`"1junk"` becomes `1`) with strict positive safe-integer parsing. Validate message/payload type per event, cap strings/arrays, reject unknown rating/subject values, and ensure `CELL_FOCUS`/`CELL_BLUR` cannot create locks for malformed identifiers. No raw input should reach normalized subject writes before Task 1.1's strict parser. HTTP JSON schemas, string bounds, and timeout/stage range checks belong to Task 2.4.

**Tests:** WS class/pupil ids like `"1junk"`, fractional values, and unsafe integers are rejected; unknown event payloads do not mutate room state; valid client message fixtures pass; unknown subject/rating values are rejected before database writes.

### Task 5.2: Enforce UI write permissions and session errors

**Files:** `classes.ts`, `useLiveSync.ts`, `App.tsx`, `BeobachtungsGrid.tsx`, `api.ts`.

Carry `canRate`/subject permissions from `SYNCED` and class responses into the UI. Disable writes for read-only access; do not infer write permission solely from visibility or core-raster access. Handle 401 centrally; do not turn `getYellowCardAlerts` errors into an empty list; show retry/re-auth state. The server remains authoritative.

**Tests:** read-only teacher sees disabled controls and server rejects writes; 401 prompts session recovery; yellow-alert failure shows an error state, not “no alerts”.

### Task 5.3: Reject malformed runtime configuration

**Files:** `server/src/config.ts`, `server/src/config.test.ts`, `.env.example`.

Make configuration parsing strict: `readInt` must reject partial/decimal forms (`12abc`, `12.5`) rather than accept `parseInt` prefixes; `readBool` must reject unsupported values rather than silently map typos to `false`; timestamps must be validated against the documented ISO/RFC3339 form; `RANK_AGGREGATION` must reject unknown values instead of silently falling back to `total`. Document accepted values and ranges in `.env.example`.

**Tests:** each invalid form throws `ConfigError`; valid integer/boolean/timestamp values retain current semantics; startup fails closed for invalid security/rank settings.

---

## Phase 6 — Performance, Accessibility, and Documentation

### Task 6.1: Bound large reads and bulk writes

**Files:** `backup.ts`, `timeouts.ts`, `evaluations.ts`, `conferences.ts`, schema/index migrations.

1. Replace the 16 full-table in-memory backup export with a streaming/pg_dump-based or paged snapshot mechanism that has a documented consistent-snapshot strategy; never materialize the entire audit log and all pupil rows in one Node heap response.
2. Paginate active timeout/history and pupil card/action histories; preserve product-required retention/report windows.
3. Convert `batch-default` from per-pupil/per-item serial SQL statements to a set-based bulk upsert inside one transaction. Convert `vote-all`'s up to 200 sequential pupil lookups to one set-based query, while validating all rows before write.
4. Index any new filters/orderings from measured query plans; do not add speculative indexes without `EXPLAIN` evidence.

**Tests/verification:** large fixture does not grow response memory linearly without bound; pagination has stable ordering/no duplicates; one invalid batch item writes nothing; bulk operation reports exact rows and preserves atomic OCC increments; capture `EXPLAIN ANALYZE` on a disposable DB.

### Task 6.2: Make audit/report data complete and accessible

**Files:** `BeobachtungsGrid.tsx`, modals, `Schulalltag.tsx`, report components, client tests.

Add accessible names and `aria-pressed` to rating buttons; proper `role="dialog"`, `aria-modal`, focus management, Escape handling, and focus return to dialogs; replace clickable `<div>` rows with keyboard-operable controls and `aria-expanded`. Ensure report comments are subject-scoped and select a deterministic evaluation rather than `p.evaluations[0]`. In `ConferenceVotingModal`, ignore global arrow-key shortcuts while an input/textarea/contenteditable has focus, sequence class-summary requests so an old response cannot render under a newly selected class, and preserve the current pupil after a confirmation reload. In `SchoolStatistics`, synchronize `initialClassId` when the parent changes it, abort/ignore stale class responses, and distinguish load failure from a genuine empty result. Keep the red-card explanation clear and do not imply a rank/count is bounded unless the shared rank engine proves it.

**Tests:** keyboard-only opens/closes each modal; focus returns; screen-reader names include item/rating; expanded rows expose state; report values are scoped; no visual-only selection state.

### Task 6.3: Reconcile documentation and CI with the actual code

**Files:** `.github/workflows/ci.yml`, `SMILE_ARCHITECTURE_AND_CODE_REVIEW.md`, `PLAN.md`, `AI.md`, `IF_YOU_ARE_AN_AI.md`, `docs/SECURITY.md`, `docs/superpowers/plans/2026-10-06-hardening-roadmap.md`.

1. Add CI for Node 22 with client/server tests, typecheck, build, backup-script tests, and the isolated PostgreSQL integration service from Task 0. CI must fail rather than silently skip the required database suite.
2. Replace stale test counts, yellow-card threshold, stack/version descriptions, ranking behavior, event names, and completed/open status. Do not delete an invariant just because current code violates it; mark it as known open work with a test/owner task.
3. Audit all line references after code fixes. Search for old dates, old routes, nonexistent scripts, old event names, and “all tests pass” claims that omit skipped suites.

**Acceptance:** a clean checkout reproduces CI; all documentation claims are checked against current source; no plaintext secrets, pupil data, or ignored-file values are added to tracked docs.

---

## End-of-Plan Review Checklist

- [ ] Every P0/P1 entry is either fixed with passing behavioural tests or explicitly blocked on one of the decisions above.
- [ ] All database integration runs used the guarded disposable database; no test read a production `.env` or ignored scratch URL.
- [ ] Subject alias reads still support historical WebUntis values, while all evaluation writes reject unknown codes and enforce assignment scope.
- [ ] No uncast conference vote is counted as yes; no `confirmedAt` field contains a configured future meeting date in place of the actual write time.
- [ ] REST and WebSocket reads/writes use the same active round and class lock policy.
- [ ] No new 500 response exposes SQL, bound values, stack traces, credentials, or pupil free text.
- [ ] Test totals distinguish passed from skipped PostgreSQL suites; CI runs the PostgreSQL suite rather than silently skipping it.
- [ ] The user-facing reports and class summaries use the same approved rank calculation and denominator.
- [ ] Current docs name any remaining product decision or known violation; they do not claim fixes that only have structural tests.

---

## Sequencing and Release Gates

1. **Before running DB integration tests:** Task 0.1 target guard/isolation. Until then, force the integration probe to an unreachable localhost URL; never use the ignored scratch URL blindly.
2. **Before the next production deployment:** operator credential rotation and archive restore/relocation (Task 0.2); no production deploy from this document.
3. **Before changing evaluation write policy:** preflight current subject-code data and answer the subject-authority/co-teaching/rank policy decisions. Create a backup and prove restore on a disposable copy.
4. **Before migration rollout:** test both empty-database creation and upgrade of a copy of the live schema; compare row counts and audit samples.
5. **For every code task:** add failing tests first; run the focused test, then `npm.cmd test`, `npm.cmd run typecheck --workspaces`, and `npm.cmd run build`; inspect `git diff` for accidental secrets/data; never claim “passed” if the PostgreSQL integration suite was skipped.
6. **Deployment:** staged backup, migration, health check, representative read/write smoke test, and rollback procedure must be approved by the operator. Never run against LXC 115 as part of local plan execution.

## Current-Review Limits

- The PostgreSQL behavioral tests are **not executed locally** (Docker is unavailable, and the ignored scratch database is intentionally unused). Local runs set `SKIP_POSTGRES_INTEGRATION=true` explicitly and the guard refuses to treat that as evidence; the CI zero-skip run is the required proof. Latest local-safe run (2026-10-12): 581 server tests passed / 27 PostgreSQL skipped, 244 client tests passed, typecheck and build green.
- No live database contents, production environment values, archive contents, or credential values were inspected. Credential literal presence was checked without printing values.
- The reported “school-wide statistics / foreign comments” defaults are marked as intentional policy and are not silently changed here.
- This document is an implementation backlog, not evidence that any listed fix has shipped. Update status only after code, tests, migration review, and acceptance evidence exist.
