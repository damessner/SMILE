# Invariants: Historical Failure Modes and Resolution Notes

> Companion to [`IF_YOU_ARE_AN_AI.md`](../../IF_YOU_ARE_AN_AI.md). The directive file states the
> six invariants as rules. This file keeps the **history**: the bug behind each rule, the
> reason the fix was made, and the test that now pins it. Read it before reopening an item
> marked resolved. Each entry is dated to the verification pass that closed it.
>
> Rule of thumb: a note here that says "fixed" describes code that was changed. If a document
> tells you to undo one of these fixes (for example, to rename a WebSocket event back to an
> older name), that document is wrong, not the code.

---

## Invariant 1: Canonical subject codes

**Failure mode.** `teaching_assignments` stored German full names while `timetable_lessons` used
WebUntis short codes. Lookups failed and returned `hours: 0`, which silently removed a teacher's
weight from conference voting. Separately, `normalizeSubject()` mints a code from any input
(`rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_')` in
[`server/src/utils/subject.ts`](../../server/src/utils/subject.ts)). Write paths therefore
accepted forged or misspelled codes, and `evaluations` has no `CHECK` constraint to stop them.

**Resolution (verified 2026-10-08).** All five write paths reject an unknown code. Each validates
with `normalizeKnownSubject()`, which returns `null` for anything outside `CANONICAL_MAP`, and
answers 400 `Ungültiges Unterrichtsfach.`:

| Path | Validator |
|---|---|
| `POST /api/evaluations/batch-default` | `normalizeKnownSubject` |
| `POST /api/evaluations/status` | `normalizeKnownSubject` |
| `POST /api/evaluations/submit` | `normalizeKnownSubject` |
| `POST /api/evaluations/reopen` | `normalizeKnownSubject` |
| `POST /api/evaluations/batch-items` | `normalizeKnownSubject` |
| WS `UPDATE_RATING` | `normalizeKnownSubject` |
| WS `CELL_FOCUS` / `CELL_BLUR` | `normalizeKnownSubject` |

Subject-level authorization sits beside it: `canRateSubject(access, code)` in
[`server/src/lib/guards.ts`](../../server/src/lib/guards.ts) stops a D-only teacher writing an M
row. `normalizeSubject()` stays correct on **reads**, where legacy `SD`/`SE`/`SM` rows must still
resolve. An earlier revision claimed the allowlist did not exist; that was true at `bf35249` only.

**Missing codes too (verified 2026-10-12).** The `= 'D'` fallbacks were removed from `/status`,
`/submit`, `/reopen`, `/batch-items` and the WS `UPDATE_RATING` path. A request without
`subjectCode` now fails `normalizeKnownSubject` instead of writing a Deutsch row. Regression test:
[`server/src/ws/live-sync.behavior.test.ts`](../../server/src/ws/live-sync.behavior.test.ts),
"rejects a live rating write with no subject instead of silently defaulting to Deutsch".

**Client copy.** [`client/src/lib/pupilItems.ts`](../../client/src/lib/pupilItems.ts) holds a
deliberate copy of the alias table, because the client cannot import the server tree. A code
dropped from the copy makes `isSubjectMatch` return false, and the subject renders empty with no
error. Regenerate the copy whenever `CANONICAL_MAP` changes.

---

## Invariant 2: Natural keys and OCC concurrency

**Failure mode.** `evaluation_items` writes computed `existing.version + 1` in Node memory, so
concurrent WebSocket writers lost updates. One grid-wide `expectedVersion` sent for every subject
made the `WHERE version = $4` guard match zero rows for all subjects but the first, producing
`CONFLICT` on cells nobody else had touched.

**Resolution.**
- Increments are atomic: `SET rating = $1, version = version + 1` (WS path) and
  `onConflictDoUpdate` with `version: sql\`${evaluationItems.version} + 1\`` (HTTP path).
- Each subject carries its own version. `itemVersionForSubject(evaluations, code, itemKey)` in
  [`client/src/lib/pupilItems.ts`](../../client/src/lib/pupilItems.ts) resolves it. Regression
  test: [`client/src/components/BeobachtungsGrid.test.tsx`](../../client/src/components/BeobachtungsGrid.test.tsx),
  "a rating write carries the version of the subject it targets".

**Default removed (verified 2026-10-12).** `onUpdateRating` in
[`server/src/ws/live-sync.ts`](../../server/src/ws/live-sync.ts) once defaulted a missing version
to `1`. It now requires a safe integer (0 to `MAX_POSTGRES_INTEGER`) and answers
`Ungültige Bewertungsversion.` otherwise. Tests: `live-sync.behavior.test.ts`, "rejects malformed
expectedVersion instead of silently defaulting to version 1" and "rejects a live rating write with
no expectedVersion".

**HTTP fallback is version-aware too.** An earlier revision said it was not. `useLiveSync.ts`
sends `version: expectedVersion` to `/batch-items`; `validateBatchItems` in
[`server/src/lib/rubric.ts`](../../server/src/lib/rubric.ts) rejects a missing or invalid version;
[`server/src/routes/evaluations.ts`](../../server/src/routes/evaluations.ts) applies
`eq(evaluationItems.version, it.version)` when `version > 0` (`0` means create-only) and returns a
reconcilable `CONFLICT` on mismatch.

