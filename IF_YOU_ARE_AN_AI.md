# 🤖 IF YOU ARE AN AI (LLM / Coding Agent Directive)

> **ATTENTION AI AGENT / ASSISTANT**:  
> Read this document **before** analyzing, refactoring, or generating code in this repository.  
> This file contains the dense mental model, critical domain invariants, architectural rules, and historical failure modes for the **SMILE** platform.

---

## 1. Quick Project Mental Model

- **What is SMILE?**  
  A real-time collaborative grading, behavior tracking, and conference decision-support web application for **MS Telfs Weissenbach** (an Austrian Middle School / Mittelschule).
- **Core Educational Concept**:  
  Students are evaluated into 3 competency tiers based on an 18-item observation matrix:
  - **Lehrling (Apprentice)**: $< 8$ positive items.
  - **Geselle (Journeyman)**: $8 - 13$ positive items.
  - **Meister (Master)**: $\ge 14$ positive items (out of 18 total).
- **Team-Teaching & Subject Weighting**:  
  Core subjects (**Deutsch [D]**, **Englisch [E]**, **Mathematik [M]**) have 2 teachers co-teaching the same class and have double the conference weight. Non-core subjects (**Berufsorientierung [BO]**, **Physik [PH]**, **Musik [MUS]**, **Technik und Design [TUD]**, etc.) have 1–2 hours weekly. Conference rankings are weighted proportionally to teacher weekly lesson hours from WebUntis (`timetable_lessons`).
- **Behavior Cards**:  
  - 🟢 **Green**: Positive praise.
  - 🟡 **Yellow**: Warning. Reaching `YELLOW_CARD_ALERT_THRESHOLD` yellow cards inside `YELLOW_CARD_ALERT_WINDOW_DAYS` automatically triggers a school-wide conference alert. The configured default is **2, not 3** (`server/src/config.ts:218`); the earlier "3 cards" description of this rule was wrong.
  - 🔴 **Red**: Severe incident. Automatically triggers a **1-step demotion penalty** on the student's conference rank (e.g. *Meister* $\to$ *Geselle*, *Geselle* $\to$ *Lehrling*).

---

## 2. Technology Stack & Runtime

- **Backend**: Node.js $\ge 22.0.0$ ESM, Fastify v5, `@fastify/websocket`, `@fastify/jwt`, `@fastify/cookie`.
- **Database & ORM**: PostgreSQL (`smile_db`), Drizzle ORM (`0.45.x`), raw pooled queries via `getPool()`.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS, Lucide React icons.
- **Testing**: Vitest, run across **both** workspaces by the root `npm test` (`npm run test --workspaces`): 11 server suites (`server/src/**/*.test.ts`) and 4 client suites (`client/src/**/*.test.{ts,tsx}`, jsdom + Testing Library). `npm test` is not server-only — a change that touches the client must keep the client suites green too.
- **Live Deployment**: Proxmox VE 8.x LXC 115 (`172.16.1.11`), host `172.16.1.54`, systemd `smile.service`.

---

## 3. Top Repository Anchors (Where Things Live)

