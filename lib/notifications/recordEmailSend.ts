/**
 * Record that a piece of mail went out — for every sender, not just one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MOVED OUT OF `BookingEmailService`
 *
 * It lived there as a module-private function, so booking mail was the only mail
 * this platform had any record of. Fifteen modules call `sendEmail` — proposals,
 * invoices, payment reminders, lead links, double opt-in, the chat's own
 * `emailSend` — and fourteen of them wrote nothing.
 *
 * That is what a delivery webhook needs to match against. Without a row carrying
 * the provider's message id, every `email.delivered` and `email.bounced` event
 * for those fourteen resolves to "no `email_sends` row carries this message id"
 * and is discarded — correctly, and for ever. So a bounced invoice, which is
 * precisely the thing a business needs to know about, was unknowable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NEVER THROWS, AND CALLERS DEPEND ON THAT
 *
 * Recording a send is bookkeeping; the send already happened. A failure here
 * must not turn a delivered email into an error response, so everything is
 * caught and logged. Callers may still `.catch()` defensively — that is
 * redundant rather than wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT LIVES
 *
 * `lib/notifications/`, beside the transport whose result it consumes, rather
 * than in `lib/services/` — which would make five services import a sixth for
 * one helper. Neither `emailTransport` nor `EmailAutomationRepository` imports
 * the other, so there is no cycle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';
import type { SendEmailResult } from '@/lib/notifications/emailTransport';

const logger = createLogger({ module: 'recordEmailSend' });

export interface RecordEmailSendParams {
  userId: string;
  /**
   * The client this mail concerns, or null.
   *
   * Null is not an error: owner-facing mail — a daily briefing, a dispute alert
   * — belongs to no contact. Nothing is recorded in that case, because
   * `email_sends.contact_id` is `NOT NULL` and a trigger on the table inserts
   * into `crm_activities`, whose own `contact_id` is also `NOT NULL`. Passing
   * null there would not merely skip the row, it would roll the whole insert
   * back. See the note in the delivery migration.
   */
  contactId: string | null;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  result: SendEmailResult;
}

export async function recordEmailSend(params: RecordEmailSendParams): Promise<void> {
  const { userId, contactId, toEmail, subject, bodyHtml, result } = params;

  // Skip logging if no contact_id (can't associate with a contact)
  if (!contactId) {
    logger.debug({ toEmail, subject }, 'Skipping email log - no contact_id');
    return;
  }

  try {
    /*
     * The transport that actually sent it.
     *
     * This was `result.provider === 'resend' ? 'resend' : 'resend'` — a ternary
     * whose two branches are the same value, so every row claimed Resend
     * whatever had really sent the mail. An SMTP or Gmail send was recorded as
     * Resend, and the column became unable to hold a fact.
     *
     * It cost a real investigation: 63 rows all reading `resend` were taken as
     * proof the platform was on Resend, while its API key is configured
     * nowhere — meaning those sends went out over one of the other two
     * transports and nothing in the database could say which.
     */
    const provider = result.provider;

    await emailSendRepository.create({
      user_id: userId,
      contact_id: contactId,
      to_email: toEmail,
      subject,
      body_html: bodyHtml,
      status: result.sent ? 'sent' : 'failed',
      /*
       * Null when the send failed, and that is load-bearing.
       *
       * `emails_sent_30d` filters on `sent_at`, so a failed attempt stays out of
       * the count without needing to be filtered by status as well.
       */
      sent_at: result.sent ? new Date().toISOString() : null,
      provider,
      /*
       * The provider's own id, not null.
       *
       * This was hardcoded `null` while the transport discarded Resend's
       * response body entirely, so no row on the platform had one — and
       * without it a delivery webhook has no way to find the send an event
       * belongs to. `opened_at` and `clicked_at` were columns nothing could
       * ever write.
       *
       * Absent for SMTP and Gmail, neither of which returns such a handle — so
       * mail sent from a laptop can never be matched to a delivery event.
       */
      provider_message_id: result.providerMessageId ?? null,
      error_message: result.error || null,
      sequence_id: null,
      sequence_step_id: null,
      campaign_id: null,
      open_count: 0,
      click_count: 0,
      delivered_at: null,
      opened_at: null,
      clicked_at: null
    });

    logger.debug({ contactId, subject, sent: result.sent }, 'Email logged to email_sends');
  } catch (err) {
    // Non-blocking - just log the error
    logger.warn({ err, contactId, subject }, 'Failed to log email to email_sends (non-blocking)');
  }
}
