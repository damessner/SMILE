#!/usr/bin/env node
/**
 * Send one test card to the configured Teams staff-channel webhook.
 *
 * Usage (on the SMILE host, as the service user):
 *   sudo -u smile node /opt/smile/scripts/test-teams-webhook.mjs
 *
 * This does not touch pupil data. It reads TEAMS_WEBHOOK_URL from the normal
 * SMILE environment file and exits non-zero when sending is disabled or fails.
 */
import { buildRedCardCard, postTeamsCard } from '../server/dist/lib/teams.js';

const payload = buildRedCardCard({
  direction: 'issued',
  pupilName: 'Test Schüler*in',
  className: 'Testklasse',
  actorName: 'SMILE Test',
  source: 'Testnachricht',
  rankChange: { from: 'Geselle', to: 'Lehrling' },
  note: 'Dies ist eine Testnotiz der Lehrkraft.',
  occurredAt: new Date(),
});

const sent = await postTeamsCard(payload);
if (!sent) {
  console.error(
    'Teams test card was not sent. Check TEAMS_WEBHOOK_URL and TEAMS_NOTIFICATIONS_ENABLED in /opt/smile-shared/.env.',
  );
  process.exit(1);
}
console.log('Teams test card sent. Check the staff channel.');
