import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRedCardCard,
  postTeamsCard,
  rankChangeFromSuggestion,
  type RedCardMessage,
} from './teams.js';

describe('rankChangeFromSuggestion', () => {
  it('demotes a Geselle to Lehrling and a Meister to Geselle', () => {
    expect(rankChangeFromSuggestion('Geselle', false, true)).toEqual({
      from: 'Geselle',
      to: 'Lehrling',
    });
    expect(rankChangeFromSuggestion('Meister', false, true)).toEqual({
      from: 'Meister',
      to: 'Geselle',
    });
  });

  it('restores the rank when the last red card is revoked', () => {
    expect(rankChangeFromSuggestion('Geselle', true, false)).toEqual({
      from: 'Lehrling',
      to: 'Geselle',
    });
  });

  it('sends nothing for a Lehrling or an unchanged red-card state', () => {
    expect(rankChangeFromSuggestion('Lehrling', false, true)).toBeNull();
    expect(rankChangeFromSuggestion('Geselle', true, true)).toBeNull();
    expect(rankChangeFromSuggestion(null, false, true)).toBeNull();
  });
});

describe('buildRedCardCard', () => {
  const message: RedCardMessage = {
    direction: 'issued',
    pupilName: 'Anna Muster',
    className: '3a',
    actorName: 'Lehrerin Beispiel (LBE)',
    source: 'Rote Karte',
    rankChange: { from: 'Geselle', to: 'Lehrling' },
    note: 'Störte den Unterricht trotz Ermahnung.',
    occurredAt: new Date('2026-11-03T10:00:00Z'),
  };

  it('carries the pupil-level rank change and the teacher note', () => {
    const payload = buildRedCardCard(message);
    const content = payload.attachments[0]!.content as any;

    expect(content.type).toBe('AdaptiveCard');
    expect(content.body[0].text).toBe('Rote Karte – Rangverlust');
    expect(content.body[0].color).toBe('Attention');

    const facts = content.body[1].facts as Array<{ title: string; value: string }>;
    expect(facts).toContainEqual({ title: 'Schüler*in', value: 'Anna Muster' });
    expect(facts).toContainEqual({ title: 'Klasse', value: '3a' });
    expect(facts).toContainEqual({ title: 'Quelle', value: 'Rote Karte' });
    expect(facts).toContainEqual({
      title: 'Ausgestellt von',
      value: 'Lehrerin Beispiel (LBE)',
    });
    expect(facts).toContainEqual({ title: 'Rang', value: 'Geselle → Lehrling' });

    expect(content.body[2].text).toBe('Notiz der Lehrkraft');
    expect(content.body[3].text).toBe('Störte den Unterricht trotz Ermahnung.');
  });

  it('never lists a subject code in the rank change', () => {
    const payload = JSON.stringify(buildRedCardCard(message));
    expect(payload).not.toContain('Deutsch');
    expect(payload).not.toContain('Mathematik');
    expect(payload).not.toContain('D (');
  });

  it('uses a positive title and colour when the rank is restored', () => {
    const payload = buildRedCardCard({ ...message, direction: 'revoked' });
    const content = payload.attachments[0]!.content as any;

    expect(content.body[0].text).toBe(
      'Rote Karte zurückgezogen – Rang wiederhergestellt',
    );
    expect(content.body[0].color).toBe('Good');
    expect(content.body[1].facts).toContainEqual({
      title: 'Zurückgezogen von',
      value: 'Lehrerin Beispiel (LBE)',
    });
  });

  it('falls back when no note was entered', () => {
    const payload = buildRedCardCard({ ...message, note: null });
    const content = payload.attachments[0]!.content as any;
    expect(content.body[3].text).toBe('Keine Notiz hinterlegt.');
  });
});

describe('postTeamsCard', () => {
  afterEach(() => vi.restoreAllMocks());

  const message: RedCardMessage = {
    direction: 'issued',
    pupilName: 'Anna Muster',
    className: '3a',
    actorName: 'LBE',
    source: 'Rote Karte',
    rankChange: { from: 'Geselle', to: 'Lehrling' },
    note: 'Testnotiz',
    occurredAt: new Date('2026-11-03T10:00:00Z'),
  };

  it('posts the Adaptive Card envelope to the webhook', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));

    await expect(
      postTeamsCard(buildRedCardCard(message), 'https://example.test/webhook'),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.test/webhook');
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(String(init?.body));
    expect(sent.type).toBe('message');
    expect(sent.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });

  it('returns false instead of throwing when Teams rejects the card', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      postTeamsCard(buildRedCardCard(message), 'https://example.test/webhook'),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[teams] webhook rejected the card with HTTP 500',
    );
  });

  it('returns false instead of throwing when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      postTeamsCard(buildRedCardCard(message), 'https://example.test/webhook'),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('[teams] webhook delivery failed (TypeError)');
  });
});
