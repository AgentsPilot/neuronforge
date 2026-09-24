/**
 * Draining the insight-action queue.
 *
 * Reap, claim, check, send, close — the §8.1 shape, fourth application after
 * payment reminders, the daily briefing and lead responses.
 *
 * ---------------------------------------------------------------------------
 * EVERY CHECK HAPPENS HERE, AT THE MOMENT OF SENDING
 *
 * Not at enqueue. A row can sit in this queue for minutes or, after a failure
 * and a backoff, for hours, and in that time the world moves: the invoice gets
 * paid, the appointment is cancelled, the client is deleted, the owner turns
 * the automation off. Checking at enqueue would mean acting on a world that no
 * longer exists, and it would also leave every other path in — a manual
 * trigger, a replay, a second enqueuer — free to bypass the check entirely.
 *
 * So the question this file asks of every row is not "was this a good idea
 * when it was queued" but "is this still true right now".
 *
 * SKIPPING IS A NORMAL OUTCOME
 *
 * Most rows that do not send are not failures. The invoice was paid, the
 * booking moved, the cap was reached. Those close as `skipped` with a reason
 * the owner can read, and are never retried, because retrying them would be
 * retrying a decision rather than an error.
 * ---------------------------------------------------------------------------
 *
 * @see supabase/migrations/20260917_insight_actions.sql
 * @see docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  insightActionRepository,
  type InsightAction,
  type InsightActionKind,
} from '@/lib/repositories/InsightActionRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { leadResponseRepository } from '@/lib/repositories/LeadResponseRepository';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail, type SendEmailResult } from '@/lib/notifications/emailTransport';
import {
  generateChaseInvoiceEmail,
  generateFollowupNudgeEmail,
  generateBookingReminderEmail,
  type EmailTone,
  type NudgeReason,
} from '@/lib/email/templates/insight-actions';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ service: 'InsightActionDispatchService' });

/**
 * Lease and batch, sized against the route's `maxDuration = 60`.
 *
 * The lease must EXCEED maxDuration or the reaper reclaims a row that is still
 * being worked on, and the client is written to twice.
 */
export const LEASE_SECONDS = 90;
export const MAX_ATTEMPTS = 5;
export const BATCH = 50;

/**
 * How many of one kind a business may send in a day.
 *
 * A cap, not a target. The failure it prevents is a detector firing on forty
 * contacts at once and the platform mailing all forty in the owner's name
 * before anyone notices — which would be indistinguishable from the owner
 * spamming their own client list.
 */
const DAILY_CAP: Record<InsightActionKind, number> = {
  chase_invoice: 20,
  followup_nudge: 15,
  booking_reminder: 50,
};

/** Invoice states that mean there is nothing left to chase. */
const INVOICE_SETTLED = new Set(['paid', 'refunded', 'partially_refunded', 'cancelled', 'void']);

