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
import { marketingGate, type MarketingBlockReason } from '@/lib/consent/marketingGate';

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

/**
 * What kind of message this is, in the sense the law cares about.
 *
 * Required, with no default, and that is the whole design. This is the only
 * email transport in the product, so a new call site that forgets to say which
 * kind it is fails to COMPILE — rather than sending an ungated marketing email
 * and being discovered afterwards.
 *
 * `transactional` is anything the recipient's own action asked for: booking
 * confirmations, reminders, invoices, receipts, refunds, proposals, a reply to
 * an enquiry. No consent needed, and nothing about these changed.
 *
 * `marketing` is anything sent because the business wanted to reach them:
 * follow-up nudges to lapsed clients, owner-written broadcasts, automated
 * solicitations on a timer. These go through `marketingGate`.
 *
 * `ownerUserId` is required on marketing because consent is per business —
 * there is no way to ask the question without knowing whose list it is.
 */
export type EmailKind =
  | { kind: 'transactional' }
  | {
      kind: 'marketing';
      ownerUserId: string;
      /** For the audit line only. The address is the key consent is held against. */
      contactId?: string | null;
    };

export interface SendEmailBase {
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
  /**
   * Where a reply goes.
   *
   * The address a client hits Reply on. This is how a booking confirmation gets
   * answered by the business rather than by the platform, and it needs no domain
   * verification — unlike `from`, which must stay on a domain we can sign for.
   */
  replyTo?: string;
  /**
   * Where this particular email can be switched off, for the `List-Unsubscribe`
   * header.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * SUPPLIED PER SEND, never derived. A booking confirmation must NOT carry
   * one: the client cannot unsubscribe from the confirmation of an appointment
   * they just made, and offering it invites them to try. Only recurring mail
   * the recipient chose to receive passes this — the morning briefing, and
   * marketing once that is switched on.
   *
   * WHY IT MATTERS BEYOND POLITENESS. Microsoft and Gmail both read the header
   * as a marker of a sender who behaves properly, and its absence as one more
   * reason to doubt. A morning briefing from this platform was quarantined by
   * Exchange as "High Confidence Phish" — with SPF, DKIM and DMARC all passing
   * — so every remaining signal is worth removing.
   *
   * One-click (RFC 8058) is deliberately NOT declared: it requires an endpoint
   * that unsubscribes on an unauthenticated POST, and advertising one that does
   * not exist is worse than advertising nothing. The URL form sends the reader
   * to a page where they confirm.
   *
   * `lib/consent/marketingGate.ts` names this header as one of three things
   * that must exist before marketing sending can be switched on.
   * ───────────────────────────────────────────────────────────────────────────
   */
  unsubscribeUrl?: string;
  /**
   * The business this email is sent on behalf of.
   *
   * Every booking email passed this already and the transport ignored it — it
   * was not even a parameter, so the value was dropped and every client received
   * mail from "NeuronForge". Given it, the sender is presented as the business
   * and replies go to the owner.
   */
  ownerUserId?: string;
  /**
   * Keep the recipient address out of this send's log lines (opt-in).
   *
   * Every other sender logs `to` at info, which is how an operator follows a
   * booking email. A security message is different: the invite-signup code
   * email is sent to someone who is not yet a customer, and its recipient must
   * not sit in the logs next to "a sign-up code was sent". With this set, `to`
   * is logged masked (`d•••@example.com`) and any email-shaped text in a
   * provider's error message is replaced before it is logged or returned.
   * The mail itself is unchanged.
   */
  redactRecipientInLogs?: boolean;
  /**
   * Strings that must never appear in this send's log lines or returned error
   * (opt-in; invite signup Slice 2a, SA F-4 / R-9).
   *
   * The invitation email carries a one-time link whose token is a credential
   * until it is used. A provider that rejects a send may echo part of the body
   * in its error text, and that text is logged and returned. Every string listed
   * here is replaced with `[redacted]` in exactly that text, alongside the
   * `redactRecipientInLogs` masking. Pass the RAW token as well as the link: an
   * HTML-escaped or URL-encoded copy of the link no longer contains the link,
   * but it still contains the token verbatim.
   *
   * The body is never logged by this transport. The subject IS logged (its
   * first 50 characters on the attempt and refusal lines, all of it on the
   * final "no transport delivered" warning), so a caller must never put a
   * secret in the subject; the invitation's subject carries no link. That
   * leaves the error text as the only place such a string could surface. The
   * mail is unchanged.
   */
  redactInLogs?: string[];
  /** Optional file attachments */
  attachments?: EmailAttachment[];
}

