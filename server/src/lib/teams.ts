import { and, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db, getPool } from '../db/index.js';
import {
  behaviorCards,
  finalRanks,
  pupils,
  schoolClasses,
  teachers,
} from '../db/schema.js';
import { demote, type Rank } from './ranking.js';
import { getLatestRound } from './rounds.js';
import { formatViennaTime } from './notification-format.js';
import { isEmailConfigured, sendRedCardEmail } from './email.js';
import {
  summarizeSubmittedTeacherVotes,
  type ConferenceTeacherVote,
} from './conference-rank.js';
import { normalizeSubject } from '../utils/subject.js';

/**
 * Staff notifications for red-card rank changes.
 *
 * Two transports are supported:
 * - Teams Workflow incoming webhook (no Entra app registration, no Graph),
 * - SMTP e-mail (for schools where Workflows is blocked, or to post into a
 *   Teams channel through its channel e-mail address).
 *
 * Microsoft Graph is deliberately not used for Teams chat messages: normal
 * chat/channel messages require delegated Graph permissions, while app-only
 * Graph messaging is migration-only.
 *
 * Notifications are best-effort and must never affect the card write. The caller
 * queues them after commit; delivery failures are logged without secrets.
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
  /** The note / incident description the teacher entered on the card. */
  note?: string | null;
}

/** A pupil-level rank change, never a per-subject change. */
export interface PupilRankChange {
  from: Rank;
  to: Rank;
}

