# Security Notes — SMILE

This records the vulnerabilities found in the pre-hardening codebase, the fixes applied,
and the **manual steps still required**.

The secrets named below were committed to this repository and documented in `README.md`.
Treat them as compromised regardless of whether version control was ever enabled — the
secrets are known from this file, from git history, and from the application bundle.

---

## Action required before the next deployment

These cannot be fixed in code — someone has to perform them.

### 1. Rotate the JWT signing secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Put the result in `JWT_SECRET`. Every existing session is invalidated, which is the point.

The server refuses to start if `JWT_SECRET` is unset, shorter than 32 characters, or
equal to the leaked value. See `server/src/config.ts`.

### 2. Rotate the PostgreSQL password

The old password was in `.env` and in a source-code fallback. On the database server:

```sql
ALTER ROLE smile_user WITH PASSWORD '<new password>';
```

Then update `DATABASE_URL`. `databaseUrl()` refuses to start if the URL still contains
the leaked password.

### 3. Reset every account password

All teacher accounts shared one password, and the admin used a second published one. Any
teacher could sign in as any other teacher or as the administrator.

- `npm run seed` now creates accounts with an individual password from
  `INITIAL_USER_PASSWORD` and sets `must_change_password = true`.
- Re-running the seed **does not** overwrite an existing account's password.
- Distribute the bootstrap passwords out of band. Each user must set their own at first
  login before they can write anything.
- If the old shared passwords were in use, assume they were and rotate regardless.

For an existing deployment, rotate directly:

```sql
UPDATE users SET password_hash = '<bcrypt hash>', must_change_password = true;
```

### 4. Enable version control

This repository was **not** a git repository and had no `.gitignore`. There is no way to
review, revert, or attribute a change to the `audit_logs` the system claims. A
`.gitignore` now exists and excludes `.env`, `node_modules/`, build output, and the backup
archives (which contain the full pupil database).

Initialise the repository **after** rotating the secrets above, so history never contains
them.

### 5. Move the backup archives out of the working tree — **STILL OUTSTANDING**

`backup_date_time.zip` and `backup_2026-10-01_17-39-50.zip` are byte-identical (both 403,162
bytes, both dated 2026-10-01) and sit in the project root. One is redundant. Verify a restore
works, then move them to controlled storage with a retention policy.

**As of 2026-10-07 this has not been done.** Both files are still in the working tree. They are
git-ignored (`.gitignore` covers `backup_*` and `*.zip`) and `git status` reports nothing, which
makes them easy to mistake for already-handled.

`npm install` therefore **fails** on a developer workstation. Running the guard directly
(`node scripts/verify-env.mjs`) exits 1, and `.env` is clean, so the archives are the only
remaining problem and the sole cause. The guard reports both by name and size and points here:

```
[verify-env] Problems found:
  - backup_date_time.zip (394 KB) is in the working tree. It contains pupil data - move it to controlled storage.
  - backup_2026-10-01_17-39-50.zip (394 KB) is in the working tree. It contains pupil data - move it to controlled storage.
See docs/SECURITY.md.
```

Everything up to that point installs fine, so the failure surfaces as an unrelated `postinstall`
error. Meanwhile the archives hold the full pupil database on a machine that is not the controlled
storage this item asks for.

Moving or deleting them is **not** a code change and was deliberately left to the owner of that
data. Note that this item is also why a clean checkout on another machine cannot reproduce the
failure — the archives are not in version control, so a fresh clone has nothing to remove.

The guard (`scripts/verify-env.mjs`) has been updated to perform a directory-wide scan for any
backup files matching `backup*.zip`, `*.dump`, or `*.sql.gz`. All three files (`backup.zip`,
`backup_date_time.zip`, `backup_2026-10-01_17-39-50.zip`) are now caught by the guard.

### 6. Pin SSH known-hosts for deployment scripts

All Python deployment and inspection scripts under `scripts/` (`deploy.py`, `deploy_to_production.py`,
`lxc-inspect.py`, `lxc-migration-check.py`, `lxc-predeploy.py`) enforce `paramiko.RejectPolicy()`.
They will refuse to connect to unverified SSH servers to prevent man-in-the-middle attacks.