export interface DrainResult {
  reaped: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function drainInsightActions(): Promise<DrainResult> {
  const runnerId = crypto.randomUUID();
  const result: DrainResult = { reaped: 0, claimed: 0, sent: 0, skipped: 0, failed: 0 };

  // Reaper first, so rows abandoned by a dead runner are eligible for this pass.
  result.reaped = (await insightActionRepository.reapStale(LEASE_SECONDS, MAX_ATTEMPTS)).length;

  const claimed = await insightActionRepository.claimDue(runnerId, BATCH);
  result.claimed = claimed.length;
  if (claimed.length === 0) return result;

  logger.info({ runnerId, claimed: claimed.length, reaped: result.reaped }, 'Draining insight actions');

  for (const action of claimed) {
    try {
      const outcome = await dispatch(action);

      if (outcome.sent) {
        await insightActionRepository.markSent(action.id);
        result.sent += 1;
      } else {
        await insightActionRepository.markSkipped(action.id, outcome.reason ?? 'not sent');
        result.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Retryable until the reaper's dead-letter says otherwise. A provider
      // blip should not permanently lose a message the owner asked for.
      await insightActionRepository.markFailed(action.id, message, action.attempts < MAX_ATTEMPTS);
      result.failed += 1;
      logger.error({ err: error, actionId: action.id, kind: action.kind }, 'Insight action failed');
    }
  }

  return result;
}

interface Outcome {
  sent: boolean;
  reason?: string;
}

/**
 * Turn a transport result into an outcome this queue understands.
 *
 * The distinction that matters: a `blocked` result is a FINAL decision, not a
 * delivery failure. The recipient never agreed to marketing, or the tenant has
 * no postal address — retrying produces the same answer every time, so throwing
 * here would hand the row to the reaper and have it retried until it
 * dead-letters. It is a skip, which is exactly what InsightActionRepository's
 * own doc comment describes ("the client unsubscribed, the guardrail refused").
 *
 * A genuine send error still throws, because that one IS worth retrying.
 */
function outcomeFromSend(result: SendEmailResult): Outcome {
  if (result.blocked) return { sent: false, reason: `not sent: ${result.blocked}` };
  if (!result.sent) throw new Error(result.error ?? 'send failed');
  return { sent: true };
}

/** One row: check it is still true, render it, send it. */
async function dispatch(action: InsightAction): Promise<Outcome> {
  /*
   * The cap, counted at the choke point and excluding this row.
   *
   * `countSentSince` filters `status = 'sent'` and `id != this one`, which
   * matters because the row asking has already been moved to `processing` by
   * the claim — counting itself would let a single action block itself once the
   * cap was one away.
   */
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const alreadySent = await insightActionRepository.countSentSince(
    action.user_id,
    action.kind,
    since,
    action.id
  );

  if (alreadySent >= DAILY_CAP[action.kind]) {
    return { sent: false, reason: `daily cap for ${action.kind} reached (${DAILY_CAP[action.kind]})` };
  }

  const profileResult = await businessProfileRepository.findByUserId(action.user_id);
  const profile = profileResult.data;
  if (!profile) return { sent: false, reason: 'business no longer exists' };

  const locale = (profile.language ?? 'en') as Locale;
  const tone = (action.payload.tone as EmailTone | undefined) ?? 'friendly';
  const businessName = profile.company_name ?? 'Your business';
  const branding = await resolveEmailBranding(action.user_id, locale, profile as never);

  switch (action.kind) {
    case 'chase_invoice':
      return chaseInvoice(action, { businessName, locale, tone, branding });
    case 'followup_nudge':
      return followupNudge(action, { businessName, locale, tone, branding });
    case 'booking_reminder':
      return bookingReminder(action, { businessName, locale, tone, branding });
    default:
      // A kind the CHECK constraint allows but this file has not learned yet.
      // Skipped rather than failed: retrying will not teach it.
      return { sent: false, reason: `unknown kind: ${action.kind}` };
  }
}

interface Context {
  businessName: string;
  locale: Locale;
  tone: EmailTone;
  branding: Awaited<ReturnType<typeof resolveEmailBranding>>;
}

async function chaseInvoice(action: InsightAction, ctx: Context): Promise<Outcome> {
  if (!action.invoice_id) return { sent: false, reason: 'no invoice on the action' };

  const { data: invoice } = await paymentInvoiceRepository.findById(action.invoice_id, action.user_id);
  if (!invoice) return { sent: false, reason: 'invoice no longer exists' };

  // The check that matters most. Between queueing and sending, the client may
  // simply have paid — and chasing somebody for money they have already sent is
  // the worst thing this queue could do.
  if (INVOICE_SETTLED.has((invoice.status ?? '').toLowerCase())) {
    return { sent: false, reason: `invoice is ${invoice.status}` };
  }

  const to = invoice.client_email?.trim();
  if (!to) return { sent: false, reason: 'no email address for this invoice' };

  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
  const daysOverdue = dueDate
    ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000))
    : 0;

