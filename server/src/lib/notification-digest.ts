import { db, getPool } from '../db/index.js';
import { config } from '../config.js';
import { notificationDigestLog } from '../db/schema.js';
import { escapeHtml, isSmtpConfigured, sendMail } from './email.js';

/**
 * Weekly per-class digest for teachers who ticked "Wochenübersicht".
 *
 * A single in-process ticker is enough for the one-container deployment. The
 * digest is sent on the first tick at/after Monday 07:00 Europe/Vienna, and a
 * unique log row per (user, class, week) prevents a restart from sending it
 * twice. The message contains counts per pupil, never the card notes.
 */

interface DigestCounts {
  green: number;
  yellow: number;
  red: number;
  timeout: number;
  cooldown: number;
}

interface PupilDigest extends DigestCounts {
  pupilName: string;
}

const ZERO: DigestCounts = { green: 0, yellow: 0, red: 0, timeout: 0, cooldown: 0 };

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Monday 00:00 of the week containing `date`. */
function startOfLocalWeek(date: Date): Date {
  const copy = startOfLocalDay(date);
  const offset = (copy.getDay() + 6) % 7; // Monday=0
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium' }).format(date);
}

async function loadDigest(classId: number, from: Date, to: Date) {
  const cardRows = await getPool().query<{
    pupil_name: string;
    type: string;
    count: number;
  }>(
    `SELECT p.full_name AS pupil_name, bc.card_type AS type, COUNT(*)::int AS count
       FROM behavior_cards bc
       JOIN pupils p ON p.id = bc.pupil_id
      WHERE bc.class_id = $1
        AND bc.created_at >= $2
        AND bc.created_at < $3
        AND bc.revoked_at IS NULL
        AND NOT (
          bc.card_type = 'red'
          AND EXISTS (
            SELECT 1 FROM timeout_incidents ti WHERE ti.red_card_id = bc.id
          )
        )
      GROUP BY p.full_name, bc.card_type`,
    [classId, from, to],
  );

  const timeoutRows = await getPool().query<{
    pupil_name: string;
    kind: string;
    count: number;
  }>(
    `SELECT p.full_name AS pupil_name, ti.kind, COUNT(*)::int AS count
       FROM timeout_incidents ti
       JOIN pupils p ON p.id = ti.pupil_id
      WHERE ti.class_id = $1
        AND ti.sent_at >= $2
        AND ti.sent_at < $3
        AND ti.kind IN ('timeout', 'cooldown')
      GROUP BY p.full_name, ti.kind`,
    [classId, from, to],
  );

  const perPupil = new Map<string, PupilDigest>();
  const total: DigestCounts = { ...ZERO };

  const getPupil = (name: string) => {
    let row = perPupil.get(name);
    if (!row) {
      row = { pupilName: name, ...ZERO };
      perPupil.set(name, row);
    }
    return row;
  };

  for (const row of cardRows.rows) {
    if (!['green', 'yellow', 'red'].includes(row.type)) continue;
    const pupil = getPupil(row.pupil_name);
    const key = row.type as 'green' | 'yellow' | 'red';
    pupil[key] += row.count;
    total[key] += row.count;
  }

  for (const row of timeoutRows.rows) {
    if (row.kind !== 'timeout' && row.kind !== 'cooldown') continue;
    const pupil = getPupil(row.pupil_name);
    pupil[row.kind] += row.count;
    total[row.kind] += row.count;
  }

  return {
    pupils: [...perPupil.values()].sort((a, b) => a.pupilName.localeCompare(b.pupilName, 'de')),
    total,
  };
}