```text
SMILE/
├── server/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts            <-- Drizzle ORM table definitions & indexes
│   │   │   └── index.ts             <-- DB client & connection pool
│   │   ├── config.ts                <-- Env-driven thresholds, deadlines, scope flags
│   │   ├── lib/
│   │   │   ├── guards.ts            <-- Permission resolver (getClassAccess, getGlobalAccess)
│   │   │   ├── ranking.ts           <-- 18-item scoring, thresholds, red card demotion
│   │   │   ├── rubric.ts            <-- Item-key & rating allowlist (VALID_RATINGS, validateBatchItems)
│   │   │   └── behavior-stages.ts   <-- Card thresholds & timeout rules
│   │   ├── routes/
│   │   │   ├── classes.ts           <-- Class roster, teacher hours, timetable mapping
│   │   │   ├── evaluations.ts       <-- Rating submissions, batch entry, status
│   │   │   ├── conferences.ts       <-- Conference mode, voting, hours-weighting
│   │   │   └── cards.ts             <-- Discipline cards (green/yellow/red)
│   │   ├── utils/
│   │   │   └── subject.ts           <-- Canonical subject taxonomy & normalizer
│   │   ├── ws/
│   │   │   └── live-sync.ts         <-- Real-time WebSocket engine & OCC
│   │   └── index.ts                 <-- Fastify server entrypoint
│   └── vitest.config.ts
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── BeobachtungsGrid.tsx <-- Main teacher matrix, autosave, subject tabs
│   │   │   ├── ConferenceVotingModal.tsx <-- Live conference voting interface
│   │   │   └── Schulalltag.tsx      <-- Daily discipline & timeout management
│   │   ├── hooks/
│   │   │   └── useLiveSync.ts       <-- WebSocket live-sync client hook
│   │   ├── lib/
│   │   │   └── pupilItems.ts        <-- Subject-scoped pupil reads (Invariants 4 & 5)
│   │   ├── services/
│   │   │   └── api.ts               <-- REST client (incl. saveEvaluationComment)
│   │   └── App.tsx                  <-- Root state, live event dispatch, router
│   └── vite.config.ts
├── scripts/
│   └── deploy_to_production.py      <-- Proxmox LXC 115 deployment automation
└── SMILE_ARCHITECTURE_AND_CODE_REVIEW.md <-- Detailed technical specification
```

---

## 4. ⚡ Critical Invariants (DO NOT VIOLATE)

If you modify this codebase, **you must maintain these invariants**:

### Invariant 1: Canonical Subject Codes
- **Rule**: NEVER store full German strings (e.g. `Berufsorientierung`) or legacy codes (`SD`, `SE`, `SM`) in `evaluations.subject_code`.
- **Requirement**: ALWAYS pass subject inputs through `normalizeSubject()` in [`server/src/utils/subject.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/utils/subject.ts).
- Canonical codes are: `D`, `E`, `M`, `BO`, `PH`, `MUS`, `TUD`, `BUB`, `BS`, `CH`, `DIGGB`, `EH`, `GPB`, `GWB`, `GZ`, `ITAL`, `KUG`, `DAZ`, `RKATH`, `RISLA`, `REV`, `BFUD`, `BFUR`, `BFUM`, `BFUE`, `SL`, `ZI`, `LW`.
- **Unknown codes must be REJECTED on a write path, not coerced.** This is the half of the rule that was always easy to miss. `normalizeSubject()` is not a validator: it ends in a fallback at [`server/src/utils/subject.ts:163`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/utils/subject.ts) that mints a code from whatever it was handed —
  ```ts
  return { code: rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_'), ... }
  ```
  `normalizeSubject('Astronomie')` returns `{ code: 'ASTRONOMIE' }`, and that is a pinned test assertion ([`server/src/utils/subject.test.ts:79`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/utils/subject.test.ts)), not an accident.
  - **On a read**, coercion is correct and intended: legacy rows and WebUntis names must still resolve. `lib/guards.ts` and the conference/statistics grouping depend on it.
  - **On a write**, coercion is a hole. A caller that passes an unrecognized string gets a well-formed, syntactically valid, completely unbounded code, and `evaluations` has no `CHECK` constraint on `subject_code` to catch it. Reject the request instead. Compare the normalized code against the canonical list above (or a `Set` derived from `CANONICAL_MAP`) and return 400 on a miss — the same shape as `validateBatchItems` rejecting an unknown item key.
- **Client-side counterpart**: [`client/src/lib/pupilItems.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/lib/pupilItems.ts) carries a **deliberate copy** of the server's `CANONICAL_MAP` alias table (95 normalized keys over the 28 codes, down from the server's 108 entries — forms differing only in separators or umlaut spelling collapse to one key). The client cannot import from the server tree (separate tsconfigs, Vite bundling vs Node ESM). **Regenerate that table whenever `CANONICAL_MAP` changes.** A code dropped from it stops that subject from matching: `isSubjectMatch` returns false, the subject renders empty, and no error is raised — a dropped alias is a silent data-loss bug, not a visible one.
- **Reason**: Timetable hours in `timetable_lessons` use these WebUntis short codes. If codes mismatch, timetable lesson hours resolve to 0, breaking the weighted voting system!
- ✅ **RESOLVED (verified 2026-10-08). All five write paths now reject an unknown subject code.** Every path listed below validates the request's `subjectCode` through **`normalizeKnownSubject()`** (`server/src/utils/subject.ts`), which returns `null` for anything not in `CANONICAL_MAP`; the handler returns 400 `Ungültiges Unterrichtsfach.` rather than inserting a minted code. The coercing `normalizeSubject()` is still correct — and still required — for **reads**, where legacy `SD`/`SE`/`SM` rows must resolve.

  | Path | Validates with |
  |---|---|
  | `POST /api/evaluations/batch-default` | `normalizeKnownSubject` |
  | `POST /api/evaluations/status` | `normalizeKnownSubject` |
  | `POST /api/evaluations/submit` | `normalizeKnownSubject` |
  | `POST /api/evaluations/reopen` | `normalizeKnownSubject` |
  | `POST /api/evaluations/batch-items` | `normalizeKnownSubject` |
  | WS `UPDATE_RATING` | `normalizeKnownSubject` |
  | WS `CELL_FOCUS` / `CELL_BLUR` | `normalizeKnownSubject` |

  Subject-level **authorization** is also in place: `canRateSubject(access, code)` (`guards.ts`) checks the caller's `access.subjects`, so a D-only teacher cannot write an M row. A previous revision of this file said the subject-code allowlist "does not exist" and warned that a forged code adds both rating mass and a conference vote — that was true of the code at `bf35249` and is no longer true of this one.