**Known exceptions.** `handleInstantRank`, `handleResetAll` and `handleQuickFillCategory` in
`BeobachtungsGrid.tsx` pass a literal `expectedVersion: 1` to `onRate`. They run only in the branch
taken when `onBatchUpdate` is absent. `App.tsx` always supplies `onBatchUpdate`, so that branch is
unreachable in production. Establish that before "fixing" them; do not cite them as examples.

---

## Invariant 3: LiveSync event bus symmetry

**Failure mode.** The client handled `TIMEOUT_CREATED` and `FINAL_RANK_LOCKED` while the server
emitted `TIMEOUT_ISSUED` and `FINAL_RANK_CONFIRMED`. Those two broadcasts were dropped silently,
because the `default:` branch of `switch(msg.type)` in
[`client/src/hooks/useLiveSync.ts`](../../client/src/hooks/useLiveSync.ts) discards unknown types.

**Earlier trap.** The client also dropped `CARD_ISSUED`, `CARD_REVOKED`, `BATCH_*` and
`PUPIL_RANKING_*`, so co-teachers stayed out of sync until a manual reload.

**Resolution (verified 2026-10-08).** Both sides use the **server's** names. The client handles
`TIMEOUT_ISSUED`, `TIMEOUT_RESOLVED`, `FINAL_RANK_CONFIRMED` and `FINAL_RANK_REVOKED`. Every
emitted `type` now has a matching `case`. Recurrence guards:
[`client/src/hooks/useLiveSync.test.ts`](../../client/src/hooks/useLiveSync.test.ts) and the
symmetry assertions in
[`server/src/docs/contract.test.ts`](../../server/src/docs/contract.test.ts) and
[`server/src/ws/live-sync.test.ts`](../../server/src/ws/live-sync.test.ts).

**Presence.** `USER_JOINED` and `USER_LEFT` are no longer emitted. Presence indicators were removed
deliberately rather than left broken. Older references to `live-sync.ts:196` and `:102` were stale.

---

## Invariant 4: Subject isolation in the grid

**Failure mode.** In the submitted-list logic, the ternary
`effectiveCanAccessRaster ? (e.subjectCode === mySubjectCode ? e.isSubmitted : e.isSubmitted) : ...`
returned `e.isSubmitted` on both branches. A submission in English therefore
marked German or Math as done, and the teacher skipped the pupil. Fixed by scoping every check
with `isSubjectMatch`. Regression test: `BeobachtungsGrid.test.tsx`, "does not tick a pupil who
submitted Deutsch when Mathematik is still open".

