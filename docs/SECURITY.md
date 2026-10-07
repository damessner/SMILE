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

**One correction to the original item**: it named two archives, but there are currently **three**
in the root. `backup.zip` (31,863,901 bytes — roughly 79× the other two, so a different archive,
not another copy) is present as well. `verify-env.mjs` does **not** check for it, so it neither
causes the install failure nor appears in any automated guard. It is caught by `.gitignore`'s
`*.zip` rule and by nothing else. Its contents and retention status are unknown; treat it as
unreviewed and hold it to the same standard as the other two.

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
| School-wide data readable by any teacher (statistics, card alerts, timeout history) | **Mostly** scoped to the caller's classes via `getGlobalAccess()`; `/timeouts/escalations` restricted to school leadership. **Gap: `GET /api/timeouts/active` is not scoped** — see below |
| `head_teacher` (~20 accounts) could download a full database dump | Backup export restricted to `admin`; audit log no longer truncated to 500 rows |
| KV matching used `field.includes(shortName)` — substring false positives granted homeroom rights | `kvFieldMatches()` with exact / parenthesised-code / separator / trailing-token matching. Covered by tests |
| Schema drift: `seed.ts` never created `timeout_incidents`, `timeout_escalations`, `timetable_lessons`, or several used columns | Schema owned by generated Drizzle migrations; hand-written DDL deleted |
| Re-running the seed reset the admin password to the published default | Existing accounts are left untouched; only new ones are created |
| `cors: { origin: true, credentials: true }` reflected any Origin | Explicit allowlist, empty by default (same-origin) |

### Known gap: `GET /api/timeouts/active` is not scoped

The High table above used to claim that statistics, card alerts **and** timeout history were all
scoped to the caller's classes through `getGlobalAccess()`. Three of those four endpoint claims hold;
the fourth does not. Corrected here rather than deleted, because the gap is open work, not a
resolved fix:

| Endpoint | Scoped? | Evidence |
|---|---|---|
| `GET /api/statistics/overview` | Only when `STATISTICS_SCHOOL_WIDE=false` | The shipped default is **school-wide**: `config.ts:230` defaults `statisticsSchoolWide` to `true`, and `statistics.ts:54` then passes `classIds: null` (unrestricted) without ever calling `getGlobalAccess`. Set the flag to `false` and it scopes normally. `statistics.ts:49-51` refuses `pupil`-role accounts outright, ahead of any scoping. |
| `GET /api/cards/alerts` | Yes | `cards.ts:187` calls `getGlobalAccess(user)`, `:188` short-circuits an empty scope, `:211` filters by `global.classIds` |
| `GET /api/timeouts/history` | Yes | `timeouts.ts:232` calls `getGlobalAccess(user)`, `:233` short-circuits an empty scope, `:259` filters by `global.classIds`, and the query is `LIMIT 50` |
| `GET /api/timeouts/active` | **No** | `timeouts.ts:149-172` — no `getGlobalAccess` call, no class filter, no `LIMIT` |

Any authenticated account can therefore read every active timeout in the school: pupil name, class
name, reason for the timeout, and the colleague who issued it. There is a comment at
`timeouts.ts:145` arguing the visibility is deliberate, on the grounds that the Lernwerkstatt
supervisor may be any teacher on duty and the underlying data is inherently shared. That is a
product decision, but it was never scoped or limited, so it covers the pupil names in the LW list
as well — and the argument for open visibility does not extend to unbounded result size.

**`getGlobalAccess` alone is not a sufficient fix, and it would not narrow this endpoint.** Its
first branch (`guards.ts:166`) is

```ts
if (isAdmin || isHeadmaster || !user.teacherId) {
  return { isAdmin, isHeadmaster, teacherId: user.teacherId, classIds: null };
}
```

`classIds: null` means *unrestricted* (`guards.ts:157`), and the third disjunct fires for **any
account without a `teacherId`** — which is exactly a `pupil`-role account. So adding
`getGlobalAccess` narrows the endpoint for ordinary teachers and leaves it just as wide for pupil
logins. Note also that `guards.ts:268` is inside `getClassAccess`, a *per-class* resolver; it is not
the global scope resolver and does not apply here. The only explicit `role === 'pupil'` refusal
anywhere in the statistics path is `statistics.ts:49-51`, which this route does not have.

A real remediation therefore needs **all three**, in this order:

1. a `role === 'pupil'` guard, mirroring `statistics.ts:49-51`;
2. `getGlobalAccess` scoping for the remaining teacher accounts;
3. a `LIMIT` — `/timeouts/history` already applies one (:258).

Plus a test per step; none of the three is covered today. Tracked as item **B7** in
[`docs/superpowers/plans/2026-10-06-hardening-roadmap.md`](superpowers/plans/2026-10-06-hardening-roadmap.md),
whose "add `getGlobalAccess`, a `LIMIT`, and a test" summary is therefore incomplete for the same
reason — it omits step 1.

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
- **No CI.** The TypeScript suites run locally via `npm test`, which covers both workspaces (server
  and client); the backup shell scripts carry 54 tests over three suites run via
  `bash scripts/test/run-all.sh`. Neither is wired to CI.
- **Backup caveat: one destination.** One Drive folder holding every copy. A 3-2-1
  arrangement would want a second, independently encrypted target. The key also lives on
  the same host as the data, so a full compromise of LXC 115 exposes historical backups
  as well as live data.

---

## Test coverage

212 tests across 13 files, all passing. `npm test` at the repository root runs **both** workspaces
(`npm run test --workspaces`): 144 server tests over 10 files, 68 client tests over 3 files.

### Server — 144 tests, 10 files

| File | Covers |
|---|---|
| `src/config.test.ts` | Secret validation, including rejection of the leaked JWT secret and DB password |
| `src/lib/guards.test.ts` | `kvFieldMatches` (including the substring-match regression), `parseIdParam` strictness |
| `src/lib/access-rules.test.ts` | The statistics-visibility and conference-mode configuration surface, asserted against the route table and the env-derived config rather than hardcoded values; plus a structural assertion that `role === 'pupil'` is refused |
| `src/lib/ranking.test.ts` | Rating classification, rank thresholds, red-card demotion, rating aggregation |
| `src/lib/behavior-stages.test.ts` | The `BEHAVIOR_STAGES` definitions and `computePupilBehaviorStage` |
| `src/lib/rubric.test.ts` | `buildRubricIndex`, `resolveCriterionId`, `isValidRating`, and `validateBatchItems` — including rejection of forged item keys and derivation of `criterionId` server-side |
| `src/utils/subject.test.ts` | `normalizeSubject` across every canonical code, the legacy aliases, and the unknown-input fallback |
| `src/ws/auth.test.ts` | End-to-end: the WebSocket upgrade is refused with 401 for missing, malformed, forged, and empty cookies |
| `src/ws/live-sync.test.ts` | Subscribe authorization for admin / unassigned / forged / no-teacherId cases, plus structural assertions that identity is never read from the payload |
| `src/index.test.ts` | Every pupil-data endpoint rejects unauthenticated requests, security headers present, CSRF Origin check, dead route removed |

### Client — 68 tests, 3 files

Run under jsdom with Testing Library. These render the real components, so a regression in the grid
fails the build rather than waiting to be found in a lesson.

| File | Covers |
|---|---|
| `src/test/harness.test.tsx` | The harness itself: a jsdom render with jest-dom matchers, and a component consuming both `useToast()` and `useConfirm()` under their providers |
| `src/lib/pupilItems.test.ts` | `isSubjectMatch`, `findItemForSubjects`, `itemVersionForSubject`, `hasSubmittedForSubject`, `isPupilFullySubmitted` — the subject-scoping guarantees of Invariants 4 and 5 |
| `src/components/BeobachtungsGrid.test.tsx` | Subject-scoped `isSubmitted`, the no-cross-subject-fallback lookup, and the conference-comment autosave flush |

The WebSocket and route-protection tests exercise real HTTP requests through
`app.inject()` and a live listener rather than asserting on source text alone.

### Not covered

Two live defects recorded in [`IF_YOU_ARE_AN_AI.md`](../IF_YOU_ARE_AN_AI.md) have **no test that
would fail on them**, and would not fail here today:

- `GET /api/timeouts/active` is unscoped (above). No test asserts it *is* scoped, so adding the
  `getGlobalAccess` scoping would not be caught by a regression.
- `TIMEOUT_ISSUED` and `FINAL_RANK_CONFIRMED` are dropped by the client's `switch` (Invariant 3).
  No test pairs a server-emitted `type` against the client's `case` labels, so a rename on one side
  alone stays invisible.