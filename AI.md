# AI Agent Instructions

> **Primary Directive File**:  
> Please see 👉 **[IF_YOU_ARE_AN_AI.md](./IF_YOU_ARE_AN_AI.md)** for the complete architectural rules, critical domain invariants, database concurrency controls, and failure mode documentation for this repository.

### Quick Reference
- **Tech Stack**: Fastify v5 (TypeScript, Node >= 22), React 19 (Vite), Drizzle ORM, PostgreSQL (`smile_db`), WebSockets.
- **Test Suite**: `npm test`
- **Typecheck**: `npm run typecheck --workspaces`
- **Build**: `npm run build`
- **Deployment**: `python scripts/deploy_to_production.py` (Proxmox LXC 115)
- **Detailed Specification**: [SMILE_ARCHITECTURE_AND_CODE_REVIEW.md](./SMILE_ARCHITECTURE_AND_CODE_REVIEW.md)