### Invariant 2: Database Natural Keys & OCC Concurrency
- **Rule**: The table `evaluations` has a unique constraint on:
  ```sql
  UNIQUE (round_id, pupil_id, class_id, subject_code)
  ```
  Never attempt blind `INSERT` without `.onConflictDoUpdate(...)` or handling unique violations.
- **Rule**: `evaluation_items` uses Optimistic Concurrency Control (OCC) with atomic PostgreSQL increments:
  ```sql
  SET rating = $1, version = version + 1
  ```
  Never calculate `version: existing.version + 1` in Node.js memory, as concurrent WebSocket writers will cause lost updates.
- **Both write paths honour this now.** The WS path (`live-sync.ts`) updates with `WHERE version = $expected` and emits `CONFLICT` on a zero-row match; the HTTP path (`evaluations.ts`) uses `onConflictDoUpdate` with `version: sql\`${evaluationItems.version} + 1\`` and never reads a version at all.
- **Every subject carries its own `expectedVersion`.** Resolve it with `itemVersionForSubject(evaluations, code, itemKey)` from `client/src/lib/pupilItems.ts`. Resolving one version for the whole grid and sending it for every subject makes the server's `WHERE version = $4` match zero rows for all but the first subject — a `CONFLICT` on cells nobody else touched. This applies to the **single-cell rating path** (`BeobachtungsGrid.tsx`, the two `onRate` call sites in the grid body), which is the only path that reaches the WS write. Regression-tested at the component level: `BeobachtungsGrid.test.tsx`, "a rating write carries the version of the subject it targets".
  - ⚠️ **Two deliberate exceptions, both on the bulk-fill paths.** `handleInstantRank`, `handleResetAll` and `handleQuickFillCategory` pass a hardcoded `expectedVersion: 1` to `onRate`. Those three only run in the `else` branch taken when **`onBatchUpdate` is absent**, and `App.tsx` always supplies `onBatchUpdate`, so the branch is dead in production and the literal is unreachable. Do not cite those three sites as examples of this rule, and do not "fix" them without first establishing that `onBatchUpdate` can be absent.
- ⚠️ **Known sharp edge**: `live-sync.ts:261` defaults `expectedVersion` to `1` when the payload omits it. A missing version is therefore *not* rejected; it is silently treated as "expect version 1". Note also that the HTTP fallback (`useLiveSync.ts:204-208` → `batchUpdateItems`) sends **no** `expectedVersion` field at all, and `/batch-items` never reads one — it relies on the atomic increment instead. So the two paths have different, both-intentional concurrency models; do not unify them by copying one field into the other.