export type SendEmailParams = SendEmailBase & EmailKind;

export interface SendEmailResult {
  sent: boolean;
  provider: 'resend' | 'smtp' | 'gmail' | 'none';
  error?: string;
  /**
   * The provider's own id for this message.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * The single thing that makes delivery observable. Resend returns `{ id }`
   * from its send call and this code discarded the whole response body — so
   * `email_sends.provider_message_id` was null on all 63 rows, and there was
   * no key to match a webhook event back to the send it belonged to.
   *
   * The consequence: `opened_at`, `clicked_at` and `delivered_at` existed as
   * columns and were never written. Sixty emails sent, zero known to have been
   * read — so "your chase emails are not being opened", the most actionable
   * thing the platform could tell an owner about the automations they switched
   * on, was unanswerable.
   *
   * Absent for SMTP and Gmail, which return no such handle.
   * ─────────────────────────────────────────────────────────────────────────
   */
  providerMessageId?: string;
  /**
   * Refused before any transport was touched.
   *
   * NOT a delivery failure, and callers must not treat it as one. A blocked
   * send is a final decision — retrying it produces the same answer, so a
   * caller that throws here will have its queue row retried forever. Close the
   * row as skipped instead.
   */
  blocked?: MarketingBlockReason | 'multi_recipient';
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

/**
 * The `List-Unsubscribe` header, or nothing.
 *
 * Angle brackets are required by RFC 2369 — a bare URL is ignored by the
 * clients this exists to satisfy.
 */
function unsubscribeHeaders(p: SendEmailParams): Record<string, string> {
  const url = p.unsubscribeUrl?.trim();
  if (!url) return {};
  return { 'List-Unsubscribe': `<${url}>` };
}

const EMAIL_SHAPED = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g;

/** `dana@example.com` → `d•••@example.com`. */
function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${Array.from(address.slice(0, at))[0]}•••@${address.slice(at + 1)}`;
}

/** The recipients as this send may log them (`redactRecipientInLogs`). */
function recipientsForLog(p: SendEmailBase): string[] {
  return p.redactRecipientInLogs ? p.to.map(maskAddress) : p.to;
}

/**
 * A provider's error text as this send may log or return it.
 *
 * `redactInLogs` first, longest string first, so a link is replaced whole
 * before the token inside it; then email-shaped text for `redactRecipientInLogs`.
 * Empty strings are ignored: `split('')` would redact between every character.
 */
function errorTextForLog(p: SendEmailBase, text: string): string {
  let out = text;
  const secrets = (p.redactInLogs ?? []).filter((value) => typeof value === 'string' && value.length > 0);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  return p.redactRecipientInLogs ? out.replace(EMAIL_SHAPED, '[email]') : out;
}

/** `user@domain.tld`, one `@`, no spaces or brackets: the shape of a sending address. */
const SENDER_ADDRESS_SHAPE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;

/**
 * The platform's configured sending ADDRESS, from `RESEND_FROM_EMAIL` only, or
 * `undefined` (invite signup Slice 2a, SA R-2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAILS CLOSED, ON PURPOSE. Unlike `sendEmail`'s own default, this never falls
 * back to `RESEND_DEFAULT_FROM` (a NeuronForge address). The invitation email
 * is the first mail an invitee ever gets from us, and a brand they have never
 * heard of on it is exactly what the requirement rules out; a caller that gets
 * `undefined` records "not sent" and the admin copies the link instead.
 *
 * Accepts `Name <address>` and a bare `address`; returns the address part,
 * trimmed, only when it has the shape of one. The display name in the variable
 * is ignored: the caller sets its own.
 *
 * Other senders are unaffected: this is read by nobody else.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function platformSenderAddress(): string | undefined {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  if (!configured) return undefined;
  const bracketed = configured.match(/<([^<>]*)>\s*$/);
  const address = (bracketed ? bracketed[1] : configured).trim();
  if (!bracketed && /[<>]/.test(configured)) return undefined;
  return SENDER_ADDRESS_SHAPE.test(address) ? address : undefined;
}

/** Returns the provider's message id, or undefined when it cannot be read. */
async function sendViaResend(p: SendEmailParams): Promise<string | undefined> {
  // Build request body
  const body: Record<string, unknown> = {
    from: p.from || process.env.RESEND_FROM_EMAIL || RESEND_DEFAULT_FROM,
    to: p.to,
    subject: p.subject,
    html: p.html,
    text: resolveText(p), // D9: multipart/alternative — plaintext part alongside HTML
    // So a client's reply reaches the business, not an unattended platform inbox.
    ...(p.replyTo ? { reply_to: p.replyTo } : {}),
  };

  const unsub = unsubscribeHeaders(p);
  if (Object.keys(unsub).length > 0) body.headers = unsub;

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
    const errorText = errorTextForLog(p, await res.text());
    logger.error({ status: res.status, error: errorText }, 'Resend API error');
    throw new Error(`Resend API error (${res.status}): ${errorText}`);
  }

  /*
   * `{ id }`, and it is the whole point of reading this response.
   *
   * A body that cannot be parsed is not a failed send — the mail has gone. It
   * costs the tracking for that one message and nothing else, so it degrades
   * to undefined rather than throwing.
   */
  try {
    const payload = (await res.json()) as { id?: string };
    return typeof payload?.id === 'string' ? payload.id : undefined;
  } catch {
    logger.warn('Resend accepted the send but its response could not be read; delivery will not be tracked');
    return undefined;
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
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
    to: p.to.join(', '),
    subject: p.subject,
    html: p.html,
    text: resolveText(p),
    // Same header as the Resend path, from the same builder.
    headers: unsubscribeHeaders(p),
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
    // Gmail forces the authenticated account as the sender, so the business's
    // name cannot appear here — but a reply can still reach the owner.
    from: p.from || `"NeuronForge" <${process.env.GMAIL_USER}>`,
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
    to: p.to.join(', '),
    subject: p.subject,
    html: p.html,
    text: resolveText(p), // D9: multipart/alternative — nodemailer builds both parts
    // Same header as the other two transports, from the same builder.
    headers: unsubscribeHeaders(p),
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
/**
 * Who the client sees the email from, and where a reply goes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking confirmation is from the practice, not from us. Every one of these
 * went out as "NeuronForge <notifications@neuronforge.app>", so a client
 * received an appointment reminder from a company they have never heard of, and
 * hitting Reply reached nobody.
 *
 * The display NAME becomes the business and Reply-To becomes the owner. The
 * envelope address deliberately stays on our own verified domain: SPF and DKIM
 * are published for it, and forging a From on a domain we cannot sign for is how
 * mail lands in spam or is rejected outright. A client sees the business's name
 * in their inbox and replies reach the owner — which is the whole of what is
 * wanted here, without breaking deliverability to get it.
 *
 * A business that wants its own address in the envelope needs its domain
 * verified with the provider; that is a separate, opt-in piece of work.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The address a client should reach when they reply to, or RSVP to, this mail.
 *
 * Exported for the calendar invite: an `.ics` names an ORGANIZER, and naming
 * the platform's own no-reply mailbox there — as the invite generator used to
 * — points every acceptance at a mailbox nobody reads. Returns undefined when
 * the owner cannot be resolved, and the invite then omits ORGANIZER entirely,
 * which imports cleanly rather than naming the wrong person.
 */
export async function resolveOwnerReplyTo(ownerUserId: string | undefined): Promise<string | undefined> {
  if (!ownerUserId) return undefined;
  const { replyTo } = await resolveSender(ownerUserId, '');
  return replyTo;
}

async function resolveSender(
  ownerUserId: string | undefined,
  fallbackFrom: string
): Promise<{ from: string; replyTo?: string }> {
  if (!ownerUserId) return { from: fallbackFrom };

  try {
    const { supabaseServer } = await import('@/lib/supabaseServer');
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('company_name')
      .eq('user_id', ownerUserId)
      .maybeSingle();

    const { data: authUser } = await supabaseServer.auth.admin.getUserById(ownerUserId);
    const ownerEmail = authUser?.user?.email || undefined;

    const address = fallbackFrom.match(/<([^>]+)>/)?.[1] || fallbackFrom;
    const name = profile?.company_name?.trim();

    return {
      // Quoted: a business name with a comma in it splits the header otherwise.
      from: name ? `"${name.replace(/"/g, '')}" <${address}>` : fallbackFrom,
      replyTo: ownerEmail,
    };
  } catch (err) {
    // Never block a send on this. An email from the platform's own name still
    // reaches the client; an email that was not sent does not.
    logger.warn({ err, ownerUserId }, 'Could not resolve business sender — using the platform default');
    return { from: fallbackFrom };
  }
}

