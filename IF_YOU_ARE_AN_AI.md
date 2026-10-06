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
  - 🟡 **Yellow**: Warning. **3 Yellow Cards** across any subjects automatically trigger a school-wide conference alert.
  - 🔴 **Red**: Severe incident. Automatically triggers a **1-step demotion penalty** on the student's conference rank (e.g. *Meister* $\to$ *Geselle*, *Geselle* $\to$ *Lehrling*).

---

## 2. Technology Stack & Runtime

- **Backend**: Node.js $\ge 22.0.0$ ESM, Fastify v5, `@fastify/websocket`, `@fastify/jwt`, `@fastify/cookie`.
- **Database & ORM**: PostgreSQL (`smile_db`), Drizzle ORM (`0.45.x`), raw pooled queries via `getPool()`.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS, Lucide React icons.
- **Testing**: Vitest (`server/src/**/*.test.ts`).
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
│   │   ├── lib/
│   │   │   ├── guards.ts            <-- Permission resolver (getClassAccess)
│   │   │   ├── ranking.ts           <-- 18-item scoring, thresholds, red card demotion
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
- **Reason**: Timetable hours in `timetable_lessons` use these WebUntis short codes. If codes mismatch, timetable lesson hours resolve to 0, breaking the weighted voting system!

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

### Invariant 3: LiveSync Event Bus Symmetry
- When the backend broadcasts a message via `broadcastToClass(classId, msg)` in [`server/src/ws/live-sync.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/server/src/ws/live-sync.ts), it **must** be handled in:
  1. [`client/src/hooks/useLiveSync.ts`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/hooks/useLiveSync.ts) (must not drop it in `switch(msg.type)`).
  2. [`client/src/App.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/App.tsx) in `handleRatingUpdated`.

### Invariant 4: Subject Isolation in Observation Grid
- In [`client/src/components/BeobachtungsGrid.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.tsx), a pupil is submitted **only** for the active subject being viewed.
- Always use `isSubjectMatch(e.subjectCode, mySubjectCode)` when checking `e.isSubmitted`.
- Never check `evaluations.some(e => e.isSubmitted)` across all subjects, because a submission in English must NOT mark German or Math as submitted!

### Invariant 5: 18-Item Rubric Boundary
- A student rubric has exactly **18 items** (6 dimensions $\times$ 3 items).
- In [`BeobachtungsGrid.tsx`](file:///c:/Users/dames/OneDrive/Documents/antigravity/SMILE/client/src/components/BeobachtungsGrid.tsx), `calculateRank` must iterate over the 18 criteria items displayed in the grid using `getItemData(pupil, it.key)`.
- Never do `pupil.evaluations.flatMap(e => e.items)` to calculate positive counts, as pupils with multiple subject evaluations will accumulate $> 18$ items and artificially trigger *Meister*!

### Invariant 6: Authentication & Cookies
- The app uses **HttpOnly, SameSite cookies** for both REST API and WebSockets.
- WebSocket handshakes authenticate via the browser's cookie header during the HTTP upgrade. Do NOT attach JWT tokens in WS URL query strings.
- If `user.mustChangePassword === true`, WebSockets must be rejected with close code `1008`.

---

## 5. ⚠️ Historical Traps (Bugs Fixed - Do Not Reintroduce)

1. **Bug: LiveSync message omission**:  
   `useLiveSync.ts` previously dropped `CARD_ISSUED`, `CARD_REVOKED`, `BATCH_*`, `PUPIL_RANKING_*`, leaving co-teachers desynchronized until a manual browser reload. Handlers are now wired up.
2. **Bug: Ternary logic error in submitted list**:  
   `effectiveCanAccessRaster ? (e.subjectCode === mySubjectCode ? e.isSubmitted : e.isSubmitted) : ...` returned `e.isSubmitted` on both true and false branches, leaking submissions across all subjects. Fixed with `isSubjectMatch`.
3. **Bug: Subject code naming divergence**:  
   `teaching_assignments` used German full names, while `timetable_lessons` used WebUntis abbreviations. Lookups failed and returned `hours: 0`. Fixed with canonical subject normalizer.
4. **Bug: Multi-subject item count inflation**:  
   `calculateRank` concatenated items across all evaluations, counting up to 36+ items instead of 18. Fixed by scoping strictly to active criteria items.

---

## 6. 🛠️ Essential Terminal Commands

Run commands from the repository root:

```powershell
# Run backend & frontend in development mode
npm run dev

# Run Vitest test suite (server)
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
- [ ] If you emitted a new WebSocket event on the backend, did you handle it on the client?
- [ ] Did you run `npm test` and `npm run typecheck --workspaces` before completing your work?
- [ ] Did you preserve the team-teaching double-weighting logic in `conferences.ts`?
