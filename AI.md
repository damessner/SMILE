# AI Agent Instructions

> **Primary Directive File**:  
> Please see 👉 **[IF_YOU_ARE_AN_AI.md](./IF_YOU_ARE_AN_AI.md)** for the complete architectural rules, critical domain invariants, database concurrency controls, and failure mode documentation for this repository.

Read it before writing code. Its six invariants are load-bearing, and **three of them are currently
violated in shipped code**. Each violation is recorded in place, marked ⚠️, with the file and line
that breaks it and the plan that will fix it — do not skim past those blocks. An agent that trusts
the invariant statements without reading the violations will reintroduce bugs that were already
removed, or "fix" a deferred item that was left deliberately.

The most recent reconciliation (2026-10-07) is recorded in
[`docs/superpowers/plans/2026-10-06-assessment-integrity.md`](./docs/superpowers/plans/2026-10-06-assessment-integrity.md).

### Quick Reference
- **Tech Stack**: Fastify v5 (TypeScript, Node >= 22), React 19 (Vite), Drizzle ORM, PostgreSQL (`smile_db`), WebSockets.
- **Test Suite**: `npm test` — runs **both** workspaces and needs `PORT` set (e.g. `PORT=3000 npm test`); server: 559 passed + 27 PostgreSQL-skipped across 39 files; client: 245 passed across 19 files (counts as of 2026-10-11). Not server-only.
- **Typecheck**: `npm run typecheck --workspaces`
- **Build**: `npm run build`
- **Deployment**: `python scripts/deploy_to_production.py` (Proxmox LXC 115)
- **Known open security items**: [`docs/SECURITY.md`](./docs/SECURITY.md) — the backup archives in the project root are still outstanding, and `GET /api/timeouts/active` is still unscoped.
- **Deferred work**: [`docs/superpowers/plans/2026-10-06-hardening-roadmap.md`](./docs/superpowers/plans/2026-10-06-hardening-roadmap.md) — rank-logic unification, plus the accessibility and deadline items.
- **Detailed Specification**: [SMILE_ARCHITECTURE_AND_CODE_REVIEW.md](./SMILE_ARCHITECTURE_AND_CODE_REVIEW.md)