export interface RedCardMessage {
  direction: RedCardDirection;
  pupilName: string;
  className: string;
  actorName: string;
  source: string;
  rankChange: PupilRankChange;
  note: string | null;
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
        {
          title: 'Rang',
          value: `${event.rankChange.from} → ${event.rankChange.to}`,
        },
      ],
    },
    {
      type: 'TextBlock',
      text: 'Notiz der Lehrkraft',
      weight: 'Bolder',
      spacing: 'Medium',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: event.note?.trim() || 'Keine Notiz hinterlegt.',
      wrap: true,
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
 * Apply the red-card state to one pupil-level suggestion. A card is a single
 * one-step demotion; a Lehrling stays Lehrling, so no notification is emitted.
 */
export function rankChangeFromSuggestion(
  suggestion: Rank | null,
  beforeHasRedCard: boolean,
  afterHasRedCard: boolean,
): PupilRankChange | null {
  if (!suggestion || beforeHasRedCard === afterHasRedCard) return null;
  const from = beforeHasRedCard ? demote(suggestion) : suggestion;
  const to = afterHasRedCard ? demote(suggestion) : suggestion;
  return from === to ? null : { from, to };
}

/**
 * Compute the pupil-level conference rank before and after the red-card state.
 *
 * Ranks are a pupil property, not a per-subject value. The base is the
 * hours-weighted suggestion from submitted teacher votes; a red card demotes
 * that suggestion one step. A confirmed final rank is official and is never
 * demoted again, so it produces no notification.
 */
export async function computePupilRankChange(
  pupilId: number,
  classId: number,
  beforeHasRedCard: boolean,
  afterHasRedCard: boolean,
): Promise<PupilRankChange | null> {
  if (beforeHasRedCard === afterHasRedCard) return null;

  const round = await getLatestRound();
  if (!round) return null;

  const confirmed = await db
    .select({ rank: finalRanks.rank })
    .from(finalRanks)
    .where(
      and(
        eq(finalRanks.roundId, round.id),
        eq(finalRanks.pupilId, pupilId),
        eq(finalRanks.classId, classId),
      ),
    )
    .limit(1);
  if (confirmed.length > 0) return null;

  const evals = await getPool().query<{
    teacher_id: number | null;
    subject_code: string;
    proposed_status: string | null;
    is_submitted: boolean;
  }>(
    `SELECT teacher_id, subject_code, proposed_status, is_submitted
       FROM evaluations
      WHERE pupil_id = $1 AND class_id = $2 AND round_id = $3`,
    [pupilId, classId, round.id],
  );
  if (evals.rows.length === 0) return null;

  const hoursRes = await getPool().query<{
    teacher_id: number;
    subject_code: string;
    hours: number;
  }>(
    `SELECT teacher_id, UPPER(TRIM(subject_code)) AS subject_code, COUNT(*)::int AS hours
       FROM timetable_lessons
      WHERE class_id = $1
      GROUP BY teacher_id, UPPER(TRIM(subject_code))`,
    [classId],
  );
  const hoursMap = new Map<string, number>();
  for (const row of hoursRes.rows) {
    hoursMap.set(`${row.teacher_id}_${row.subject_code}`, row.hours);
  }

  const totalHoursRes = await getPool().query<{
    teacher_id: number;
    total_hours: number;
  }>(
    `SELECT teacher_id, COUNT(*)::int AS total_hours
       FROM timetable_lessons
      WHERE class_id = $1
      GROUP BY teacher_id`,
    [classId],
  );
  const totalHoursMap = new Map<number, number>();
  for (const row of totalHoursRes.rows) {
    totalHoursMap.set(row.teacher_id, row.total_hours);
  }

  const votes: ConferenceTeacherVote[] = evals.rows.map((row) => {
    const normalized = normalizeSubject(row.subject_code);
    const upperSubject = row.subject_code.trim().toUpperCase();
    const hours =
      (row.teacher_id !== null
        ? hoursMap.get(`${row.teacher_id}_${upperSubject}`)
        : undefined) ??
      (row.teacher_id !== null
        ? hoursMap.get(`${row.teacher_id}_${normalized.code}`)
        : undefined) ??
      (row.teacher_id !== null ? totalHoursMap.get(row.teacher_id) : undefined) ??
      (normalized.isCoreSmile ? 4 : 2);

    return {
      teacherId: row.teacher_id,
      teacherShort: '',
      teacherName: '',
      subjectCode: row.subject_code,
      proposedStatus: row.proposed_status,
      isSubmitted: row.is_submitted,
      submittedAt: null,
      positiveCount: 0,
      totalRated: 0,
      hours,
      weight: hours,
      isTeamTeaching: normalized.isCoreSmile,
    };
  });

  const suggestion = summarizeSubmittedTeacherVotes(votes).suggestedRankByHours;
  return rankChangeFromSuggestion(suggestion, beforeHasRedCard, afterHasRedCard);
}

function cleanTeacherNote(note: string | null | undefined): string | null {
  return (
    note
      ?.replace(/^\[TIME-OUT LW\]\s*(Arbeitsauftrag:\s*)?/i, '')
      .trim() || null
  );
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

  const rankChange = await computePupilRankChange(
    event.pupilId,
    event.classId,
    beforeHasRedCard,
    afterHasRedCard,
  );
  if (!rankChange) return null;

  return {
    direction: event.direction,
    pupilName: pupil.fullName,
    className: schoolClass?.name ?? '—',
    actorName,
    source: event.source,
    rankChange,
    note: cleanTeacherNote(event.note),
    occurredAt: new Date(),
  };
}

/**
 * Queue a notification after the card transaction has committed.
 *
 * Sends to every configured transport: the Teams Workflow webhook and/or SMTP
 * e-mail. Intentionally not awaited by the route: the card write must not wait
 * for Teams or the mail server. The helper re-reads the rank state from
 * PostgreSQL, so it also handles concurrent cards correctly (a second active red
 * card causes no second demotion message).
 */
export function queueRedCardRankChange(event: RedCardRankChangeEvent): void {
  const teamsConfigured =
    config.teams.notificationsEnabled && Boolean(config.teams.webhookUrl);
  if (!teamsConfigured && !isEmailConfigured()) return;

  void (async () => {
    const message = await loadRedCardMessage(event);
    if (!message) return;
    await Promise.all([
      postTeamsCard(buildRedCardCard(message)),
      sendRedCardEmail(message),
    ]);
  })().catch((error) => {
    // Do not log the webhook URL, SMTP password or pupil data. A failed
    // notification is visible in the journal only by its error class.
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[notifications] rank-change notification skipped (${name})`);
  });
}
