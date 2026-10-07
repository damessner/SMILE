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
- ⚠️ **KNOWN VIOLATION — no write path performs the allowlist check.** Verified 2026-10-07 against the code at commit `bf35249`. Five paths take `subjectCode` straight from the request body (or WS payload), run it through the coercing `normalizeSubject()`, and insert the result as `evaluations.subject_code`:
  | Path | Line |
  |---|---|
  | `POST /api/evaluations/batch-default` | [`evaluations.ts:97`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/routes/evaluations.ts) |
  | `POST /api/evaluations/status` | [`evaluations.ts:233`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/routes/evaluations.ts) |
  | `POST /api/evaluations/submit` | [`evaluations.ts:312`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/routes/evaluations.ts) |
  | `POST /api/evaluations/batch-items` | [`evaluations.ts:465`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/routes/evaluations.ts) |
  | WS `UPDATE_RATING` | [`live-sync.ts:265`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/ws/live-sync.ts) |

  Task 3 closed the *item-key* half of this class of bug (`batch-items` now derives `criterionId` server-side via `validateBatchItems`) but did **not** touch the subject-code half. The item-key allowlist is now mandatory; the subject-code allowlist does not exist. Consequences of the gap: each invented code mints another `evaluations` row, `summarizeRatings` sums positives across *all* of a pupil's evaluations, and `conferences.ts:505` builds one weighted vote per evaluation with **no subject filter** — so a forged code adds both rating mass and a conference vote. **Do not treat this invariant as currently enforced.** Closing it is open work.

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
- ⚠️ **KNOWN VIOLATION — two broadcasts are silently dropped today.** The client handles `TIMEOUT_CREATED` and `FINAL_RANK_LOCKED`, but the server never emits those names; it emits `TIMEOUT_ISSUED` and `FINAL_RANK_CONFIRMED`.
  | Server emits | Where | Client handles? |
  |---|---|---|
  | `TIMEOUT_ISSUED` | `timeouts.ts:119`, `:126` | **No** — falls to `default` |
  | `FINAL_RANK_CONFIRMED` | `conferences.ts:210`, `:314` | **No** — falls to `default` |
  | `TIMEOUT_CREATED` | *never emitted* | Yes (`useLiveSync.ts:123`) — dead |
  | `FINAL_RANK_LOCKED` | *never emitted* | Yes (`useLiveSync.ts:125`) — dead |

  This is the same failure mode as Historical Trap 1, re-entered through a rename rather than an omission. A co-teacher does not see a timeout issue or a confirmed final rank until they reload. `USER_JOINED` / `USER_LEFT` (`live-sync.ts:196`, `:102`) are also unhandled; their payloads are `teacherName` (plus `classId` for `USER_JOINED`), so dropping them costs a presence indicator rather than pupil data — but nothing in the code says that was the intent, so treat it as undocumented rather than decided. **Fix the two real drops when you touch either route** — it is a rename on both sides, not a redesign.

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
  - ⚠️ **In Gesamt mode that call is a deliberate cross-subject read, and its rank is submitted to every subject.** `findItemForSubjects` returns the first match across all `mySubjects`, so a cell shows the first subject in `mySubjects` order that holds the key. `handleSubmitPupil` then sends that one rank as `finalRankToSubmit` for **each** `subCode`. A pupil rated in Mathematik alone and then in Deutsch is submitted under a Deutsch-derived rank for Mathematik. This is the same defect *shape* this branch closed for the roster and the item lookup, on the `final_ranks` path, and it is **pre-existing** — recorded as roadmap **E13** with the product question, not fixed. Cite the merged call as the reference implementation only together with this caveat; it is correct about *scoping*, not about *which scope*.
