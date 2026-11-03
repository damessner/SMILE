# Microsoft Teams staff-channel notifications

SMILE can post a message to a Microsoft Teams channel when a red card changes a
pupil's rank (demotion on issue, restoration when the last active red card is
revoked).

This uses a **Teams Workflow incoming webhook**, not Microsoft Graph:

- no Entra app registration,
- no Graph admin consent,
- no public callback endpoint on the SMILE server,
- works from the internal LXC over outbound HTTPS.

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
- affected subjects and the rank change, e.g. `D (Deutsch): Meister → Geselle`,
- a link to SMILE.

The red-card note / incident description is **not** sent.

No message is sent when the effective rank does not change (for example a red
card for a pupil who is already `Lehrling` in every rated subject, or a second
red card while one is already active).

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

8. Issue and revoke a red card for a test pupil, or watch the journal:

   ```bash
   journalctl -u smile.service -f | grep '\[teams\]'
   ```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TEAMS_WEBHOOK_URL` | empty | Workflow webhook URL. Empty disables sending. |
| `TEAMS_NOTIFICATIONS_ENABLED` | `true` | Set `false` to stop sending without removing the URL. |
| `PUBLIC_APP_URL` | `https://172.16.1.11` | Target of the card's “In SMILE öffnen” action. |

## Failure behaviour

Delivery is queued after the card transaction commits and is never awaited by
the card request. A Teams outage or a revoked webhook cannot make a red card
fail to save. Failures are logged as `[teams] ...` without the URL or pupil
data, and are best-effort only (no retry queue).

## Data protection

The message leaves the school's SMILE server and is stored in the Microsoft 365
tenant. The school's M365/Teams data-protection approval must cover staff-channel
messages containing pupil names. Keep the channel membership restricted to
staff and review it at the start of each school year.
