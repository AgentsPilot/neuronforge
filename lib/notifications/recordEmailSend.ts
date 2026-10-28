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
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
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
  /**
   * The booking this mail was about, where it was about one.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS EXISTS
   *
   * `email_sends` had no link to a booking at all, so the contact drawer's
   * journey matched them by GUESSING — the booking's creation time plus the
   * service name. That held while a booking had one appointment and one
   * confirmation; it cannot work now that a booking rescheduled after a
   * no-show has several attempts, each with its own mail, because a heuristic
   * keyed on when the BOOKING was created cannot tell them apart.
   *
   * Optional, and null for everything that genuinely concerns no booking: a
   * campaign, a sequence step, a daily briefing.
   */
  bookingId?: string | null;
  /**
   * The specific ATTEMPT this mail was about.
   *
   * `bookingId` says which job; this says which of its appointments, which is
   * what lets the journey put a confirmation under the meeting it confirmed and
   * a reschedule request under the one that was missed, rather than stacking
   * every mail on the first attempt.
   *
   * Null where the mail is about the job rather than one appointment — an
   * invoice, a quote, a thank-you.
   */
  meetingId?: string | null;
  /**
   * Was this a REPEAT of mail the client already had?
   *
   * The owner pressing "send again". Recorded rather than derived, because the
   * obvious derivation is wrong: every reschedule notice shares one subject, so
   * "this subject appeared before" would label the second genuine notice a
   * resend of the first.
   */
  isResend?: boolean;
  /**
   * WHAT this message was, as its sender knew it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * RECORDED, NOT READ BACK OUT OF THE SUBJECT
   *
   * The journey used to print the raw subject, which on one booking repeats the
   * service name on every row and says nothing the owner did not already know.
   * The kind is what they actually want: a confirmation, a reschedule notice, a
   * reminder.
   *
   * The subject cannot answer it. It is composed for the CLIENT, in the
   * client's language, so matching on it fails the moment an owner's language
   * and their client's differ — and a template edit would silently change what
   * the code believes a message was. Every sender already knows; the fact was
   * simply being discarded here.
   *
   * Optional so that a sender which genuinely has no kind to declare still
   * compiles. Those rows degrade to the subject, which is today's behaviour.
   */
  kind?: EmailKind;
  result: SendEmailResult;
}

/**
 * The kinds of mail the platform sends.
 *
 * A union rather than an enum so a call site is a plain string literal, and
 * `email_sends.email_kind` is TEXT so adding one needs no migration. Keep these
 * in step with the labels in `crm.journey.mail_kind.*`; an unlabelled kind
 * falls back to the subject rather than showing a raw identifier.
 */
export type EmailKind =
  /* About one appointment. */
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  /* Only the appointment was called off; the job continues. A different
     message from `booking_cancelled`, and the journey must not conflate
     them. */
  | 'meeting_cancelled'
  | 'missed_appointment'
  | 'meeting_reminder'
  | 'meeting_reminder_owner'
  /* About the job rather than one appointment. */
  /**
   * The bill itself, going out to the client.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Deliberately NOT in `ABOUT_ONE_APPOINTMENT`, for the reason `payment_receipt`
   * is not: an invoice is a fact about the JOB. It carries its booking, so the
   * card can answer "was this client actually billed?", but it does not belong
   * inside one appointment's history.
   *
   * The roster had no invoice member at all, which is why every invoice mail
   * ever sent was filed with no kind AND no booking — the sender holds the
   * invoice row, uses `booking_id` from it to build the pay link, and then
   * dropped it when recording the send. An owner looking at the card saw no
   * evidence the bill had gone out, and concluded it had not.
   * ───────────────────────────────────────────────────────────────────────────
   */
  | 'invoice_sent'
  | 'payment_receipt'
  | 'refund_confirmed'
  /* One payment request withdrawn, while the agreement itself continues. Not
     `booking_cancelled`: the booking stands and later periods still bill. */
  | 'payment_request_cancelled'
  | 'intake_requested'
  | 'intake_received'
  | 'quote_request'
  /* The client who gave their details, was sent to pay, and never finished.
     Belongs to no booking, because there is none — that is its subject. */
  | 'booking_recovery'
  /* About the contact, with no booking behind it. */
  | 'contact_welcome'
  | 'contact_returning';

