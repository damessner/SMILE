# AI Agent Instructions

> **Primary Directive File**:  
> Please see 👉 **[IF_YOU_ARE_AN_AI.md](./IF_YOU_ARE_AN_AI.md)** for the complete architectural rules, critical domain invariants, database concurrency controls, and failure mode documentation for this repository.

Read it before writing code. Its six invariants are load-bearing. Earlier revisions warned that several
were violated in shipped code; **those violations are fixed and the notes are now marked ✅ RESOLVED**
with the tests that pin them. Read those blocks anyway — they record the failure modes and the
historical traps, and an agent that trusts the invariant statements without reading them will
reintroduce bugs that were already removed, or "fix" a deferred item that was left deliberately.

The most recent reconciliation is the 2026-10-12 docs-truth and security pass (stale violation claims
corrected; deactivated-account enforcement and WebSocket rate limiting added). The 2026-10-07
reconciliation is recorded in
[`docs/superpowers/plans/2026-10-06-assessment-integrity.md`](./docs/superpowers/plans/2026-10-06-assessment-integrity.md).

### Quick Reference
- **Tech Stack**: Fastify v5 (TypeScript, Node >= 22), React 19 (Vite), Drizzle ORM, PostgreSQL (`smile_db`), WebSockets.
- **Test Suite**: `npm test` — runs **both** workspaces and needs `PORT` set (e.g. `PORT=3000 npm test`); server: 581 passed + 27 PostgreSQL-skipped across 41 files; client: 241 passed across 19 files (counts as of 2026-10-12). Not server-only.
- **Typecheck**: `npm run typecheck --workspaces`
- **Build**: `npm run build`
- **Deployment**: `python scripts/deploy_to_production.py` (Proxmox LXC 115)
- **Known open security items**: [`docs/SECURITY.md`](./docs/SECURITY.md) — the backup archives were moved out of the working tree on 2026-10-12 (`verify-env` is clean); `GET /api/timeouts/active` was scoped on 2026-10-09 (`lib/lw-duty.ts`). Remaining accepted items: no TLS on the LAN (a boot warning now fires while `COOKIE_SECURE` is false) and the permissive `STATISTICS_*` defaults, which are a school decision.
- **Deferred work**: [`docs/superpowers/plans/2026-10-06-hardening-roadmap.md`](./docs/superpowers/plans/2026-10-06-hardening-roadmap.md) — rank-logic unification, plus the accessibility and deadline items.
- **Detailed Specification**: [SMILE_ARCHITECTURE_AND_CODE_REVIEW.md](./SMILE_ARCHITECTURE_AND_CODE_REVIEW.md)
