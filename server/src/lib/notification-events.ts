import { and, desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import {
  notificationPreferences,
  notificationSubscriptions,
  schoolClasses,
  teachers,
  timeoutIncidents,
  users,
} from '../db/schema.js';
import { escapeHtml, isSmtpConfigured, sendMail } from './email.js';
import { HEADMASTER_SHORTNAMES } from './guards.js';
import { formatViennaTime } from './notification-format.js';

/**
 * Per-class event subscriptions.
 *
 * A subscription row is per user and class. The user supplies one address in
 * notification_preferences. Event mails are sent immediately after the card or
 * time-out transaction; a delivery failure never fails the write.
 */

export type NotificationEventType = 'green' | 'yellow' | 'red' | 'timeout' | 'cooldown';

export interface ClassEvent {
  type: NotificationEventType;
  classId: number;
  pupilId?: number;
  pupilName: string;
  teacherId: number | null;
  note?: string | null;
  occurredAt?: Date;
  retroactive?: boolean;
}

export interface TimeoutHistoryEntry {
  sentAt: Date;
  teacherName: string;
  taskAssignment: string;
  retroactive: boolean;
}

const EVENT_COLUMN = {
  green: notificationSubscriptions.green,
  yellow: notificationSubscriptions.yellow,
  red: notificationSubscriptions.red,
  timeout: notificationSubscriptions.timeout,
  cooldown: notificationSubscriptions.cooldown,
} as const;

const EVENT_LABEL: Record<NotificationEventType, string> = {
  green: 'Grüne Karte',
  yellow: 'Gelbe Karte',
  red: 'Rote Karte',
  timeout: 'Time-Out',
  cooldown: 'Cool-Down',
};

async function resolveNames(classId: number, teacherId: number | null) {
  const [schoolClass] = await db
    .select({ name: schoolClasses.name })
    .from(schoolClasses)
    .where(eq(schoolClasses.id, classId))
    .limit(1);

  let teacherName = 'Schulleitung';
  if (teacherId !== null) {
    const [teacher] = await db
      .select({ fullName: teachers.fullName })
      .from(teachers)
      .where(eq(teachers.id, teacherId))
      .limit(1);
    teacherName = teacher?.fullName ?? 'Unbekannt';
  }

  return { className: schoolClass?.name ?? '—', teacherName };
}

async function loadTimeoutHistory(pupilId: number): Promise<TimeoutHistoryEntry[]> {
  const rows = await db
    .select({
      sentAt: timeoutIncidents.sentAt,
      teacherFullName: teachers.fullName,
      taskAssignment: timeoutIncidents.taskAssignment,
      retroactive: timeoutIncidents.retroactive,
    })
    .from(timeoutIncidents)
    .leftJoin(teachers, eq(teachers.id, timeoutIncidents.sentByTeacherId))
    .where(
      and(
        eq(timeoutIncidents.pupilId, pupilId),
        eq(timeoutIncidents.kind, 'timeout'),
      ),
    )
    .orderBy(desc(timeoutIncidents.sentAt), desc(timeoutIncidents.recordedAt));

  return rows.map((row) => ({
    sentAt: row.sentAt instanceof Date ? row.sentAt : new Date(row.sentAt),
    teacherName: row.teacherFullName ?? 'Schulleitung',
    taskAssignment: row.taskAssignment,
    retroactive: Boolean(row.retroactive),
  }));
}

function formatTimeoutHistoryBlocks(
  history: TimeoutHistoryEntry[] | undefined,
  fallbackTotal?: number,
): { textLines: string[]; htmlBlock: string } {
  const entries = history ?? [];
  const totalCount = entries.length > 0 ? entries.length : (fallbackTotal ?? 0);
  if (entries.length === 0 && totalCount <= 0) {
    return { textLines: [], htmlBlock: '' };
  }

  const totalLabel = `Time-Outs insgesamt: ${totalCount}`;
  const formattedEntries = entries.map((entry, idx) => {
    const number = totalCount - idx;
    const when = Number.isNaN(entry.sentAt.getTime())
      ? 'Unbekanntes Datum'
      : formatViennaTime(entry.sentAt);
    const retro = entry.retroactive ? ' (Nachtrag)' : '';
    const teacher = entry.teacherName.trim() || 'Schulleitung';
    const note = entry.taskAssignment.replace(/\s*\r?\n\s*/g, ' ').trim() || 'Keine Notiz hinterlegt.';
    return { number, when, retro, teacher, note };
  });

  const textLines = [
    '',
    totalLabel,
    ...(formattedEntries.length > 0
      ? [
          'Time-Out-Verlauf:',
          ...formattedEntries.map(
            (e) => `- #${e.number} · ${e.when}${e.retro} · ${e.teacher} — ${e.note}`,
          ),
        ]
      : []),
  ];

  const listItemsHtml = formattedEntries
    .map(
      (e) =>
        `<li style="margin:0 0 4px"><strong>#${e.number}</strong> · ${escapeHtml(e.when)}${escapeHtml(e.retro)} · ${escapeHtml(e.teacher)} — ${escapeHtml(e.note)}</li>`,
    )
    .join('');

  const htmlBlock = `
    <div style="margin:0 0 16px;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
      <p style="font-weight:700;margin:0${formattedEntries.length > 0 ? ' 0 8px' : ''}">${escapeHtml(totalLabel)}</p>
      ${
        formattedEntries.length > 0
          ? `<p style="font-size:12px;color:#4b5563;font-weight:600;margin:0 0 6px">Time-Out-Verlauf:</p><ul style="margin:0;padding-left:18px;font-size:13px">${listItemsHtml}</ul>`
          : ''
      }
    </div>
  `.trim();

  return { textLines, htmlBlock };
}

function eventEmail(
  event: ClassEvent,
  className: string,
  teacherName: string,
  timeoutHistory?: TimeoutHistoryEntry[],
): { subject: string; text: string; html: string } {
  const label = `${EVENT_LABEL[event.type]}${event.retroactive ? ' (Nachtrag)' : ''}`;
  const note = event.note?.trim() || 'Keine Notiz hinterlegt.';
  const time = formatViennaTime(event.occurredAt ?? new Date());
  const subject = `SMILE: ${label} – ${event.pupilName} (${className})`;
  const headline = `${event.pupilName} (${className}) · ${label} · ${teacherName} · ${time}`;
  const historyBlock =
    event.type === 'timeout' ? formatTimeoutHistoryBlocks(timeoutHistory) : { textLines: [], htmlBlock: '' };

  const text = [
    headline,
    '',
    note,
    ...historyBlock.textLines,
    ...(config.teams.appUrl ? ['', `In SMILE öffnen: ${config.teams.appUrl}`] : []),
    '',
    'Automatisch gesendet von SMILE.',
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
      <p style="font-size:16px;font-weight:700;margin:0 0 12px">${escapeHtml(headline)}</p>
      <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(note)}</p>
      ${historyBlock.htmlBlock}
      ${config.teams.appUrl ? `<p style="margin:0 0 12px"><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>` : ''}
      <p style="color:#9ca3af;font-size:11px;margin:16px 0 0">Automatisch gesendet von SMILE.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

/**
 * Queue an event mail for every user subscribed to this class and event type.
 * Called after the card/time-out transaction; not awaited by the route.
 */
export function queueClassEventNotification(event: ClassEvent): void {
  if (!isSmtpConfigured()) return;

  void (async () => {
    const rows = await db
      .select({
        email: notificationPreferences.email,
        userRole: users.role,
        teacherShortName: teachers.shortName,
      })
      .from(notificationSubscriptions)
      .innerJoin(
        notificationPreferences,
        eq(notificationPreferences.userId, notificationSubscriptions.userId),
      )
      .innerJoin(users, eq(users.id, notificationSubscriptions.userId))
      .leftJoin(teachers, eq(teachers.id, users.teacherId))
      .where(
        and(
          eq(notificationSubscriptions.classId, event.classId),
          eq(EVENT_COLUMN[event.type], true),
        ),
      );

    const leadershipEmails = new Set(
      config.email.leadershipTo.map((addr) => addr.trim().toLowerCase()).filter(Boolean),
    );
    const recipientsByAddress = new Map<string, { email: string; isLeadership: boolean }>();
    for (const row of rows) {
      const email = row.email.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      const isLeadership =
        row.userRole === 'admin' ||
        (row.teacherShortName != null &&
          HEADMASTER_SHORTNAMES.has(row.teacherShortName.trim().toUpperCase())) ||
        leadershipEmails.has(key);
      const existing = recipientsByAddress.get(key);
      recipientsByAddress.set(key, {
        email: existing?.email ?? email,
        isLeadership: (existing?.isLeadership ?? false) || isLeadership,
      });
    }

    const recipients = [...recipientsByAddress.values()];
    if (recipients.length === 0) return;

    const needsTimeoutHistory =
      event.type === 'timeout' &&
      event.pupilId !== undefined &&
      recipients.some((recipient) => recipient.isLeadership);

    const [{ className, teacherName }, timeoutHistory] = await Promise.all([
      resolveNames(event.classId, event.teacherId),
      needsTimeoutHistory && event.pupilId !== undefined
        ? loadTimeoutHistory(event.pupilId)
        : Promise.resolve<TimeoutHistoryEntry[]>([]),
    ]);

    const standardContent = eventEmail(event, className, teacherName);
    const leadershipContent =
      needsTimeoutHistory && timeoutHistory.length > 0
        ? eventEmail(event, className, teacherName, timeoutHistory)
        : standardContent;

    await Promise.allSettled(
      recipients.map((recipient) =>
        sendMail({
          ...(recipient.isLeadership ? leadershipContent : standardContent),
          to: [recipient.email],
        }),
      ),
    );
  })().catch((error) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[notifications] class event delivery skipped (${name})`);
  });
}

export interface TimeoutEscalationEvent {
  classId: number;
  pupilId?: number;
  pupilName: string;
  teacherId: number | null;
  totalTimeouts: number;
  note?: string | null;
  occurredAt?: Date;
  retroactive?: boolean;
}

export function buildTimeoutEscalationEmail(
  event: TimeoutEscalationEvent,
  className: string,
  teacherName: string,
  timeoutHistory?: TimeoutHistoryEntry[],
): { subject: string; text: string; html: string } {
  const totalCount =
    timeoutHistory && timeoutHistory.length > 0 ? timeoutHistory.length : event.totalTimeouts;
  const time = formatViennaTime(event.occurredAt ?? new Date());
  const note = event.note?.trim() || 'Keine Notiz hinterlegt.';
  const subject = `SMILE: Time-Out-Eskalation (${totalCount})${event.retroactive ? ' – Nachtrag' : ''} – ${event.pupilName} (${className})`;
  const headline = `${event.pupilName} (${className}) · Time-Out-Eskalation (${totalCount})${event.retroactive ? ' (Nachtrag)' : ''} · ${teacherName} · ${time}`;
  const historyBlock = formatTimeoutHistoryBlocks(timeoutHistory, totalCount);

  const text = [
    headline,
    '',
    note,
    ...historyBlock.textLines,
    ...(config.teams.appUrl ? ['', `In SMILE öffnen: ${config.teams.appUrl}`] : []),
    '',
    'Automatisch gesendet von SMILE.',
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
      <p style="font-size:16px;font-weight:700;margin:0 0 12px;color:#b91c1c">${escapeHtml(headline)}</p>
      <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(note)}</p>
      ${historyBlock.htmlBlock}
      ${config.teams.appUrl ? `<p style="margin:0 0 12px"><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>` : ''}
      <p style="color:#9ca3af;font-size:11px;margin:16px 0 0">Automatisch gesendet von SMILE.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

/**
 * Mandatory MED/SLC mail when a pupil reaches 3, 6, 9, ... time-outs. Recipients
 * come from LEADERSHIP_NOTIFICATION_EMAILS; this is independent of subscriptions.
 */
export function queueTimeoutEscalationNotification(event: TimeoutEscalationEvent): void {
  if (!isSmtpConfigured() || config.email.leadershipTo.length === 0) return;

  void (async () => {
    const [{ className, teacherName }, timeoutHistory] = await Promise.all([
      resolveNames(event.classId, event.teacherId),
      event.pupilId !== undefined
        ? loadTimeoutHistory(event.pupilId)
        : Promise.resolve<TimeoutHistoryEntry[]>([]),
    ]);
    const content = buildTimeoutEscalationEmail(event, className, teacherName, timeoutHistory);

    await sendMail({
      to: config.email.leadershipTo,
      ...content,
    });
  })().catch((error) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[notifications] escalation delivery skipped (${name})`);
  });
}

/** Exported for tests. */
export function buildEventEmail(
  event: ClassEvent,
  className: string,
  teacherName: string,
  timeoutHistory?: TimeoutHistoryEntry[],
) {
  return eventEmail(event, className, teacherName, timeoutHistory);
}