**Operator setup:**
Before running any deployment script, obtain the target host-key fingerprint from a trusted
out-of-band source (for example, the provider console or an administrator) and compare it with
the key collected from the network. `ssh-keyscan` alone is not authentication and must never be
treated as proof of identity:
```bash
# Collect the candidate key without trusting it yet:
ssh-keyscan -t ed25519 <PROXMOX_HOST> > /tmp/smile-host-key-candidate

# Compare the displayed SHA256 fingerprint with the independently verified fingerprint.
ssh-keygen -lf /tmp/smile-host-key-candidate -E sha256

# Only after the fingerprints match, install the candidate:
cat /tmp/smile-host-key-candidate >> ~/.ssh/known_hosts

# Or specify a custom pinned known_hosts file:
export SSH_KNOWN_HOSTS=/path/to/pinned_known_hosts
```

---

## What was fixed

### Critical

| Issue | Fix |
|---|---|
| `/ws` had **no authentication** — anyone on the LAN could connect, read all live broadcasts, and write ratings | Handshake requires a valid session, authenticated in a `preHandler` so an unauthenticated upgrade is refused with 401 before the socket opens. `server/src/index.ts` |
| WS authorization was `if (client.teacherId)`, where `teacherId` came from the client's own `SUBSCRIBE_CLASS` payload — omissible and forgeable | Identity comes exclusively from the verified JWT; the guard is now `getClassAccess(user, classId).canRate`. `server/src/ws/live-sync.ts` |
| JWT secret hardcoded as a fallback identical to the real `.env` value | No fallback. Validated at boot; rejects the leaked value and short secrets. `server/src/config.ts` |
| DB connection string hardcoded as fallback in two places, including `drizzle.config.ts` | Resolved from `DATABASE_URL` with no fallback; the leaked password is rejected |
| All teachers shared one password; admin used a second published one | Per-account random bootstrap password + `must_change_password`; server rejects all writes until changed |

### High

| Issue | Fix |
|---|---|
| Pupil create/edit/archive required only a valid token — any teacher could modify any class's roster | `canManagePupils` (admin or homeroom head of that class); moving a pupil requires rights in **both** classes |
| Any teacher could issue red cards (instant rank loss) in classes they do not teach | `canRecord` class check plus pupil-must-belong-to-class validation |
| Any user could revoke any teacher's card by id | Restricted to the issuing teacher, that class's homeroom heads, or school leadership |
| `pupilId` and `classId` were never cross-validated | `findPupilInClass()` on every write path; mismatches return 400 |
| A KV could confirm a conference rank for a pupil in a *different* class | `pupil.classId !== cid` is rejected in `/vote` and `/vote-all` |
| School-wide data readable by any teacher (statistics, card alerts, timeout history) | Scoped to caller's classes via `getGlobalAccess()` and `lw-duty.ts`; `/timeouts/escalations` restricted to school leadership; `/timeouts/active` scoped to duty teacher or own classes |
| `head_teacher` (~20 accounts) could download a full database dump | Backup export restricted to `admin`; audit log no longer truncated to 500 rows |
| KV matching used `field.includes(shortName)` — substring false positives granted homeroom rights | `kvFieldMatches()` with exact / parenthesised-code / separator / trailing-token matching. Covered by tests |
| Schema drift: `seed.ts` never created `timeout_incidents`, `timeout_escalations`, `timetable_lessons`, or several used columns | Schema owned by generated Drizzle migrations; hand-written DDL deleted |
| Re-running the seed reset the admin password to the published default | Existing accounts are left untouched; only new ones are created |
| `cors: { origin: true, credentials: true }` reflected any Origin | Explicit allowlist, empty by default (same-origin) |

### Endpoint visibility: how each read is scoped

**Correction (2026-10-08).** An earlier revision of this file carried a section headed *"Known
gap: `GET /api/timeouts/active` is not scoped"*, which asserted that the endpoint had no
`role === 'pupil'` guard, no `LIMIT`, and that `getGlobalAccess` returned `classIds: null` for any
account without a `teacherId`. It then prescribed a three-step remediation. **All three steps are
already implemented.** The description was stale, and acting on it would have been wrong twice
over: adding a `getGlobalAccess` guard to a route that already refuses pupils narrows nothing, and
the quoted `guards.ts` branch no longer reads that way.

