# 🤖 Agent Instructions & Directives

> **CRITICAL DIRECTIVE**:  
> Always read and strictly adhere to **[IF_YOU_ARE_AN_AI.md](./IF_YOU_ARE_AN_AI.md)** and **[AI.md](./AI.md)** before writing code or proposing changes in this repository.

---

### Core Domain Rules & Invariants
1. **Canonical Subject Codes (Invariant 1)**:  
   Only store canonical codes (`D`, `E`, `M`, `BO`, `PH`, `MUS`, `TUD`, etc.). Always normalize via `normalizeSubject()` from `server/src/utils/subject.ts`.
2. **Database OCC Concurrency (Invariant 2)**:  
   Table `evaluations` has unique constraint on `(round_id, pupil_id, class_id, subject_code)`. Version increments must be atomic in PostgreSQL (`version = version + 1`). Single-cell writes in `BeobachtungsGrid.tsx` carry the subject-specific version.
3. **LiveSync Event Bus Symmetry (Invariant 3)**:  
   Broadcast types in `server/src/ws/live-sync.ts` must match `switch(msg.type)` handlers in `client/src/hooks/useLiveSync.ts`.
4. **Subject Isolation in Grid (Invariant 4)**:  
   Evaluation status must be subject-scoped (`hasSubmittedForSubject`). Never check `evaluations.some(e => e.isSubmitted)` across all subjects.
5. **18-Item Rubric Boundary (Invariant 5)**:  
   Maximum 18 rubric criteria. Never use `flatMap` across multiple evaluations to calculate positive totals.
6. **Authentication & Session Security (Invariant 6)**:  
   Strictly HttpOnly, SameSite cookies for both REST and WebSockets. Close code 1008 on forced password reset.

---

### Test & Build Commands
- Run all tests: `npm test` from the repository root with `PORT` set (server 581 passed + 27 PostgreSQL-skipped / 41 files; client 244 passed / 19 files, as of 2026-10-12). There is no root vitest config — do not run `npx vitest` from the root, it sweeps both workspaces under the wrong environment.
- Typecheck: `npm run typecheck --workspaces`
- Build: `npm run build`