### Invariant 3: LiveSync Event Bus Symmetry
- When the backend broadcasts a message via `broadcastToClass(classId, msg)` in [`server/src/ws/live-sync.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/ws/live-sync.ts), it **must** be handled in:
  1. [`client/src/hooks/useLiveSync.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/hooks/useLiveSync.ts) (must not drop it in `switch(msg.type)`).
  2. [`client/src/App.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/App.tsx) in `handleRatingUpdated`.
- There is exactly **one** WebSocket client in the app (`useLiveSync.ts:45`) with **one** `onmessage` (`:53`) and a `default: break;` at `:136` that drops anything unrecognised **silently**. A handler that does not match the emitted `type` string byte-for-byte is indistinguishable from no handler at all. Grep the server for `type: '...'` and diff it against the `case` labels before you trust this invariant.
- ✅ **RESOLVED (verified 2026-10-08). No action needed — and do not "fix" this again.** An earlier revision of this file recorded a live violation here: the client handled `TIMEOUT_CREATED` / `FINAL_RANK_LOCKED` while the server emitted `TIMEOUT_ISSUED` / `FINAL_RANK_CONFIRMED`, so those two broadcasts were dropped. Both sides now use the **server's** names. The client handles `TIMEOUT_ISSUED`, `TIMEOUT_RESOLVED`, `FINAL_RANK_CONFIRMED` and `FINAL_RANK_REVOKED` (`useLiveSync.ts:246-249`), and **all 20 emitted `type` strings have a matching `case` label.** The old `TIMEOUT_CREATED` / `FINAL_RANK_LOCKED` cases are gone.

  **Read this before touching the event bus:** the server names are canonical. If you find yourself renaming `TIMEOUT_ISSUED` to `TIMEOUT_CREATED` because a document told you to, you are reintroducing a bug that was fixed. The checklist item in §7 that used to suggest exactly that rename has been corrected for the same reason.

  `USER_JOINED` / `USER_LEFT` are no longer emitted by the server at all; earlier references to `live-sync.ts:196` / `:102` were stale. Presence indicators were dropped deliberately rather than left broken.

### Invariant 4: Subject Isolation in Observation Grid
- In [`client/src/components/BeobachtungsGrid.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.tsx), a pupil is submitted **only** for the active subject being viewed.
- **The sanctioned reads are `hasSubmittedForSubject` and `isPupilFullySubmitted`**, both from [`client/src/lib/pupilItems.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/lib/pupilItems.ts). Use them; do not re-derive the check.
  - `hasSubmittedForSubject(evaluations, code)` — is this pupil submitted for **one** subject?
  - `isPupilFullySubmitted(evaluations, codes)` — submitted for **every** subject in `codes`? Pass the subject codes actually in scope (all of `mySubjects` in Gesamt mode, the single active subject otherwise). An empty `codes` is `false`, never vacuously `true`: a caller holding no subject set has not established that anything is done.
- If you must inline the check, it must be gated on `isSubjectMatch(e.subjectCode, code)`. That is still correct and still appears in production code — `BeobachtungsGrid.tsx:199`, `:202`, `:213`, `:741`, `:744` and `ClassOverview.tsx:75` all do it. It is the **unscoped** form that is forbidden.
- Never check `evaluations.some(e => e.isSubmitted)` across all subjects, because a submission in English must NOT mark German or Math as submitted! A pupil who submitted only Deutsch is still open in Mathematik, and the teacher skips them. This was the concrete failure mode; it is regression-tested in [`client/src/components/BeobachtungsGrid.test.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.test.tsx) ("does not tick a pupil who submitted Deutsch when Mathematik is still open").
- The same scoping applies to item lookup. `findItemForSubjects(evaluations, codes, itemKey)` searches only the subjects in `codes` and returns `null` when none of them holds the item — deliberately, so an unrated pupil shows empty cells rather than another subject's ratings. Do not reintroduce a fallback that widens the search. Both levels are tested (Historical Trap 5).

