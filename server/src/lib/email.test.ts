import { describe, expect, it } from 'vitest';
import { buildRedCardEmail, isEmailConfigured, sendRedCardEmail } from './email.js';
import type { RedCardMessage } from './teams.js';

const message: RedCardMessage = {
  direction: 'issued',
  pupilName: 'Anna Muster',
  className: '3a',
  actorName: 'Lehrerin Beispiel (LBE)',
  source: 'Rote Karte',
  changes: [
    { subjectCode: 'D', from: 'Meister', to: 'Geselle' },
    { subjectCode: 'M', from: 'Geselle', to: 'Lehrling' },
  ],
  occurredAt: new Date('2026-11-03T10:00:00Z'),
};

describe('buildRedCardEmail', () => {
  it('contains the full name, class, cause and rank changes', () => {
    const mail = buildRedCardEmail(message);

    expect(mail.subject).toContain('Anna Muster');
    expect(mail.subject).toContain('3a');
    expect(mail.text).toContain('Schüler*in: Anna Muster');
    expect(mail.text).toContain('Klasse: 3a');
    expect(mail.text).toContain('Quelle: Rote Karte');
    expect(mail.text).toContain('D (Deutsch): Meister → Geselle');
    expect(mail.text).toContain('M (Mathematik): Geselle → Lehrling');
    expect(mail.html).toContain('Rote Karte – Rangverlust');
  });

  it('uses the restore wording after a revoke', () => {
    const mail = buildRedCardEmail({ ...message, direction: 'revoked' });

    expect(mail.subject).toContain('Rang wiederhergestellt');
    expect(mail.text).toContain('Zurückgezogen von: Lehrerin Beispiel (LBE)');
    expect(mail.html).toContain('Rang wiederhergestellt');
  });

  it('never includes the red-card note and escapes HTML in names', () => {
    const mail = buildRedCardEmail({
      ...message,
      pupilName: '<script>alert(1)</script>',
      source: 'Rote Karte',
    });

    expect(mail.text).not.toContain('Vorfall');
    expect(mail.text).not.toContain('note');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('sendRedCardEmail', () => {
  it('is disabled when no SMTP credentials and recipient are configured', async () => {
    expect(isEmailConfigured()).toBe(false);
    await expect(sendRedCardEmail(message, ['test@example.test'])).resolves.toBe(false);
  });
});