export async function sendEmail(p: SendEmailParams): Promise<SendEmailResult> {
  const errors: string[] = [];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The consent gate. Before any transport, before the sender is even resolved.
   *
   * Transactional mail returns from this block untouched — the check below is
   * the only thing that happens to it, and it is a single comparison. Bookings,
   * invoices, receipts, refunds and proposals behave exactly as they did.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (p.kind === 'marketing') {
    // Consent is held per person. A marketing send that names several
    // recipients cannot be checked, so it is refused rather than approximated.
    // Every current caller sends to one address, so this costs nothing today
    // and closes the hole where a future one batches.
    if (p.to.length !== 1) {
      logger.warn(
        { ownerUserId: p.ownerUserId, recipientCount: p.to.length },
        'Refused a marketing send addressed to more than one recipient'
      );
      return { sent: false, provider: 'none', blocked: 'multi_recipient' };
    }

    const verdict = await marketingGate.check(p.ownerUserId, p.to[0]);
    if (!verdict.allowed) {
      logger.warn(
        {
          ownerUserId: p.ownerUserId,
          contactId: p.contactId ?? null,
          reason: verdict.reason,
          subject: p.subject?.substring(0, 50),
        },
        'Refused a marketing send'
      );
      return { sent: false, provider: 'none', blocked: verdict.reason };
    }
  }

  // Log email send attempt with attachment info
  logger.info({
    to: recipientsForLog(p),
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

  /*
   * Resolved once, before any transport: all three need the same answer, and
   * the fallback chain must not ask the database three times.
   */
  const sender = await resolveSender(
    p.ownerUserId,
    p.from || process.env.RESEND_FROM_EMAIL || RESEND_DEFAULT_FROM
  );
  p = { ...p, from: sender.from, replyTo: p.replyTo || sender.replyTo };

  // 1. Resend (preferred for production)
  if (resendConfigured()) {
    try {
      const providerMessageId = await sendViaResend(p);
      logger.info({ to: recipientsForLog(p), provider: 'resend', providerMessageId }, 'Email sent');
      return { sent: true, provider: 'resend', providerMessageId };
    } catch (err: any) {
      const message = errorTextForLog(p, String(err?.message ?? err));
      errors.push(`resend: ${message}`);
      logger.warn({ err: message }, 'Resend send failed — trying next transport');
    }
  } else if (process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is set but is not a valid Resend key (must start with "re_") — skipping Resend');
  }

  // 2. SMTP (universal - works with any email provider)
  if (smtpConfigured()) {
    try {
      await sendViaSMTP(p);
      logger.info({ to: recipientsForLog(p), provider: 'smtp', host: process.env.SMTP_HOST }, 'Email sent');
      return { sent: true, provider: 'smtp' };
    } catch (err: any) {
      const message = errorTextForLog(p, String(err?.message ?? err));
      errors.push(`smtp: ${message}`);
      logger.warn({ err: message, host: process.env.SMTP_HOST }, 'SMTP send failed — trying next transport');
    }
  }

  // 3. Gmail OAuth2 (nodemailer) — shared env "system" account
  if (gmailConfigured()) {
    try {
      await sendViaGmail(p);
      logger.info({ to: recipientsForLog(p), provider: 'gmail' }, 'Email sent');
      return { sent: true, provider: 'gmail' };
    } catch (err: any) {
      const message = errorTextForLog(p, String(err?.message ?? err));
      errors.push(`gmail: ${message}`);
      logger.warn({ err: message }, 'Gmail send failed');
    }
  }

  // 4. Nothing configured / all failed → report not sent (structured Pino only)
  logger.warn(
    { to: recipientsForLog(p), subject: p.subject, errors: errors.length ? errors : undefined },
    'No email transport delivered the message (preview only)'
  );
  return { sent: false, provider: 'none', error: errors.join('; ') || 'no email transport configured' };
}