### Invariant 5: 18-Item Rubric Boundary
- A student rubric has exactly **18 items** (6 dimensions $\times$ 3 items).
- In [`BeobachtungsGrid.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.tsx), `calculateRank` takes a `pupil` parameter and iterates the criteria items displayed in the grid, resolving each one through `getItemData(pupil, it.key)` (`:296`). That helper (`:281-286`) is a one-line delegation:
  ```ts
  findItemForSubjects(pupil.evaluations,
    isAllSubjectsMode ? mySubjects.map((s) => s.code) : [mySubjectCode], itemKey)
  ```
  Cite those two, not a paraphrase — `selectedPupil` and `subCode` are **write**-path names (`:1695`, `:1725`) and are not in scope inside `calculateRank`.
  - ✅ **RESOLVED (verified 2026-10-10, roadmap E13 closed).** The caveat that used to sit here — that `findItemForSubjects` merged across `mySubjects` and `handleSubmitPupil` sent that one rank for every `subCode` — is no longer the code. `handleSubmitPupil` now computes the rank **per subject** through `scoreSubject(selectedPupil.evaluations, subCode, rubricItemKeys)`, so a pupil rated in Mathematik alone is submitted under a Mathematik-derived rank, never a Deutsch-derived one. `calculateRank` keeps the merged read for *display* only. What replaced it is a different, deliberate rule, and it is what the tests now pin:
    - A subject with a calculated rank submits that rank.
    - An **unrated** subject inherits the teacher's explicit manual proposal (`votedRank`) if one exists.
    - With neither, the subject submits **nothing** and the loop `continue`s. It is *not* back-filled with a fabricated `Geselle`, because that would store a `proposedStatus` nobody cast for that subject and make an open pupil read as decided.
    - Consequence, intended: `isSubmitted` in Gesamt mode requires **every** subject, so a pupil with one unrated subject stays open and never reaches the submitted list. A teacher who wants that pupil closed must rate the subject or set a proposal. Regression-tested in `BeobachtungsGrid.test.tsx` ("never submits a fabricated rank for an unrated subject", "lets an unrated subject inherit an explicit manual proposal").
- Never do `pupil.evaluations.flatMap(e => e.items)` to calculate positive counts, as pupils with multiple subject evaluations will accumulate $> 18$ items and artificially trigger *Meister*!
- [`client/src/lib/pupilItems.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/lib/pupilItems.ts) is the client-side counterpart of this rule and of Invariant 4. It is the sanctioned home for subject-scoped reads; the grid already routes through it.
- ⚠️ **OPEN VIOLATION — the four client report/overview rank implementations inflate positives. The bug's *shape* changed and the old description is wrong.**

  An earlier revision of this file said these four `flatMap` every evaluation, so their positive count is unbounded past 18. **That is no longer the code.** They now dedupe by item key, so the count is bounded at 18 — but the *semantics* are worse in a way that is easy to miss:

  ```ts
  if (!evaluatedItemsMap.has(it.itemKey) || isPositiveRating(it.rating)) {
    evaluatedItemsMap.set(it.itemKey, it.rating);
  }
  ```

  The `|| isPositiveRating(...)` means **any** teacher's positive rating for a key wins. With three core-subject teachers rating disjoint sets of 6 keys each, a pupil scores **18/18 → automatic Meister**, where each teacher individually saw 6/18 → **Lehrling**. The bound was restored; the inflation moved from the count into the merge. Two of these four render documents that get printed for parent conferences (`KelPdfModal`, `TeacherClassReportModal`), and `Schulalltag` is the main classroom view.

  | File | Function | Reachable from the UI? |
  |---|---|---|
  | `client/src/components/Schulalltag.tsx:211` | `getPupilRank` | yes — main classroom view |
  | `client/src/components/KelPdfModal.tsx:21` | inline count | yes — parent conference printout |
  | `client/src/components/TeacherClassReportModal.tsx:39` | inline count | yes — teacher report printout |
  | `client/src/components/ClassOverview.tsx:59` | `getPupilRank` | **no** — not imported by `App.tsx`; dead component |

  Treat these four ranks as **display-only and untrustworthy** until unification lands. `BeobachtungsGrid.tsx` is correct about scoping and is the reference implementation. **The fix needs a product decision, not just a refactor:** the correct merge is one of (a) scope each view to `mySubjects` and treat distinct subjects as distinct rasters, (b) average the per-subject ranks, or (c) any-positive across subjects, which is what the code does today and which the 18-item invariant argues against. Do not pick one in code without the school's answer — see the Gesamt-mode caveat above and roadmap E13. Unification alone only decides *where* the count comes from. **Partially resolved since the last revision:** all four now read the *thresholds and denominator* from the delivered config (§8), so they agree with the server about where the bars are; the *merge semantics* above are unchanged and still open.

