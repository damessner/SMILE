import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import {
  behaviorCards,
  evaluationItems,
  evaluations,
  pupils,
  schoolClasses,
  teachers,
} from '../db/schema.js';
import {
  demote,
  rankFromScore,
  summarizeRatings,
  type Rank,
} from './ranking.js';
import { getLatestRound } from './rounds.js';
import { normalizeSubject } from '../utils/subject.js';

/**
 * Sends staff-channel notifications to Microsoft Teams for red-card rank changes.
 *
 * The transport is a Teams Workflow incoming webhook. It deliberately does not use
 * Microsoft Graph: normal chat/channel messages require delegated Graph permissions,
 * while app-only Graph messaging is migration-only. A webhook needs no Entra app
 * registration and no public callback endpoint.
 *
 * Notifications are best-effort and must never affect the card write. The caller
 * queues them after commit; delivery failures are logged without the webhook URL.
 */

export type RedCardDirection = 'issued' | 'revoked';

export interface RedCardRankChangeEvent {
  pupilId: number;
  classId: number;
  /** Teacher who issued or revoked the card; null for a non-teacher admin action. */
  actorTeacherId: number | null;
  direction: RedCardDirection;
  /** Human-readable cause, e.g. "Rote Karte" or "Time-Out". */
  source: string;
}

export interface RankChange {
  subjectCode: string;
  from: Rank;
  to: Rank;
}

export interface RedCardMessage {
  direction: RedCardDirection;
  pupilName: string;
  className: string;
  actorName: string;
  source: string;
  changes: RankChange[];
  occurredAt: Date;
}

export interface TeamsWebhookPayload {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: Record<string, unknown>;
  }>;
}

/**
 * Pure demotion/restore mapping. A red card is a single one-step demotion, not one
 * step per card, matching `calculateRank` and the client's per-subject display.
 */
export function rankChangesForSubjects(
  subjects: Array<{ subjectCode: string; baseRank: Rank }>,
  beforeHasRedCard: boolean,
  afterHasRedCard: boolean,
): RankChange[] {
  if (beforeHasRedCard === afterHasRedCard) return [];

  return subjects
    .map((subject) => {
      const from = beforeHasRedCard ? demote(subject.baseRank) : subject.baseRank;
      const to = afterHasRedCard ? demote(subject.baseRank) : subject.baseRank;
      return from === to
        ? null
        : { subjectCode: subject.subjectCode, from, to };
    })
    .filter((change): change is RankChange => change !== null)
    .sort((a, b) => a.subjectCode.localeCompare(b.subjectCode, 'de'));
}

/** Subject code plus the canonical display name, without duplicating a bare code. */
function subjectLabel(code: string): string {
  const name = normalizeSubject(code).name;
  return name && name !== code ? `${code} (${name})` : code;
}

function formatViennaTime(date: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  }).format(date);
}

/** Build the Adaptive Card exactly as the Teams Workflow webhook expects it. */
export function buildRedCardCard(event: RedCardMessage): TeamsWebhookPayload {
  const isIssued = event.direction === 'issued';
  const title = isIssued
    ? 'Rote Karte – Rangverlust'
    : 'Rote Karte zurückgezogen – Rang wiederhergestellt';

  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: title,
      weight: 'Bolder',
      size: 'Medium',
      color: isIssued ? 'Attention' : 'Good',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Schüler*in', value: event.pupilName },
        { title: 'Klasse', value: event.className },
        { title: 'Quelle', value: event.source },
        {
          title: isIssued ? 'Ausgestellt von' : 'Zurückgezogen von',
          value: event.actorName,
        },
        { title: 'Zeit', value: formatViennaTime(event.occurredAt) },
      ],
    },
    {
      type: 'TextBlock',
      text: 'Rangänderung',
      weight: 'Bolder',
      spacing: 'Medium',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: event.changes.map((change) => ({
        title: subjectLabel(change.subjectCode),
        value: `${change.from} → ${change.to}`,
      })),
    },
  ];

  const actions = config.teams.appUrl
    ? [
        {
          type: 'Action.OpenUrl',
          title: 'In SMILE öffnen',
          url: config.teams.appUrl,
        },
      ]
    : undefined;

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(actions ? { actions } : {}),
        },
      },
    ],
  };
}

/**
 * POST a card to a Teams Workflow webhook.
 *
 * Returns false rather than throwing: a Teams outage must never make a card write
 * look failed. The URL is never included in logs.
 */
