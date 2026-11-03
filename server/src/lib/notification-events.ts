import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import {
  notificationPreferences,
  notificationSubscriptions,
  pupils,
  schoolClasses,
  teachers,
} from '../db/schema.js';
import { escapeHtml, isSmtpConfigured, sendMail } from './email.js';
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
  pupilName: string;
  teacherId: number | null;
  note?: string | null;
  occurredAt?: Date;
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

function eventEmail(
  event: ClassEvent,
  className: string,
  teacherName: string,
): { subject: string; text: string; html: string } {
  const label = EVENT_LABEL[event.type];
  const note = event.note?.trim() || 'Keine Notiz hinterlegt.';
  const time = formatViennaTime(event.occurredAt ?? new Date());
  const subject = `SMILE: ${label} – ${event.pupilName} (${className})`;
  const headline = `${event.pupilName} (${className}) · ${label} · ${teacherName} · ${time}`;

  const text = [
    headline,
    '',
    note,
    ...(config.teams.appUrl ? ['', `In SMILE öffnen: ${config.teams.appUrl}`] : []),
    '',
    'Automatisch gesendet von SMILE.',
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
      <p style="font-size:16px;font-weight:700;margin:0 0 12px">${escapeHtml(headline)}</p>
      <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(note)}</p>
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
      .select({ email: notificationPreferences.email })
      .from(notificationSubscriptions)
      .innerJoin(
        notificationPreferences,
        eq(notificationPreferences.userId, notificationSubscriptions.userId),
      )
      .where(
        and(
          eq(notificationSubscriptions.classId, event.classId),
          eq(EVENT_COLUMN[event.type], true),
        ),
      );

    const recipients = [...new Set(rows.map((row) => row.email.trim()).filter(Boolean))];
    if (recipients.length === 0) return;

    const { className, teacherName } = await resolveNames(event.classId, event.teacherId);
    const content = eventEmail(event, className, teacherName);
    await Promise.allSettled(recipients.map((email) => sendMail({ ...content, to: [email] })));
  })().catch((error) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[notifications] class event delivery skipped (${name})`);
  });
}

export interface TimeoutEscalationEvent {
  classId: number;
  pupilName: string;
  teacherId: number | null;
  totalTimeouts: number;
  note?: string | null;
  occurredAt?: Date;
}

/**
 * Mandatory MED/SLC mail when a pupil reaches 3, 6, 9, ... time-outs. Recipients
 * come from LEADERSHIP_NOTIFICATION_EMAILS; this is independent of subscriptions.
 */
export function queueTimeoutEscalationNotification(event: TimeoutEscalationEvent): void {
  if (config.email.leadershipTo.length === 0) return;

  void (async () => {
    const { className, teacherName } = await resolveNames(event.classId, event.teacherId);
    const time = formatViennaTime(event.occurredAt ?? new Date());
    const note = event.note?.trim() || 'Keine Notiz hinterlegt.';
    const subject = `SMILE: Time-Out-Eskalation (${event.totalTimeouts}) – ${event.pupilName} (${className})`;
    const headline = `${event.pupilName} (${className}) · Time-Out-Eskalation (${event.totalTimeouts}) · ${teacherName} · ${time}`;

    const text = [
      headline,
      '',
      note,
      ...(config.teams.appUrl ? ['', `In SMILE öffnen: ${config.teams.appUrl}`] : []),
      '',
      'Automatisch gesendet von SMILE.',
    ].join('\n');

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
        <p style="font-size:16px;font-weight:700;margin:0 0 12px;color:#b91c1c">${escapeHtml(headline)}</p>
        <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(note)}</p>
        ${config.teams.appUrl ? `<p style="margin:0 0 12px"><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>` : ''}
        <p style="color:#9ca3af;font-size:11px;margin:16px 0 0">Automatisch gesendet von SMILE.</p>
      </div>
    `.trim();

    await sendMail({
      to: config.email.leadershipTo,
      subject,
      text,
      html,
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
) {
  return eventEmail(event, className, teacherName);
}