- **Related hardcoding, resolved since the last revision**: the thresholds (`14` / `8`) and the `/18` denominator were literals in the client. They are now **delivered**, not copied: `GET /api/classes/:classId/pupils` answers with `rubricConfig` read from `server/src/config.ts` (`rankThresholds`, `rubricItemCount`, `rankAggregation`), `App.tsx` installs it via `setActiveRubricConfig`, and the raster maths reads it through `activeRankThresholds()` / `activeRubricItemCount()`. See §8.

- **Resolved since the last revision**: the deadline is no longer a local-time literal. `submissionDeadline` now arrives from the API (`/api/classes/:id/pupils` → `App.tsx` → props) and is parsed as a UTC ISO string. `BeobachtungsGrid.tsx` fails **closed** when it is absent (`!Number.isFinite(deadlineAt) || now > deadlineAt` → writes disabled), so a missing deadline locks the grid rather than unlocking it. `ClassOverview.tsx` still carries a hardcoded `'2026-10-30T21:59:59.000Z'` fallback, but that component is not wired in.

### Invariant 6: Authentication & Cookies
- The app uses **HttpOnly, SameSite cookies** for both REST API and WebSockets.
- WebSocket handshakes authenticate via the browser's cookie header during the HTTP upgrade. Do NOT attach JWT tokens in WS URL query strings.
- If `user.mustChangePassword === true`, WebSockets must be rejected with close code `1008`.

---

## 8. Rubric Configuration — The Single Source of Truth

**The server decides; the client obeys.** Every rank boundary and the raster denominator live in exactly one place at runtime:

- `server/src/config.ts` — `rankThresholds` (`RANK_THRESHOLD_MEISTER`, `RANK_THRESHOLD_GESELLE`) and `rubricItemCount` (`RUBRIC_ITEM_COUNT`), validated at boot (`meister` must exceed `geselle`; `itemCount` must be positive). A payload that violates this is rejected at startup, so the values that reach `lib/ranking.ts` are always orderable.
- `server/src/lib/ranking.ts` — the only code that compares a score against those thresholds when a rank is **stored**.

**Do not copy those numbers into the client.** A second copy is exactly how a deployment that raised `RANK_THRESHOLD_MEISTER` shows *Meister* on screen while the server stores *Lehrling* — the client and the server then disagree about every pupil, silently.

### The delivery path

```
server/src/config.ts                (env → validated values)
  └─ GET /api/classes/:classId/pupils        → `rubricConfig` field
       └─ client/src/lib/rubricConfig.ts     (setActiveRubricConfig / activeRankThresholds / activeRubricItemCount)
            └─ scoreSubject(...)             (client/src/lib/pupilItems.ts)
            └─ formatCount / formatSubjectEvidence / computeSubjectEvidenceBars   (client/src/lib/conferenceEvidence.ts)
            └─ quickGradeFills(...)          (one-click grade fill pattern)
```

`App.tsx` calls `setActiveRubricConfig(pupilData.rubricConfig)` in `loadClassData`; every consumer below reads it at **call** time, so the config can be swapped between renders.

### Rules for touching this

