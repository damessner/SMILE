# Critical Review & Hardening Pass — 2026-11-09

**Scope:** full repository review (server, client, tests, docs) on `main` at `e64b6ac`,
followed by a fix pass with regression tests.
**Method:** two independent read-only audits (server security/correctness, client
state/live-sync) plus a direct review; every reported finding was re-verified against the
code before being accepted, fixed, or deferred. One auditor finding was refuted (see §2.4).
**Not a substitute for CI:** the PostgreSQL integration suite was skipped locally with an
explicit `SKIP_POSTGRES_INTEGRATION=true`; the 32 skipped cases still need the CI run to be
evidence.

---

## 1. Fixed in this pass

Each item below is code + a regression test that fails on the previous implementation.

### 1.1 Username enumeration through login timing

`server/src/routes/auth.ts` compared an unknown username against a dummy bcrypt hash
that was **66 characters long** ("$2a$12$" + 59). bcrypt hashes are exactly 60
characters; bcryptjs rejects the malformed value without running the key derivation.
Measured on this workstation: unknown username ≈ **1 ms**, wrong password for an existing
account at cost 12 ≈ **265 ms**. The code's own comment claimed the dummy comparison made
the paths indistinguishable, so the intended protection was absent.

Fixed by deriving `DUMMY_PASSWORD_HASH` from `BCRYPT_ROUNDS`, so it is a valid 60-character
hash at the configured cost (`auth.login.test.ts`: format, cost, and "unknown username is
compared against the dummy hash").

### 1.2 Stale role claim could reach admin-only routes

Admin/leadership gates (`requireRole`, `requireAccountAdministrator`) run in
`preValidation` and decide on the **token's** role. The durable role was applied later, in
the global `preHandler` session guard, and the handlers behind those gates do not re-check
it. A demoted administrator therefore kept reaching `/api/backup/export-json`,
`/api/backup/restore`, the audit log and credential minting with the stale claim for the
rest of the token lifetime — the exact class of bug the guard exists to prevent, one
lifecycle stage too late.

Fixed in `server/src/lib/guards.ts`: if the durable role differs from the claim, the
session is ended (401 + cookie cleared) instead of continuing with a capability the account
no longer has. Test doubles that omit `role` keep working. Regression test in
`auth.test.ts`.

### 1.3 Conference "unconfirm" recorded a withdrawal that never happened

`POST /api/conferences/:classId/vote` with `action: 'unconfirm'` wrote a
`CONFERENCE_VOTE_REVOKED` audit row, broadcast `FINAL_RANK_REVOKED` and answered 200 even
when the DELETE matched no row. A stale board or crafted request could therefore add "a
conference decision was withdrawn" to the official record although none had been
confirmed. Now the DELETE uses `RETURNING` and a no-op answers 404 without audit or
broadcast, matching the rule `/reopen` already followed. Regression test in
`conferences.test.ts`.

### 1.4 Raster items stayed writable after a ballot was submitted

`/status` refuses rank and next-step changes on a submitted evaluation (conditional
update) unless it is reopened, but `POST /api/evaluations/batch-items` and the WebSocket
`UPDATE_RATING` path wrote `evaluation_items` with no `is_submitted` check at all. The
client disables the grid, but the API is the authority: a co-teacher's client or a crafted
request could rewrite the raster evidence behind a submitted ballot, silently changing the
positive counts the conference screen shows, with no `/reopen` and no audit.

Both paths now refuse with `EVALUATION_SUBMITTED` ("Diese Bewertung ist bereits
eingereicht. Bitte zuerst wieder öffnen."). The WebSocket path has a behavioral
regression test in `live-sync.locks.test.ts`; `batch-items` shares the same predicate and is
exercised by the CI integration suite.
**Known remaining exception:** `/batch-default` is an explicit force-overwrite operation
(`forceOverwrite: true` acknowledgement) and is not covered by this guard; see §4.

### 1.5 Client tests could not run on Node 23+ (all of `App.test.tsx` failed)

Node 23+ defines experimental `localStorage`/`sessionStorage` accessors on `globalThis`;
without `--localstorage-file` they evaluate to `undefined`. Vitest's jsdom environment
skips names that already exist on the global, so the jsdom Storage never became reachable.
Result: 7 tests in `App.test.tsx` failed with "Cannot read properties of undefined
(reading 'setItem')" on Node 26 while CI (Node 22) was green. `client/src/test/setup.ts`
now installs a deterministic in-memory Storage per test file, so the runner's Node version
no longer decides whether storage exists. Full client suite is green again.

### 1.6 Onboarding tour could not be dismissed when storage throws

`OnboardingTour.tsx` wrote the "seen" flags directly inside its close handler. Safari's
private mode and browsers with site data disabled **throw** on `setItem`; the exception
escaped before `onClose()` ran, so the overlay could not be closed at all. The writes are
now guarded (the tour closes even when the preference cannot persist; it simply appears
once more next visit). Regression tests in the new `OnboardingTour.test.tsx`, including
one that makes `setItem` throw.

### 1.7 Schulalltag live timeout event reloaded the previous class

The `smile:timeouts-updated` listener is registered in a one-time `useEffect([])` and
captured `currentClass` from the mount render. After a class switch, a timeout event
reloaded the **previous** class's cards and time-outs into the current view: every row's
green/yellow/red/time-out counters fell to 0 until a manual reload. The handler now reads
the current class id from a ref. Regression test in `Schulalltag.test.tsx` (render class
3a, switch to 4b, dispatch the event, assert only 4b is reloaded).

### 1.8 Conference voting modal discarded unsaved rank edits and could apply a stale class

`loadData()` runs after every accept/withdraw and rebuilt `pupilVotes` from the server
response alone, so any rank the chair had changed in table mode for other pupils was
silently replaced by the server's suggestion — and the following "Klasse bestätigen"
submitted ranks nobody had chosen. Separately, an in-flight vote's `loadData(oldClassId)`
could pass the generation guard after a class switch and render the old class under the
new header.

`loadData` now (a) refuses a class id that is no longer selected (before and after the
await) and (b) merges server data with local unsaved edits: a local rank survives when it
differs from the server's current proposal and the pupil is not confirmed; everything else
follows the server so co-chairs' decisions still appear. Regression test in
`ConferenceVotingModal.test.tsx`.

---

## 2. Verified, not changed

### 2.1 HIGH — WebSocket rating write can race a conference lock

`server/src/ws/live-sync.ts` (UPDATE_RATING) checks `getClassRoundLockState` once and then
writes `evaluations`/`evaluation_items` outside any transaction. Every HTTP rating route
wraps the check and the write in one transaction that first takes
`acquireClassRoundLock(tx, round.id, classId)` and re-reads the lock, so the chair's
`POST /lock` and the write are serialized. The WebSocket path has no such serialization: a
freeze committed between the check and the write can be overtaken by an in-flight frame,
leaving a rating change in a frozen class.

This is a genuine, if narrow, race and was **not** changed here because it requires
restructuring the whole WS write path (transaction + `onConflictDoNothing` inserts to avoid
aborting on the unique-index fallback). The fix should mirror
`evaluations.ts` `/batch-items`: one `db.transaction` around the evaluation/item read and
write, `acquireClassRoundLock` first, re-check `getClassRoundLockStateWith`, throw a
"locked during write" error mapped to `CLASS_CONFERENCE_LOCKED`, and use
`onConflictDoNothing().returning()` for the two races instead of `try/catch` (a caught
constraint violation aborts a PostgreSQL transaction).

### 2.2 Retroactive Time-Out duplicate check is a TOCTOU

`timeouts.ts` checks for an existing identical retroactive incident with a SELECT and then
inserts, with no unique constraint covering `(pupil_id, class_id, kind, sent_at)`. Two
concurrent identical submissions can both pass and double-store the incident (double
escalation mail, double WebUntis mirror). Needs a uniqueness decision + migration, so it
was left to a migration-bearing change rather than a bare code edit.

### 2.3 Client findings deferred

- `WebUntisView.tsx`: the "Neuer Klassenbucheintrag" form lists the App-selected class's
  pupils but posts the WebUntis filter's class id, so the request is rejected when the two
  differ; and `loadLessons`/`loadAbsences`/`loadEvents` have no request-generation guard,
  so a slow older response can overwrite the newer selection. Both need a small state-shape
  change plus tests and were not squeezed into this pass.
- `useClassData.ts`: the timetable auto-detect applies after the fallback class load and
  can yank the teacher back to a class they already left manually. Fix: apply the detected
  class only while the selection is still the fallback.
- `ConferenceVotingModal`: full-screen conference mode has no `role="dialog"`/
  `aria-modal`, initial focus, Escape close or focus trap (other dialogs in the app have
  these). Accessibility follow-up.

### 2.4 Refuted finding

The client audit reported that ordinary teachers receive a permanent "Live Sync gestört"
state because subscribing to the Lernwerkstatt room 999 is denied. That is not what the
server does: `onSubscribe` deliberately answers **silently** for class `999`
(`live-sync.ts`, the `classId !== LW_CLASS_ID` branch guards the error + disconnect), so no
ERROR frame exists for the client to store. The rest of that finding (un-correlated ERROR
frames are all stored as connection errors) is accurate but not reachable on that path.

---

## 3. Verification evidence

Run from the repository root on 2026-11-09 (Windows, Node 26.13, `SKIP_POSTGRES_INTEGRATION=true`):

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean (server + client) |
| `npm test --workspace=server` | 60 files, 764 passed, 32 skipped (PostgreSQL opt-out) |
| `npm test --workspace=client` | 23 files, 292 passed |

New/updated regression tests: `server/src/routes/auth.login.test.ts` (timing parity),
`server/src/routes/auth.test.ts` (role divergence), `server/src/routes/conferences.test.ts`
(no-op revocation), `server/src/ws/live-sync.locks.test.ts` (submitted evaluation),
`client/src/test/setup.ts` (storage harness), `client/src/components/OnboardingTour.test.tsx`,
`client/src/components/Schulalltag.test.tsx` (class switch),
`client/src/components/ConferenceVotingModal.test.tsx` (unsaved edits). Each client test was
verified to fail against the previous implementation.

## 4. Remaining limits

- PostgreSQL integration evidence is still required from CI; no local database was used.
- `/batch-default` remains a deliberate force-overwrite (it carries `forceOverwrite: true`)
  and can rewrite a submitted evaluation's items. Either it should refuse submitted
  evaluations after the fix in §1.4, or the force-overwrite semantics need an explicit
  product decision.
- The accepted risks documented in `docs/SECURITY.md` (plain HTTP during the transition,
  shared start password with 14-day expiry, school-wide statistics defaults, conference
  quorum) are unchanged.