- Never do `pupil.evaluations.flatMap(e => e.items)` to calculate positive counts, as pupils with multiple subject evaluations will accumulate $> 18$ items and artificially trigger *Meister*!
- [`client/src/lib/pupilItems.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/lib/pupilItems.ts) is the client-side counterpart of this rule and of Invariant 4. It is the sanctioned home for subject-scoped reads; the grid already routes through it.
- ⚠️ **KNOWN VIOLATION — four client files still `flatMap` across all of a pupil's evaluations.** Their positive counts are unbounded past 18, so they violate this invariant today. **This is deliberately deferred**, not overlooked — see [`docs/superpowers/plans/2026-10-06-hardening-roadmap.md`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/docs/superpowers/plans/2026-10-06-hardening-roadmap.md), "Deferred: rank-logic unification", which now lists **these exact four** with their lines. Note that the roadmap's *unification* target is a different set of four — `server/src/lib/ranking.ts`, `BeobachtungsGrid.tsx`, `Schulalltag.tsx`, `ClassOverview.tsx` — and two of *those* (`ranking.ts` and `BeobachtungsGrid.tsx`) are already correct. The two sets overlap in only `Schulalltag.tsx` and `ClassOverview.tsx`. Until the unification lands, treat these ranks as **display-only and untrustworthy**; do not build on them, and do not read this invariant as enforced across the app.
  | File | Line | Status |
  |---|---|---|
  | `client/src/components/Schulalltag.tsx` (`getPupilRank`) | 211 | violates; named in the roadmap |
  | `client/src/components/ClassOverview.tsx` (`getPupilRank`) | 59 | violates; named in the roadmap |
  | `client/src/components/KelPdfModal.tsx` | 21 | violates; named in the roadmap |
  | `client/src/components/TeacherClassReportModal.tsx` | 39 | violates; named in the roadmap |

  (`BeobachtungsGrid.tsx` itself is correct about *scoping* — it is the reference implementation the other four should converge on. Read the Gesamt-mode caveat above before applying it to a merged write.)
- **Related hardcoding, also unfixed**: the thresholds (`14` / `8`), the `/18` denominator, and the submission deadline are literals in the client, not read from `server/src/config.ts` (`rankThresholds`, `rubricItemCount`, `submissionDeadline`). The client references none of them. `new Date(2026, 9, 30, 23, 59, 59)` appears in `BeobachtungsGrid.tsx:274` and `ClassOverview.tsx:47`, in browser-local time, while the server's `submissionDeadline` is UTC — they agree only for a CEST browser (roadmap item E11). Do not assume a value you read in one of these files is the same value the server enforces.

### Invariant 6: Authentication & Cookies
- The app uses **HttpOnly, SameSite cookies** for both REST API and WebSockets.
- WebSocket handshakes authenticate via the browser's cookie header during the HTTP upgrade. Do NOT attach JWT tokens in WS URL query strings.
- If `user.mustChangePassword === true`, WebSockets must be rejected with close code `1008`.

---

## 5. ⚠️ Historical Traps (Bugs Fixed - Do Not Reintroduce)

1. **Bug: LiveSync message omission**:  
   `useLiveSync.ts` previously dropped `CARD_ISSUED`, `CARD_REVOKED`, `BATCH_*`, `PUPIL_RANKING_*`, leaving co-teachers desynchronized until a manual browser reload. Those handlers are now wired up — **but the trap is not fully closed**: `TIMEOUT_ISSUED` and `FINAL_RANK_CONFIRMED` are dropped by exactly this mechanism today. See the known violation under Invariant 3.
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

## 6. 🛠️ Essential Terminal Commands

Run commands from the repository root:

```powershell
# Run backend & frontend in development mode
npm run dev

# Run the Vitest test suite — BOTH workspaces
#   server: 11 suites / 159 tests
#   client:  4 suites / 78 tests
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

## 7. 🤖 Checklist for Incoming AI Code Reviews

When reviewing changes or writing code:
- [ ] Did you preserve existing comments and docstrings?
- [ ] Are all raw subject codes routed through `normalizeSubject`?
- [ ] Did you check whether your database query respects the `(roundId, pupilId, classId, subjectCode)` natural key?
- [ ] Does your change preserve atomic versioning on `evaluation_items`?
- [ ] If you emitted a new WebSocket event on the backend, did you handle it on the client — and did you check the `type` string matches byte-for-byte, not just that a similar-looking `case` exists?
- [ ] If you renamed a WebSocket event, did you rename it on **both** sides? (`TIMEOUT_ISSUED` → `TIMEOUT_CREATED` and `FINAL_RANK_CONFIRMED` → `FINAL_RANK_LOCKED` were renamed on the client only.)
- [ ] Does every write path that accepts a subject code **reject** an unknown one, rather than letting `normalizeSubject()` coerce it into a new code?
- [ ] Did you use `findItemForSubjects` / `hasSubmittedForSubject` / `isPupilFullySubmitted` rather than an inline or unscoped scan?
- [ ] If you computed a rank or a positive count, did you scope it to the subjects in view instead of `flatMap`ing every evaluation?
- [ ] If you touched `CANONICAL_MAP` in `server/src/utils/subject.ts`, did you regenerate the copy in `client/src/lib/pupilItems.ts`?
- [ ] Did you run `npm test` and `npm run typecheck --workspaces` before completing your work?
- [ ] Did you preserve the team-teaching double-weighting logic in `conferences.ts`?