  const { subject, html } = generateChaseInvoiceEmail({
    clientName: invoice.client_name?.trim() || 'there',
    businessName: ctx.businessName,
    invoiceNumber: invoice.invoice_number ?? '',
    amount: Number(invoice.amount ?? 0),
    currency: invoice.currency ?? 'USD',
    dueDate,
    daysOverdue,
    payUrl: invoice.stripe_hosted_invoice_url ?? null,
    branding: ctx.branding,
    locale: ctx.locale,
    tone: ctx.tone,
  });

  // Chasing an unpaid invoice is transactional: it is about a debt the
  // recipient already owes, not an attempt to sell them anything.
  const sendResult = await sendEmail({
    kind: 'transactional',
    to: [to],
    subject,
    html,
    // Was missing, so this went out branded "NeuronForge" with no reply path
    // back to the business that is actually owed the money.
    ownerUserId: action.user_id,
  });
  return outcomeFromSend(sendResult);
}

/**
 * How long a lead-response chase suppresses the insight nudge.
 *
 * Time-boxed rather than permanent. `lead_responses` sends at most one invite
 * and one chase per contact, ever — the table's UNIQUE (contact_id, kind) sees
 * to that — so after those two it falls silent for good. A lead who has heard
 * nothing for a month is genuinely cold again, and muting the nudge forever
 * would mean the platform never follows up with them at all.
 */
const CHASE_SUPPRESSES_NUDGE_DAYS = 30;