- **Reject, don't apply, a bad payload.** `setActiveRubricConfig` ignores an absent, partial, or self-contradictory config and keeps the last good one (initially the shipped defaults `14`/`8`/`18`). `positiveCount >= undefined` is always `false`, so a partial config would otherwise silently demote the whole class to *Lehrling*. The shipped defaults exist so the first render — and every test that renders without a roster payload — behave exactly as before.
- **`assessmentRubrics.gradeBoundaries` is NOT the source.** `server/src/db/seed.ts` writes it once, only when no default rubric exists. Raising `RANK_THRESHOLD_MEISTER` on an existing install changes `config.ts` and leaves a stale rubric row behind. Read `config.ts`.
- **The one-click grade fills are derived, not fixed.** `quickGradeFills(rank, itemCount)` fills *Meister* to exactly the meister threshold, *Geselle* to the midpoint of the band (`geselle + floor((meister - geselle) / 2)`), and *Lehrling* to `floor(geselle / 2)`. The *Geselle* slack is deliberate: filling exactly `geselle` positives leaves no margin, and a teacher demoting a single item would drop the pupil below the bar. The invariant worth keeping is that a fill never scores a different rank than the one clicked — tested across several threshold pairs, not pinned to one number.
- **Every test file that touches the config resets it.** The values are install-wide module state, so a raised count leaks into the next assertion without an `afterEach(() => resetActiveRubricConfig())`.

---

## 5. ⚠️ Historical Traps (Bugs Fixed - Do Not Reintroduce)

1. **Bug: LiveSync message omission**:
   `useLiveSync.ts` previously dropped `CARD_ISSUED`, `CARD_REVOKED`, `BATCH_*`, `PUPIL_RANKING_*`, leaving co-teachers desynchronized until a manual browser reload. Those handlers are wired up, and the trap is **now fully closed** — every one of the 20 server-emitted event names has a matching client `case`. The `TIMEOUT_ISSUED` / `FINAL_RANK_CONFIRMED` instance of this trap (re-entered through a rename) was fixed; see the resolved note under Invariant 3. The recurrence guard is `client/src/hooks/useLiveSync.test.ts` plus the event-symmetry test in `server/src/ws/live-sync.test.ts`.
2. **Bug: Ternary logic error in submitted list**:  
   `effectiveCanAccessRaster ? (e.subjectCode === mySubjectCode ? e.isSubmitted : e.isSubmitted) : ...` returned `e.isSubmitted` on both true and false branches, leaking submissions across all subjects. Fixed with `isSubjectMatch`.
3. **Bug: Subject code naming divergence**:  
   `teaching_assignments` used German full names, while `timetable_lessons` used WebUntis abbreviations. Lookups failed and returned `hours: 0`. Fixed with canonical subject normalizer.
4. **Bug: Multi-subject item count inflation**:  
   `calculateRank` concatenated items across all evaluations, counting up to 36+ items instead of 18. Fixed in `BeobachtungsGrid.tsx` by scoping strictly to active criteria items. **Still unfixed elsewhere** — see the known violation under Invariant 5.
5. **Bug: Cross-subject `getItemData` fallback**:  
   The grid looked through the active subject and, on a miss, fell back to scanning **every** evaluation the pupil had in **every** subject. One teacher was shown another teacher's ratings, those ratings fed the displayed rank, and the wrong evaluation's `version` was paired with the active subject's write — so the optimistic-concurrency guard matched zero rows and reported a conflict on a cell nobody else had touched. The function still exists at [`BeobachtungsGrid.tsx:281`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.tsx), but its body is now a single delegation to `findItemForSubjects`, which searches only the subjects in scope and returns `null` rather than widening. Do not restore a widening branch inside it.

   Regression-tested at two levels, and cite the right one:
   - **The lookup itself** — [`client/src/lib/pupilItems.test.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/lib/pupilItems.test.ts), `findItemForSubjects` suite: "does not fall back to another subject when the subject has no evaluation", "does not borrow a key that only a subject outside the scope holds".
   - **What the grid draws** — [`client/src/components/BeobachtungsGrid.test.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.test.tsx), "the rendered cells hold no rating from another subject": a pupil rated `org_1` in Deutsch, viewed in single-subject Mathematik, renders an empty cell, no reset control and `0/18 Punkte`. This is the assertion that a re-pasted fallback breaks.