/**
 * Which ATTEMPT this mail was about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESOLVED HERE, NOT AT EIGHT CALL SITES
 *
 * Every booking email already knows its booking. Almost none of them hold the
 * meeting row, and threading one through each sender would mean eight places
 * that can each forget — the same spread that let `meeting_status` go unread in
 * fifteen queries.
 *
 * So the caller passes what it has. A sender that genuinely knows the attempt
 * (a reminder for one specific session) passes `meetingId` and this returns it
 * untouched; everything else passes only `bookingId` and gets the attempt that
 * is current now, which is the one the mail is about.
 *
 * THE LATEST ATTEMPT IS THE RIGHT ANSWER because the mail is being sent now.
 * A confirmation, a reminder, a reschedule request — each concerns the
 * appointment as it stands at the moment of sending, and `listAttempts` returns
 * them in `occurrence_number` order, so the last is the current one.
 *
 * Null rather than a throw on any failure. This whole function is inside a
 * recording path the callers already treat as non-blocking: an email that was
 * sent must never be un-sent because its attribution could not be worked out,
 * and a null here simply means the journey falls back to matching it by time,
 * which is what it does for all 704 rows that predate the column anyway.
 */
/**
 * The kinds that are about ONE APPOINTMENT, rather than the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE KIND HAS TO DECIDE
 *
 * `resolveMeetingId` files a mail under the booking's current attempt whenever
 * it is given a booking and no meeting. That is right for a message about an
 * appointment — a confirmation, a reschedule notice — and wrong for everything
 * else, because the journey draws its rail from exactly that link.
 *
 * So a booking CANCELLATION, which is about the whole job, appeared inside the
 * meeting's history underneath "you cancelled the meeting" — two different
 * events reading as one. Reported from the card. A payment receipt and a
 * refund notice had the same shape and the same fate.
 *
 * Everything not listed here keeps `meeting_id` null and sits outside the
 * rail, which is where a fact about the job belongs.
 */
const ABOUT_ONE_APPOINTMENT = new Set<string>([
  'booking_confirmed',
  'booking_rescheduled',
  'missed_appointment',
  'meeting_cancelled',
  'meeting_reminder',
  'meeting_reminder_owner',
]);

async function resolveMeetingId(
  userId: string,
  bookingId: string | null | undefined,
  meetingId: string | null | undefined,
  kind: EmailKind | undefined
): Promise<string | null> {
  /* An explicit meeting always wins: a caller that names one knows better
     than this rule does. */
  if (meetingId) return meetingId;
  if (!bookingId) return null;

  /*
   * No kind declared means an older caller, and the old behaviour for it:
   * guessing wrong on a message nobody classified is no worse than the guess
   * it already made, and refusing would empty the rail for those rows.
   */
  if (kind && !ABOUT_ONE_APPOINTMENT.has(kind)) return null;

  try {
    const attempts = await schedulingBookingRepository.listAttempts(userId, [bookingId]);
    const forBooking = attempts[bookingId] ?? [];
    return forBooking.length > 0 ? forBooking[forBooking.length - 1].id : null;
  } catch (err) {
    logger.warn({ err, bookingId }, 'Could not resolve the meeting for an email (non-blocking)');
    return null;
  }
}

export async function recordEmailSend(params: RecordEmailSendParams): Promise<void> {
  const { userId, contactId, toEmail, subject, bodyHtml, bookingId, meetingId, isResend, kind, result } = params;

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
      /*
       * What this mail was about. `?? null` rather than omitted: the column
       * exists on every row, and an explicit null is the honest value for mail
       * that concerns no booking.
       */
      booking_id: bookingId ?? null,
      meeting_id: await resolveMeetingId(userId, bookingId, meetingId, kind),
      /* `false`, not undefined: the question always has an answer, and the
         default is "not recorded as a repeat". */
      is_resend: isResend ?? false,
      email_kind: kind ?? null,
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
