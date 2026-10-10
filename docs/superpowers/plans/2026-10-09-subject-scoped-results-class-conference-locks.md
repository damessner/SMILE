# Subject-Scoped Results and Class Conference Locks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-conference assessment result subject-specific and enforce persisted conference locks per class and round across all evaluation mutation paths.

**Architecture:** Add a pure client scoring helper that scores rubric keys within one canonical subject and adopt it in visible classroom/report surfaces; replace the statistics pupil-wide score with subject result rows. Add a `class_round_locks` table, a shared effective-lock resolver, REST/WS guards, and matching client lock-state propagation. Preserve global round closure, conference decisions, existing authentication and excluded policies.

**Tech Stack:** TypeScript, React, Vitest/Testing Library, Fastify, Drizzle ORM, PostgreSQL; no new dependencies.

**Spec:** [2026-10-09 subject-scoped results and class conference locks](../specs/2026-10-09-subject-scoped-results-class-conference-locks-design.md)

## Global Constraints

- Store only canonical subject codes on evaluation writes; use `normalizeKnownSubject()` and read aliases through `normalizeSubject()` / the client alias matcher.
- Count at most the rubric's 18 distinct item keys for one subject. No positive-wins merge across subjects.
- Evaluation lock key is `(round_id, class_id)`; absent row is unlocked; global `observation_rounds.is_locked` remains an all-class write closure.
- REST lock rejection is HTTP 423 with `code: 'CLASS_CONFERENCE_LOCKED'`; WS rejection is structured `ERROR` with the same code.
- Conference vote, unconfirm and vote-all remain allowed under a class lock.
- Do not change bootstrap-password handling, statistics visibility, foreign-comment policy, cookie flags, or add dependencies.
- Preserve exact server/client LiveSync event symmetry and existing authorization, audit, deadlines and OCC behavior.
- Run `npm test`, `npm run typecheck --workspaces`, and `npm run build` from repo root; preserve exit statuses and report PostgreSQL integration skips honestly.

## Review Focus

- Legacy and canonical evaluation rows both exist for one subject with the same item key; newest `updatedAt` wins deterministically, irrespective of whether a rating is positive.
- A subject has zero rated items, or only `n.b.`/empty values; it is pending and omitted from ranked-result distributions.
- A class has no class-lock row while another class is locked in the same round; the missing row remains unlocked.
- Global round closure and class lock are both active; all evaluation writes remain closed even when a class lock is false.
- A socket subscribes to multiple classes and receives lock updates for a non-primary class; the selected class state must not be overwritten.

---

## File map

**Scoring and result display:** `client/src/lib/pupilItems.ts` + `pupilItems.test.ts` own pure subject-scoped score calculation; `BeobachtungsGrid.tsx` + `.test.tsx`, `ClassOverview.tsx` + `.test.tsx`, `Schulalltag.tsx` + new `Schulalltag.test.tsx`, `TeacherClassReportModal.tsx` + new `.test.tsx`, and `KelPdfModal.tsx` + new `.test.tsx` use it. The grid receives `currentClass.mySubjects` for the KEL modal. `types.ts` adds a shared rank type if needed.

**Statistics:** new pure `server/src/lib/subject-statistics.ts` + `.test.ts` canonicalizes assigned/evaluated subjects and scores rows; `server/src/routes/statistics.ts` queries class assignments and returns subject results plus a separate pupil-level conference decision; new `client/src/components/SchoolStatistics.test.tsx` verifies `SchoolStatistics.tsx` row, pending, filter and distribution rendering.

**Lock backend:** `server/src/db/schema.ts`, hand-authored append-only `server/drizzle/0005_class_round_locks.sql`, and `server/drizzle/meta/_journal.json`, plus `server/src/lib/class-round-lock.ts` + `.test.ts`. The existing repository uses hand-authored migrations 0002–0004 and currently has only snapshots 0000–0001; do not fabricate a snapshot or run `db:migrate` to a configured database. If `drizzle-kit generate` is tried, use only a safe local configuration and retain its snapshot only after verifying it contains solely the intended change. `conferences.ts` persists/broadcasts; `evaluations.ts` and `live-sync.ts` enforce; `classes.ts` and WS `SYNCED` expose effective state. PostgreSQL route coverage belongs in the existing opt-in `evaluations.integration.test.ts`.