6. **Bug: Unvalidated `batch-items`**:  
   `POST /api/evaluations/batch-items` checked only that `itemKey` was *present*, then wrote the client's own `criterionId`. A batch of 200 invented keys rated `'++'` became 200 positive ratings — an automatic *Meister*, forgeable by any teacher with write access to one pupil. Fixed by `validateBatchItems` in [`server/src/lib/rubric.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/lib/rubric.ts): every key must exist in the active rubric, the rating must be in `VALID_RATINGS`, the criterion is derived server-side, and rejection is all-or-nothing. The validator's own behaviour is regression-tested in [`server/src/lib/rubric.test.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/lib/rubric.test.ts).

   **That unit test does not cover the route.** ⚠️ Whether `evaluations.ts` *calls* the validator and iterates **its** output is pinned only structurally, in [`server/src/routes/evaluations.test.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/routes/evaluations.test.ts) — a source assertion, not a behavioural one, because the handler reaches PostgreSQL (`loadRubricIndex`, `getClassAccess`, `findPupilInClass`, `getOpenRound`, the transaction) before the decision and this repository has no database in CI. Deleting the two calls and restoring the inline loop *is* caught; a wrong call, a discarded result, or a reordered handler would not be. Treat the item-key forgery fix as unit-tested and **wiring-unpinned** until a database-backed route test exists.

   The item-key allowlist is the pattern the **subject-code** half of Invariant 1 still lacks — see that invariant.

---

## 9. 🛠️ Essential Terminal Commands

Run commands from the repository root:

```powershell
# Run backend & frontend in development mode
npm run dev

# Run the Vitest test suite — BOTH workspaces
#   server: 27 suites / 403 tests (+24 PostgreSQL-integration tests, skipped without
#           TEST_DATABASE_URL)   client: 10 suites / 134 tests
# The client suites use jsdom + Testing Library and include
# client/src/components/BeobachtungsGrid.test.tsx and
# client/src/components/ClassOverview.test.tsx, which render the real components.
npm test

# Run TypeScript typecheck across all workspaces (MUST PASS WITH 0 ERRORS)
npm run typecheck --workspaces

# Build production bundles
npm run build

# Deploy to production LXC 115 (requires environment variables)
$env:PROXMOX_HOST='172.16.1.54'
$env:PROXMOX_USER='root'
$env:PROXMOX_PASSWORD='<PROXMOX_PASSWORD>'
$env:LXC_CONTAINER_ID='115'
python scripts/deploy_to_production.py
```

---

## 10. 🤖 Checklist for Incoming AI Code Reviews

When reviewing changes or writing code:
- [ ] Did you preserve existing comments and docstrings?
- [ ] Are all raw subject codes routed through `normalizeSubject`?
- [ ] Did you check whether your database query respects the `(roundId, pupilId, classId, subjectCode)` natural key?
- [ ] Does your change preserve atomic versioning on `evaluation_items`?
- [ ] If you emitted a new WebSocket event on the backend, did you handle it on the client — and did you check the `type` string matches byte-for-byte, not just that a similar-looking `case` exists?
- [ ] If you renamed a WebSocket event, did you rename it on **both** sides? (The server's `type` strings are canonical: `TIMEOUT_ISSUED`, `FINAL_RANK_CONFIRMED`, `TIMEOUT_RESOLVED`, `FINAL_RANK_REVOKED`. The historical one-sided rename that broke this is fixed; never re-apply it.)
- [ ] Does every write path that accepts a subject code **reject** an unknown one, rather than letting `normalizeSubject()` coerce it into a new code?
- [ ] Did you use `findItemForSubjects` / `hasSubmittedForSubject` / `isPupilFullySubmitted` rather than an inline or unscoped scan?
- [ ] If you computed a rank or a positive count, did you scope it to the subjects in view instead of `flatMap`ing every evaluation?
- [ ] If you touched `CANONICAL_MAP` in `server/src/utils/subject.ts`, did you regenerate the copy in `client/src/lib/pupilItems.ts`?
- [ ] Did you run `npm test` and `npm run typecheck --workspaces` before completing your work?
- [ ] Did you preserve the team-teaching double-weighting logic in `conferences.ts`?
