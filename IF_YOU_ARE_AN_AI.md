# 🤖 IF YOU ARE AN AI (LLM / Coding Agent Directive)

> **Read before changing code.** Concise operating guide for **SMILE**. The six invariants in §4 are load-bearing; each names the file that enforces it. Check the code and its tests before "fixing" anything described here.

---

## 1. Quick Project Mental Model

- **SMILE**: real-time collaborative grading, behavior tracking and conference decision support for MS Telfs Weissenbach (Austrian Mittelschule).
- **Tiers** from an 18-item rubric: **Lehrling** < 8 positive items; **Geselle** 8–13; **Meister** ≥ 14 (config, §8).
- **Team teaching**: core subjects (D, E, M) have two teachers and double conference weight. Rankings are weighted by weekly lesson hours from WebUntis (`timetable_lessons`).
- **Behavior cards**: 🟢 praise; 🟡 warning (reaching `YELLOW_CARD_ALERT_THRESHOLD` in `YELLOW_CARD_ALERT_WINDOW_DAYS` raises a school-wide alert; see `server/src/config.ts`); 🔴 severe (1-step conference-rank demotion).

## 2. Technology Stack & Runtime

- **Backend**: Node.js ≥ 22 ESM, Fastify v5, `@fastify/websocket`, `@fastify/jwt`, `@fastify/cookie`. PostgreSQL (`smile_db`), Drizzle ORM 0.45.x, raw pooled queries via `getPool()`.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS, Lucide React.
- **Testing**: Vitest in both workspaces; root `npm test` runs server and client suites. A client change must keep the client suites green too. Counts: §9.

## 3. Top Repository Anchors

```text
server/src/
  config.ts              env-driven thresholds, deadlines, flags (validated at boot)
  db/schema.ts           Drizzle tables & indexes
  lib/guards.ts          permissions (getClassAccess, getGlobalAccess, canRateSubject)
  lib/ranking.ts         stored-rank scoring, thresholds, red-card demotion
  lib/rubric.ts          item-key & rating allowlist (validateBatchItems)
  routes/evaluations.ts  rating submissions, batch entry, status
  routes/conferences.ts  conference mode, voting, hours-weighting
  utils/subject.ts       CANONICAL_MAP & subject normalizers
  ws/live-sync.ts        WebSocket engine, broadcasts, OCC
client/src/
  components/BeobachtungsGrid.tsx   teacher matrix, autosave, subject tabs
  hooks/useLiveSync.ts              WebSocket client; switch(msg.type)
  lib/pupilItems.ts                 subject-scoped reads, scoreSubject
  lib/rubricConfig.ts               delivered rubric config (§8)
  App.tsx                           root state, live event dispatch
scripts/deploy_to_production.py     Proxmox LXC 115 deployment
```

---

## 4. ⚡ Critical Invariants (DO NOT VIOLATE)

### Invariant 1: Canonical Subject Codes
- Store only canonical codes (`D`, `E`, `M`, `BO`, `PH`, `MUS`, `TUD`, …) in `evaluations.subject_code`. Never store German names or legacy codes (`SD`, `SE`, `SM`). The list is `CANONICAL_MAP` in [`server/src/utils/subject.ts`](./server/src/utils/subject.ts).
- **Write paths reject** unknown *or missing* codes with 400 `Ungültiges Unterrichtsfach.` Validate with `normalizeKnownSubject()` (returns `null` on a miss). Never default to `'D'`.
- **Reads** use `normalizeSubject()` so legacy rows and WebUntis names still resolve. **Never** use it on a write: it mints a code from any input.
- Authorization: `canRateSubject(access, code)` in `server/src/lib/guards.ts`.
- [`client/src/lib/pupilItems.ts`](./client/src/lib/pupilItems.ts) holds a deliberate copy of the aliases. **Regenerate it whenever `CANONICAL_MAP` changes**; a dropped alias silently renders an empty subject.

