import { describe, expect, it, vi, beforeEach } from 'vitest';
import { config } from '../../config.js';
import { WebUntisClient, normalizeWebUntisHost, parseDateOnly, toUntisDateInt } from './client.js';
import { classregText, queueWebUntisClassregCorrection, queueWebUntisClassregEvent } from './sync.js';
import { isWebUntisError } from './errors.js';

const enqueued = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('./outbox.js', () => ({
  enqueueWebUntisOutbox: vi.fn(async (input: Record<string, unknown>) => {
    enqueued.push(input);
  }),
}));

describe('WebUntis client configuration', () => {
  it('defaults to production and can be switched for the connect wizard', () => {
    const client = new WebUntisClient();
    expect(client.getEnvironment()).toBe('production');
    expect(client.getConfig().server).toBe('ms-telfs.webuntis.com');
    expect(client.getConfig().school).toBe('ms-telfs');

    client.setEnvironment('playground');
    expect(client.getEnvironment()).toBe('playground');
    expect(client.getConfig().server).toBe('playground.webuntis.com');
    expect(client.getConfig().school).toBe('PG6ef0f7d3-abdf-49b5-ab74-044ef932d877');

    client.setEnvironment('production');
    expect(client.getEnvironment()).toBe('production');
  });

  it('never substitutes the service password for a personal account', () => {
    const personal = new WebUntisClient({
      server: 'ms-telfs.webuntis.com',
      school: 'ms-telfs',
      user: 'OFJ',
    });
    expect(personal.getConfig().password).toBe('');
    expect(personal.getConfig().serviceAccount).toBe(false);
  });

  it('gives the shared service client the configured credentials', () => {
    const originalPassword = config.webuntis.password;
    try {
      (config.webuntis as { password: string }).password = 'service-secret';
      const service = new WebUntisClient({ serviceAccount: true });
      const cfg = service.getConfig();
      expect(cfg.password).toBe('service-secret');
      expect(cfg.user).toBe(config.webuntis.user);
      expect(cfg.serviceAccount).toBe(true);
    } finally {
      (config.webuntis as { password: string }).password = originalPassword;
    }
  });
});

describe('WebUntis date handling', () => {
  it('parses a date-only value at local noon to avoid UTC off-by-one', () => {
    const parsed = parseDateOnly('2026-11-05');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(10);
    expect(parsed!.getDate()).toBe(5);
    expect(parsed!.getHours()).toBe(12);
  });

  it('rejects impossible calendar dates', () => {
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('05.11.2026')).toBeNull();
  });

  it('converts date-only strings without a timezone round-trip', () => {
    expect(toUntisDateInt('2026-11-05')).toBe(20261105);
    expect(toUntisDateInt('20261105')).toBe(20261105);
  });

  it('throws instead of sending NaN to WebUntis', () => {
    expect(() => toUntisDateInt('not-a-date')).toThrow(RangeError);
  });
});

describe('WebUntis host allowlist', () => {
  it('accepts a configured WebUntis host', () => {
    expect(normalizeWebUntisHost('https://ms-telfs.webuntis.com/')).toBe('ms-telfs.webuntis.com');
    expect(normalizeWebUntisHost('playground.webuntis.com')).toBe('playground.webuntis.com');
  });

  it('rejects an arbitrary host used as an SSRF probe', () => {
    try {
      normalizeWebUntisHost('169.254.169.254');
      throw new Error('expected normalizeWebUntisHost to throw');
    } catch (err) {
      expect(isWebUntisError(err)).toBe(true);
      if (isWebUntisError(err)) expect(err.code).toBe('WEBUNTIS_HOST_NOT_ALLOWED');
    }
  });
});

describe('WebUntis class-register mirror', () => {
  beforeEach(() => {
    enqueued.length = 0;
  });

  it('renders the same text for cards and time-outs', () => {
    expect(classregText('yellow', 'Störung')).toBe('[Gelbe Karte] Störung');
    expect(classregText('red', null)).toBe('[Rote Karte - Rangverlust] Disziplinarischer Vorfall');
    expect(classregText('timeout', 'Arbeitsblatt')).toBe('[Time-Out] Arbeitsblatt');
  });

  it('enqueues a durable upsert with a stable idempotency key', async () => {
    queueWebUntisClassregEvent({
      pupilId: 101,
      classId: 430,
      type: 'yellow',
      note: 'Störung des Unterrichts',
      occurredAt: new Date(2026, 10, 5, 9, 35),
      teacherUserId: 'user-1',
      sourceId: 'card-1',
    });
    await Promise.resolve();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      userId: 'user-1',
      kind: 'classreg_upsert',
      idempotencyKey: 'classreg:upsert:card-1',
      payload: {
        pupilId: 101,
        classId: 430,
        eventKind: 'yellow',
        date: '2026-11-05',
        time: '09:35',
        categoryId: 2,
      },
    });
  });

  it('enqueues a compensating entry when a card is revoked', async () => {
    queueWebUntisClassregCorrection({
      pupilId: 101,
      classId: 430,
      type: 'red',
      note: 'Tätlicher Übergriff',
      teacherUserId: 'user-1',
      sourceId: 'card-1',
    });
    await Promise.resolve();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: 'classreg_correction',
      idempotencyKey: 'classreg:correction:card-1',
    });
    const payload = enqueued[0]!.payload as { text: string };
    expect(payload.text).toContain('[Korrektur]');
    expect(payload.text).toContain('[Rote Karte - Rangverlust]');
  });
});
