# AGENTS — working rules for SMILE

SMILE is a live Austrian middle-school assessment platform. Pupil data is
sensitive. Read `docs/SECURITY.md` and `docs/history/invariants-history.md`
before changing authentication, authorization, subject codes, or WebSocket
events.

## Build and test

Run commands from the repository root:

```bash
npm install
npm run typecheck
npm test
```

Run `npm test`, not a bare `npx vitest` from the repository root: there is no root vitest config, so a root-level invocation collects both workspaces under the wrong environment. Each workspace has its own config.

PostgreSQL integration tests require `TEST_DATABASE_URL` (a throwaway loopback
database named `smile_db_test`). If none is available, set
`SKIP_POSTGRES_INTEGRATION=true` explicitly; a silent skip is not evidence.

## Non-negotiables

- Never trust a role, teacher id, or pupil id from a request body; derive identity
  from the verified session and durable user row.
- Canonicalize every subject code with `normalizeKnownSubject()` before writing.
- Keep evaluation writes atomic: version increments are done by PostgreSQL, not
  by reading and adding one in Node.
- Any state-changing endpoint needs a class/permission check, a pupil-in-class
  check, and an audit row where the operation is part of the official record.
- New WebSocket event types need a matching client handler and an entry in the
  live-sync contract test.
- Never commit `.env`, `data/`, `reports/`, dumps, password hashes, or
  `pupil_group_mappings.json`.
