import { describe, expect, it } from 'vitest';
import { buildRedCardEmail, isEmailConfigured, sendRedCardEmail } from './email.js';
import { SMILE_LOGO_CID, SMILE_LOGO_PNG } from './email-logo.js';
import type { RedCardMessage } from './teams.js';

const message: RedCardMessage = {
  direction: 'issued',
  pupilName: 'Anna Muster',
  className: '3a',
  actorName: 'Lehrerin Beispiel (LBE)',
  source: 'Rote Karte',
  rankChange: { from: 'Geselle', to: 'Lehrling' },
  retroactive: false,
  note: 'Störte den Unterricht trotz Ermahnung.',
  occurredAt: new Date('2026-11-03T10:00:00Z'),
};

describe('buildRedCardEmail', () => {
  it('contains the full name, class, pupil-level rank and the note', () => {
    const mail = buildRedCardEmail(message);

    expect(mail.subject).toBe('Schüler Anna Muster (3a) Geselle ---> Lehrling');
    expect(mail.text).toContain(
      'Anna Muster (3a) Geselle ---> Lehrling · Rote Karte · Lehrerin Beispiel (LBE)',
    );
    expect(mail.text).toContain('Störte den Unterricht trotz Ermahnung.');
    expect(mail.html).toContain('Anna Muster (3a)');
    expect(mail.html).toContain('Geselle ---&gt; Lehrling');
    expect(mail.html).toContain(`cid:${SMILE_LOGO_CID}`);
    expect(SMILE_LOGO_PNG.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(mail.html).not.toContain('<table');
  });

  it('does not enumerate subjects', () => {
    const mail = buildRedCardEmail(message);
    expect(mail.text).not.toContain('Deutsch');
    expect(mail.text).not.toContain('Mathematik');
    expect(mail.text).not.toContain('D (');
  });

  it('uses the restore wording after a revoke', () => {
    const mail = buildRedCardEmail({
      ...message,
      direction: 'revoked',
      rankChange: { from: 'Lehrling', to: 'Geselle' },
      retroactive: false,
    });

    expect(mail.subject).toBe('Schüler Anna Muster (3a) Lehrling ---> Geselle');
    expect(mail.text).toContain(
      'Anna Muster (3a) Lehrling ---> Geselle · Rote Karte zurückgezogen',
    );
  });

  it('uses the yellow-card source label for 3-yellow rank changes', () => {
    const mail = buildRedCardEmail({
      ...message,
      source: '3 Gelbe Karten',
      rankChange: { from: 'Meister', to: 'Geselle' },
    });

    expect(mail.subject).toBe('Schüler Anna Muster (3a) Meister ---> Geselle');
    expect(mail.text).toContain(
      'Anna Muster (3a) Meister ---> Geselle · 3 Gelbe Karten · Lehrerin Beispiel (LBE)',
    );
  });

  it('escapes HTML in names and notes, and falls back when no note exists', () => {
    const mail = buildRedCardEmail({
      ...message,
      pupilName: '<script>alert(1)</script>',
      note: '<b>fett</b>',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('<b>fett</b>');
    expect(mail.html).toContain('&lt;b&gt;fett&lt;/b&gt;');

    const noNote = buildRedCardEmail({ ...message, note: null });
    expect(noNote.text).toContain('Keine Notiz hinterlegt.');
  });
});

describe('sendRedCardEmail', () => {
  it('is disabled when no SMTP credentials and recipient are configured', async () => {
    expect(isEmailConfigured()).toBe(false);
    await expect(sendRedCardEmail(message, ['test@example.test'])).resolves.toBe(false);
  });
});
