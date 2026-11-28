/**
 * Tell the admins when the allow-list blocked an email (PROD-1 S3.3c, lean).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. While the recipient guard is on (`recipientAllowList.ts`), a test mail to
 * an address that is not on the list is refused with only a log line, and
 * nobody reads the logs while testing. This sends a short email to the admins
 * instead, so "the mail never arrived" is answered at once.
 *
 * WHAT IT IS: a best-effort diagnostic, not a record.
 *   - Only on a Vercel deployment (`VERCEL=1`) while the guard is on. Local
 *     development has the terminal log; Jest never sets `VERCEL`, so tests do
 *     nothing here and reach no network.
 *   - At most one alert per source every 10 minutes per server instance, so a
 *     run that refuses fifty sends, or the public contact form, cannot flood
 *     the admins. The alert says so.
 *   - Recipients are masked (`j***@domain`), never shown in full. The domain is
 *     kept because it is what decides "add this address" vs "add the domain".
 *   - Sent only to admins who are themselves on the allow-list, each checked on
 *     its own, so the alert can never be refused and cannot alert about itself.
 *   - Never throws and never changes the refusal it reports.
 *
 * `emailTransport` and `AdminAccessService` are imported lazily: the transport
 * imports this module, and the plugin executors should not pull the admin
 * repository in at load time for a path that is off in production.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sources: `email_transport`, `gmail`, `outlook`, `google_calendar`,
 * `contact_form_confirmation`, `contact_form_notification`.
 *
 * @module lib/email/blockedEmailAlert
 */

import { createLogger } from '@/lib/logger';
import { checkOutboundRecipients, isRecipientGuardOn } from '@/lib/email/recipientAllowList';
import { escapeHtml } from '@/lib/email/escapeHtml';

const logger = createLogger({ module: 'blockedEmailAlert' });

export const ALERT_THROTTLE_MS = 10 * 60 * 1000;
const MAX_LISTED_RECIPIENTS = 10;
const BRACKETED = /<([^<>]*)>\s*$/;
const DOMAIN_SHAPE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
/* A letter or digit only: never a bidi override or a zero-width character. */
const SHOWABLE_FIRST = /^[\p{L}\p{N}]$/u;

export interface BlockedEmailAlert {
  /** Which sender refused, e.g. `email_transport`, `gmail`, `outlook`, `google_calendar`, `contact_form`. */
  source: string;
  /** What it was doing, e.g. `send_email`, `create_event`, or the transport's consent kind. */
  action: string;
  /** The recipients as the caller held them. Only the refused ones are listed, masked. */
  recipients: readonly string[];
}

/* Per-instance throttle: source → last alert time. */
const lastAlertAt = new Map<string, number>();

/** `j***@domain.example`, `***@domain.example` for a short or odd local part, or `(unreadable)`. */
export function maskRecipient(value: string): string {
  const raw = String(value ?? '').trim();
  const bracketed = raw.match(BRACKETED);
  const address = (bracketed ? bracketed[1] : raw).trim().toLowerCase();
  const at = address.lastIndexOf('@');
  const local = at > 0 ? address.slice(0, at) : '';
  const domain = at > 0 ? address.slice(at + 1) : '';
  if (!local || !DOMAIN_SHAPE.test(domain)) return '(unreadable)';
  const first = Array.from(local)[0] ?? '';
  const shown = Array.from(local).length >= 3 && SHOWABLE_FIRST.test(first) ? first : '';
  return `${shown}***@${domain}`;
}

/** The refused recipients, masked, de-duplicated, capped. */
function refusedMasked(recipients: readonly string[]): { listed: string[]; more: number } {
  const masked = new Set<string>();
  for (const element of recipients) {
    for (const part of String(element ?? '').split(/[,;]/)) {
      if (part.trim().length === 0) continue;
      if (!checkOutboundRecipients([part]).allowed) masked.add(maskRecipient(part));
    }
  }
  const all = Array.from(masked).sort();
  return { listed: all.slice(0, MAX_LISTED_RECIPIENTS), more: Math.max(0, all.length - MAX_LISTED_RECIPIENTS) };
}

function environmentLabel(): string {
  const env = process.env.VERCEL_ENV;
  return env === 'production' || env === 'preview' || env === 'development' ? env : 'unknown';
}

/** Is the alert live here? Literal env reads so the Environment page's drift guard can see them. */
export function isBlockedEmailAlertOn(): boolean {
  return process.env.VERCEL === '1' && isRecipientGuardOn();
}

/**
 * Email the allowed admins about one refusal. Fire-and-forget safe: the promise
 * never rejects. Callers that are already async may await it; sync callers use
 * `void alertBlockedEmail(...)`.
 */
export async function alertBlockedEmail(alert: BlockedEmailAlert): Promise<void> {
  try {
    if (!isBlockedEmailAlertOn()) return;

    const now = Date.now();
    const last = lastAlertAt.get(alert.source);
    if (last !== undefined && now - last < ALERT_THROTTLE_MS) return;
    lastAlertAt.set(alert.source, now);

    const { AdminAccessService } = await import('@/lib/services/AdminAccessService');
    const admins = Array.from(
      new Set((await AdminAccessService.getInstance().listAdminEmails()).map((e) => e.trim().toLowerCase()))
    ).filter((e) => e.length > 0 && checkOutboundRecipients([e]).allowed);

    if (admins.length === 0) {
      logger.warn({ source: alert.source }, 'Blocked-email alert not sent: no admin address is on the allow-list');
      return;
    }

    const env = environmentLabel();
    const { listed, more } = refusedMasked(alert.recipients);
    const subject = `[${env}] An email was blocked by the allow-list (${alert.source})`;
    const recipientLine =
      alert.recipients.length === 0
        ? 'Recipients: not checked (this action is refused whenever the allow-list guard is on)'
        : `Recipients: ${listed.length > 0 ? listed.join(', ') : '(none listed)'}${more > 0 ? ` and ${more} more` : ''}`;
    const lines = [
      `An email was not sent on the ${env} deployment because of the allow-list (EMAIL_RECIPIENT_ALLOWLIST).`,
      `Source: ${alert.source}`,
      `Action: ${alert.action}`,
      recipientLine,
      'If the address was meant to receive mail, add it (or its domain) to EMAIL_RECIPIENT_ALLOWLIST. Otherwise no action is needed.',
      `Further blocks from this source in the next ${ALERT_THROTTLE_MS / 60000} minutes are not alerted.`,
    ];

    const { sendEmail, platformSenderAddress } = await import('@/lib/notifications/emailTransport');
    for (const admin of admins) {
      const result = await sendEmail({
        kind: 'transactional',
        to: [admin],
        from: platformSenderAddress(),
        subject,
        text: lines.join('\n\n'),
        html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
        redactRecipientInLogs: true,
      });
      if (!result.sent) logger.warn({ source: alert.source, provider: result.provider }, 'Blocked-email alert send failed');
    }
  } catch (err) {
    logger.warn({ err, source: alert.source }, 'Blocked-email alert failed (non-blocking)');
  }
}

/** Test hook: forget the throttle. */
export function resetBlockedEmailAlertThrottle(): void {
  lastAlertAt.clear();
}