**Lock client:** `client/src/hooks/useLiveSync.ts` keeps class-keyed lock state for subscribed IDs; `App.tsx` passes selected-class lock state to `BeobachtungsGrid`; `BeobachtungsGrid.tsx` blocks ratings, submits, reopen and comment autosave. `api.ts` maintains typed lock endpoint behavior if response shape is modeled. Update hook/grid tests.

## Task 1: Pure canonical-subject scoring helper

**Exact interface:** export `type AssessmentRank = 'Lehrling' | 'Geselle' | 'Meister'` and `scoreSubject(evaluations: Array<{ subjectCode: string; id: string; items?: Array<{ itemKey: string; rating: string; updatedAt: string }> }>, subjectCode: string, rubricItemKeys: readonly string[]): { subjectCode: string; positiveCount: number; totalRated: number; rank: AssessmentRank | null }` from `client/src/lib/pupilItems.ts`.

**Files:**
- Modify: `client/src/lib/pupilItems.ts`
- Modify: `client/src/lib/pupilItems.test.ts`
- Modify: `client/src/types.ts` only if a shared result type is required

**Interfaces:**
- Consumes: `Evaluation[]`, canonical subject code, configured rubric item keys.
- Produces: `scoreSubject(evaluations, subjectCode, rubricItemKeys)` with the exact signature above; `positiveCount` and `totalRated` are each in `[0, rubricItemKeys.length]`, and `rank` is null when `totalRated === 0`.
- Duplicate alias-equivalent evaluations and repeated item keys resolve by newest `updatedAt`; tie-break equal timestamps by lexicographically greater evaluation id, never rating value.

- [x] **Step 1: Write the failing helper tests** in `pupilItems.test.ts`: (a) same pupil D with 6 positives and M with 16 positives produces independent counts/ranks; (b) aliases `SD` and `D` group together; (c) duplicate same-key entries choose newest timestamp even when older is positive; (d) `n.b.`/empty-only inputs return `totalRated: 0, rank: null`; (e) item keys outside the rubric list are ignored and duplicates never exceed 18.
- [x] **Step 2: Run the targeted test to confirm the missing export fails**: `npm test --workspace=client -- src/lib/pupilItems.test.ts`. Expected: failure that `scoreSubject` is not a function/export, not a runner/import error.
- [x] **Step 3: Implement `scoreSubject`** in `pupilItems.ts`; use `isSubjectMatch`, distinct rubric keys and deterministic newest-row selection; rank thresholds remain 8 and 14, matching existing UI behavior.
- [x] **Step 4: Re-run the targeted test** with the same command. Expected: all `pupilItems` assertions pass.

## Task 2: Subject-specific classroom grid and cards

In Gesamt mode, retain a single row per pupil but show a compact labeled score/rank chip for every `mySubjects` entry; remove the current aggregate rank chip/count. In single-subject mode retain the current single score. For red-card behavior in `Schulalltag`, apply the existing one-step demotion separately to each subject rank, never to an aggregate.

**Files:**
- Modify: `client/src/components/BeobachtungsGrid.tsx` and `.test.tsx`
- Modify: `client/src/components/ClassOverview.tsx` and `.test.tsx`
- Modify: `client/src/components/Schulalltag.tsx`

**Interfaces:**
- Consumes: Task 1 `scoreSubject`.
- Produces: Gesamt mode displays per-subject scores, and submission writes a separately computed rank for each `subCode`.

- [x] **Step 1: Add failing grid tests**: with D at 6/18 and M at 16/18, Gesamt shows D Lehrling and M Meister (no merged 18/18); clicking submit calls `onSubmitPupil` for D with D's rank and for M with M's rank. Use 18 criterion keys so the test exercises actual thresholds.
- [x] **Step 2: Run targeted tests**: `npm test --workspace=client -- src/components/BeobachtungsGrid.test.tsx`. Expected: failures from current merged rank/submission.
- [x] **Step 3: Add a failing ClassOverview test** where positive items are disjoint by subject and a same-key conflict exists; assert each subject-labelled score follows Task 1 and neither shows an any-positive merged result.
- [x] **Step 4: Run `npm test --workspace=client -- src/components/ClassOverview.test.tsx`**. Expected: the new assertion fails on current merged scoring.
- [x] **Step 5: Implement** grid per-subject score chips/submission and shared scoring in `ClassOverview` and `Schulalltag`; no one-rank Gesamt fallback. In `ClassOverview`, show each result as `<subjectCode> <positiveCount>/18 <rank|Ausstehend>`. In `Schulalltag`, show the same subject labels and preserve each subject's independent red-card demotion.
- [x] **Step 6: Run both targeted suites**. Expected: existing subject-submission/lock behavior remains green and the independent ranks display correctly.

