# Microsoft Teams staff-channel notifications

SMILE can post a message to a Microsoft Teams channel when a red card changes a
pupil's rank (demotion on issue, restoration when the last active red card is
revoked).

Two transports are available:

1. **Teams Workflow incoming webhook** — recommended.
2. **SMTP e-mail** — fallback for tenants where Workflows is blocked; can send
   to a staff list or to a Teams channel e-mail address.

Neither uses Microsoft Graph:

- no Entra app registration,
- no Graph admin consent,
- no public callback endpoint on the SMILE server,
- works from the internal LXC over outbound HTTPS (webhook) or SMTP port 587.

Microsoft Graph is deliberately not used: normal chat/channel messages require
delegated Graph permissions, and app-only Graph messaging is migration-only.
A webhook is the supported path for one-way channel notifications.

## What is sent

For a rank-changing red card:

- pupil full name,
- class,
- source (`Rote Karte` or `Time-Out`),
- issuing or revoking teacher,
- timestamp,
- the pupil-level rank change, e.g. `Geselle → Lehrling`,
- the note / incident description the teacher entered on the red card,
- a link to SMILE.

Ranks are pupil-level, never per subject. No message is sent when the effective
pupil rank does not change (for example a red card for a pupil who is already
`Lehrling`, or a second red card while one is already active).

## Admin setup

1. Create a **private staff channel** in Teams, for example
   `SMILE – Meldungen`. Add only teachers and school leadership. Do not add
   pupils or parent accounts.
2. Open the channel and choose **Workflows** (channel `...` menu or the
   Workflows app).
3. Search for the template **“Send webhook alerts to a channel”**.
4. Select the team and the staff channel, then **Save**.
5. Open the workflow details and copy the **webhook URL**.
6. Put the URL on the SMILE server in `/opt/smile-shared/.env`:

   ```bash
   TEAMS_WEBHOOK_URL="https://..."
   TEAMS_NOTIFICATIONS_ENABLED=true
   PUBLIC_APP_URL="https://172.16.1.11"
   ```

   The file must stay mode `600` and owned by the `smile` service user. The URL
   is a bearer secret; do not commit it, paste it into a ticket, or log it.

7. Restart the service:

   ```bash
   systemctl restart smile.service
   ```

8. Issue and revoke a red card for a test pupil, or send one test card that does
   not touch pupil data:

   ```bash
   sudo -u smile node /opt/smile/scripts/test-teams-webhook.mjs
   ```

   Watch the journal for delivery errors:

   ```bash
   journalctl -u smile.service -f | grep '\[teams\]'
   ```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TEAMS_WEBHOOK_URL` | empty | Workflow webhook URL. Empty disables sending. |
| `TEAMS_NOTIFICATIONS_ENABLED` | `true` | Set `false` to stop sending without removing the URL. |
| `PUBLIC_APP_URL` | `https://172.16.1.11` | Target of the card's “In SMILE öffnen” action. |

## E-mail fallback (SMTP)

If a Teams Workflow cannot be created, the same rank-change message can be sent
by e-mail instead. The recipient can be a staff distribution list or the e-mail
address of a Teams channel (channel `...` → **Get email address**), which turns
the mail into a channel post.

Configure `/opt/smile-shared/.env`:

```bash
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST="smtp.office365.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="smile@ms-telfs.at"
SMTP_PASSWORD="..."
SMTP_FROM="SMILE <smile@ms-telfs.at>"
NOTIFICATION_EMAIL_TO="staff-list@example.org"
```

`SMTP_SECURE=false` is correct for port 587 (STARTTLS). Use `true` only for
implicit TLS on port 465.

Then restart SMILE and send a test that does not touch pupil data:

```bash
sudo -u smile node /opt/smile/scripts/test-email-notification.mjs
```

To test one explicit address without changing `NOTIFICATION_EMAIL_TO`:

```bash
sudo -u smile node /opt/smile/scripts/test-email-notification.mjs name@example.org
```

The same red-card rules apply: full pupil name, class, source, teacher,
pupil-level rank change, and the teacher's note; no message when the rank does
not change.

## Failure behaviour

Delivery is queued after the card transaction commits and is never awaited by
the card request. A Teams outage, revoked webhook or SMTP failure cannot make a
red card fail to save. Failures are logged as `[teams]` or `[email]` without
secrets or pupil data, and are best-effort only (no retry queue).

## Data protection

The message leaves the school's SMILE server and is stored in the Microsoft 365
tenant. The school's M365/Teams data-protection approval must cover staff-channel
messages containing pupil names. Keep the channel membership restricted to
staff and review it at the start of each school year.