async function followupNudge(action: InsightAction, ctx: Context): Promise<Outcome> {
  if (!action.contact_id) return { sent: false, reason: 'no contact on the action' };

  const { data: contact } = await crmContactRepository.findById(action.contact_id, action.user_id);
  if (!contact) return { sent: false, reason: 'contact no longer exists' };

  /*
   * Has the lead-response queue already chased this person?
   *
   * The two systems say the same thing — "you went quiet, here is how to book"
   * — and neither knows the other exists. A lead who never books gets the
   * invitation on day zero, the chase on day five, and then this nudge a week
   * after that: the same message twice from one business, because two queues
   * each checked only themselves.
   *
   * Checked HERE rather than at enqueue, for the same reason as every other
   * test in this file: the chase may go out after the nudge is queued, and a
   * check at enqueue time would miss exactly that ordering.
   */
  const since = new Date(Date.now() - CHASE_SUPPRESSES_NUDGE_DAYS * 86_400_000).toISOString();
  const { data: alreadyChased } = await supabaseServer
    .from('lead_responses')
    .select('id, kind')
    .eq('user_id', action.user_id)
    .eq('contact_id', action.contact_id)
    .eq('status', 'sent')
    .gte('created_at', since)
    .limit(1);

  if (alreadyChased && alreadyChased.length > 0) {
    return {
      sent: false,
      reason: `already followed up by the lead-response queue (${alreadyChased[0].kind})`,
    };
  }

  const to = contact.email?.trim();
  if (!to) return { sent: false, reason: 'no email address for this contact' };

  const { subject, html } = generateFollowupNudgeEmail({
    clientName: [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || 'there',
    businessName: ctx.businessName,
    serviceName: (action.payload.service_name as string | undefined) ?? null,
    bookingUrl: (action.payload.booking_url as string | undefined) ?? null,
    // Set by the enqueuer from the detector that asked. Decides the opening.
    reason: (action.payload.reason as NudgeReason | undefined) ?? 'unspecified',
    branding: ctx.branding,
    locale: ctx.locale,
    tone: ctx.tone,
  });

  /*
   * MARKETING. "It has been a while since your last visit, would you like to
   * book again" is a solicitation: the recipient did not ask for it, and the
   * only reason it exists is that the business wants the booking. It needs a
   * recorded opt-in, which is what the gate checks.
   *
   * `ownerUserId` was missing here too, so the nudge went out in the platform's
   * name rather than the business's.
   */
  const sendResult = await sendEmail({
    kind: 'marketing',
    ownerUserId: action.user_id,
    contactId: action.contact_id,
    to: [to],
    subject,
    html,
  });
  return outcomeFromSend(sendResult);
}

async function bookingReminder(action: InsightAction, ctx: Context): Promise<Outcome> {
  if (!action.booking_id) return { sent: false, reason: 'no booking on the action' };

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * STAND DOWN IF THE STANDING REMINDER IS ON.
   *
   * There are two ways a client can be reminded about an appointment, and they
   * are alternatives rather than layers:
   *
   *   the card OFF  this one. It fires only when the no-show or cancellation
   *                 detectors spot a spike, so it is the safety net.
   *   the card ON   every confirmed appointment gets a reminder at the owner's
   *                 chosen lead time, so the spike case is covered already.
   *
   * With both running, a business whose no-shows spiked would send two
   * reminders for the same appointment — the exact collision invoice chasing
   * had, where `chase_invoices_enabled` and `payment_reminder_enabled` both
   * fired on day three.
   *
   * One check per action, no per-booking bookkeeping, and nothing for the
   * owner to do. The card says this in as many words.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select('meeting_reminder_enabled')
    .eq('user_id', action.user_id)
    .maybeSingle();

  if ((profile as { meeting_reminder_enabled?: boolean } | null)?.meeting_reminder_enabled) {
    return { sent: false, reason: 'standing meeting reminder covers this booking' };
  }

  const { data: booking } = await schedulingBookingRepository.findById(action.booking_id, action.user_id);
  if (!booking) return { sent: false, reason: 'booking no longer exists' };

  /*
   * And stand down for a booking the standing reminder ALREADY handled.
   *
   * The check above covers the card being on now. This covers the owner having
   * switched it off since: the reminders already queued or sent do not unsend
   * themselves, and a client who got one on Monday must not get a second one
   * from the safety net on Tuesday.
   *
   * The queue row IS the record. A `meeting_reminder` row keyed on this
   * booking means the standing automation has it, whatever state the row is
   * in — pending means it is going out, sent means it went.
   */
  if (
    booking.contact_id &&
    (await leadResponseRepository.hasRowFor(
      action.user_id,
      'meeting_reminder',
      booking.contact_id,
      action.booking_id
    ))
  ) {
    return { sent: false, reason: 'standing meeting reminder already handled this booking' };
  }

  // Reminding somebody about an appointment that was cancelled is worse than
  // not reminding them at all.
  if ((booking.status ?? '').toLowerCase() !== 'confirmed') {
    return { sent: false, reason: `booking is ${booking.status}` };
  }

  const startsAt = booking.start_time ? new Date(booking.start_time) : null;
  if (!startsAt) return { sent: false, reason: 'booking has no start time' };
  // A reminder for something that has already happened is noise.
  if (startsAt.getTime() < Date.now()) return { sent: false, reason: 'appointment has passed' };

  const contactResult = booking.contact_id
    ? await crmContactRepository.findById(booking.contact_id, action.user_id)
    : { data: null };
  const to = contactResult.data?.email?.trim();
  if (!to) return { sent: false, reason: 'no email address for this booking' };

  const serviceResult = booking.service_id
    ? await schedulingServiceRepository.findById(booking.service_id, action.user_id)
    : { data: null };

  const { subject, html } = generateBookingReminderEmail({
    clientName:
      [contactResult.data?.first_name, contactResult.data?.last_name].filter(Boolean).join(' ').trim() || 'there',
    businessName: ctx.businessName,
    serviceName: serviceResult.data?.service_name ?? 'appointment',
    startsAt,
    timezone: booking.timezone ?? 'UTC',
    manageUrl: (action.payload.manage_url as string | undefined) ?? null,
    branding: ctx.branding,
    locale: ctx.locale,
    tone: ctx.tone,
  });

  // A reminder about an appointment the recipient booked themselves.
  const sendResult = await sendEmail({
    kind: 'transactional',
    to: [to],
    subject,
    html,
    ownerUserId: action.user_id,
  });
  return outcomeFromSend(sendResult);
}