Current state, verified against the code:

| Endpoint | Scoped? | Evidence |
|---|---|---|
| `GET /api/statistics/overview` | Only when `STATISTICS_SCHOOL_WIDE=false` | The shipped default is **school-wide**: `config.ts` defaults `statisticsSchoolWide` to `true`, and `statistics.ts` then passes `classIds: null` without calling `getGlobalAccess`. Set the flag to `false` and it scopes normally. `pupil`-role accounts are refused outright, ahead of any scoping. **Both policy toggles are now documented in `.env.example`** — they were previously absent, which made the most consequential privacy switch in the system undiscoverable for operators. |
| `GET /api/cards/alerts` | Yes | Calls `getGlobalAccess(user)`, short-circuits an empty scope, filters by `global.classIds` |
| `GET /api/timeouts/history` | Yes | Calls `getGlobalAccess(user)`, short-circuits an empty scope, filters by `global.classIds`, `LIMIT 50` |
| `GET /api/timeouts/active` | Yes — **fixed 2026-10-09** | Scoped via `lib/lw-duty.ts`: duty teacher & school leadership get school-wide view; other teachers see only their assigned classes in SQL before `LIMIT 100`; filters `expires_at > NOW()`. |
| `GET /api/conferences/:classId/summary` | **Yes — fixed 2026-10-08** | See below. |

**Two of these were live defects and are now closed.**

1. **`GET /api/conferences/:classId/summary` read every class in the school.** The gate was
   `!access.canRead && !user.teacherId && user.role !== 'admin'` — a three-way `&&` whose second
   conjunct is false for *every* teacher, so it never refused anyone with a `teacherId`. Any
   teacher could read any class's full summary: every pupil, every behaviour card and its note,
   every other teacher's `comment` and `nextStep`, and every final rank. It was the only endpoint in
   the codebase using that shape; every sibling uses a plain `if (!access.canRead)`. Now gated by
   the extracted, unit-tested predicate `canReadConferenceSummary(user, access)` in
   `conferences.ts`, covered by `conferences.test.ts`. The route's own comment had claimed this was
   already fixed.

2. **`GET /api/backup/export-json` wrote no audit record.** The one action that can move the entire
   school record out of the system in a single request left only a pino line, which is precisely the
   history that does not survive an incident. It now writes a `FULL_DATA_EXPORTED` row carrying the
   actor and row counts — counts only, because copying pupil names into the one table every
   administrator can read would reproduce the exposure.

**Resolved (2026-10-09).** `/api/timeouts/active` and `/:id/resolve` are now unified under one shared authorization rule (`lib/lw-duty.ts`):

1. **Duty roster derived from timetable**: The on-duty teacher is resolved from `timetable_lessons` (class 999, period matching `currentPeriod()`). Duty teachers and school leadership receive unrestricted visibility of the active Lernwerkstatt board.
2. **Class-scoped for other teachers**: Teachers not on duty see only active timeouts for their own assigned classes, filtered in SQL before `LIMIT 100` (`($1::bool OR sc.id = ANY($2::int[]))`). Teachers with no classes receive `[]` immediately without querying. Pupils are refused with 403.
3. **Resolve parity**: Resolving an incident uses the identical predicate (`canActOnTimeout`), eliminating the previous 403 defect that prevented the on-duty supervisor from releasing pupils from other classes.
4. **LiveSync room 999 symmetry**: `getClassAccess(user, 999).canRead` is true for the duty teacher and leadership. `useLiveSync` supports room arrays (`[selectedClassId, 999]`), enabling live updates for the duty supervisor. Non-duty teachers attempting room 999 are safely ignored rather than disconnected.
5. **Release at the bell**: Timeouts receive an `expires_at` timestamp (end of current period, or end of next period if issued during a break; `null` outside school hours). A background sweeper (`lib/timeout-sweeper.ts`) auto-resolves expired timeouts with `resolved_by = null` and audit action `TIME_OUT_AUTO_RESOLVED`. The `/active` query additionally filters `(expires_at IS NULL OR expires_at > NOW())` to eliminate ghost entries across missed ticks. Auto-resolved timeouts continue to count toward milestone escalations (milestones 3, 6, 9...).

