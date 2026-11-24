import nodemailer from 'nodemailer';
import { config } from '../config.js';
import type { RedCardMessage } from './teams.js';
import { formatViennaTime } from './notification-format.js';
import { SMILE_LOGO_CID, SMILE_LOGO_PNG } from './email-logo.js';

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

export type EmailTone = 'green' | 'yellow' | 'red' | 'timeout' | 'cooldown' | 'neutral';

export interface EmailCardOptions {
  badge: string;
  tone?: EmailTone;
  meta: string;
  title: string;
  subtitle?: string;
  noteLabel?: string;
  note?: string;
  noteHighlight?: boolean;
  extraHtml?: string;
}

const TONE_BADGE_STYLE: Record<EmailTone, { bg: string; border: string; text: string }> = {
  green: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  yellow: { bg: '#fef9c3', border: '#fde047', text: '#854d0e' },
  red: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  timeout: { bg: '#ffe4e6', border: '#fda4af', text: '#9f1239' },
  cooldown: { bg: '#e0f2fe', border: '#7dd3fc', text: '#075985' },
  neutral: { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' },
};

/**
 * Shared HTML card wrapper for all SMILE notification e-mails. Uses <div>
 * layout + inline styles + cid: logo so Outlook/M365 and Apple Mail render it
 * without external image requests or <table> wrapper tags.
 */
export function renderEmailCard(options: EmailCardOptions): string {
  const palette = TONE_BADGE_STYLE[options.tone ?? 'neutral'];
  const noteBg = options.noteHighlight ? '#fffbeb' : '#f8fafc';
  const noteBorder = options.noteHighlight ? '#fde68a' : '#e2e8f0';
  const noteColor = options.noteHighlight ? '#78350f' : '#334155';
  const noteTitleColor = options.noteHighlight ? '#92400e' : '#64748b';

  const noteBlock = options.note
    ? `<div style="margin:0 0 14px;padding:12px 14px;background:${noteBg};border:1px solid ${noteBorder};border-radius:12px;color:${noteColor};font-size:13px">
        ${options.noteLabel ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${noteTitleColor};margin:0 0 4px">${escapeHtml(options.noteLabel)}</div>` : ''}
        <div style="white-space:pre-wrap;margin:0">${escapeHtml(options.note)}</div>
      </div>`
    : '';

  const subtitleBlock = options.subtitle
    ? `<div style="font-size:14px;font-weight:700;color:#334155;margin:4px 0 0">${escapeHtml(options.subtitle)}</div>`
    : '';

  const ctaBlock = config.teams.appUrl
    ? `<div style="margin:16px 0 0"><a href="${escapeHtml(config.teams.appUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none">In SMILE öffnen &rarr;</a></div>`
    : '';

  return `
    <div style="margin:0;padding:16px 12px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="height:4px;background-color:#0570cf;background-image:linear-gradient(90deg,#6d1d8e 0%,#0570cf 28%,#2eb85c 55%,#facc15 76%,#e11d48 100%)"></div>
        <div style="padding:16px 22px 12px;border-bottom:1px solid #e2e8f0">
          <img src="cid:${SMILE_LOGO_CID}" alt="SMILE" width="108" height="32" style="display:inline-block;vertical-align:middle;height:32px;width:auto;border:0;margin:0 12px 4px 0" />
          <span style="display:inline-block;vertical-align:middle;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${palette.bg};border:1px solid ${palette.border};color:${palette.text};margin-bottom:4px">${escapeHtml(options.badge)}</span>
        </div>
        <div style="padding:18px 22px">
          <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 4px">${escapeHtml(options.meta)}</div>
          <div style="font-size:18px;font-weight:800;color:#0f172a;margin:0">${escapeHtml(options.title)}</div>
          ${subtitleBlock}
          <div style="margin:14px 0 0">
            ${noteBlock}
            ${options.extraHtml ?? ''}
          </div>
          ${ctaBlock}
        </div>
        <div style="padding:12px 22px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:11px">
          Automatisch gesendet von SMILE &middot; MS Weissenbach
        </div>
      </div>
    </div>
  `.trim();
}

export function buildRedCardEmail(message: RedCardMessage): EmailContent {
  const isIssued = message.direction === 'issued';
  const sourceLabel = message.source || 'Rote Karte';
  const action = `${isIssued ? sourceLabel : `${sourceLabel} zurückgezogen`}${message.retroactive ? ' · Nachtrag' : ''}`;
  const subject = `Schüler ${message.pupilName} (${message.className}) ${message.rankChange.from} ---> ${message.rankChange.to}`;
  const time = formatViennaTime(message.occurredAt);
  const note = message.note?.trim() || 'Keine Notiz hinterlegt.';
  const headline = `${message.pupilName} (${message.className}) ${message.rankChange.from} ---> ${message.rankChange.to} · ${action} · ${message.actorName} · ${time}`;

  const textLines = [headline, '', note];

  if (config.teams.appUrl) {
    textLines.push('', `In SMILE öffnen: ${config.teams.appUrl}`);
  }
  textLines.push('', 'Automatisch gesendet von SMILE.');

  const html = renderEmailCard({
    badge: action,
    tone: isIssued ? 'red' : 'neutral',
    meta: `Klasse ${message.className} · ${time} · ${message.actorName}`,
    title: `${message.pupilName} (${message.className})`,
    subtitle: `Rangänderung: ${message.rankChange.from} ---> ${message.rankChange.to}`,
    noteLabel: 'Begründung / Notiz',
    note,
  });

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
    const attachments = mail.html.includes(`cid:${SMILE_LOGO_CID}`)
      ? [
          {
            filename: 'smile-logo.png',
            content: SMILE_LOGO_PNG,
            cid: SMILE_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline' as const,
          },
        ]
      : undefined;

    await getTransport().sendMail({
      from: fromAddress(),
      to: mail.to.join(', '),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(attachments ? { attachments } : {}),
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
