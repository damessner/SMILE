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

export interface OutgoingMail extends EmailContent {
  to: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { escapeHtml };

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

/** SMTP transport is ready; recipients are supplied per message. */
export function isSmtpConfigured(): boolean {
  return config.email.notificationsEnabled && hasSmtpCredentials();
}

/** Legacy global recipient list for red-card rank-loss notifications. */
export function isEmailConfigured(): boolean {
  return isSmtpConfigured() && config.email.to.length > 0;
}

export function buildRedCardEmail(message: RedCardMessage): EmailContent {
  const isIssued = message.direction === 'issued';
  const action = isIssued ? 'Rote Karte' : 'Rote Karte zurückgezogen';
  const subject = `Schüler ${message.pupilName} (${message.className}) ${message.rankChange.from} ---> ${message.rankChange.to}`;
  const time = formatViennaTime(message.occurredAt);
  const note = message.note?.trim() || 'Keine Notiz hinterlegt.';
  const headline = `${message.pupilName} (${message.className}) ${message.rankChange.from} ---> ${message.rankChange.to} · ${action} · ${message.actorName} · ${time}`;

  const textLines = [headline, '', note];

  if (config.teams.appUrl) {
    textLines.push('', `In SMILE öffnen: ${config.teams.appUrl}`);
  }
  textLines.push('', 'Automatisch gesendet von SMILE.');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:640px">
      <p style="font-size:16px;font-weight:700;margin:0 0 12px">${escapeHtml(headline)}</p>
      <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(note)}</p>
      ${
        config.teams.appUrl
          ? `<p style="margin:0 0 12px"><a href="${escapeHtml(config.teams.appUrl)}">In SMILE öffnen</a></p>`
          : ''
      }
      <p style="color:#9ca3af;font-size:11px;margin:16px 0 0">Automatisch gesendet von SMILE.</p>
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
 * Send one e-mail. Returns false rather than throwing so a mail outage never
 * makes a card write look failed. The password is never logged.
 */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  if (!isSmtpConfigured() || mail.to.length === 0) return false;

  try {
    await getTransport().sendMail({
      from: fromAddress(),
      to: mail.to.join(', '),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[email] notification delivery failed (${name})`);
    return false;
  }
}

/** Legacy fixed-recipient red-card rank-loss mail. */
export async function sendRedCardEmail(
  message: RedCardMessage,
  recipients: string[] = config.email.to,
): Promise<boolean> {
  const content = buildRedCardEmail(message);
  return sendMail({ ...content, to: recipients });
}
