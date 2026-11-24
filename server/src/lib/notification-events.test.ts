import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, selectResults, configState } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async (_mail: { to: string[]; subject: string; text: string; html: string }) => true),
  selectResults: { queue: [] as unknown[][] },
  configState: {
    leadershipTo: ['slc@ms-telfs.at', 'med@ms-telfs.at'],
  },
}));

function nextSelectResult() {
  return selectResults.queue.shift() ?? [];
}

function makeSelectChain() {
  const result = nextSelectResult();
  const chain: any = Promise.resolve(result);
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  return chain;
}

vi.mock('../config.js', () => ({
  config: {
    teams: { appUrl: 'https://smile.example.test' },
    email: {
      get leadershipTo() {
        return configState.leadershipTo;
      },
    },
  },
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
  },
}));

vi.mock('./email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./email.js')>();
  return {
    ...actual,
    isSmtpConfigured: () => true,
    sendMail: sendMailMock,
  };
});

import {
  buildEventEmail,
  buildTimeoutEscalationEmail,
  queueClassEventNotification,
  queueTimeoutEscalationNotification,
} from './notification-events.js';

const base = {
  classId: 3,
  pupilName: 'Anna Muster',
  teacherId: 42,
  note: 'Störte den Unterricht trotz Ermahnung.',
  occurredAt: new Date('2026-11-03T10:00:00Z'),
};

const sampleHistory = [
  {
    sentAt: new Date('2026-11-24T09:15:00Z'),
    teacherName: 'Max Mustermann',
    taskAssignment: 'Aufgabe fertigstellen',
    retroactive: false,
  },
  {
    sentAt: new Date('2026-11-10T08:05:00Z'),
    teacherName: 'Anna Beispiel',
    taskAssignment: 'Nachtrag: Störung',
    retroactive: true,
  },
  {
    sentAt: new Date('2026-10-15T10:30:00Z'),
    teacherName: 'Peter Huber',
    taskAssignment: 'Wiederholtes Stören',
    retroactive: false,
  },
];

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

  it('includes total count and chronological entries when timeout history is passed', () => {
    const mail = buildEventEmail(
      { ...base, type: 'timeout', pupilId: 99 },
      '3a',
      'Max Mustermann',
      sampleHistory,
    );

    expect(mail.text).toContain('Time-Outs insgesamt: 3');
    expect(mail.text).toContain('Time-Out-Verlauf:');
    expect(mail.text).toContain('#3 · ');
    expect(mail.text).toContain('Max Mustermann — Aufgabe fertigstellen');
    expect(mail.text).toContain('#2 · ');
    expect(mail.text).toContain('(Nachtrag) · Anna Beispiel — Nachtrag: Störung');
    expect(mail.text).toContain('#1 · ');
    expect(mail.text).toContain('Peter Huber — Wiederholtes Stören');
    expect(mail.html).toContain('Time-Outs insgesamt: 3');
    expect(mail.html).toContain('<strong>#3</strong>');
    expect(mail.html).not.toContain('<table');
  });

  it('does not attach timeout history to cooldown event mails', () => {
    const mail = buildEventEmail(
      { ...base, type: 'cooldown', pupilId: 99 },
      '3a',
      'Max Mustermann',
      sampleHistory,
    );

    expect(mail.text).not.toContain('Time-Outs insgesamt:');
    expect(mail.html).not.toContain('Time-Out-Verlauf:');
  });
});

describe('buildTimeoutEscalationEmail', () => {
  it('includes total count, dates, teachers, and escaped history notes', () => {
    const mail = buildTimeoutEscalationEmail(
      {
        classId: 3,
        pupilId: 99,
        pupilName: 'Anna Muster',
        teacherId: 42,
        totalTimeouts: 3,
        note: 'Aufgabe fertigstellen',
        occurredAt: new Date('2026-11-24T09:15:00Z'),
      },
      '3a',
      'Max Mustermann',
      [
        ...sampleHistory.slice(0, 2),
        {
          sentAt: new Date('2026-10-15T10:30:00Z'),
          teacherName: 'Peter <Huber>',
          taskAssignment: '<b>Störung</b>',
          retroactive: false,
        },
      ],
    );

    expect(mail.subject).toContain('Time-Out-Eskalation (3)');
    expect(mail.text).toContain('Time-Outs insgesamt: 3');
    expect(mail.text).toContain('#3 · ');
    expect(mail.text).toContain('#2 · ');
    expect(mail.text).toContain('#1 · ');
    expect(mail.html).toContain('Peter &lt;Huber&gt;');
    expect(mail.html).toContain('&lt;b&gt;Störung&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Störung</b>');
  });
});

describe('queue notification delivery with timeout history', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    selectResults.queue = [];
    configState.leadershipTo = ['slc@ms-telfs.at', 'med@ms-telfs.at'];
  });

  it('sends timeout history to SLC/MED escalation recipients', async () => {
    selectResults.queue = [
      [{ name: '3a' }], // 1. resolveNames: schoolClasses
      sampleHistory.map((h) => ({
        sentAt: h.sentAt,
        teacherFullName: h.teacherName,
        taskAssignment: h.taskAssignment,
        retroactive: h.retroactive,
      })), // 2. loadTimeoutHistory (starts synchronously inside Promise.all)
      [{ fullName: 'Max Mustermann' }], // 3. resolveNames: teachers (after await schoolClasses)
    ];

    queueTimeoutEscalationNotification({
      classId: 3,
      pupilId: 99,
      pupilName: 'Anna Muster',
      teacherId: 42,
      totalTimeouts: 3,
      note: 'Aufgabe fertigstellen',
      occurredAt: new Date('2026-11-24T09:15:00Z'),
    });

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
    const sent = sendMailMock.mock.calls[0][0];
    expect(sent.to).toEqual(['slc@ms-telfs.at', 'med@ms-telfs.at']);
    expect(sent.text).toContain('Time-Outs insgesamt: 3');
    expect(sent.text).toContain('#2 · ');
  });

  it('attaches timeout history for SLC/MED subscribers but omits it for regular teachers', async () => {
    selectResults.queue = [
      [
        { email: 'slc@ms-telfs.at', userRole: 'head_teacher', teacherShortName: 'SLC' },
        { email: 'lehrer@ms-telfs.at', userRole: 'teacher', teacherShortName: 'LBE' },
      ], // 1. subscription query
      [{ name: '3a' }], // 2. resolveNames: schoolClasses
      sampleHistory.map((h) => ({
        sentAt: h.sentAt,
        teacherFullName: h.teacherName,
        taskAssignment: h.taskAssignment,
        retroactive: h.retroactive,
      })), // 3. loadTimeoutHistory (starts synchronously inside Promise.all)
      [{ fullName: 'Max Mustermann' }], // 4. resolveNames: teachers
    ];

    queueClassEventNotification({
      type: 'timeout',
      classId: 3,
      pupilId: 99,
      pupilName: 'Anna Muster',
      teacherId: 42,
      note: 'Aufgabe fertigstellen',
      occurredAt: new Date('2026-11-24T09:15:00Z'),
    });

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(2));
    const calls = sendMailMock.mock.calls.map(([arg]) => arg);
    const slcMail = calls.find((c) => c.to[0] === 'slc@ms-telfs.at');
    const teacherMail = calls.find((c) => c.to[0] === 'lehrer@ms-telfs.at');

    expect(slcMail?.text).toContain('Time-Outs insgesamt: 3');
    expect(slcMail?.text).toContain('Time-Out-Verlauf:');
    expect(teacherMail?.text).not.toContain('Time-Outs insgesamt:');
  });
});