### Invariant 2: Natural Keys & OCC Concurrency
- `evaluations` has `UNIQUE (round_id, pupil_id, class_id, subject_code)`. Never blind-`INSERT`; use `.onConflictDoUpdate(...)`.
- `evaluation_items` versions are atomic: `SET rating = $1, version = version + 1`. Never compute `existing.version + 1` in Node.
- WS single-cell writes (`onUpdateRating`, `server/src/ws/live-sync.ts`) require an integer `expectedVersion` and write `WHERE version = $expected`; zero rows → `CONFLICT`. No default version.
- HTTP batch writes (`/batch-items`, `server/src/routes/evaluations.ts`) are validated by `validateBatchItems` (`server/src/lib/rubric.ts`). The two mechanisms differ on purpose; do not unify them.
- **Every subject carries its own `expectedVersion`**: use `itemVersionForSubject(evaluations, code, itemKey)` (`pupilItems.ts`). One grid-wide version makes every subject but the first conflict.

### Invariant 3: LiveSync Event Bus Symmetry
- Every `type` broadcast by `broadcastToClass` in [`server/src/ws/live-sync.ts`](./server/src/ws/live-sync.ts) needs an exact-match `case` in `switch(msg.type)` in [`client/src/hooks/useLiveSync.ts`](./client/src/hooks/useLiveSync.ts). Its `default:` drops unknown types **silently**.
- **Server names are canonical** (`TIMEOUT_ISSUED`, `TIMEOUT_RESOLVED`, `FINAL_RANK_CONFIRMED`, `FINAL_RANK_REVOKED`). Renaming one requires changing both sides in the same change.

### Invariant 4: Subject Isolation in the Grid
- Submission state is per subject. Use `hasSubmittedForSubject(evaluations, code)` and `isPupilFullySubmitted(evaluations, codes)` from `pupilItems.ts`. An empty `codes` is `false`, never `true`.
- Inline checks must be gated by `isSubjectMatch(e.subjectCode, code)`.
- **Forbidden**: `evaluations.some(e => e.isSubmitted)` across subjects. A Deutsch submission must never mark Mathematik done.
- `findItemForSubjects(evaluations, codes, itemKey)` searches only in-scope subjects and returns `null` on a miss. Do not add a widening fallback.

### Invariant 5: 18-Item Rubric Boundary
- A student rubric has exactly **18 items** (6 dimensions × 3), delivered at runtime via `rubricConfig` (§8).
- Score one subject with `scoreSubject(evaluations, subjectCode, rubricItemKeys)` (`pupilItems.ts`). `calculateRank` in `BeobachtungsGrid.tsx` delegates to it.
- **Forbidden**: `pupil.evaluations.flatMap(e => e.items)` to count positives or merge subjects. Views show per-subject rasters; there is no pupil-level aggregate in the client.
- Server: `summarizeRatings` (`server/src/lib/ranking.ts`) is additive under `RANK_AGGREGATION=total`. Pass one evaluation group per subject.
- An unrated subject submits the teacher's explicit proposal (`votedRank`) if set, otherwise **nothing**. Never fabricate a rank.

### Invariant 6: Authentication & Cookies
- Auth uses **HttpOnly, SameSite cookies** for REST and WebSockets. Never put a JWT in a WS URL; the handshake reads the cookie header.
- `user.mustChangePassword === true` → WebSocket closed with **`1008`**.
- Deactivated accounts get 403 `ACCOUNT_DEACTIVATED` on every request (`buildSessionGuard`, `server/src/lib/guards.ts`); admin placeholder teacher rows are `active: false` by design and are exempt.
- Inbound WS messages are token-bucket rate-limited (`WS_RATE_LIMIT_PER_SECOND`, `WS_RATE_LIMIT_BURST` in `live-sync.ts`).

---

## 5. History (Fixed Failure Modes — Do Not Reintroduce)