function digestEmail(
  className: string,
  weekStart: Date,
  weekEnd: Date,
  digest: Awaited<ReturnType<typeof loadDigest>>,
): { subject: string; text: string; html: string } {
  const subject = `SMILE Wochenübersicht: Klasse ${className} – KW ${isoWeek(weekStart)}`;
  const range = `${formatDay(weekStart)} – ${formatDay(weekEnd)}`;
  const totalLine = `Grün ${digest.total.green} · Gelb ${digest.total.yellow} · Rot ${digest.total.red} · Time-Out ${digest.total.timeout} · Cool-Down ${digest.total.cooldown}`;

  const pupilLine = (p: PupilDigest) =>
    `${p.pupilName}: Grün ${p.green}, Gelb ${p.yellow}, Rot ${p.red}, Time-Out ${p.timeout}, Cool-Down ${p.cooldown}`;

  const text = [
    `Wochenübersicht Klasse ${className}`,
    `Zeitraum: ${range}`,
    '',
    `Gesamt: ${totalLine}`,
    '',
    ...(digest.pupils.length > 0
      ? digest.pupils.map(pupilLine)
      : ['Keine Ereignisse in dieser Woche.']),
    '',
    ...(config.teams.appUrl ? [`In SMILE öffnen: ${config.teams.appUrl}`] : []),
    '',
    'Automatisch gesendet von SMILE.',
  ].join('\n');

  const rows = digest.pupils
    .map(
      (p) => `<tr>
        <td style="padding:4px 12px 4px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(p.pupilName)}</td>
        <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #e5e7eb">${p.green}</td>
        <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #e5e7eb">${p.yellow}</td>
        <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #e5e7eb">${p.red}</td>
        <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #e5e7eb">${p.timeout}</td>
        <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #e5e7eb">${p.cooldown}</td>
      </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5">
      <h2 style="margin:0 0 6px">Wochenübersicht Klasse ${escapeHtml(className)}</h2>
      <p style="margin:0 0 16px;color:#6b7280">${escapeHtml(range)}</p>
      <p style="margin:0 0 16px"><strong>Gesamt:</strong> ${escapeHtml(totalLine)}</p>
      ${
        digest.pupils.length === 0
          ? '<p>Keine Ereignisse in dieser Woche.</p>'
          : `<table style="border-collapse:collapse;width:100%;font-size:14px">
              <thead><tr>
                <th style="text-align:left;padding:4px 12px 4px 0">Schüler*in</th>
                <th style="padding:4px 8px">Grün</th>
                <th style="padding:4px 8px">Gelb</th>
                <th style="padding:4px 8px">Rot</th>
                <th style="padding:4px 8px">Time-Out</th>
                <th style="padding:4px 8px">Cool-Down</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>`
      }
      ${config.teams.appUrl ? `<p><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>` : ''}
      <p style="color:#6b7280;font-size:12px;margin-top:24px">Automatisch gesendet von SMILE.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

export async function sendDueWeeklyDigests(now = new Date()): Promise<number> {
  if (!isSmtpConfigured()) return 0;

  const thisMonday = startOfLocalWeek(now);
  const sendAfter = new Date(thisMonday);
  sendAfter.setHours(7, 0, 0, 0);
  if (now < sendAfter) return 0;

  const previousMonday = new Date(thisMonday);
  previousMonday.setDate(thisMonday.getDate() - 7);
  const weekStartKey = localDateKey(previousMonday);

  const subscriptions = await getPool().query<{
    user_id: string;
    class_id: number;
    email: string;
    class_name: string;
  }>(
    `SELECT ns.user_id, ns.class_id, np.email, sc.name AS class_name
       FROM notification_subscriptions ns
       JOIN notification_preferences np ON np.user_id = ns.user_id
       JOIN school_classes sc ON sc.id = ns.class_id
      WHERE ns.weekly_digest = true
        AND ns.created_at < $2
        AND NOT EXISTS (
          SELECT 1 FROM notification_digest_log l
           WHERE l.user_id = ns.user_id
             AND l.class_id = ns.class_id
             AND l.week_start = $1
        )`,
    [weekStartKey, thisMonday],
  );

  let sent = 0;
  for (const subscription of subscriptions.rows) {
    const digest = await loadDigest(subscription.class_id, previousMonday, thisMonday);
    const content = digestEmail(
      subscription.class_name,
      previousMonday,
      new Date(thisMonday.getTime() - 1),
      digest,
    );
    const ok = await sendMail({
      to: [subscription.email],
      ...content,
    });
    if (!ok) continue;

    await db
      .insert(notificationDigestLog)
      .values({
        userId: subscription.user_id,
        classId: subscription.class_id,
        weekStart: weekStartKey,
      })
      .onConflictDoNothing();
    sent += 1;
  }

  return sent;
}

/** Start the 15-minute ticker. `unref()` keeps tests and shutdown clean. */
export function startWeeklyDigestScheduler(log?: { info: (msg: string) => void; warn: (msg: string) => void }) {
  let running = false;
  let timer: NodeJS.Timeout;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await sendDueWeeklyDigests();
      if (sent > 0) log?.info(`Weekly notification digests sent: ${sent}`);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      log?.warn(`Weekly notification digest run failed (${name})`);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), 15 * 60 * 1000);
  timer.unref();
  void tick();
  return timer;
}
