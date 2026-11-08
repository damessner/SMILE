# WebUntis integration

SMILE reads timetables, absences and class-register entries from WebUntis and
writes two things back: lesson content (`Lehrstoff`) and class-register entries
for behaviour cards and Time-Outs.

The integration is optional. SMILE starts without it and reports the integration
as disconnected.

## Configuration

All settings live in `.env` (see `.env.example`). None of them have a built-in
password.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBUNTIS_ENV` | `production` | `production` or `playground`. Deploy-time only; not switchable in the UI. |
| `WEBUNTIS_SERVER` | `ms-telfs.webuntis.com` | Production host. |
| `WEBUNTIS_SCHOOL` | `ms-telfs` | WebUntis school identifier. |
| `WEBUNTIS_PLAYGROUND_SCHOOL` | MS-Telfs playground id | School id used when `WEBUNTIS_ENV=playground`. |
| `WEBUNTIS_USER` | `untis_monitor` | Shared **read-only** leadership account. |
| `WEBUNTIS_PASSWORD` | *(empty)* | Password for the shared account. Empty disables it. |
| `WEBUNTIS_CREDENTIAL_KEY` | *(empty)* | Dedicated key (min. 32 chars) for stored personal passwords. |
| `WEBUNTIS_ALLOWED_HOSTS` | `webuntis.com` | Comma-separated host allowlist for personal accounts. |
| `WEBUNTIS_TIMEOUT_MS` | `10000` | Outbound request timeout. |
| `WEBUNTIS_AUTO_SYNC_DISCIPLINARY` | `true` | Mirror cards/Time-Outs into the class register. |
| `WEBUNTIS_SYNC_INTERVAL_MS` | `30000` | Outbox worker interval. |
| `WEBUNTIS_SYNC_MAX_ATTEMPTS` | `8` | Retry budget per outbox entry. |
| `WEBUNTIS_SYNC_MAX_AGE_MS` | `604800000` | Give up on entries older than seven days. |

`WEBUNTIS_PASSWORD` previously had a hard-coded default that was committed to
source control. That value is now in `LEAKED_SECRETS` and the server refuses to
boot with it. Rotate the account in WebUntis before deploying.

### Credential encryption

Personal WebUntis passwords are encrypted with AES-256-GCM. With
`WEBUNTIS_CREDENTIAL_KEY` set, the key is derived from that value (HKDF). Without
it, the key is derived from `JWT_SECRET` for backwards compatibility — rotating
`JWT_SECRET` then makes stored credentials unreadable. At boot the server
re-encrypts legacy rows with the dedicated key, so switching the key does not
force every teacher to reconnect.

## Identity model

- **Personal account (teachers).** A teacher links their own WebUntis account in
  the WebUntis view. The server verifies the credentials and requires the
  returned WebUntis `personId` to equal the caller's `teachers.id`
  (`personType === 2`, i.e. a teacher). Administrators are exempt because their
  accounts have no teacher binding.
- **Service account (leadership only).** The shared `untis_monitor` account is
  used **only** for read views when the caller is an administrator or a
  headmaster (SLC/MED). It is never used for a teacher, and never for a write.
  There is no silent fallback: a teacher without a linked account sees a
  "not connected" state.
- **Writes** always use the caller's personal account, so the WebUntis audit
  trail and SMILE's audit log name the same person.

## Authorization

Every WebUntis endpoint runs the same class-access matrix as the rest of SMILE:

- `canRead` for timetable, absences and class-register reads.
- `canRecord` for class-register writes and `Lehrstoff`.
- Teaching content additionally proves lesson ownership: the client is asked for
  the timetable of the given class on the given day and the `lessonId` must
  appear there. A lesson id is not a capability.
- `classId` query parameters are parsed strictly (`parsePositiveInt`), never with
  `Number()`/`parseInt`.
- Requests without a `classId` are expanded to the caller's class scope; a
  teacher never receives school-wide data.
- Only the class-register categories `2` (Verhalten) and `3` (Sonstiges), listed
  in `config.webuntis.allowedCategoryIds`, may be written.

## Error contract

`server/src/lib/webuntis/errors.ts` defines `WebUntisError` with stable codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `WEBUNTIS_NOT_CONNECTED` | 409 | No personal account linked. |
| `WEBUNTIS_AUTH_FAILED` | 502 | WebUntis rejected the credentials/session. |
| `WEBUNTIS_UNAVAILABLE` | 502 | Network, timeout or server error. |
| `WEBUNTIS_PERMISSION_DENIED` | 403 | The WebUntis account lacks the right. |
| `WEBUNTIS_INVALID_REQUEST` | 400 | Invalid date, category or payload. |
| `WEBUNTIS_HOST_NOT_ALLOWED` | 400 | Host outside the allowlist (SSRF guard). |

Reads throw instead of returning `[]`. An outage is therefore distinguishable
from a genuinely empty day, both in the API and in the UI.

## Outbox and retries

Class-register mirrors are written to `webuntis_sync_outbox` in the same request
and delivered by a background worker. This replaces the old `setImmediate`
dispatch, which lost the entry on the first network error and on every restart.

- Entries are claimed with a conditional `UPDATE ... WHERE status = 'pending'`,
  so two workers cannot write the same row.
- Retryable failures (network, timeout, session expiry) are retried with
  exponential backoff up to `WEBUNTIS_SYNC_MAX_ATTEMPTS` and
  `WEBUNTIS_SYNC_MAX_AGE_MS`.
- Permanent failures (missing account, invalid payload, permission denied) are
  marked `failed` and keep `last_error` for diagnosis.
- The rendered text, date and time are frozen when the entry is queued, so a
  retry cannot move a Monday incident to Wednesday.

WebUntis exposes no verified delete endpoint for class-register entries. When a
card is revoked, SMILE therefore writes a compensating `[Korrektur] …` entry that
names the original as withdrawn. Do not describe this as a deletion.

## Troubleshooting

- **"Kein persönliches WebUntis-Konto verknüpft"** — the teacher must connect
  their account; the shared account is not a fallback.
- **"Dieses WebUntis-Konto gehört nicht zu Ihrer Lehrkraft"** — the WebUntis
  login belongs to a different person. Use the teacher's own credentials.
- **"Der Server … ist nicht als WebUntis-Host freigegeben"** — add the host to
  `WEBUNTIS_ALLOWED_HOSTS` (exact host or `webuntis.com` suffix).
- **Stored credentials stopped working after a secret rotation** — set
  `WEBUNTIS_CREDENTIAL_KEY`, restart once so legacy rows are re-encrypted, and
  then rotate `JWT_SECRET`.
- **Outbox backlog** — inspect `webuntis_sync_outbox`:

  ```sql
  SELECT status, count(*) FROM webuntis_sync_outbox GROUP BY status;
  SELECT id, kind, attempts, last_error, next_attempt_at
    FROM webuntis_sync_outbox WHERE status = 'failed' ORDER BY updated_at DESC;
  ```
