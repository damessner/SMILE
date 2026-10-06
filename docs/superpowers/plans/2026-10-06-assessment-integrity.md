# Assessment Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a pupil's assessed rank impossible to forge, stop losing the conference comment, and remove the cross-subject contamination that makes the grid show the wrong rank.

**Architecture:** Extract the rubric from its current hiding place (a private cache inside `live-sync.ts`) into one importable module, then route every write path — HTTP batch, HTTP status, and WebSocket — through it. The client gets the same treatment: the subject-matching and item-lookup helpers move out of the 1,484-line grid component into testable pure functions.

**Tech Stack:** Fastify v5, Drizzle ORM, PostgreSQL, React 19, Vite 8, Vitest, TypeScript.

**Spec:** This document. The findings it addresses are in `docs/superpowers/plans/2026-10-06-hardening-roadmap.md` (Phase A).

## Global Constraints

- Node `>= 22.0.0`, ESM. All relative imports use the `.js` extension.
- `npm test` runs the server workspace only. On PowerShell use `npm.cmd test` — `npm.ps1` is blocked by execution policy on this machine.
- `npm run typecheck --workspaces` must end with 0 errors. This is a gate on every task.
- Server tests live at `server/src/**/*.test.ts`. The `include` glob is set in `server/vitest.config.ts`; do not widen it.
- **Tests must import the code under test.** `server/src/lib/access-rules.test.ts`, `server/src/ws/auth.test.ts` and the first 90 lines of `server/src/ws/live-sync.test.ts` currently re-implement the logic inline and assert against the copy. Never copy that pattern. If a test cannot import the function, the function needs extracting first.
- German is the user-facing language. Error messages, UI strings and audit `action` values stay German; identifiers stay English.
- Preserve existing code comments that are accurate. Delete any comment that describes a design the code does not implement.
- One logical change per commit. Never mix a bugfix with a rename or a reformat.
- No new runtime dependencies on the server. The client test harness (Task 1) adds devDependencies only.

## Review Focus

The five input classes most likely to bite a teacher mid-lesson, none of which the current tests exercise:

1. **A teacher is assigned both D and M; a pupil has no M evaluation at all.** The M view must render empty cells. Today it renders the D teacher's smileys, which then get submitted as the M rank.
2. **A teacher types a conference comment and clicks the next pupil inside the debounce window.** The comment must be persisted before the view switches. Today it is discarded and the badge reads "Gesichert".
3. **A co-teacher submits the pupil for M while this teacher is looking at D.** D's "Eingereicht" tick must stay dark.
4. **A pupil with zero rated items, or with no evaluation for the subject being viewed.** Item lookup must return `null` rather than falling through to another subject, and the submitted check must be `false`. A rank helper that divides by an empty array is the failure mode to guard.

A fifth class — a legacy `SD` row coexisting with a new `D` row, double-counting positives — belongs to Phase C's data migration, not to this phase. It is recorded there.

---

### Task 1: Client test harness

There is no test runner in `client/` — zero test files. Every client fix in Tasks 4-6 is otherwise unverifiable, so this comes first.

**Files:**
- Modify: `client/package.json` (add `test` script and devDependencies)
- Create: `client/vitest.config.ts`
- Create: `client/src/test/setup.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run test --workspace=client` runs Vitest over `client/src/**/*.test.ts(x)` in a jsdom environment with `@testing-library/jest-dom` matchers registered. Later tasks rely on this exact command.

- [ ] **Step 1: Add the devDependencies and the test script**

In `client/package.json` add to `devDependencies`: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Add to `scripts`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Create `client/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 3: Create `client/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Write a harness smoke test**

Create `client/src/test/harness.test.ts`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Probe() {
  return <p role="status">harness ok</p>;
}

