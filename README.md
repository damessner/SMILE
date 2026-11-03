# SMILE

SMILE is a collaborative assessment, behaviour-tracking and conference platform
for MS Telfs Weissenbach. It runs as a Fastify/PostgreSQL API with a React/Vite
client, normally inside a Proxmox LXC container.

## Local setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `JWT_SECRET` and
   `INITIAL_USER_PASSWORD`.
2. `npm install`
3. `npm run db:migrate`
4. `npm run seed` (first bootstrap only; never overwrites an existing password)
5. `npm run dev`

The client dev server proxies `/api` and `/ws` to `http://127.0.0.1:3000`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

There is intentionally no root vitest config; run the workspace scripts via
`npm test`. PostgreSQL integration tests require `TEST_DATABASE_URL` (a
throwaway `smile_db_test` database) or an explicit
`SKIP_POSTGRES_INTEGRATION=true`.

## Deployment

`python3 scripts/deploy.py` builds the bundle, takes a database and app snapshot,
installs a new immutable release, switches the `/opt/smile` symlink atomically,
restarts `smile.service`, and rolls back on a failed health check.

Before deploying, read `docs/SECURITY.md` and `docs/BACKUP.md`. The application
stores pupil data; keep dumps, reports, `.env` files and
`pupil_group_mappings.json` outside version control and outside the deployable
tree.