- Dropped LiveSync broadcasts from `type` / `case` mismatches (Invariant 3).
- Submissions leaked across subjects through a ternary returning `e.isSubmitted` on both branches (Invariant 4).
- German names vs WebUntis codes resolved lesson hours to 0 (Invariant 1).
- Item concatenation across subjects inflated counts past 18 (Invariant 5).
- `getItemData` fell back to another subject's evaluation (Invariant 4).
- `batch-items` accepted invented keys, so forged `++` ratings produced *Meister* (`validateBatchItems`).
- `subjectCode` defaulted to `'D'` and `expectedVersion` to `1`; both defaults were removed.

---

## 8. Rubric Configuration — Single Source of Truth

**The server decides; the client obeys.**

- [`server/src/config.ts`](./server/src/config.ts) owns `RANK_THRESHOLD_MEISTER` (14), `RANK_THRESHOLD_GESELLE` (8) and `RUBRIC_ITEM_COUNT` (18), validated at boot (meister > geselle; count > 0). Defaults in parentheses.
- Only [`server/src/lib/ranking.ts`](./server/src/lib/ranking.ts) compares scores with thresholds when a rank is **stored**.
- **Never copy these numbers into the client.**
- Delivery: `GET /api/classes/:classId/pupils` → `rubricConfig` → `App.tsx` `setActiveRubricConfig(...)` → [`client/src/lib/rubricConfig.ts`](./client/src/lib/rubricConfig.ts) (`activeRankThresholds`, `activeRubricItemCount`) → `scoreSubject`, `conferenceEvidence.ts`, `quickGradeFills`.
- `setActiveRubricConfig` **rejects** partial or contradictory payloads and keeps the last good config. A partial config would silently demote a whole class.
- `assessmentRubrics.gradeBoundaries` in the database is **not** the source (`server/src/db/seed.ts` writes it once). Read `config.ts`.
- Tests that touch the config call `resetActiveRubricConfig()` in `afterEach`.
- The submission deadline arrives as a UTC ISO string; if it is missing the grid **fails closed**.

---

## 9. 🛠️ Essential Commands

Run from the repository root. On Windows PowerShell use `npm.cmd` if `npm.ps1` is blocked.

```powershell
npm run dev                          # backend + frontend, development mode

$env:PORT='3000'; npm test           # Vitest, BOTH workspaces; PORT must be set
#   Run `npm test` for current counts; this file does not state them.
#   Server integration tests need TEST_DATABASE_URL and skip without it (CI provisions PostgreSQL).
#   There is no root vitest config. Do NOT run `npx vitest` from the root.

npm run typecheck --workspaces       # must pass with 0 errors
npm run build                        # production bundles

# Deploy to Proxmox LXC 115 (requires environment variables)
$env:PROXMOX_HOST='172.16.1.54'; $env:PROXMOX_USER='root'
$env:PROXMOX_PASSWORD='<PROXMOX_PASSWORD>'; $env:LXC_CONTAINER_ID='115'
python scripts/deploy_to_production.py
```

---

## 10. 🤖 Checklist for AI Code Changes

- [ ] Existing comments and docstrings preserved.
- [ ] Subject codes on write paths go through `normalizeKnownSubject`; unknown **or missing** codes are rejected.
- [ ] Queries respect the `(round_id, pupil_id, class_id, subject_code)` natural key and atomic versioning.
- [ ] A new or renamed WS event matches byte-for-byte on both server and client.
- [ ] Subject-scoped helpers (`findItemForSubjects`, `hasSubmittedForSubject`, `isPupilFullySubmitted`) used, not unscoped scans; no `flatMap` over all evaluations.
- [ ] `CANONICAL_MAP` changes mirrored into `client/src/lib/pupilItems.ts`.
- [ ] Team-teaching double weighting in `server/src/routes/conferences.ts` preserved.
- [ ] `npm test` (with `PORT` set) and `npm run typecheck --workspaces` run before completing.
