/**
 * Telling a client their quote request arrived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A METHOD ON `BookingEmailService`
 *
 * There is no booking. A quoted service sold without a consultation produces a
 * contact, an activity and nothing else — no appointment, no invoice, no price.
 * Every method on `BookingEmailService` starts by loading a booking row, and a
 * confirmation that had to invent one would be the fiction the quote-request
 * route exists to avoid.
 *
 * The OTHER case, where the client did book a consultation, is already served
 * by `BookingEmailService.sendBookingConfirmation` against the real row. The
 * two cases send different emails because they are telling the client different
 * things: one says "you have an appointment", this one says "we have your
 * request".
 *
 * @module lib/services/QuoteRequestEmailService
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { resolveEmailBranding } from '@/lib/email/branding';
import { generateQuoteReceivedEmail } from '@/lib/email/templates/quote-received';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
import { getBusinessLocale } from '@/lib/services/BookingEmailService';
import { safeTimezone } from '@/lib/scheduling/businessTime';

const logger = createLogger({ service: 'QuoteRequestEmailService' });

export interface QuoteReceivedEmailInput {
  ownerId: string;
  /** Null when the contact could not be resolved; the email still sends. */
  contactId: string | null;
  clientEmail: string;
  clientName: string;
  serviceName: string;
  note?: string | null;
  /** The business's zone, so the receipt is dated as the business reckons it. */
  timezone?: string | null;
}

export interface QuoteReceivedEmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Send the client their receipt. Never throws.
 *
 * A failure here must not fail the request: the contact is saved and the
 * activity is logged before this runs, so a missing email is recoverable and a
 * lost request is not.
 */
export async function sendQuoteReceivedEmail(
  input: QuoteReceivedEmailInput
): Promise<QuoteReceivedEmailResult> {
  const log = logger.child({ ownerId: input.ownerId, contactId: input.contactId });

  try {
    // Client-facing, so it speaks the business's language like the rest.
    const locale = await getBusinessLocale(input.ownerId);

    const { data: profile } = await businessProfileRepository.findByUserId(input.ownerId);
    const branding = await resolveEmailBranding(input.ownerId, locale, profile);

    const { subject, html } = generateQuoteReceivedEmail({
      clientName: input.clientName,
      serviceName: input.serviceName,
      note: input.note,
      submittedAt: new Date(),
      // `safeTimezone` so an unset or malformed zone cannot throw inside a
      // date formatter and take the email with it.
      timezone: safeTimezone(input.timezone ?? undefined),
      branding,
      locale,
    });

    const result = await sendEmail({
      kind: 'transactional',
      to: [input.clientEmail],
      subject,
      html,
      ownerUserId: input.ownerId,
    });

    if (result.sent) {
      log.info({ provider: result.provider }, 'Quote request receipt sent');
    } else {
      log.warn({ error: result.error }, 'Quote request receipt reached no transport');
    }

    recordEmailSend({
      userId: input.ownerId,
      contactId: input.contactId,
      toEmail: input.clientEmail,
      subject,
      bodyHtml: html,
      result,
    }).catch(err => log.warn({ err }, 'Email logging failed (non-blocking)'));

    return { sent: result.sent, error: result.error };
  } catch (error) {
    log.error({ err: error }, 'Quote request receipt failed');
    return { sent: false, error: error instanceof Error ? error.message : 'unknown' };
  }
}