## Task 3: Teacher and KEL report surfaces

**Interfaces:** teacher report iterates `currentClass.mySubjects`; KEL modal accepts `subjects: Array<{ code: string; name: string }>` from `App.tsx` and renders one subject section per entry. Both use Task 1's helper over exactly `criteria.flatMap(c => c.items.map(i => i.key))`.

**Files:**
- Modify: `client/src/components/TeacherClassReportModal.tsx`
- Modify: `client/src/components/KelPdfModal.tsx`
- Add: focused component tests in `client/src/components/` (match the existing Vitest/Testing Library conventions)

**Interfaces:**
- Consumes: Task 1 `scoreSubject`.
- Produces: printed teacher/KEL documents show subject-labelled counts and ranks; no blended pupil-wide rubric score.

- [x] **Step 1: Write failing report tests**: a pupil with D 6/18 and M 16/18 has two separately labeled results; KEL criterion cells use the selected subject's own evaluation and never render 22/18 or the merged positive-wins outcome.
- [x] **Step 2: Run each focused component suite**: `npm test --workspace=client -- src/components/TeacherClassReportModal.test.tsx src/components/KelPdfModal.test.tsx`. Expected: failure because existing UI emits one cross-subject summary.
- [x] **Step 3: Implement** subject-specific teacher report sections using `currentClass.mySubjects`; add `subjects` prop to `KelPdfModal` and pass `currentClass.mySubjects` from the exact `App.tsx` call site. Render each subject's own rubric cells and rank, or an explicit pending label when it has no rated items.
- [x] **Step 4: Run focused report tests**. Expected: separate per-subject output; existing print/report test suite (if present) passes.

## Task 4: Subject-specific statistics API contract

**Pure helper interface:** create `buildSubjectStatistics(pupils, subjectsByClass, evaluations, itemsByEvaluationId, teachersById, options)` in `server/src/lib/subject-statistics.ts`; inputs are plain typed records, options contain `showForeignComments`, `viewerRole` and `viewerTeacherId`, output is one typed pupil record per pupil with one `subjectResults` record per canonical union of assigned and evaluated subjects. Export these interfaces for the route and unit tests. `normalizeSubject` supplies canonical codes; `summarizeRatings` and `calculateRank` from `server/src/lib/ranking.ts` score each single evaluation after item-key deduplication.

**Files:**
- Modify: `server/src/routes/statistics.ts`
- Modify: `server/src/routes/conferences.ts` only if export evidence currently creates a cross-subject combined positive count (confirmed conference rank remains a distinct result)
- Modify/add: `server/src/routes/statistics.test.ts` or the nearest established route test; existing PostgreSQL route harness is `evaluations.integration.test.ts`

**Interfaces:**
- Each API pupil record contains `subjectResults: Array<{ subjectCode: string; subjectName: string; positiveCount: number; totalRated: number; calculatedRank: Rank | null; teacherVote: TeacherVote | null; items: FormattedPupilItem[] }>`.
- The canonical result subject set is the union of normalized `teaching_assignments` subjects for that pupil's class and subjects already present in that pupil's evaluations; this preserves legacy evaluation results while adding pending assigned subjects.
- Each pupil retains `conferenceDecision: { rank: Rank; isConfirmed: true; overrideReason: string | null } | null`.
- Distribution counts only subject results with `totalRated > 0`; `total` is rated pupil-subject result count.

- [x] **Step 1: Write failing tests** in `server/src/lib/subject-statistics.test.ts`: assigned D/M with no evaluation emits D/M pending; evaluation subject with no current assignment is retained; `SD` and D collapse to D; one subject rank does not use another subject's items; duplicate keys use the latest update; no-rated entries have null rank; foreign comments still follow the existing options; conference decision is separate.
- [x] **Step 2: Run `npm test --workspace=server -- src/lib/subject-statistics.test.ts`**. Expected: missing builder export causes the specific test failure, not an environment/database error.
- [x] **Step 3: Implement** the pure typed builder; it receives the class assignment subject map, pupil/evaluation/item records, teacher map and notes-policy context; retain `teacherVote` with its existing comment-redaction result.
- [x] **Step 4: In `statistics.ts`, query the assigned subject codes for `targetClassIds`, pass their normalized map plus the existing query results to the builder, and compute distribution only over results with `totalRated > 0`.
- [x] **Step 5: Add route integration assertions** in `evaluations.integration.test.ts` with a second subject assignment and distinct fixture ratings; test API shape and conference rank separation. `TEST_DATABASE_URL` is optional, but if unavailable this DB-backed test is reported skipped, not passed.
- [x] **Step 6: Run pure tests and, when configured, `npm test --workspace=server -- src/routes/evaluations.integration.test.ts`.** Existing scope and note-policy tests remain unchanged and green.

