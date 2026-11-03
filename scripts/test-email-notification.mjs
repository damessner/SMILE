#!/usr/bin/env node
/**
 * Send one test rank-change e-mail through the configured SMTP account.
 *
 * Usage (on the SMILE host, as the service user):
 *   sudo -u smile node /opt/smile/scripts/test-email-notification.mjs
 *   sudo -u smile node /opt/smile/scripts/test-email-notification.mjs da.messner@tsn.at
 *
 * With an explicit address, NOTIFICATION_EMAIL_TO is not required. SMTP host,
 * user, password and from still come from the normal SMILE environment file.
 * This does not touch pupil data.
 */
import { sendRedCardEmail } from '../server/dist/lib/email.js';

const recipient = process.argv[2]?.trim();
const message = {
  direction: 'issued',
  pupilName: 'Test Schüler*in',
  className: 'Testklasse',
  actorName: 'SMILE Test',
  source: 'Testnachricht',
  rankChange: { from: 'Geselle', to: 'Lehrling' },
  retroactive: false,
  note: 'Dies ist eine Testnotiz der Lehrkraft.',
  occurredAt: new Date(),
};

const sent = await sendRedCardEmail(message, recipient ? [recipient] : undefined);
if (!sent) {
  console.error(
    'Test e-mail was not sent. Check SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM and NOTIFICATION_EMAIL_TO in /opt/smile-shared/.env.',
  );
  process.exit(1);
}
console.log(`Test e-mail sent${recipient ? ` to ${recipient}` : ''}.`);