export async function postTeamsCard(
  payload: TeamsWebhookPayload,
  webhookUrl: string = config.teams.webhookUrl,
): Promise<boolean> {
  if (!config.teams.notificationsEnabled || !webhookUrl.trim()) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[teams] webhook rejected the card with HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[teams] webhook delivery failed (${name})`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function activeRedCardCount(pupilId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(behaviorCards)
    .where(
      and(
        eq(behaviorCards.pupilId, pupilId),
        eq(behaviorCards.cardType, 'red'),
        isNull(behaviorCards.revokedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Compute the ranked subjects whose displayed rank differs under the red-card
 * state before/after. Only subjects with at least one counted rating participate;
 * a pupil with no ratings has no rank to demote.
 */
export async function computeRedCardRankChanges(
  pupilId: number,
  classId: number,
  beforeHasRedCard: boolean,
  afterHasRedCard: boolean,
): Promise<RankChange[]> {
  if (beforeHasRedCard === afterHasRedCard) return [];

  const round = await getLatestRound();
  if (!round) return [];

  const evaluationRows = await db
    .select({ id: evaluations.id, subjectCode: evaluations.subjectCode })
    .from(evaluations)
    .where(
      and(
        eq(evaluations.roundId, round.id),
        eq(evaluations.pupilId, pupilId),
        eq(evaluations.classId, classId),
      ),
    );

  if (evaluationRows.length === 0) return [];

  const itemRows = await db
    .select({
      evaluationId: evaluationItems.evaluationId,
      itemKey: evaluationItems.itemKey,
      rating: evaluationItems.rating,
      updatedAt: evaluationItems.updatedAt,
    })
    .from(evaluationItems)
    .where(inArray(evaluationItems.evaluationId, evaluationRows.map((row) => row.id)));

  const itemsByEvaluation = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByEvaluation.get(item.evaluationId) ?? [];
    list.push(item);
    itemsByEvaluation.set(item.evaluationId, list);
  }

  const subjects: Array<{ subjectCode: string; baseRank: Rank }> = [];
  for (const evaluation of evaluationRows) {
    const summary = summarizeRatings([
      {
        evaluationId: evaluation.id,
        items: itemsByEvaluation.get(evaluation.id) ?? [],
      },
    ]);
    if (summary.totalRated === 0) continue;
    subjects.push({
      subjectCode: evaluation.subjectCode,
      baseRank: rankFromScore(summary.scoreForThreshold),
    });
  }

  return rankChangesForSubjects(subjects, beforeHasRedCard, afterHasRedCard);
}

async function loadRedCardMessage(
  event: RedCardRankChangeEvent,
): Promise<RedCardMessage | null> {
  const [pupil] = await db
    .select({ fullName: pupils.fullName })
    .from(pupils)
    .where(eq(pupils.id, event.pupilId))
    .limit(1);
  if (!pupil) return null;

  const [schoolClass] = await db
    .select({ name: schoolClasses.name })
    .from(schoolClasses)
    .where(eq(schoolClasses.id, event.classId))
    .limit(1);

  let actorName = 'Schulleitung';
  if (event.actorTeacherId !== null) {
    const [teacher] = await db
      .select({ fullName: teachers.fullName })
      .from(teachers)
      .where(eq(teachers.id, event.actorTeacherId))
      .limit(1);
    actorName = teacher?.fullName ?? 'Unbekannt';
  }

  const activeCards = await activeRedCardCount(event.pupilId);
  const isIssued = event.direction === 'issued';
  // An issued card is already committed, so it is included in the count. A revoked
  // card is already excluded; before the revoke it was active by definition.
  const beforeHasRedCard = isIssued ? activeCards > 1 : true;
  const afterHasRedCard = activeCards > 0;

  const changes = await computeRedCardRankChanges(
    event.pupilId,
    event.classId,
    beforeHasRedCard,
    afterHasRedCard,
  );
  if (changes.length === 0) return null;

  return {
    direction: event.direction,
    pupilName: pupil.fullName,
    className: schoolClass?.name ?? '—',
    actorName,
    source: event.source,
    changes,
    occurredAt: new Date(),
  };
}

/**
 * Queue a notification after the card transaction has committed.
 *
 * Intentionally not awaited by the route: the card write must not wait for Teams.
 * The helper re-reads the rank state from PostgreSQL, so it also handles concurrent
 * cards correctly (a second active red card causes no second demotion message).
 */
export function queueRedCardRankChange(event: RedCardRankChangeEvent): void {
  if (!config.teams.notificationsEnabled || !config.teams.webhookUrl) return;

  void (async () => {
    const message = await loadRedCardMessage(event);
    if (!message) return;
    await postTeamsCard(buildRedCardCard(message));
  })().catch((error) => {
    // Do not log the webhook URL or pupil data. A failed notification is visible
    // in the journal only by its error class.
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[teams] rank-change notification skipped (${name})`);
  });
}
