// lib/notifications/emailTransport.ts
// Provider-agnostic transactional email sender.
//
// Sends via whatever is configured, in priority order, with automatic fallback:
//   1. Resend            (if RESEND_API_KEY looks valid — starts with "re_")
//   2. SMTP              (if SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS)
//   3. Gmail OAuth2      (if GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN)
//   4. console preview   (dev) — returns { sent: false }
//
// Best-effort: never throws. Returns a structured result so callers can log
// honestly. Used by NotificationService (calibration result + human-approval
// step emails).

import nodemailer from 'nodemailer';
import { createLogger } from '@/lib/logger';
// D12: htmlToText now lives in ONE shared util. Re-exported below so existing
// callers (and the D9 test importing it from here) keep working unchanged.
import { htmlToText } from '@/lib/email/htmlToText';

export { htmlToText };

const logger = createLogger({ module: 'EmailTransport', service: 'notifications' });

const RESEND_DEFAULT_FROM = 'NeuronForge <notifications@neuronforge.app>';

export interface EmailAttachment {
  /** Filename to display in the email */
  filename: string;
  /** File content as Buffer or base64 string */
  content: Buffer | string;
  /** MIME type (e.g., 'application/pdf') */
  contentType: string;
}

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
  /** Resend honors this (verified domain required); SMTP/Gmail use configured sender. */
  from?: string;
  /** Optional file attachments */
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  sent: boolean;
  provider: 'resend' | 'smtp' | 'gmail' | 'none';
  error?: string;
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

function smtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
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
  // Build request body
  const body: Record<string, unknown> = {
    from: p.from || process.env.RESEND_FROM_EMAIL || RESEND_DEFAULT_FROM,
    to: p.to,
    subject: p.subject,
    html: p.html,
    text: resolveText(p), // D9: multipart/alternative — plaintext part alongside HTML
  };

  // Add attachments if present (Resend format)
  // Resend expects: { filename, content (base64 string), type (optional mime type) }
  if (p.attachments && p.attachments.length > 0) {
    body.attachments = p.attachments.map(att => {
      const content = Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content;
      logger.info({
        filename: att.filename,
        contentType: att.contentType,
        contentLength: content.length,
        isBase64: typeof content === 'string' && content.length > 0
      }, 'Preparing attachment for Resend');
      return {
        filename: att.filename,
        content,
        type: att.contentType, // Add MIME type for proper handling
      };
    });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    logger.error({ status: res.status, error: errorText }, 'Resend API error');
    throw new Error(`Resend API error (${res.status}): ${errorText}`);
  }
}

/**
 * Send via SMTP using nodemailer.
 * Supports any SMTP server (Gmail, Outlook, SendGrid, custom, etc.)
 */
async function sendViaSMTP(p: SendEmailParams): Promise<void> {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure, // true for 465, false for other ports (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Build mail options
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME || 'NeuronForge';

  const mailOptions: nodemailer.SendMailOptions = {
    from: p.from || `"${fromName}" <${fromEmail}>`,
    to: p.to.join(', '),
    subject: p.subject,
    html: p.html,
    text: resolveText(p),
  };

  // Add attachments if present (nodemailer format)
  if (p.attachments && p.attachments.length > 0) {
    logger.info({
      attachmentCount: p.attachments.length,
      attachments: p.attachments.map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        size: Buffer.isBuffer(a.content) ? a.content.length : (typeof a.content === 'string' ? a.content.length : 0)
      }))
    }, 'Preparing attachments for SMTP');
    mailOptions.attachments = p.attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    }));
  }

  await transporter.sendMail(mailOptions);
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

  // Build mail options
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"NeuronForge" <${process.env.GMAIL_USER}>`,
    to: p.to.join(', '),
    subject: p.subject,
    html: p.html,
    text: resolveText(p), // D9: multipart/alternative — nodemailer builds both parts
  };

  // Add attachments if present (nodemailer format)
  if (p.attachments && p.attachments.length > 0) {
    logger.info({
      attachmentCount: p.attachments.length,
      attachments: p.attachments.map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        size: Buffer.isBuffer(a.content) ? a.content.length : (typeof a.content === 'string' ? a.content.length : 0)
      }))
    }, 'Preparing attachments for Gmail');
    mailOptions.attachments = p.attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    }));
  }

  await transporter.sendMail(mailOptions);
}

/**
 * Send a transactional email via the first configured/working provider.
 * Never throws — returns { sent, provider, error }.
 */
export async function sendEmail(p: SendEmailParams): Promise<SendEmailResult> {
  const errors: string[] = [];

  // Log email send attempt with attachment info
  logger.info({
    to: p.to,
    subject: p.subject?.substring(0, 50),
    hasAttachments: !!(p.attachments && p.attachments.length > 0),
    attachmentCount: p.attachments?.length || 0,
    attachmentDetails: p.attachments?.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      size: Buffer.isBuffer(a.content) ? a.content.length : (typeof a.content === 'string' ? a.content.length : 0)
    })),
    resendConfigured: resendConfigured(),
    smtpConfigured: smtpConfigured(),
    gmailConfigured: gmailConfigured(),
  }, 'Attempting to send email');

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

  // 2. SMTP (universal - works with any email provider)
  if (smtpConfigured()) {
    try {
      await sendViaSMTP(p);
      logger.info({ to: p.to, provider: 'smtp', host: process.env.SMTP_HOST }, 'Email sent');
      return { sent: true, provider: 'smtp' };
    } catch (err: any) {
      errors.push(`smtp: ${err?.message ?? err}`);
      logger.warn({ err: err?.message ?? String(err), host: process.env.SMTP_HOST }, 'SMTP send failed — trying next transport');
    }
  }

  // 3. Gmail OAuth2 (nodemailer) — shared env "system" account
  if (gmailConfigured()) {
    try {
      await sendViaGmail(p);
      logger.info({ to: p.to, provider: 'gmail' }, 'Email sent');
      return { sent: true, provider: 'gmail' };
    } catch (err: any) {
      errors.push(`gmail: ${err?.message ?? err}`);
      logger.warn({ err: err?.message ?? String(err) }, 'Gmail send failed');
    }
  }

  // 4. Nothing configured / all failed → report not sent (structured Pino only)
  logger.warn(
    { to: p.to, subject: p.subject, errors: errors.length ? errors : undefined },
    'No email transport delivered the message (preview only)'
  );
  return { sent: false, provider: 'none', error: errors.join('; ') || 'no email transport configured' };
}
