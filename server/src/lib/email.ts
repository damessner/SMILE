import nodemailer from 'nodemailer';
import { config } from '../config.js';
import type { RedCardMessage } from './teams.js';
import { formatViennaTime } from './notification-format.js';

/**
 * SMTP e-mail transport for the same red-card rank-change message the Teams
 * webhook sends. It exists because a Teams Workflow can be blocked by tenant
 * policy while the school already has a working Microsoft 365 SMTP account.
 *
 * The recipient can be a staff distribution list or a Teams channel e-mail
 * address (which turns the mail into a channel post). The teacher's red-card
 * note is included for staff, as requested.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fromAddress(): string {
  return config.email.from || config.email.user;
}

function hasSmtpCredentials(): boolean {
  return Boolean(
    config.email.host &&
      config.email.user &&
      config.email.password &&
      fromAddress(),
  );
}

/** Sending is enabled only when the transport and at least one recipient exist. */
export function isEmailConfigured(): boolean {
  return (
    config.email.notificationsEnabled &&
    hasSmtpCredentials() &&
    config.email.to.length > 0
  );
}

export function buildRedCardEmail(message: RedCardMessage): EmailContent {
  const isIssued = message.direction === 'issued';
  const title = isIssued
    ? 'Rote Karte – Rangverlust'
    : 'Rote Karte zurückgezogen – Rang wiederhergestellt';

  const subject = `SMILE: ${title} – ${message.pupilName} (${message.className})`;

  const textLines = [
    title,
    '',
    `Schüler*in: ${message.pupilName}`,
    `Klasse: ${message.className}`,
    `Quelle: ${message.source}`,
    `${isIssued ? 'Ausgestellt von' : 'Zurückgezogen von'}: ${message.actorName}`,
    `Zeit: ${formatViennaTime(message.occurredAt)}`,
    `Rang: ${message.rankChange.from} → ${message.rankChange.to}`,
    '',
    'Notiz der Lehrkraft:',
    message.note?.trim() || 'Keine Notiz hinterlegt.',
  ];

  if (config.teams.appUrl) {
    textLines.push('', `In SMILE öffnen: ${config.teams.appUrl}`);
  }

  const facts: Array<[string, string]> = [
    ['Schüler*in', message.pupilName],
    ['Klasse', message.className],
    ['Quelle', message.source],
    [
      isIssued ? 'Ausgestellt von' : 'Zurückgezogen von',
      message.actorName,
    ],
    ['Zeit', formatViennaTime(message.occurredAt)],
    ['Rang', `${message.rankChange.from} → ${message.rankChange.to}`],
  ];

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5">
      <h2 style="margin:0 0 12px;color:${isIssued ? '#b91c1c' : '#15803d'}">${escapeHtml(title)}</h2>
      <table style="border-collapse:collapse;margin:0 0 16px">
        ${facts
          .map(
            ([label, value]) =>
              `<tr><td style="padding:2px 16px 2px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:2px 0;font-weight:600">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}
      </table>
      <h3 style="margin:0 0 6px">Notiz der Lehrkraft</h3>
      <div style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(message.note?.trim() || 'Keine Notiz hinterlegt.')}</div>
      ${
        config.teams.appUrl
          ? `<p><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>`
          : ''
      }
      <p style="color:#6b7280;font-size:12px;margin-top:24px">Automatisch gesendet von SMILE.</p>
    </div>
  `.trim();

  return { subject, text: textLines.join('\n'), html };
}

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      requireTLS: !config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return cachedTransport;
}

/**
 * Send one rank-change e-mail. Returns false rather than throwing so a mail
 * outage never makes a card write look failed. The password is never logged.
 */
export async function sendRedCardEmail(
  message: RedCardMessage,
  recipients: string[] = config.email.to,
): Promise<boolean> {
  if (
    !config.email.notificationsEnabled ||
    !hasSmtpCredentials() ||
    recipients.length === 0
  ) {
    return false;
  }

  const content = buildRedCardEmail(message);
  try {
    await getTransport().sendMail({
      from: fromAddress(),
      to: recipients.join(', '),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[email] notification delivery failed (${name})`);
    return false;
  }
}
