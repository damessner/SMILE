import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBeforeAndAfterCards,
  buildRedCardCard,
  postTeamsCard,
  rankChangeFromSuggestion,
  type RedCardMessage,
} from './teams.js';
import { effectiveCardDemotionSteps } from './rank-demotion.js';

describe('rankChangeFromSuggestion', () => {
  it('demotes a Geselle to Lehrling and a Meister to Geselle', () => {
    expect(rankChangeFromSuggestion('Geselle', 0, 1)).toEqual({
      from: 'Geselle',
      to: 'Lehrling',
    });
    expect(rankChangeFromSuggestion('Meister', 0, 1)).toEqual({
      from: 'Meister',
      to: 'Geselle',
    });
  });

  it('restores the rank when the last red card is revoked', () => {
    expect(rankChangeFromSuggestion('Geselle', 1, 0)).toEqual({
      from: 'Lehrling',
      to: 'Geselle',
    });
  });

  it('sends nothing for a Lehrling or an unchanged red-card state', () => {
    expect(rankChangeFromSuggestion('Lehrling', 0, 1)).toBeNull();
    expect(rankChangeFromSuggestion('Geselle', 1, 1)).toBeNull();
    expect(rankChangeFromSuggestion(null, 0, 1)).toBeNull();
  });

  it('reconstructs before/after card states for 3rd yellow card and revoke', () => {
    const round = {
      startsOn: new Date('2026-09-14T00:00:00Z'),
      endsOn: new Date('2027-02-15T00:00:00Z'),
    };
    const confirmedAt = new Date('2026-11-03T13:25:35Z');
    const activeCards = [
      { id: 'y3', cardType: 'yellow', createdAt: new Date('2026-11-17T06:51:59Z') },
      { id: 'y2', cardType: 'yellow', createdAt: new Date('2026-11-06T09:41:27Z') },
      { id: 'y1', cardType: 'yellow', createdAt: new Date('2026-11-04T07:55:10Z') },
    ];
    const issued = buildBeforeAndAfterCards(activeCards, {
      direction: 'issued',
      cardType: 'yellow',
      cardId: 'y3',
    });
    expect(effectiveCardDemotionSteps(issued.before, round, confirmedAt, 3)).toBe(0);
    expect(effectiveCardDemotionSteps(issued.after, round, confirmedAt, 3)).toBe(1);
    expect(rankChangeFromSuggestion('Meister', 0, 1)).toEqual({
      from: 'Meister',
      to: 'Geselle',
    });

    const revoked = buildBeforeAndAfterCards(activeCards.slice(1), {
      direction: 'revoked',
      cardType: 'yellow',
      cardId: 'y3',
      cardCreatedAt: new Date('2026-11-17T06:51:59Z'),
    });
    expect(effectiveCardDemotionSteps(revoked.before, round, confirmedAt, 3)).toBe(1);
    expect(effectiveCardDemotionSteps(revoked.after, round, confirmedAt, 3)).toBe(0);
    expect(rankChangeFromSuggestion('Meister', 1, 0)).toEqual({
      from: 'Geselle',
      to: 'Meister',
    });
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
    retroactive: false,
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
    retroactive: false,
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