## Task 5: Statistics UI for per-subject result rows

**Files:**
- Modify: `client/src/components/SchoolStatistics.tsx`
- Add: `client/src/components/SchoolStatistics.test.tsx`
- Modify: `client/src/services/api.ts` only if typed response definitions live there

**Interfaces:**
- Consumes Task 4 `subjectResults`, rated-result distribution and separate `conferenceDecision`.
- Produces: rows keyed by `pupilId:subjectCode`; optional selected-subject filter defaults to `all`; rank filtering includes only rated subject results; pending results display as pending, not Lehrling; pupil-level conference decision is separately captioned.

- [x] **Step 1: Add failing Testing Library tests** in `SchoolStatistics.test.tsx` for independent D/M rows, pending no-rating result, filter by subject, distribution `total` counting rated pupil-subject rows, and separate confirmed conference decision.
- [x] **Step 2: Run `npm test --workspace=client -- src/components/SchoolStatistics.test.tsx`**. Expected: current component response shape/row rendering fails.
- [x] **Step 3: Implement** statistics result types, subject selection/rows, counts and no-rated display. Do not modify access control or comments policy.
- [x] **Step 4: Re-run the component tests**. Expected: rows and filters show only the selected subject result without affecting the distinct conference decision.

## Task 6: Class/round lock schema and resolver

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0005_class_round_locks.sql`
- Modify: `server/drizzle/meta/_journal.json`
- Snapshot metadata: do not invent a snapshot; repository history has only 0000/0001 snapshots despite journaled hand-authored migrations 0002–0004. Only add a generated snapshot if safe Drizzle generation, reviewed for unrelated drift, establishes the proper next snapshot.
- Create: `server/src/lib/class-round-lock.ts`
- Create: `server/src/lib/class-round-lock.test.ts`
- Modify: `server/src/db/migrations.test.ts`

**Interfaces:**
- Schema export `classRoundLocks`: UUID PK; `roundId` FK to `observation_rounds.id`; `classId` FK to `school_classes.id`; `isLocked` boolean default false; `updatedAt` timestamp default now; unique `(round_id, class_id)`.
- Resolver `getClassRoundLockState(roundId: string, classId: number): Promise<boolean>` returns false if row absent; `isClassRoundLocked(roundLocked: boolean, classLock: boolean): boolean` returns their OR.

- [x] **Step 1: Add a failing pure test** in `class-round-lock.test.ts`: OR truth table for global and class locks, including global=true/class=false. Add failing SQL-history assertions in `migrations.test.ts` for `class_round_locks` and `(round_id, class_id)` unique key.
- [x] **Step 2: Run `npm test --workspace=server -- src/lib/class-round-lock.test.ts src/db/migrations.test.ts`**. Expected: missing helper/table DDL causes specific failures.
- [x] **Step 3: Implement** `classRoundLocks` schema, `isClassRoundLocked(globalLocked, classLocked): boolean`, `getClassRoundLockState(roundId, classId): Promise<boolean>`, append-only 0005 SQL with UUID id, FKs, bool default false, updated_at default now, unique natural key and useful lookup index; add sequential journal record. Never run `db:migrate` against an unvalidated target.
- [x] **Step 4: Run focused tests**. Expected: migration-history test and pure helper test pass.

## Task 7: Persist lock endpoint, client class state, roster and WS sync

**Files:**
- Modify: `server/src/routes/conferences.ts` and `.test.ts`
- Modify: `server/src/routes/classes.ts`
- Modify: `server/src/ws/live-sync.ts` and tests
- Modify: `client/src/types.ts`, `client/src/hooks/useLiveSync.ts` and `.test.ts`, `client/src/App.tsx`, `client/src/services/api.ts`

**Interfaces:**
- Lock POST response and broadcast payload: `{ classId: number; roundId: string; isLocked: boolean }`; lock endpoint also returns `{ success: true, ... }`.
- `SYNCED` carries `{ classId, roundId: string | null, isLockedByConference: boolean, canRate }` for that subscription.
- Client hook returns `classRoundLocks: Map<number, boolean>`; both `SYNCED` and `VOTING_LOCK_CHANGED` update by `classId`, and `App.tsx` selects `classRoundLocks.get(selectedClassId) ?? false`.

- [x] **Step 1: Add failing route/helper and WS client tests**: lock/unlock only changes specified class+round, missing active round errors without broadcast, unauthorized user receives 403, persisted state returned in sync, two subscribed classes retain independent states, and successful broadcast updates the matching class only.
- [x] **Step 2: Run focused tests**: `npm test --workspace=server -- src/routes/conferences.test.ts src/ws/live-sync.behavior.test.ts` and `npm test --workspace=client -- src/hooks/useLiveSync.test.ts`. Expected: assertions fail for global/unscoped lock state.
- [x] **Step 3: Implement** lock upsert in `class_round_locks` only, preserving audit and `canRunConference`; return HTTP 400 if no latest round; include `classId`, `roundId`, `isLocked` and `changedBy` in the broadcast. Add `isLockedByConference` and `roundId` to class-pupil response. In LiveSync, `SYNCED` lock state is global-round OR class-round state for that class. Maintain `Map<number, boolean>` state client side, resetting/re-syncing on subscription set change.
- [x] **Step 4: Re-run focused suites**. Expected: matching room changes only; global observation round flag is untouched.

## Task 8: Enforce lock on all REST and WebSocket evaluation mutations

**Files:**
- Modify: `server/src/routes/evaluations.ts` and `.test.ts`
- Modify: `server/src/ws/live-sync.ts` and WS tests
- Modify: `server/src/routes/evaluations.integration.test.ts`

**Interfaces:**
- Evaluation round selection must select the latest round first; if that round's `isLocked` is true, return no writable round (never fall back to an older unlocked round). This ensures reads, class locks and writes refer to one active round.
- REST helper `rejectIfClassRoundLocked(reply, roundId, classId): Promise<boolean>` sends status 423 `{ error: string; code: 'CLASS_CONFERENCE_LOCKED' }` when the effective OR lock is true; call after class/subject authorization and round selection, before writes.
- WS UPDATE_RATING resolves the latest round first; if global-locked reject as no writable period; otherwise check class lock and send `{ type: 'ERROR', code: 'CLASS_CONFERENCE_LOCKED', message: string, clientMutationId?: string }` without writing/ACK.

- [x] **Step 1: Add PostgreSQL integration tests** for each route (`batch-default`, `status`, `submit`, `reopen`, `batch-items`) refusing locked class; add WS rejection/no row change, unlocked second-class control, conference vote/unconfirm/vote-all controls, and a latest-round-global-lock control that proves writes do not land in an older unlocked round.
- [x] **Step 2: Verify RED**: run the route behavior/integration tests. Pure route guards must fail for the current missing policy; integration tests may be skipped only when test DB isn't configured, and must be identified as skipped.
- [x] **Step 3: Implement shared resolver checks** on all five HTTP paths and WS UPDATE_RATING after permission and round selection; maintain canonical subject/OCC/deadline order. Do not guard conference decision endpoints.
- [x] **Step 4: Run focused non-DB tests** plus configured disposable PostgreSQL integration test `npm test --workspace=server -- src/routes/evaluations.integration.test.ts`. Expected: all locked writes reject, no writes occur, unlocked class and conference decision controls remain available.

## Task 9: Lock UI enforcement and truthful errors

**Files:**
- Modify: `client/src/components/BeobachtungsGrid.tsx` and `.test.tsx`
- Modify: `client/src/hooks/useLiveSync.ts` and `.test.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/BeamerMode.tsx` only as needed to show the lock response state
- Modify: `client/src/components/BeamerMode.tsx` only as needed to display persisted class/round response state

**Interfaces:**
- `isLockedByConference` is the selected class's current class-round state, not a round-global flag or whichever message arrived last.
- All evaluation actions including status/comment autosave, submit and reopen are disabled while locked; conference decision controls are not disabled by this lock.

- [x] **Step 1: Add failing grid tests** that assert comment textarea, cell rating, submit and reopen are disabled under lock; add a hook test for class-keyed lock state and an error test proving `CLASS_CONFERENCE_LOCKED` does not resolve a pending rating write as success.
- [x] **Step 2: Run targeted grid/hook tests** and verify the current missing control coverage fails.
- [x] **Step 3: Implement** lock-controlled disabled/read-only controls and error handling without swallowing server errors; maintain local save feedback semantics.
- [x] **Step 4: Re-run grid/hook tests**. Expected: all evaluation writes disabled under lock, conference decisions remain callable.

## Task 10: Conference evidence and whole-change verification

**Files:**
- Modify: `client/src/components/ConferenceVotingModal.tsx`
- Modify: `client/src/components/AllClassesConferenceExportModal.tsx`
- Modify: `client/src/components/BeamerMode.tsx`
- Add focused tests only if existing conference modal suites are available; otherwise assert the evidence formatting via a pure formatter with a unit test.

- [x] **Step 1: Add a failing subject-evidence display test** for two evidence subjects whose positive totals add above 18; verify conference UI/export displays each `subjectCode count/18` independently and no synthetic sum/18 bar. Conference final rank/suggestion remains labeled separately.
- [x] **Step 2: Implement** removal of summed `subjectEvidence.reduce(...)/18` and combined evidence display; keep conference-level rank controls unchanged.
- [x] **Step 3: Run the focused conference evidence test**. Expected: individual subject labels and bounded bars render; no synthetic cross-subject rubric score.

## Task 11: Whole change verification and review

**Files:** all changed files from Tasks 1–10; no unrelated files.

- [x] **Step 1: Run full tests**: `PORT=3000 SKIP_POSTGRES_INTEGRATION=true npm test` when the root inherits the known `PORT=0`; separately attempt DB integration only if a validated disposable `TEST_DATABASE_URL` is provided. Report skipped PostgreSQL cases as skipped, never passed. Expected: every enabled test passes without altering or disabling tests.
- [x] **Step 2: Run typecheck**: `npm run typecheck --workspaces`. Expected: zero errors.
- [x] **Step 3: Run build**: `npm run build`. Expected: server TS and client Vite build succeed.
- [x] **Step 4: Verify actual client flows through Testing Library**: run and inspect the per-subject grid-submit and stats component tests, ensure distinct D/M counts and pending behavior are observable in rendered output.
- [x] **Step 5: Check event symmetry and migration contract**: tests assert every emitted lock event is consumed; migrations test confirms new SQL plus journal entry and no DDL outside migration history.
- [x] **Step 6: Review final diff and changed paths** to confirm only the approved work and this plan/spec are present; do not commit, push, deploy, or alter the user's unrelated documentation changes.

## Plan self-review

- **Spec coverage:** Tasks 1–3 cover separate client ranks, per-subject submissions, daily classroom red-card behavior, teacher/KEL reports, pending subjects and score deduplication. Tasks 4–5 cover assignment/evaluation subject union, statistics API/UI distribution, pending results, separate conference decision and unchanged note/access policies. Tasks 6–9 cover schema/migration, per-class/per-round state, global lock compatibility, all evaluation REST/WS mutations, authorization, 423 contract, conference-write exception, roster/WS sync and UI behavior. Task 10 keeps conference evidence subject-labeled; Task 11 runs final tests/typecheck/build and reviews the actual delivered interface.
- **Step scan:** Each component/helper has a named test path and an expected behavior-level failure before production changes. Database tests are opt-in because the repository requires a separately validated disposable PostgreSQL URL; pure logic and migration-history tests run without it.
- **Type consistency:** `AssessmentRank` is the client rank union. `scoreSubject` returns nullable rank. Server `Rank | null` uses `server/src/lib/ranking.ts`; statistics subjects use `calculatedRank`, teacher details stay nested in `teacherVote`, and confirmed conference decision remains pupil-level. Lock payloads use `classId`, `roundId`, and `isLocked` consistently; client state is `Map<number, boolean>`.
- **Review focus tests:** duplicate-row recency and deterministic tie (Task 1), pending no-rated rows and no-matching-assignment retention (Task 4), absent lock row/global OR (Task 6), multi-room socket isolation (Task 7), and latest-global-lock/write controls (Task 8) are explicitly assigned tests.
- **Scope:** UI migration across reports and an API contract change make this one coupled change rather than independently shippable subsystems; task dependencies are explicit. The migration generator must not apply migrations or connect to an unvalidated DB.
