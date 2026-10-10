# Subject-Scoped Assessment Results and Class-Scoped Conference Locks

**Date:** 2026-10-09  
**Status:** Design draft for review  
**Scope:** Correct rank aggregation and conference-lock enforcement. Seeded teacher bootstrap-password handling and school-wide statistics / foreign-comment visibility are explicitly out of scope.

## Goal and accepted policy

Present one assessment result per canonical subject; never merge different subjects into one synthetic 18-item rank. Statistics summarize those subject-level results. A formal conference decision remains a separate class-wide/pupil-level result. A conference lock applies to one class and one observation round and blocks every evaluation mutation for that class, while conference decisions remain writable. Keep the documented HTTP LAN deployment compatible; retain the current configurable `COOKIE_SECURE` behavior.

## Current behavior and cause

- The observation grid ranks one active subject correctly, but Gesamt mode finds each criterion in the first subject that has it and submits that one rank to every subject.
- Other visible client reports deduplicate criterion keys across subjects by letting any positive rating win. The resulting count stays at most 18 but describes no single subject. School statistics similarly calculate one pupil-level rank from a cross-subject set of core evaluations.
- `POST /api/conferences/:classId/lock` updates `observation_rounds.is_locked`, which is shared by every class. The UI broadcasts a class id, but the persisted flag and write-round selection are global. This both locks unrelated classes and makes the effective lock state inconsistent across the client and write surfaces.
- The two explicitly excluded findings are not part of this change: do not change bootstrap-password policy, statistics visibility defaults, class visibility policy, or comment redaction policy.

## Design

### 1. Canonical-subject scoring

Use a shared, unit-tested rank helper in the client assessment utility layer to score only a requested subject and only the configured rubric item keys. Resolve aliases through the existing client subject-matching map; server read paths continue to use `normalizeSubject()`. Count each rubric key at most once, so the score remains within 0–18. When duplicate legacy/canonical evaluations resolve to one canonical subject, reconcile duplicate item keys by the newest `updatedAt`; do not let a positive value win merely because it is positive. An evaluation with no rated rubric items has no calculated rank rather than an automatic Lehrling.

In single-subject mode, retain the existing rank presentation, now backed by the shared helper. In Gesamt mode, show a distinct count/rank for each subject (and no cross-subject total rank); submit each subject's independently computed rank with that subject's evaluation. A manually selected rank on a subject without raster access remains that subject's proposal and must not be copied as a calculated rank to a different subject.

Update every visible non-conference result consumer: the observation grid, classroom overview, daily classroom view, teacher report, KEL/PDF report, and statistics. Reports show subject-labeled rows rather than a blended score. Conference voting/exports may continue to show their explicitly identified conference-level decision/suggestion, but rubric evidence shown there must remain subject-labeled and bounded to each subject's 18 items.

### 2. Statistics contract

Return subject-specific results for each pupil from the statistics endpoint. A result includes canonical `subjectCode`, display name, positive and rated counts (both bounded by 18), calculated rank or `null` when no rubric item is rated, and that subject's evaluation/proposal details. Build the subject list from class teaching assignments, normalized to canonical codes, so a pupil with no evaluation in an assigned subject is represented as pending rather than omitted. Deduplicate alias-equivalent assignment/evaluation codes.

Make the status distribution explicitly per pupil-subject result; its `total` is the number of rated pupil-subject results, not the number of pupils. The statistics UI labels this unit and allows subject-specific filtering/display. Keep the confirmed conference rank as a separate pupil-level field and do not use it to overwrite or inflate the subject distribution. Preserve the existing statistics access and foreign-comment policy unchanged.

### 3. Persisted class/round lock

Add a `class_round_locks` table keyed uniquely by `(round_id, class_id)`, with `is_locked` and `updated_at`; an absent row means unlocked. Add the Drizzle model and the next append-only SQL migration. Keep `observation_rounds.is_locked` as the existing global round closure. The effective write lock is `round.is_locked OR class_round_locks.is_locked` for that class and round.