describe('client test harness', () => {
  it('renders a React component with testing-library matchers', () => {
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('harness ok');
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm.cmd run test --workspace=client`
Expected: PASS, 1 test.

- [ ] **Step 6: Wire the root script so both workspaces run**

In root `package.json` change `"test"` to `"npm run test --workspaces"`.

Run: `npm.cmd test`
Expected: server 123 passing, client 1 passing.

- [ ] **Step 7: Commit**

```bash
git add client/package.json client/vitest.config.ts client/src/test/ package.json package-lock.json
git commit -m "test(client): add vitest + testing-library harness

The client had no test runner, so every client-side defect was unverifiable.
Root `npm test` now covers both workspaces."
```

---

### Task 2: Extract the rubric into an importable module

The reason a teacher can forge a rank is that rubric knowledge lives in two places at once: `live-sync.ts` validates `itemKey` against a private cache, and `evaluations.ts` does not validate at all. One module, imported by both, closes the gap structurally.

**Files:**
- Create: `server/src/lib/rubric.ts`
- Create: `server/src/lib/rubric.test.ts`
- Modify: `server/src/ws/live-sync.ts:69-125` (delete the moved code, import instead)

**Interfaces:**
- Consumes: `db`, `assessmentRubrics`, `rubricCriteria` from `server/src/db/`.
- Produces:
  - `export const VALID_RATINGS: ReadonlySet<string>` — exactly `crown, smile, strain, struggle, sad, restart, newstart, +, ++, -, o, n.b., ''`.
  - `export interface RubricIndex { keyToCriterion: Map<string, string>; validRatings: ReadonlySet<string> }`
  - `export function buildRubricIndex(criteria: Array<{ id: string; items: unknown }>): RubricIndex` — pure; no DB.
  - `export function resolveCriterionId(index: RubricIndex, itemKey: string): string | null`
  - `export function isValidRating(index: RubricIndex, rating: string): boolean`
  - `export async function loadRubricIndex(): Promise<RubricIndex>` — DB-backed, 60s cache, returns `buildRubricIndex` of the default rubric.
  - `export function invalidateRubricCache(): void` — test seam, also called by `resetLiveSyncForTests`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/rubric.test.ts` with these cases:

- `buildRubricIndex([])` yields a `keyToCriterion` with `size === 0`, and `resolveCriterionId` returns `null` for any key.
- `buildRubricIndex([{ id: 'crit-1', items: [{ key: 'org_1' }, { key: 'org_2' }] }])` maps `org_1` and `org_2` to `crit-1`.
- `resolveCriterionId` returns `null` for `'x1'` — an attacker-chosen key.
- A criteria row whose `items` is not an array is skipped rather than throwing.
- A criteria row whose items are missing `key` are skipped.
- `isValidRating` accepts each of the 13 values in `VALID_RATINGS` and rejects `'x'`, `'MEISTER'`, `'null'`.
- `VALID_RATINGS` has exactly 13 entries.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test --workspace=server -- rubric.test.ts`
Expected: FAIL — `Cannot find module './rubric.js'`.

- [ ] **Step 3: Implement `server/src/lib/rubric.ts`**

Move `VALID_RATINGS` and the `RubricIndex` interface out of `live-sync.ts` verbatim. Implement `buildRubricIndex` as a pure fold over the criteria rows, guarding `Array.isArray(c.items)` and `typeof item?.key === 'string'`. Implement `loadRubricIndex` with the same 60-second cache discipline that `getRubricIndex` used, and have it return `buildRubricIndex(criteria)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd run test --workspace=server -- rubric.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `live-sync.ts` to import instead of owning**

Delete `VALID_RATINGS`, `RubricIndex`, `rubricCache`, `RUBRIC_CACHE_TTL_MS` and `getRubricIndex` from `live-sync.ts`. Import `loadRubricIndex`, `resolveCriterionId`, `isValidRating` from `../lib/rubric.js`. In `onUpdateRating` (`:375-384`) replace the lookup with `resolveCriterionId(rubric, itemKey)` and `isValidRating(rubric, rating)`. Have `resetLiveSyncForTests` (`:576`) call `invalidateRubricCache()`.

- [ ] **Step 6: Verify no behaviour regressed**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: 123 server tests still pass, plus the new rubric tests. 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/rubric.ts server/src/lib/rubric.test.ts server/src/ws/live-sync.ts
git commit -m "refactor(rubric): extract rubric index into an importable module

live-sync.ts owned the only copy of the item-key allowlist, so the HTTP write
path could not reuse it and shipped unvalidated. One module, imported by every
write path."
```

---

### Task 3: Validate batch items against the rubric — the forgery fix

`server/src/routes/evaluations.ts:429-433` checks only that `itemKey` is *present*, then writes the client-supplied `criterionId` verbatim (`:470`). 200 fabricated keys rated `'++'` produce `positiveCount = 200` and therefore `Meister`.

**Files:**
- Modify: `server/src/lib/rubric.ts` (add the validator)
- Modify: `server/src/lib/rubric.test.ts`
- Modify: `server/src/routes/evaluations.ts:410-505`

**Interfaces:**
- Consumes: `RubricIndex`, `resolveCriterionId`, `isValidRating` from Task 2.
- Produces:
  - `export interface BatchItemInput { itemKey: string; rating: string }`
  - `export interface ValidatedBatchItem { itemKey: string; rating: string; criterionId: string }`
  - `export type BatchValidation = { ok: true; items: ValidatedBatchItem[] } | { ok: false; error: string }`
  - `export function validateBatchItems(inputs: unknown, index: RubricIndex, maxItems: number): BatchValidation`
  - The client-supplied `criterionId` is **ignored entirely** and re-derived. `BatchItemInput` deliberately omits it.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/lib/rubric.test.ts`:

- Rejects an item whose `itemKey` is not in the rubric, with `error` containing `'Unbekanntes Beobachtungsmerkmal'`.
- Rejects an item whose `rating` is not in `VALID_RATINGS`.
- **The forgery case:** given an index containing only `org_1`, an input of 200 items with keys `x1`..`x200` all rated `'++'` returns `ok: false`. Nothing is validated partially.
- A `criterionId` supplied on the input object is ignored — the returned item's `criterionId` equals `index.keyToCriterion.get(itemKey)`.
- An input that is not an array returns `ok: false`.
- An empty array returns `ok: false`.
- `maxItems` boundary: exactly `maxItems` is accepted, `maxItems + 1` returns `ok: false`.
- A valid single item returns `ok: true` with one item carrying the derived `criterionId`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test --workspace=server -- rubric.test.ts`
Expected: FAIL — `validateBatchItems` is not exported.

- [ ] **Step 3: Implement `validateBatchItems`**

Signature `export function validateBatchItems(inputs: unknown, index: RubricIndex, maxItems: number): BatchValidation`.

Order the checks so the first failure determines the message: array → non-empty → length cap → per-item criterion lookup → per-item rating. Return the *first* problem as a German message, matching the existing tone (`'Unbekanntes Beobachtungsmerkmal oder ungültiger Bewertungswert.'`). Build the success array by calling `resolveCriterionId` per item; a `null` result is a rejection, never a pass-through.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd run test --workspace=server -- rubric.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the route**

In `server/src/routes/evaluations.ts`, inside the `/batch-items` handler after the existing body checks, replace the loop at `:429-433` with:

```ts
const rubric = await loadRubricIndex();
const validation = validateBatchItems(items, rubric, 200);
if (!validation.ok) return badRequest(reply, validation.error);
```

Then change the insert loop at `:465-491` to iterate `validation.items` and take `criterionId` from the validated object. Delete the now-unused `ALLOWED_RATINGS` set at `:508-522` and its `export` at `:525`, then update `server/src/index.test.ts` if it imports it (it does not today).

- [ ] **Step 6: Verify**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: all pass, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/rubric.ts server/src/lib/rubric.test.ts server/src/routes/evaluations.ts
git commit -m "fix(evaluations): validate batch item keys against the rubric

POST /api/evaluations/batch-items accepted any itemKey and wrote the
client-supplied criterionId, so a single request with 200 fabricated keys
rated '++' produced positiveCount 200 and an automatic Meister rank. The
criterion is now derived server-side, as the WebSocket path already did."
```

---

### Task 4: Stop the grid falling back to another subject's ratings

`client/src/components/BeobachtungsGrid.tsx:244-247` falls back to scanning every evaluation. In single-subject mode a teacher sees another teacher's ratings, submits them as their own subject's rank, and sends a mismatched OCC version that guarantees a conflict.

**Files:**
- Create: `client/src/lib/pupilItems.ts`
- Create: `client/src/lib/pupilItems.test.ts`
- Modify: `client/src/components/BeobachtungsGrid.tsx:236-249`

**Interfaces:**
- Consumes: the `isSubjectMatch` helper currently at `BeobachtungsGrid.tsx:57-67`.
- Produces:
  - `export function isSubjectMatch(a: string, b: string): boolean` — moved out of the component, unchanged behaviour, now covering the full alias table from `server/src/utils/subject.ts` rather than only `SD/SE/SM`.
  - `export interface SubjectItemSource { subjectCode: string; items?: Array<{ itemKey: string }> }`
  - `export function findItemForSubjects<T extends { itemKey: string }>(evaluations: Array<{ subjectCode: string; items?: T[] }>, codes: string[], itemKey: string): T | null` — searches only `codes`. No cross-subject fallback. Returns the first match in `codes` order. Generic in the item type so callers keep `rating` and `version` in the inferred type.
  - `export function hasSubmittedForSubject(evaluations: Array<{ subjectCode: string; isSubmitted: boolean }>, code: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/pupilItems.test.ts`:

- `findItemForSubjects` with evaluations `[{subjectCode:'D', items:[{itemKey:'org_1', rating:'crown'}]}, {subjectCode:'M', items:[{itemKey:'org_1', rating:'smile'}]}]`, codes `['M']`, key `org_1` → returns the **M** item (`rating: 'smile'`).
- **Review Focus #1:** the same evaluations with codes `['D']` and a pupil who has only a D evaluation, queried for key `org_9` → returns `null`. It must not fall back to D's row for a different key.
- A pupil with **no** evaluation for the requested code but one for another code → returns `null` for any key.
- An empty `codes` array returns `null`.
- `hasSubmittedForSubject([{subjectCode:'D', isSubmitted:true},{subjectCode:'M', isSubmitted:false}], 'M')` → `false`. **Review Focus #4.**
- `hasSubmittedForSubject([...], 'D')` → `true`.
- `isSubjectMatch('SD','D')`, `isSubjectMatch('SE','E')`, `isSubjectMatch('SM','M')` → `true`.
- `isSubjectMatch('deutsch','D')` → `true` (full alias table, not just the three legacy pairs).
- `isSubjectMatch('BO','D')` → `false`.
- **Review Focus #4:** a pupil whose evaluation has `items: []` returns `null` for any key, and `hasSubmittedForSubject` on `{ subjectCode: 'D', isSubmitted: false }` returns `false`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test --workspace=client -- pupilItems.test.ts`
Expected: FAIL — `Cannot find module './pupilItems'`.

- [ ] **Step 3: Implement `client/src/lib/pupilItems.ts`**

Implement all four exports. `isSubjectMatch` lowercases and strips non-alphanumerics on both sides before comparing, so `SD`/`sd`/`Deutsch` all reduce to a comparable form; port the alias table from `server/src/utils/subject.ts:7-145` rather than the three-pair subset. `findItemForSubjects` iterates `codes` in order and returns on the first hit — it must **not** iterate `evaluations` after exhausting `codes`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd run test --workspace=client -- pupilItems.test.ts`
Expected: PASS.

- [ ] **Step 5: Swap the component over**

In `BeobachtungsGrid.tsx`: delete the local `isSubjectMatch` at `:57-67`, delete the whole `getItemData` body at `:236-249` and replace it with a one-line delegation to `findItemForSubjects(pupil.evaluations, isAllSubjectsMode ? mySubjects.map(s => s.code) : [mySubjectCode], itemKey)`. Update every call site of `isSubjectMatch` to import it.

- [ ] **Step 6: Verify**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: all pass, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/pupilItems.ts client/src/lib/pupilItems.test.ts client/src/components/BeobachtungsGrid.tsx
git commit -m "fix(grid): stop cross-subject fallback in item lookup

getItemData fell back to scanning every evaluation, so a teacher viewing
Mathematik saw the Deutsch teacher's ratings, submitted them as the M rank,
and sent a mismatched OCC version that forced a conflict."
```

---

### Task 5: Subject-scope every submitted check

Four sites read `e.isSubmitted` without subject scope, contradicting Invariant 4 in `IF_YOU_ARE_AN_AI.md`. `BeobachtungsGrid.tsx:177-184` already does it correctly — that is the model.

**Files:**
- Modify: `client/src/lib/pupilItems.ts` (add `isPupilFullySubmitted`)
- Modify: `client/src/lib/pupilItems.test.ts`
- Modify: `client/src/components/BeobachtungsGrid.tsx:692`
- Modify: `client/src/components/ClassOverview.tsx:67,71`
- Modify: `client/src/components/TeacherClassReportModal.tsx:41`

**Interfaces:**
- Consumes: `hasSubmittedForSubject` from Task 4.
- Produces: `export function isPupilFullySubmitted(evaluations: Array<{ subjectCode: string; isSubmitted: boolean }>, codes: string[]): boolean` — true only when every code in `codes` has a submitted evaluation.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/lib/pupilItems.test.ts`:

- `isPupilFullySubmitted([{D,true}], ['D','M'])` → `false`. **Review Focus #3.**
- `isPupilFullySubmitted([{D,true},{M,true}], ['D','M'])` → `true`.
- `isPupilFullySubmitted([{D,true}], [])` → `false` (an empty code list must not read as "everything is done").
- `isPupilFullySubmitted([{D,false}], ['D'])` → `false`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test --workspace=client -- pupilItems.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement and wire it**

Implement `isPupilFullySubmitted` as `codes.length > 0 && codes.every(c => hasSubmittedForSubject(evaluations, c))`.

Then replace each of the four unscoped reads:
- `BeobachtungsGrid.tsx:692` — `const pDone = isPupilFullySubmitted(p.evaluations, isAllSubjectsMode ? mySubjects.map(s => s.code) : [mySubjectCode]);`
- `ClassOverview.tsx:67` — same substitution, using that file's active-subject variable.
- `ClassOverview.tsx:71` — replace the unscoped `.find(e => e.isSubmitted)` with `.find(e => isSubjectMatch(e.subjectCode, code) && e.isSubmitted)`.
- `TeacherClassReportModal.tsx:41` — same substitution.

- [ ] **Step 4: Verify**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: all pass, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/pupilItems.ts client/src/lib/pupilItems.test.ts client/src/components/BeobachtungsGrid.tsx client/src/components/ClassOverview.tsx client/src/components/TeacherClassReportModal.tsx
git commit -m "fix(grid): scope every isSubmitted check to the active subject

Four sites read e.isSubmitted across all subjects, so a pupil submitted in
Deutsch showed as ticked while their Mathematik evaluation was still open."
```

---

### Task 6: Persist the conference comment

`BeobachtungsGrid.tsx:1051-1055` calls `markSaved()`, which only animates a badge. The comment is discarded when the teacher switches pupils, while the badge asserts it was secured.

**Files:**
- Modify: `client/src/services/api.ts`
- Modify: `client/src/components/BeobachtungsGrid.tsx:271-277, 1045-1060`
- Create: `client/src/components/BeobachtungsGrid.test.tsx`

**Interfaces:**
- Consumes: the existing `POST /api/evaluations/status` route, which already accepts `comment` alone and — unlike every other write route — does **not** enforce `config.submissionDeadline`. Do not add a deadline check to it; a teacher may annotate after the deadline, and no write beyond `comment` may be accepted without one (see roadmap Phase D).
- Produces: `export async function saveEvaluationComment(pupilId: number, classId: number, subjectCode: string, comment: string): Promise<void>` in `api.ts`.

- [ ] **Step 1: Write the failing component test**

Create `client/src/components/BeobachtungsGrid.test.tsx`. Mock `../services/api` with `vi.mock`, render `BeobachtungsGrid` with a single pupil who has no submitted evaluation, and assert:

- Typing into the comment textarea and blurring calls `saveEvaluationComment` with the typed text.
- `saveEvaluationComment` rejecting leaves the "Gesichert" badge **not** shown, and surfaces an error toast. **This is the assertion that would have caught the original bug.**
- Switching `selectedPupilId` prop within the debounce window still flushes the pending comment before the switch. **Review Focus #2.**
- `saveEvaluationComment` is not called when the textarea is empty or whitespace-only.

Use `userEvent.type` followed by `userEvent.tab` to trigger blur. Wrap the switch-pupil case in `vi.useFakeTimers()` and `vi.advanceTimersByTime(800)`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test --workspace=client -- BeobachtungsGrid.test.tsx`
Expected: FAIL — `saveEvaluationComment` is not called.

- [ ] **Step 3: Add the API function**

In `client/src/services/api.ts`:

```ts
export async function saveEvaluationComment(
  pupilId: number, classId: number, subjectCode: string, comment: string,
): Promise<void> {
  const res = await apiFetch('/api/evaluations/status', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode, comment }),
  });
  if (!res.ok) throw new Error(`Kommentar konnte nicht gespeichert werden (${res.status}).`);
}
```

Use the file's existing `apiFetch` helper and `credentials: 'include'` path rather than a bare `fetch`.

- [ ] **Step 4: Wire the debounce**

In `BeobachtungsGrid.tsx`:
- Add a `pendingComment` ref holding `{ pupilId, subjectCode, comment } | null` and an 800ms timer ref.
- `onChange` updates local state, resets the timer, and schedules the flush.
- `onBlur` flushes immediately.
- Add a `useEffect` cleanup on `[selectedPupil?.id]` that flushes any pending comment before the view switches. **Review Focus #3.**
- Clear both refs on unmount.
- Replace the `markSaved()` call in `onBlur` with `void flushComment().then(() => markSaved())`, so the badge only appears after the server confirms. On rejection, call the existing error-toast path and do not set `lastSavedTime`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm.cmd run test --workspace=client -- BeobachtungsGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify the whole suite**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: all pass, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/services/api.ts client/src/components/BeobachtungsGrid.tsx client/src/components/BeobachtungsGrid.test.tsx
git commit -m "fix(grid): persist the conference comment on blur

onBlur called markSaved(), which only animated a badge. The typed justification
was discarded when the teacher switched pupils while the UI reported
'Gesichert 14:22:07'. The badge now follows the server response."
```

---

### Task 7: Reconcile the directive documents with the code

The directives are the highest-leverage defect in the repository: an agent that trusts `IF_YOU_ARE_AN_AI.md` will faithfully reintroduce the bugs Tasks 3-6 just removed.

**Files:**
- Modify: `IF_YOU_ARE_AN_AI.md`
- Modify: `docs/SECURITY.md`
- Modify: `server/src/db/schema.ts:45` (stale legacy-code comment)
- Modify: `AI.md`

**Interfaces:**
- Consumes: the shipped behaviour after Tasks 2-6.
- Produces: no code. The invariant list must state what the code does.

- [ ] **Step 1: Correct `IF_YOU_ARE_AN_AI.md`**

- Invariant 1: add that unknown subject codes must be **rejected**, not coerced. After Task 3 the fallback at `utils/subject.ts:164` that mints unbounded codes must no longer be reachable from a write path — if you cannot guarantee that, say so explicitly.
- Invariant 4: state that `hasSubmittedForSubject` / `isPupilFullySubmitted` are the only sanctioned reads, with file references.
- Invariant 5: note that `client/src/lib/pupilItems.ts` is the client-side counterpart and that `Schulalltag.getPupilRank` still violates this pending the roadmap's unification work. **Record the known violation rather than deleting the invariant.**
- Section 5 "Historical Traps": add the cross-subject `getItemData` fallback and the unvalidated `batch-items` as traps 5 and 6, since both are now regression-tested.
- Section 6: correct the test command — `npm test` now runs both workspaces.

- [ ] **Step 2: Correct `docs/SECURITY.md`**

- Item 5 states the two `backup_*.zip` archives should be moved out of the tree. They are still there. Either move them or state that they remain outstanding.
- Line ~98 claims statistics and timeout history were scoped to the caller's classes. `GET /api/timeouts/active` is not. Correct the claim.

- [ ] **Step 3: Fix the stale schema comment**

`server/src/db/schema.ts:45` reads `// e.g. "SD", "SE", "SM", "D", "E"`. The forbidden-codes list in Invariant 1 names `SD`, `SE`, `SM` as legacy values that must never be stored. Replace with the canonical examples `D`, `E`, `M`, `BO`, `PH`.

- [ ] **Step 4: Verify**

Run: `npm.cmd test && npm.cmd run typecheck --workspaces`
Expected: all pass — this task changes documentation only.

- [ ] **Step 5: Commit**

```bash
git add IF_YOU_ARE_AN_AI.md AI.md docs/SECURITY.md server/src/db/schema.ts
git commit -m "docs: reconcile agent directives with shipped behaviour

The invariant file described designs the code did not implement and asserted
invariants three of the four live write paths violated. Corrected, with known
remaining violations recorded rather than removed."
```