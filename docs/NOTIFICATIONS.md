# E-mail notification subscriptions

Teachers can build their own e-mail notification profile from the **bell icon**
in the SMILE header. Settings are stored per user; the address is entered once
and used for every selected class.

## What can be selected

For each class, independently:

- Grüne Karte
- Gelbe Karte
- Rote Karte
- Time-Out
- Cool-Down
- Wochenübersicht (weekly digest)

A teacher can select any class, not only classes they teach. This is a school
decision: any staff account may subscribe to any class.

There is **no address-confirmation e-mail** (also a school decision). The UI
therefore warns that messages contain pupil names, class and the teacher's note,
and that the address must be entered carefully.

## Event mails

Immediately after a card or time-out is saved, SMILE sends one mail per
subscriber whose class/event selection matches:

- direct green/yellow/red card → that card type,
- disciplinary time-out → `Time-Out` (not additionally `Rote Karte`),
- cool-down → `Cool-Down`.

The message contains:

- pupil full name,
- class,
- event type,
- issuing teacher,
- timestamp,
- the note / task assignment entered by the teacher,
- a link to SMILE.

No notes are sent for the weekly digest; it contains counts only.

## Weekly digest

The digest is sent on the first scheduler tick at/after **Monday 07:00
Europe/Vienna** for the previous week. It is one mail per selected class and
contains, per pupil:

- green, yellow, red, time-out and cool-down counts,
- a total line.

A teacher who enables the digest on Monday after 07:00 starts with the following
week. A unique `notification_digest_log` row prevents a restart from sending the
same week twice.

## Mandatory MED/SLC escalation mail

Independent of subscriptions, MED and SLC receive a mail whenever a pupil
reaches a 3/6/9/... time-out milestone. Configure their addresses in
`/opt/smile-shared/.env`:

```bash
LEADERSHIP_NOTIFICATION_EMAILS="med@example.org,slc@example.org"
```

This mail contains pupil, class, total time-out count, teacher and the current
task assignment. Cool-Downs do not count toward the milestone.

## SMTP

Subscriptions use the same SMTP account as the existing red-card rank-loss mail:

```bash
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST="smtp.office365.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="smile@ms-telfs.at"
SMTP_PASSWORD="..."
SMTP_FROM="SMILE <smile@ms-telfs.at>"
```

`NOTIFICATION_EMAIL_TO` is only for the older fixed-recipient red-card rank-loss
mail. Subscription mails use the address stored per teacher and do not require
`NOTIFICATION_EMAIL_TO`.

## Data model

- `notification_preferences` — one row per user, contains the e-mail address.
- `notification_subscriptions` — one row per user+class, six booleans.
- `notification_digest_log` — one row per sent user+class+week.

## Privacy

Because any staff member can subscribe to any class, a subscription mail can
contain another class's pupil names and notes. This is intentional per school
decision, but the staff channel/list must remain restricted to school staff.
Review subscriptions and the SMTP account at the start of each school year.
