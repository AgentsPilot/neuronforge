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

  // 4. Nothing configured / all failed → console preview, report not sent
  logger.warn(
    { to: p.to, subject: p.subject, errors: errors.length ? errors : undefined },
    'No email transport delivered the message (preview only)'
  );
  console.warn('📧 [EmailTransport] Email NOT sent — no working transport. Preview:', {
    to: p.to,
    subject: p.subject,
  });
  return { sent: false, provider: 'none', error: errors.join('; ') || 'no email transport configured' };
}