### Confirmed functional bug

`server/src/routes/classes.ts` filtered cards with `eq(behaviorCards.revokedAt, null)`.
Drizzle compiles that to `revoked_at = $1` bound to `NULL`, which in PostgreSQL is never
true — so the cards array was **always empty** and the green/yellow counters in
`BeobachtungsGrid.tsx` and `ClassOverview.tsx` always rendered 0.

Verified by compiling the query rather than assuming:

```
eq(col, null)  ->  where  = $1   [ null ]      # never matches
isNull(col)    ->  where  is null              # correct
```

Now uses `isNull()`. Cards filed by the admin (no `teacher_id`) were additionally dropped
by an `INNER JOIN teachers`; that is now a `LEFT JOIN`.

### Medium

| Issue | Fix |
|---|---|
| `authenticate` decorator typed `any`; every handler cast `request.user as {...}` | Typed `preHandler`, `request.authUser` populated in one place, `requireAuth()` helper |
| No rate limiting on login | `@fastify/rate-limit`, per-IP on login, per-user globally (so a school behind one NAT does not share a bucket) |
| JWT in `localStorage`, no CSP | httpOnly `SameSite=Strict` cookie; strict CSP; `X-Frame-Options: DENY`; `nosniff`; CSRF Origin check on state-changing requests |
| `POST /evaluations/batch-default` only broadcast a message and returned success — it **never wrote anything** | Now a transactional bulk upsert; returns the number of items written |
| `api.ts` `conferenceOverride()` posted to `/api/conferences/:id/override`, which does not exist | Repointed to the real `/vote` endpoint |
| Hardcoded dates (`2026-10-30`, `2026-11-03`) in route handlers, inconsistent local vs UTC | `SUBMISSION_DEADLINE` / `OFFICIAL_CONFERENCE_DATE` in config, both UTC |
| Rank thresholds (14/8) duplicated in two routes; seeded `grade_boundaries` read by nothing | Single implementation in `lib/ranking.ts`; seed derives its config from the same source |
| N+1 loops without transactions (`batch-items`, `vote-all`); application-side `version + 1` could lose-update against a WS write | Both wrapped in transactions; version increment now evaluated by Postgres |
| Round selection used `.where(isLocked=false).limit(1)` with no `ORDER BY` | Deterministic `ORDER BY created_at DESC` everywhere |
| New pupil IDs from `MAX(id)+1` — racy, and could collide with a future WebUntis import | Dedicated `pupil_id_seq` sequence starting at 9,000,000 |
| `@fastify/static` ≤10.1.1 path-traversal / route-guard bypass (high) | Upgraded to 10.1.5 |
| `fast-jwt` ≤6.2.3 — **critical** JWT auth bypass with an empty HMAC secret, plus cache confusion | Upgraded to `@fastify/jwt` 10.2.2, algorithm pinned to HS256 |
| `drizzle-orm` <0.45.2 — SQL injection via unescaped identifiers (high) | Upgraded to 0.45.3 |
| Log redaction absent — passwords and cookies could reach the log stream | `logger.redact` covers `authorization`, `cookie`, `set-cookie`, and password fields |
| No request body limit | `bodyLimit` configured |
| WS room unbounded; dead sockets leaked; relied on a global `WebSocket` class absent on Node 20 | Room cap, heartbeat reaper, hardcoded `WS_OPEN = 1` |
| `NaN` from route params reached SQL via `/timetable/teacher/:teacherId` | Strict `parseIdParam()`; that endpoint also scoped to self / shared classes / leadership |
| Unique-constraint gaps allowed duplicate evaluations and items under concurrent writes | Unique indexes on `(round, pupil, class, subject)`, `(evaluation, item)`, `(round, pupil)`, `(pupil, milestone)` |
| Missing indexes on hot lookup paths | Added for teaching assignments, cards, timeouts, timetable, final ranks |
| Security headers plugin was encapsulated, so its hooks applied to no routes | Wrapped in `fastify-plugin` to break encapsulation — caught by the header test |
| The leaked-credential check on `DATABASE_URL` was a plain substring scan, so a percent-encoded password (`%21` for `!`) slipped past it | `databaseUrl()` now also compares the percent-decoded parsed password; tests cover both the bypass and the non-bypass |
| Evaluation writes accepted `teacherId: 0` as a real actor, and `/reopen` skipped the actor check entirely | Shared `hasPersistedTeacherActor` predicate rejects non-positive/non-integer ids; `/reopen` now calls `requireEvaluationActor` like every other rating write; nullable actor columns collapse sentinels to `null` via `safeTeacherId` |
| `POST /submit` mapped *any* unrecognised `proposedStatus` to `Geselle`, silently downgrading a pupil | `resolveProposedRank` keeps an omitted rank as the neutral default but rejects a present-but-invalid one with 400 |
| A single-cell conflict with nothing to reconcile left the stale value on screen (WebSocket and HTTP batch alike) | Both paths now require a usable version before patching a cell, and otherwise request an authoritative class reload; a vanished item row is reported as an explicit version-`0` tombstone |
| Conference tallies counted uncast votes as agreement: "yes" was the class roster minus a counter an administrator typed | Tally removed entirely. Participation is measured from submitted evaluations (`submittedTeachers`/`eligibleTeachers`/`teachersMissing`) and the split shown is the hours-weighted one the code already computed. The `votesNo` stepper and its API field are gone |
| An administrator rating a pupil had no valid `teacher_id` — the column is `NOT NULL` — so the old code wrote the sentinel `0` | Migration `0002` creates one `active: false` teacher row per admin account in the reserved 9000000 range and links it, so attribution is truthful. Refuses to run if that range is occupied. Run [`PREFLIGHT-admin-actor.sql`](PREFLIGHT-admin-actor.sql) first |