**`getItemData` fallback.** The grid searched the active subject and, on a miss, scanned every
subject. A teacher saw another teacher's ratings, those ratings fed the displayed rank, and the
wrong evaluation's `version` was paired with the active subject's write, so the OCC guard reported
a conflict on an untouched cell. The body is now a delegation to `findItemForSubjects` in
`pupilItems.ts`, which searches only in-scope subjects and returns `null` on a miss. Regression
tests: `client/src/lib/pupilItems.test.ts` ("does not fall back to another subject when the subject
has no evaluation", "does not borrow a key that only a subject outside the scope holds") and
`BeobachtungsGrid.test.tsx` ("the rendered cells hold no rating from another subject").

---

## Invariant 5: 18-item rubric boundary

**Failure mode (grid).** `calculateRank` concatenated items across every evaluation, counting 36+
items instead of 18. Fixed by scoping to the active criteria. It now delegates to
`scoreSubject(pupil.evaluations, targetCode, rubricItemKeys)`.

**Failure mode (reports).** Four report and overview implementations merged item ratings across a
pupil's subjects with an "any positive wins" rule (`|| isPositiveRating(...)`). Three teachers
rating disjoint six-key sets each produced 18/18 (Meister) while each saw 6/18. Removed in commit
`9dfce72` (2026-10-10). The four sites now call `scoreSubject`, which dedupes by key with
newest-`updatedAt`-wins. Affected: `Schulalltag.tsx` (`getPupilSubjectResults`; `getPupilRank`
derives no pupil-level rank), `KelPdfModal.tsx`, `TeacherClassReportModal.tsx`.
`ClassOverview.tsx` was deleted on 2026-10-12 as dead code. Regression tests:
`Schulalltag.test.tsx`, `KelPdfModal.test.tsx` (no synthetic 18/18) and
`TeacherClassReportModal.test.tsx` ("does not merge results into one aggregate score").

**Unrated subjects (E13, verified 2026-10-10).** `handleSubmitPupil` computes rank per subject. A
subject with a calculated rank submits it. An unrated subject inherits the teacher's explicit
`votedRank` proposal, if one exists. Otherwise it submits nothing. Back-filling a fabricated
Geselle would store a `proposedStatus` nobody cast. Consequence: in Gesamt mode `isSubmitted`
requires every subject. Tests: `BeobachtungsGrid.test.tsx`, "never submits a fabricated rank for an
unrated subject" and "lets an unrated subject inherit an explicit manual proposal".

**Server aggregate.** `summarizeRatings` in
[`server/src/lib/ranking.ts`](../../server/src/lib/ranking.ts) is additive under the default
`RANK_AGGREGATION=total`. A pupil rated by several teachers can exceed 18 in a stored tally.
Production callers (`server/src/routes/conferences.ts`) pass one group per subject, so the
aggregate stays per subject. Unifying it is a deferred decision (roadmap C9/E13).

**Hardcoded thresholds and deadline.** Thresholds (`14`/`8`) and the `/18` denominator were client
literals. They are now delivered through `rubricConfig` (see directive §8). The deadline was a
browser-local literal, `new Date(2026, 9, 30, 23, 59, 59)`, which disagreed with the server by
timezone. It now arrives from the API as a UTC ISO string. `BeobachtungsGrid.tsx` fails closed
when it is missing (`!Number.isFinite(deadlineAt) || now > deadlineAt` disables writes). The
hardcoded `'2026-10-30T21:59:59.000Z'` fallback in `ClassOverview.tsx` went with that file.

---

## Invariant 6: Authentication, deactivation and rate limiting

**Deactivation gap (closed 2026-10-12).** Deactivated accounts were rejected only at login. Now
`buildSessionGuard` in [`server/src/lib/guards.ts`](../../server/src/lib/guards.ts) reads
`teachers.active` through the cached session state (`server/src/lib/session.ts`) on every request
and answers `403 ACCOUNT_DEACTIVATED`, clearing the session cookie. The WebSocket layer closes with
`1008` on the next message (`ensureLiveSession`). Admins are exempt, because their placeholder
teacher rows are `active: false` by design (migration `0002`). Tests:
[`server/src/routes/auth.test.ts`](../../server/src/routes/auth.test.ts) and
[`server/src/ws/live-sync.behavior.test.ts`](../../server/src/ws/live-sync.behavior.test.ts).

**WebSocket rate limiting (added 2026-10-12).** WebSocket frames bypass the HTTP limiter. Each
socket now has a token bucket (`WS_RATE_LIMIT_PER_SECOND` and `WS_RATE_LIMIT_BURST` in
`live-sync.ts`). The first drop sends one `ERROR` with code `RATE_LIMITED`. Twenty consecutive
violations close the socket with `1008`. Unit tests: `server/src/lib/ws-rate-limit.test.ts`.
Wiring: `live-sync.behavior.test.ts`.

---

## Historical traps (bugs fixed, do not reintroduce)

1. **LiveSync message omission.** See Invariant 3. The `TIMEOUT_ISSUED` and `FINAL_RANK_CONFIRMED`
   instance came back through a one-sided rename. It is fixed. Never re-apply that rename.
2. **Ternary logic error in the submitted list.** See Invariant 4. Fixed with `isSubjectMatch`.
3. **Subject code naming divergence.** See Invariant 1. Fixed with the canonical normalizer.
4. **Multi-subject item count inflation.** See Invariant 5. Fixed in `BeobachtungsGrid.tsx` by
   scoping to active criteria. The report and overview merge was fixed in `9dfce72`.
5. **Cross-subject `getItemData` fallback.** See Invariant 4.
6. **Unvalidated `batch-items` (rank forgery).** `POST /api/evaluations/batch-items` checked only
   that `itemKey` was present and wrote the client's own `criterionId`. A batch of 200 invented
   keys rated `++` became 200 positive ratings, which is an automatic Meister. Any teacher with
   write access to one pupil could forge it. Fixed by `validateBatchItems` in
   [`server/src/lib/rubric.ts`](../../server/src/lib/rubric.ts): every key must exist in the active
   rubric, the rating must be in `VALID_RATINGS`, the criterion is derived server-side, and
   rejection is all-or-nothing. Unit tests: `server/src/lib/rubric.test.ts`. Route tests:
   [`server/src/routes/evaluations.integration.test.ts`](../../server/src/routes/evaluations.integration.test.ts)
   ("Rank Forgery Prevention (Behavioral)"). These need `TEST_DATABASE_URL` and run in CI.
   Structural guard: [`server/src/routes/evaluations.test.ts`](../../server/src/routes/evaluations.test.ts).

---

## Other resolved notes

- **Yellow-card threshold.** The default alert threshold is 2, not 3
  (`YELLOW_CARD_ALERT_THRESHOLD` in [`server/src/config.ts`](../../server/src/config.ts)). An
  earlier description of the rule said 3 and was wrong.
- **`subjectCode` and `expectedVersion` defaults.** `subjectCode` defaulted to `'D'` and
  `expectedVersion` to `1`. Both defaults were removed (see Invariants 1 and 2).
- **Rubric source of truth.** `assessmentRubrics.gradeBoundaries` in the database is not read at
  runtime. `server/src/db/seed.ts` writes it once, so raising a threshold in `config.ts` on an
  existing install leaves a stale row behind. Read `config.ts`. Details are in directive §8.
