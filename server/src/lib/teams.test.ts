import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRedCardCard,
  postTeamsCard,
  rankChangesForSubjects,
  type RedCardMessage,
} from './teams.js';

describe('rankChangesForSubjects', () => {
  const subjects = [
    { subjectCode: 'D', baseRank: 'Meister' as const },
    { subjectCode: 'M', baseRank: 'Geselle' as const },
    { subjectCode: 'E', baseRank: 'Lehrling' as const },
  ];

  it('demotes every subject above Lehrling exactly one step', () => {
    expect(rankChangesForSubjects(subjects, false, true)).toEqual([
      { subjectCode: 'D', from: 'Meister', to: 'Geselle' },
      { subjectCode: 'M', from: 'Geselle', to: 'Lehrling' },
    ]);
  });

  it('restores the same ranks when the last red card is revoked', () => {
    expect(rankChangesForSubjects(subjects, true, false)).toEqual([
      { subjectCode: 'D', from: 'Geselle', to: 'Meister' },
      { subjectCode: 'M', from: 'Lehrling', to: 'Geselle' },
    ]);
  });

  it('does nothing when the effective red-card state is unchanged', () => {
    expect(rankChangesForSubjects(subjects, true, true)).toEqual([]);
    expect(rankChangesForSubjects(subjects, false, false)).toEqual([]);
  });
});

describe('buildRedCardCard', () => {
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

  it('carries the full pupil name, class, cause and rank changes', () => {
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

    const rankFacts = content.body[3].facts as Array<{ title: string; value: string }>;
    expect(rankFacts).toEqual([
      { title: 'D (Deutsch)', value: 'Meister → Geselle' },
      { title: 'M (Mathematik)', value: 'Geselle → Lehrling' },
    ]);
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

  it('never includes the red-card note', () => {
    const payload = JSON.stringify(buildRedCardCard(message));
    expect(payload).not.toContain('Vorfall');
    expect(payload).not.toContain('note');
  });
});

describe('postTeamsCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts the Adaptive Card envelope to the webhook', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const payload = buildRedCardCard({
      direction: 'issued',
      pupilName: 'Anna Muster',
      className: '3a',
      actorName: 'LBE',
      source: 'Rote Karte',
      changes: [{ subjectCode: 'D', from: 'Meister', to: 'Geselle' }],
      occurredAt: new Date('2026-11-03T10:00:00Z'),
    });

    await expect(postTeamsCard(payload, 'https://example.test/webhook')).resolves.toBe(true);
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
      postTeamsCard(
        buildRedCardCard({
          direction: 'issued',
          pupilName: 'Anna Muster',
          className: '3a',
          actorName: 'LBE',
          source: 'Rote Karte',
          changes: [{ subjectCode: 'D', from: 'Meister', to: 'Geselle' }],
          occurredAt: new Date(),
        }),
        'https://example.test/webhook',
      ),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(
      '[teams] webhook rejected the card with HTTP 500',
    );
  });

  it('returns false instead of throwing when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      postTeamsCard(
        buildRedCardCard({
          direction: 'issued',
          pupilName: 'Anna Muster',
          className: '3a',
          actorName: 'LBE',
          source: 'Rote Karte',
          changes: [{ subjectCode: 'D', from: 'Meister', to: 'Geselle' }],
          occurredAt: new Date(),
        }),
        'https://example.test/webhook',
      ),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith('[teams] webhook delivery failed (TypeError)');
  });
});