Change the existing conference lock endpoint to persist only the class/round record for the latest active round; it must never mutate the global round flag. A request without an active round returns a clear client error and does not claim a lock was saved. Preserve `canRunConference` authorization and audit logging. Return `{ success, classId, roundId, isLocked }` and broadcast `VOTING_LOCK_CHANGED` with the same scope fields. A missing class lock row means `false`.

Use one shared server helper to resolve active-round class-lock state. The roster response and WebSocket `SYNCED` event report the effective state for their own class. Live updates are keyed by `classId`, so the selected class's state cannot be overwritten by another subscribed room. Keep server/client event names symmetric.

Enforce the class lock on all evaluation mutation paths: `POST /api/evaluations/batch-default`, `/status`, `/submit`, `/reopen`, `/batch-items`, and WebSocket `UPDATE_RATING`. A locked class receives HTTP 423 with code `CLASS_CONFERENCE_LOCKED`; WebSocket writes receive the matching structured `ERROR`. This applies to comments/status changes and submission/reopen as well as rubric ratings. Existing UI disabled states should cover every evaluation control, including comment autosave, and surface server rejection rather than claiming a save. Conference vote, unvote, and vote-all endpoints remain available while the class is locked. The global round lock continues to close writes in every class.

The lock check defines behavior for writes that reach the persisted guard after a lock has committed; already-running requests are not retroactively rolled back. A lock change is broadcast only after persistence succeeds.

### 4. Compatibility and migration

- No new dependencies or authentication transport changes.
- No new or changed cookie flags; session cookies remain HttpOnly and SameSite Strict, with `Secure` governed by the existing operator setting.
- Existing rows need no backfill: no `class_round_locks` row means the class remains unlocked, while a globally locked round remains closed.
- The SQL migration must be append-only, update the Drizzle migration journal/snapshot following repository convention, and add only the table/indexes described above.

## Failure handling and authorization

- Do not return success for a lock that has no active round or failed to persist.
- Do not expose lock state for a class the caller cannot read; preserve existing class access checks.
- Maintain subject-code canonicalization on server writes and subject isolation in every score.
- Keep rubric totals at 18 maximum. Do not use a cross-evaluation `flatMap` to form a rank.
- Lock/unlock audits and broadcasts include class and round identity. Failure to write the lock leaves the prior persisted state unchanged and emits no success broadcast.

## Acceptance criteria

1. The same pupil may be Lehrling in one subject and Meister in another; no classroom, report, PDF, or statistics calculation merges those scores into one 18-item rank.
2. Gesamt submission stores the rank for the corresponding subject, not the first subject's rank for every subject.
3. Per-subject counts never exceed 18; duplicate item keys are reconciled deterministically, and unrated subjects are pending.
4. Statistics returns and renders subject-level results/distributions, with the final conference decision separately identified as pupil-level.
5. Locking class A/round R leaves class B/round R writable; locking A/R in the active round blocks every REST and WS evaluation mutation for A, with stable documented error codes.
6. Conference confirmation/revocation/vote-all remain usable while the class is locked.
7. Existing global round closure, class authorization, audit trail, canonical subject rules, LiveSync symmetry, cookie behavior, and both excluded policies remain unchanged.
8. Unit/component tests and available route tests cover these behaviors. PostgreSQL integration tests are run when an explicitly configured disposable test database is available; skipped database checks must be reported as a limitation, not a pass.
9. `npm test`, `npm run typecheck --workspaces`, and `npm run build` pass; verify the routes and at least one representative client flow through their actual test/UI interfaces.

## Test strategy

- Add failing pure-helper tests for distinct-subject results, canonical aliases, duplicate rubric-key reconciliation, zero-rated pending subjects, and the 18-item cap.
- Add component regressions for Gesamt-mode per-subject badges/submission, classroom cards, teacher/KEL reports, and subject-specific statistics distribution/filter behavior.
- Add server tests for lock-state lookup/default-unlocked, lock endpoint authorization and persistence, no-active-round behavior, class isolation, HTTP 423 response on each evaluation route, and WebSocket error/broadcast symmetry. Use the existing PostgreSQL integration suite for actual database persistence when its explicit test database is configured.
- Run the full root tests, workspace typechecks, and production build after the final edit. Do not alter or skip existing tests to obtain a green run.
