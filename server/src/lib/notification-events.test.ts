import { describe, expect, it } from 'vitest';
import { buildEventEmail } from './notification-events.js';

const base = {
  classId: 3,
  pupilName: 'Anna Muster',
  teacherId: 42,
  note: 'Störte den Unterricht trotz Ermahnung.',
  occurredAt: new Date('2026-11-03T10:00:00Z'),
};

describe('buildEventEmail', () => {
  it.each([
    ['green', 'Grüne Karte'],
    ['yellow', 'Gelbe Karte'],
    ['red', 'Rote Karte'],
    ['timeout', 'Time-Out'],
    ['cooldown', 'Cool-Down'],
  ] as const)('labels a %s event as %s', (type, label) => {
    const mail = buildEventEmail({ ...base, type }, '3a', 'Lehrerin Beispiel (LBE)');

    expect(mail.subject).toContain(label);
    expect(mail.subject).toContain('Anna Muster');
    expect(mail.subject).toContain('3a');
    expect(mail.text).toContain(
      `Anna Muster (3a) · ${label} · Lehrerin Beispiel (LBE)`,
    );
    expect(mail.text).toContain('Störte den Unterricht trotz Ermahnung.');
    expect(mail.html).not.toContain('<table');
  });

  it('escapes HTML in names and notes', () => {
    const mail = buildEventEmail(
      { ...base, type: 'red', pupilName: '<script>x</script>', note: '<b>fett</b>' },
      '3a',
      'LBE',
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('<b>fett</b>');
    expect(mail.html).toContain('&lt;b&gt;fett&lt;/b&gt;');
  });

  it('falls back when there is no note', () => {
    const mail = buildEventEmail({ ...base, type: 'green', note: null }, '3a', 'LBE');
    expect(mail.text).toContain('Keine Notiz hinterlegt.');
  });
});
