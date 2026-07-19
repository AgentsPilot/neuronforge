// lib/notifications/emailTransport.ts
// Provider-agnostic transactional email sender.
//
// Sends via whatever is configured, in priority order, with automatic fallback:
//   1. Resend            (if RESEND_API_KEY looks valid — starts with "re_")
//   2. Gmail OAuth2      (if GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN)
//   3. console preview   (dev) — returns { sent: false }
//
// Best-effort: never throws. Returns a structured result so callers can log
// honestly. Used by NotificationService (calibration result + human-approval
// step emails).

import nodemailer from 'nodemailer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'EmailTransport', service: 'notifications' });

const RESEND_DEFAULT_FROM = 'NeuronForge <notifications@neuronforge.app>';

export interface SendEmailParams {
  to: string[];
  subject: string;
  html: string;
  /**
   * D9: optional plaintext alternative. When omitted, the transport auto-generates
   * one from `html` so every send is proper `multipart/alternative` (HTML + text)
   * — never single-part `text/html`, which renders inconsistently across clients.
   * Callers do NOT need to supply this; the transport degrades gracefully.
   */
  text?: string;
  /** Resend honors this (verified domain required); Gmail always sends from GMAIL_USER. */
  from?: string;
  /**
   * Last-resort fallback: if Resend + env Gmail both fail and this owner has a
   * google-mail plugin connection, send via that connection (its token is valid
   * and auto-refreshing). The email is sent FROM the owner's own Gmail.
   */
  ownerUserId?: string;
}

export interface SendEmailResult {
  sent: boolean;
  provider: 'resend' | 'gmail' | 'gmail-plugin' | 'none';
  error?: string;
}

/**
 * D9: derive a readable plaintext alternative from an HTML document. Deliberately
 * dependency-free (no html-to-text lib): drop non-content elements, turn block-level
 * boundaries into newlines, strip the remaining tags, decode the common entities,
 * and collapse whitespace. Good enough for a plaintext MIME part; the HTML part
 * remains the primary render.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    // Remove elements whose text content is not human-readable body copy.
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Line breaks and block boundaries → newlines.
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|thead|tbody|section|header|footer|ul|ol)>/gi, '\n')
    // Strip all remaining tags.
    .replace(/<[^>]+>/g, '')
    // Decode the entities our templates actually emit.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse whitespace: trim each line, cap consecutive blank lines.
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * D9: the plaintext part to send. Prefer a caller-supplied `text`; otherwise
 * auto-generate from the HTML so the message is always multipart/alternative.
 */
function resolveText(p: SendEmailParams): string {
  const supplied = p.text?.trim();
  return supplied || htmlToText(p.html);
}

function resendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!key && key.startsWith('re_');
}

function gmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_USER &&
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

async function sendViaResend(p: SendEmailParams): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: p.from || process.env.RESEND_FROM_EMAIL || RESEND_DEFAULT_FROM,
      to: p.to,
      subject: p.subject,
      html: p.html,
      text: resolveText(p), // D9: multipart/alternative — plaintext part alongside HTML
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${await res.text()}`);
  }
}

/**
 * Last-resort: send via the owner's google-mail PLUGIN connection (the same path
 * the agent's own emails use — valid, auto-refreshing token). Sends from the
 * owner's Gmail. Lazy-imports the plugin executor so the plugin system is only
 * loaded when this fallback actually fires.
 */
async function sendViaOwnerPlugin(p: SendEmailParams): Promise<void> {
  const { PluginExecuterV2 } = await import('@/lib/server/plugin-executer-v2');
  const executer = await PluginExecuterV2.getInstance();
  const result = await executer.execute(p.ownerUserId as string, 'google-mail', 'send_email', {
    recipients: { to: p.to },
    content: { subject: p.subject, html_body: p.html },
  });
  if (!result.success) {
    throw new Error(result.message || result.error || 'google-mail plugin send failed');
  }
}

async function sendViaGmail(p: SendEmailParams): Promise<void> {
  // Gmail forces the sender to the authenticated account — ignore any caller
  // `from` and always send from GMAIL_USER.
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_USER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
  });
  await transporter.sendMail({
    from: `"NeuronForge" <${process.env.GMAIL_USER}>`,
    to: p.to.join(', '),
    subject: p.subject,
    html: p.html,
    text: resolveText(p), // D9: multipart/alternative — nodemailer builds both parts
  });
}

/**
 * Send a transactional email via the first configured/working provider.
 * Never throws — returns { sent, provider, error }.
 */
export async function sendEmail(p: SendEmailParams): Promise<SendEmailResult> {
  const errors: string[] = [];

  // 1. Resend (preferred for production)
  if (resendConfigured()) {
    try {
      await sendViaResend(p);
      logger.info({ to: p.to, provider: 'resend' }, 'Email sent');
      return { sent: true, provider: 'resend' };
    } catch (err: any) {
      errors.push(`resend: ${err?.message ?? err}`);
      logger.warn({ err: err?.message ?? String(err) }, 'Resend send failed — trying next transport');
    }
  } else if (process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is set but is not a valid Resend key (must start with "re_") — skipping Resend');
  }

  // 2. Gmail OAuth2 (nodemailer) — shared env "system" account
  if (gmailConfigured()) {
    try {
      await sendViaGmail(p);
      logger.info({ to: p.to, provider: 'gmail' }, 'Email sent');
      return { sent: true, provider: 'gmail' };
    } catch (err: any) {
      errors.push(`gmail: ${err?.message ?? err}`);
      logger.warn({ err: err?.message ?? String(err) }, 'Gmail send failed — trying next transport');
    }
  }

  // 3. Owner's google-mail plugin connection — last-resort, sends from the owner's Gmail
  if (p.ownerUserId) {
    try {
      await sendViaOwnerPlugin(p);
      logger.info({ to: p.to, provider: 'gmail-plugin', ownerUserId: p.ownerUserId }, 'Email sent');
      return { sent: true, provider: 'gmail-plugin' };
    } catch (err: any) {
      errors.push(`gmail-plugin: ${err?.message ?? err}`);
      logger.warn({ err: err?.message ?? String(err), ownerUserId: p.ownerUserId }, 'Owner google-mail plugin send failed');
    }
  }

  // 4. Nothing configured / all failed → report not sent (structured Pino only)
  logger.warn(
    { to: p.to, subject: p.subject, errors: errors.length ? errors : undefined },
    'No email transport delivered the message (preview only)'
  );
  return { sent: false, provider: 'none', error: errors.join('; ') || 'no email transport configured' };
}