---

## Known limitations

- **No TLS.** The app serves plain HTTP on the school LAN, as originally specified. The
  session cookie is `httpOnly` and `SameSite=Strict`, but the token still crosses the
  network in clear text and is interceptable by anyone on a switched network. Set
  `COOKIE_SECURE=true` and put it behind a TLS-terminating proxy when you can.
- ~~**No automated backup schedule.**~~ Resolved: hourly encrypted `pg_dump` to Google
  Drive with tiered retention, `cryptcheck` verification, a restore script, and a weekly
  unattended restore drill. See [`docs/BACKUP.md`](BACKUP.md). `README.md` §8 still
  references `python scratch/create_backup.py`, which does not exist — update or delete it.
- ~~**Restore is not implemented.**~~ Resolved: `restore-from-gdrive.sh` restores into a
  scratch database by default and refuses to overwrite the live database without
  `--force`.
- **Remaining npm advisories.** 4 moderate, all `esbuild` via `drizzle-kit` at build time.
  Production dependencies audit clean (`npm audit --omit=dev` → 0 vulnerabilities).
- **`PLAN.md` still describes the old stack** (React 18 / Fastify 4 / Node 20, shared
  default passwords). Update it or it will mislead the next reader.
- **CI workflow.** `.github/workflows/ci.yml` runs workspace typechecks, server/client tests,
  the PostgreSQL integration suite against a fresh restricted test database, Python SSH
  security tests, and the production build. Local PostgreSQL tests require the explicit
  `TEST_DATABASE_URL`; a local opt-out does not count as integration-test evidence.
- **Backup caveat: one destination.** One Drive folder holding every copy. A 3-2-1
  arrangement would want a second, independently encrypted target. The key also lives on
  the same host as the data, so a full compromise of LXC 115 exposes historical backups
  as well as live data.
- ~~**One bootstrap password for every seeded account.**~~ Seeded accounts still use the
  operator-supplied `INITIAL_USER_PASSWORD` and require a change at first login. The Konten
  panel's administrator reset (`POST /api/auth/admin/temporary-password`) now generates a
  fresh random one-time credential for each reset (`server/src/lib/temporary-credential.ts`)
  instead of reusing the legacy shared `smile2026` value; no flow produces `smile2026` any
  more. The reset revokes prior sessions and forces a password change before the account can
  mutate data. The generated value is shown once in the reset response and is deliberately
  never logged (nor copied to the clipboard by the UI), so the administrator must hand it to
  the user out of band.

### Open owner decisions

These are not code defects; each needs a decision from the school's owner before it can be
implemented honestly.

- **Conference quorum.** A rank can still be confirmed when most teachers have not voted.
  Whether that requires a quorum is school policy: if a teacher is ill, does that block the
  conference? Current behaviour is unchanged — confirmation is an administrative act, and
  the screen now states plainly how much input there was.
- **MED holding two logins.** MED gets school-wide authority through the headmaster
  short-name rule, and `users.role` is a single value, so MED cannot be both teacher and
  admin in one account. Whether the teacher login and the admin login should be merged
  into one identity changes what each sees, so it was left alone.

---

## Test coverage

The root `npm test` command runs the server and client workspaces (with `PORT` set). The latest
local-safe run reported **555 server tests passed, 27 PostgreSQL integration tests skipped, and
245 client tests passed** (2026-10-11); `server/src/docs/contract.test.ts` keeps every document
that quotes a total in agreement.

Run it as `npm test` from the repository root. There is no root vitest config, so invoking
`npx vitest` directly at the root collects both workspaces under the server's environment and
produces spurious failures — the workspace scripts are the only supported entry point. `python -m unittest discover -s scripts/test -p "test_*.py"` ran 2 SSH security tests.
Workspace typechecks and the production build also passed in that run.

A local run must either set `TEST_DATABASE_URL` (a throwaway, loopback, empty `smile_db_test`
with a restricted role) or set `SKIP_POSTGRES_INTEGRATION=true` explicitly. The guard rejects the
skipped run as evidence: the integration suite fails loudly rather than silently reporting green.

The 24 skipped tests are guarded PostgreSQL behavioral cases (including writes, session revocation,
and cleanup isolation). They were not run locally: Docker is unavailable, and the ignored scratch
database was intentionally not used. The CI workflow provisions a fresh restricted test database;
its zero-skip run remains the required proof for those cases. A local opt-out is not integration
evidence.

### Remaining verification limits

- Conference vote/co-teaching semantics, lock scope, rank aggregation, comment ownership, and
  post-deadline comment policy are product-gated in [`bugfix.md`](../bugfix.md); no outcome is
  inferred here.
- The administrator actor strategy is now implemented (placeholder `teachers` row per admin
  account, `active: false`, reserved id range), but **the production preflight has not been
  run** — nobody has executed [`PREFLIGHT-admin-actor.sql`](PREFLIGHT-admin-actor.sql) against
  the live database. Until its output is known, it is unknown whether any row already carries
  the `teacher_id = 0` sentinel. Migration `0002` refuses to run if the reserved id range is
  occupied, but the data question needs a human answer.
- The nullable `votes_yes`/`votes_no`/`total_voters` columns on `final_ranks` are left in
  place for reversibility. No code reads them, but a deployment still running older code
  would. Drop them once no deployment does.
- Every newly seeded teacher still shares the operator-supplied `INITIAL_USER_PASSWORD`
  (each is flagged `mustChangePassword`). The administrator reset issues a fresh random
  one-time credential per handover, so that shared seed password is now the only
  shared-password path left; it stays a risk until per-account bootstrap delivery exists.
- A conflict with no current version to reconcile (the item row disappeared, or no evaluation
  survived) now triggers an authoritative class reload on both the WebSocket and HTTP paths instead
  of leaving a stale cell on screen. The behaviour is unit-tested, but the resulting database state
  behind those paths is only exercised by the PostgreSQL suite.
- WebSocket sessions are rechecked before inbound actions and class broadcasts, but the database
  check and socket send are not held under a shared revocation lock. The cross-worker reset race
  still requires a concurrency test and an ordered revocation fence before claiming atomic delivery.
- Operator tasks (credential rotation, verified restore/archive relocation, TLS rollout, and live
  data preflight) were not performed.
