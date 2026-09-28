/**
 * What it means to cancel a booking — in one place, for every caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Cancelling is not a status update. It is a status update AND removing the
 * appointment from the owner's calendar AND telling the client not to come.
 * Miss either of the last two and the database says "cancelled" while the
 * calendar still shows the slot and the client still turns up.
 *
 * That sequence lived inside `POST /api/scheduling/bookings/[id]/cancel`, so
 * only an HTTP caller got it. The chat cancelled through
 * `schedulingBookingRepository.cancel()` directly — which is just the update —
 * and so cancelled bookings silently, leaving the calendar and the client
 * untouched. Same verb, two different meanings, depending on which door you
 * came in through.
 *
 * So the sequence moved here and both doors call it. The rule this encodes:
 * anything a write MUST do to be true belongs below the route, never inside it.
 *
 * SIDE EFFECTS ARE AWAITED, not fired and forgotten. The route used to hand the
 * calendar delete and the email to floating promises after the response — on
 * serverless that is a race against the function freezing, and it is exactly the
 * work that must not be lost. Each is caught individually: a booking that is
 * cancelled but whose email bounced is a cancelled booking, and reporting
 * failure would be worse than the truth.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/BookingLifecycleService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
  type SchedulingBooking,
  type SchedulingService,
  type SchedulingRepositoryResult,
} from '@/lib/repositories/SchedulingRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { OPEN_PROPOSAL_STATUSES } from '@/lib/repositories/ProposalRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { BookingEmailService, getBusinessTimezone } from '@/lib/services/BookingEmailService';
import { businessDateKey } from '@/lib/scheduling/businessTime';
import {
  paymentInvoiceRepository,
  paymentTransactionRepository,
  stripeConnectRepository,
  type PaymentInvoice,
} from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { emitPaymentEvent } from '@/lib/services/PaymentEventService';
import { voidInvoice } from '@/lib/payments/invoiceLifecycle';
import { bookingPaymentState } from '@/lib/payments/bookingPaymentState';
import { SERVICE_DATE_TERMS } from '@/lib/payments/invoiceTerms';
import { isPlanStopped, PLAN_STOPPED_STATUSES } from '@/lib/payments/planStatus';

const logger = createLogger({ service: 'BookingLifecycleService' });
const auditTrail = AuditTrailService.getInstance();

/** Just enough of a Pino logger for a caller to pass its correlated child. */
type ContextLogger = {
  debug: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

export interface CancelBookingParams {
  bookingId: string;
  userId: string;
  reason?: string;
  /**
   * The originating HTTP request, when there is one. Only the audit trail uses
   * it — to record IP and user agent. Absent for the chat, which is a legitimate
   * caller rather than a degraded one.
   */
  request?: NextRequest;
  /** A caller's correlated child logger, so one cancellation reads as one story. */
  logger?: ContextLogger;
  /**
   * Whether the cancellation email invites the client to book again. Defaults
   * to true, which is right for every ordinary cancellation.
   *
   * False when the business itself is closing: the invitation contradicts the
   * message and points at a page that is about to stop existing.
   */
  offerRebooking?: boolean;
}

/**
 * Invoice statuses that something will still chase, so cancelling the booking
 * has to close them.
 *
 * `draft` is included: it was never sent, so cancelling it costs nothing and
 * leaving it would put an invoice for a cancelled appointment in front of the
 * owner the next time they opened the list.
 */
const CHASEABLE_INVOICE_STATUSES = ['draft', 'sent', 'overdue'];

/**
 * How a client cancellation is written into `cancellation_reason`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY RECORD OF WHO CANCELLED.
 *
 * There is no column for it, so this prefix is what separates "the client could
 * not make it" from "the business called it off" — and the dashboard's
 * `booking_cancelled` gap reads it to decide whether the owner is told at all.
 * An owner who cancelled a booking does not need the dashboard telling them
 * they cancelled it.
 *
 * Exported so the gap matches on the SAME string the route writes. It was two
 * literals in two files for one turn, and they already disagreed: the route
 * wrote "Client cancelled: …" where the query looked for "Cancelled by client",
 * so every cancellation that came with a reason — the ones a client bothered to
 * explain — would have been silently invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const CLIENT_CANCELLED_PREFIX = 'Cancelled by client';

/** The reason text for a client cancellation, with whatever they said. */
export function clientCancellationReason(reason?: string | null): string {
  return reason ? `${CLIENT_CANCELLED_PREFIX}: ${reason}` : CLIENT_CANCELLED_PREFIX;
}

/** What actually happened to each side effect, so a caller can say so. */
export interface CancelBookingOutcome {
  booking: SchedulingBooking;
  calendarEventRemoved: boolean;
  clientNotified: boolean;
  /** Unpaid invoices moved to `cancelled`, so nothing chases them any more. */
  invoicesCancelled: number;
  /**
   * Money the business is still holding for a booking that is not happening.
   *
   * Reported rather than acted on: a refund moves real money and belongs to a
   * person, not to a cancellation. The owner-facing surfaces use this to ask.
   * Zero when nothing was paid, which is the ordinary case.
   */
  amountHeld: number;
  /** The currency `amountHeld` is in — a business may invoice in several. */
  heldCurrency: string | null;
  /**
   * A payment plan that is STILL CHARGING this client, reported and left alone.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * DELIBERATELY NOT STOPPED HERE.
   *
   * Cancelling an appointment is not the same as ending someone's payment
   * arrangement: a plan can fund more than this one booking, and ending it
   * early is a decision with a client on the other side of it. The platform
   * does not make that decision on its own — `cancelPlan` exists, is reached
   * from the refund dialog and the Money page, and stays a human's to press.
   *
   * What follows from that is why this field exists at all: until the owner
   * acts, the client's card WILL be charged again on schedule. So the surfaces
   * that read this must be loud and must not let the row age away quietly.
   * ───────────────────────────────────────────────────────────────────────────
   */
  planLive: boolean;
  /** Periods still to be charged on that plan, where the plan knows. */
  periodsRemaining: number | null;
  /**
   * Quote stages closed so nothing chases the client for them.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The invoice scan is not the only chaser. `processOverdueItems` has a SECOND
   * pass over `payment_plan_installments` — pending rows with a past due date,
   * with no reference to the booking — and it emails the CLIENT in the owner's
   * name on days 1, 3 and 7. So voiding the invoices stopped half of it: a
   * quote's remaining stages went on demanding money for a cancelled job, and
   * a stage already invoiced kept being chased through its installment row even
   * after its invoice was voided.
   *
   * Only stages with NO live subscription behind them. A subscription plan's
   * periods are real money still arriving — the plan is deliberately left
   * running — and cancelling those rows would falsify the books. This stops the
   * CHASING, never the money, which is the same line the invoice voiding draws.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stagesClosed: number;
}

/**
 * Cancel a booking and make the cancellation real.
 *
 * The status update is the only step allowed to fail the operation: if the row
 * did not change, nothing was cancelled and there is nothing to notify anyone
 * about. Everything after it is best effort and reported in the outcome.
 */
export async function cancelBooking(
  params: CancelBookingParams
): Promise<SchedulingRepositoryResult<CancelBookingOutcome>> {
  const { bookingId, userId, reason, request, offerRebooking } = params;
  const log = params.logger ?? logger;

  log.info({ bookingId, userId, reason }, 'Cancelling booking');

  const result = await schedulingBookingRepository.cancel(bookingId, userId, reason);

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return { data: null, error: new Error('Booking not found') };
  }

  const booking = result.data;

  // The client's own name, for the audit entry. A failure here must not stop a
  // cancellation that has already happened, so it degrades to 'Client'.
  let contactName = 'Client';
  if (booking.contact_id) {
    const contactResult = await crmContactRepository.findById(booking.contact_id, userId);
    if (contactResult.data) {
      contactName =
        `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim() ||
        'Client';
    }
  }

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_CANCELLED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking for ${contactName}`,
      // `details`, not `metadata` — the audit input has no `metadata` field, so
      // the reason passed under that name was being dropped on the floor.
      details: { reason },
      request,
    })
    .catch(err => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  // Only bookings that reached an external calendar have an event to remove.
  //
  // Both services below REPORT failure rather than throwing it, so the try/catch
  // is for the unexpected and the returned flag is what actually decides the
  // outcome. Trusting the absence of a throw would report every failed delete as
  // a success — which is the class of bug this whole module exists to end.
  let calendarEventRemoved = false;
  if (booking.external_calendar_event_id) {
    try {
      const sync = await CalendarSyncService.deleteCalendarEvent(booking, userId);
      calendarEventRemoved = sync.success;
      if (!sync.success) {
        log.warn({ bookingId, error: sync.error }, 'Calendar event delete failed');
      }
    } catch (err) {
      log.warn({ err, bookingId }, 'Calendar event delete threw');
    }
  }

  /*
   * The invoices, settled two ways: stop chasing what was never paid, and
   * report what was.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * An unpaid invoice used to survive the cancellation untouched, and the
   * overdue scan reads `status in ('sent','overdue')` with no reference to the
   * booking at all — so the platform went on emailing the client on days 1, 3
   * and 7 past due, in the owner's name, demanding payment for an appointment
   * that had been cancelled. Moving it to `cancelled` takes it out of that scan
   * by itself; no change to the reminder service is needed.
   *
   * Anything already PAID is left exactly as it is. That is a record of money
   * that moved, and rewriting it would be a lie about what happened. What this
   * does instead is measure it, so the owner can be asked.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let invoicesCancelled = 0;
  let amountHeld = 0;
  let heldCurrency: string | null = null;
  let planLive = false;
  let periodsRemaining: number | null = null;
  let stagesClosed = 0;

  try {
    const { data: invoices } = await paymentInvoiceRepository.findByBookingId(bookingId, userId);

    for (const invoice of invoices ?? []) {
      if (CHASEABLE_INVOICE_STATUSES.includes(invoice.status)) {
        /*
         * `voidInvoice`, not a local status write.
         *
         * ───────────────────────────────────────────────────────────────────
         * A Stripe-issued invoice lives in TWO places. Flipping the local row
         * to `cancelled` stops this platform chasing it and does nothing at
         * all to the other one: Stripe goes on sending its own reminders in
         * the owner's name, and the hosted invoice page stays payable — so a
         * client could pay, in full, for an appointment that was cancelled.
         *
         * `lib/payments/invoiceLifecycle` is where that is already handled,
         * and the invoices tab and the chat both cancel through it. Voiding at
         * the processor is best effort inside it: an invoice Stripe refuses
         * (never finalized, already void) still gets its local change, which
         * is the right trade — losing the void is a warning, losing the
         * cancellation would be a bug.
         * ───────────────────────────────────────────────────────────────────
         */
        const { error } = await voidInvoice({ invoiceId: invoice.id, userId, request });

        if (!error) invoicesCancelled += 1;
        continue;
      }

    }

    /*
     * What the business is actually holding, from the PAYMENTS.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * NOT from the invoices, which is what this read first and which missed the
     * commonest online sale outright. A client paying through the booking widget
     * or a landing page produces a payment_transaction carrying `booking_id`
     * and NO invoice at all — so an invoice-only sum reported nothing held,
     * the owner was never asked about the refund, and the money simply stayed.
     *
     * `findSettledForBooking` asks both ways — transactions tied to the booking
     * AND transactions tied to its invoices — and `bookingPaymentState` nets
     * the refunds off. It is the same pair the delete guard below relies on, so
     * "does this booking hold money" now has ONE answer in this file rather
     * than two that disagree about direct payments.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: settled } = await paymentTransactionRepository.findSettledForBooking(
      bookingId,
      (invoices ?? []).map(invoice => invoice.id),
      userId
    );

    const held = bookingPaymentState(settled ?? []);
    amountHeld = held.netHeld;
    heldCurrency = (settled ?? []).find(row => row.currency)?.currency ?? null;

    if (invoicesCancelled > 0 || amountHeld > 0) {
      log.info({ bookingId, invoicesCancelled, amountHeld }, 'Settled the invoices for a cancelled booking');
    }
  } catch (err) {
    // The booking is cancelled either way. An invoice left chaseable is a real
    // problem and logged loudly, but not one worth failing the cancellation for.
    log.error({ err, bookingId }, 'Could not settle the invoices for a cancelled booking');
  }

  /*
   * Is a payment plan still charging this client? READ ONLY.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Nothing here stops it, on purpose — see `planLive` on the outcome. The
   * platform does not end somebody's payment arrangement because an appointment
   * was called off; `cancelPlan` is reached from the refund dialog and the
   * Money page and stays the owner's to press.
   *
   * Its own try/catch, and its own statement: an unreadable plan must not cost
   * the invoice work above it, and the invoice work failing must not hide a
   * plan that is still taking money. `isPlanStopped` is the same predicate
   * `cancelPlan` reads, so the two cannot disagree about what "live" means.
   * ───────────────────────────────────────────────────────────────────────────
   */
  try {
    const { data: plan } = await supabaseServer
      .from('payment_plan_subscriptions')
      /*
       * `installment_count`, NOT `periods_total` — which does not exist. One
       * unknown name makes PostgREST reject the WHOLE select, so a typo here
       * would report every cancelled booking as having no live plan: the
       * silent-nothing failure this codebase has been bitten by before.
       */
      .select('id, status, installment_count, periods_paid, next_charge_at')
      .eq('user_id', userId)
      .eq('booking_id', bookingId)
      /*
       * Live plans only, and `maybeSingle` is safe BECAUSE of that filter: the
       * partial unique index `idx_plan_subs_one_live_per_booking` allows at
       * most one row per booking in exactly these statuses. Asking without the
       * filter could match an old stopped plan alongside a live one, and
       * `maybeSingle` would then throw — reporting "no plan" on precisely the
       * booking that has two.
       *
       * The list is derived from `PLAN_STOPPED_STATUSES` rather than retyped,
       * so this cannot drift from what `cancelPlan` considers finished.
       */
      .not('status', 'in', `(${PLAN_STOPPED_STATUSES.join(',')})`)
      .maybeSingle();

    // Belt and braces: the filter above already excluded the stopped ones.
    if (plan && !isPlanStopped(plan.status as string)) {
      planLive = true;

      /*
       * Null is UNKNOWN, not zero.
       *
       * `Number(null)` is 0, so reading these without the null check reported
       * "0 periods remaining" for a plan whose counts could not be read — which
       * says "nothing left to charge" about a plan that is still charging. Not
       * knowing how many are left is not evidence that none are.
       */
      const count = plan.installment_count == null ? NaN : Number(plan.installment_count);
      const paid = plan.periods_paid == null ? NaN : Number(plan.periods_paid);
      periodsRemaining =
        Number.isFinite(count) && Number.isFinite(paid) ? Math.max(0, count - paid) : null;

      log.info(
        { bookingId, planId: plan.id, periodsRemaining },
        'Booking cancelled with a payment plan still charging; left running for the owner to decide'
      );
    }
  } catch (err) {
    log.error({ err, bookingId }, 'Could not check whether a payment plan is still charging');
  }

  /*
   * Stop chasing the quote stages nobody will ever collect.
   *
   * See `stagesClosed` above for why this exists and why it is scoped the way
   * it is. `subscription_id IS NULL` is the whole safety of it: those rows are
   * a quote's milestones, which only ever become money if somebody invoices
   * them, and this booking is off. A subscription's projected periods are
   * excluded and left exactly as they are.
   */
  try {
    const { data: closed } = await supabaseServer
      .from('payment_plan_installments')
      .update({ status: 'cancelled', next_retry_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('booking_id', bookingId)
      // Only what has not happened. A paid stage is a record of money that
      // arrived and is never rewritten.
      .eq('status', 'pending')
      .is('subscription_id', null)
      .select('id');

    stagesClosed = closed?.length ?? 0;

    if (stagesClosed > 0) {
      log.info({ bookingId, stagesClosed }, 'Closed the quote stages for a cancelled booking');
    }
  } catch (err) {
    log.error({ err, bookingId }, 'Could not close the quote stages for a cancelled booking');
  }

  /*
   * Cancelling a QUOTED booking ends the whole job, not just the meeting.
   *
   * On a quoted service the appointment is the consultation and the journey
   * runs on past it — so "completed" and "no-show" describe the meeting, and
   * cancelling is the one mark that means "we are not doing this". That has to
   * reach the QUOTE as well: a client still holding a live link could accept
   * next week a job the business had already written off, and the acceptance
   * would raise an invoice for work nobody intends to do.
   *
   * Withdrawn, not deleted — the quote and its price stay in the client's
   * history, which is the record of why this did not happen.
   */
  let quotesWithdrawn = 0;
  try {
    const { data: service } = await supabaseServer
      .from('scheduling_services')
      .select('sale_mode')
      .eq('id', booking.service_id)
      .maybeSingle();

    if (service?.sale_mode === 'proposal') {
      const { data: withdrawn } = await supabaseServer
        .from('proposals')
        .update({ status: 'withdrawn' })
        .eq('user_id', userId)
        .eq('booking_id', bookingId)
        .in('status', OPEN_PROPOSAL_STATUSES)
        .select('id');

      quotesWithdrawn = withdrawn?.length ?? 0;
      if (quotesWithdrawn > 0) {
        log.info({ bookingId, quotesWithdrawn }, 'Withdrew the outstanding quotes with the booking');
      }
    }
  } catch (err) {
    // The booking is already cancelled. A quote left standing is a real problem
    // but not one worth failing the cancellation over — it is logged loudly so
    // it can be seen rather than swallowed.
    log.error({ err, bookingId }, 'Could not withdraw the quotes for a cancelled booking');
  }

  /*
   * The email, only while there is still an appointment to cancel.
   *
   * "Your appointment has been cancelled" is right for a meeting that has not
   * happened yet. Sent about a consultation that took place last Tuesday — the
   * case where the owner is closing a lost job — it is simply false, and it
   * lands with a client who has already been told a price they declined.
   */
  const meetingStillAhead = !booking.start_time || new Date(booking.start_time) > new Date();

  let clientNotified = false;
  if (!meetingStillAhead) {
    log.info({ bookingId }, 'Cancellation email skipped — the meeting had already passed');
  } else try {
    const email = await BookingEmailService.sendCancellationEmail(bookingId, userId, reason, {
      offerRebooking,
    });
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Cancellation email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Cancellation email threw');
  }

  log.info(
    { bookingId, userId, calendarEventRemoved, clientNotified },
    'Booking cancelled'
  );

  return {
    data: {
      booking,
      calendarEventRemoved,
      clientNotified,
      invoicesCancelled,
      amountHeld,
      heldCurrency,
      planLive,
      periodsRemaining,
      stagesClosed,
    },
    error: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * CREATING A BOOKING
 *
 * Same argument as cancelling, with more at stake. Creating a booking is not an
 * insert: it is a conflict check, an insert, a calendar event, an invoice, and a
 * confirmation to the client. A row written without those is an appointment that
 * exists only in the database — absent from the owner's calendar, possibly
 * double-booked, unbilled, and unknown to the person expected to attend.
 *
 * The route did all of it and the chat could not book at all, which was the
 * honest state of affairs. Declaring `bookings.create` against the repository
 * would have been the dishonest one.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The requested time cannot be given away.
 *
 * A distinct type because it is the one create failure that is not an error in
 * the system — the caller asked for something legitimate that is already taken,
 * and both callers need to say which, in their own words: the route as a 409,
 * the chat as a sentence offering another time.
 */
export class BookingSlotUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'overlap' | 'external_calendar',
    readonly conflictingBooking?: {
      id: string;
      start_time: string;
      end_time: string;
      status: string;
    }
  ) {
    super(message);
    this.name = 'BookingSlotUnavailableError';
  }
}

export interface CreateBookingParams {
  userId: string;
  serviceId: string;
  /** Already resolved and verified to belong to this user. */
  contactId: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  notes?: string;
  bookingSource?: string;
  /** Raise an invoice when the service is priced. Defaults to true. */
  createInvoice?: boolean;
  sendIntakeForm?: boolean;
  /**
   * The contact's name and email, when the caller already has them. Looked up
   * from `contactId` otherwise, so a caller that only knows the id — the chat —
   * still gets a correctly addressed invoice and confirmation.
   */
  contactName?: string;
  contactEmail?: string | null;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface CreateBookingOutcome {
  booking: SchedulingBooking;
  invoice: PaymentInvoice | null;
  calendarSynced: boolean;
  clientNotified: boolean;
}

/**
 * Create a booking and everything that makes it a real appointment.
 *
 * Fails the whole operation only for the things that must not be papered over:
 * a conflicting slot, and the insert itself. An invoice or an email that fails
 * afterwards leaves a booking that genuinely exists, and is reported rather than
 * rolled back.
 */
export async function createBooking(
  params: CreateBookingParams
): Promise<SchedulingRepositoryResult<CreateBookingOutcome>> {
  const {
    userId,
    serviceId,
    contactId,
    startTime,
    endTime,
    timezone,
    notes,
    bookingSource,
    createInvoice = true,
    sendIntakeForm = false,
    request,
  } = params;
  const log = params.logger ?? logger;

  log.info({ userId, serviceId, contactId, startTime }, 'Creating booking');

  // 1. The slot must be free — of this user's own bookings, and of anything in
  //    the calendar they actually live by. Both refuse the booking outright:
  //    double-booking someone is not a warning.
  const overlapCheck = await schedulingBookingRepository.checkOverlap(userId, startTime, endTime);

  if (overlapCheck.error) {
    return { data: null, error: overlapCheck.error };
  }

  if (overlapCheck.data && overlapCheck.data.length > 0) {
    const conflict = overlapCheck.data[0];
    log.warn({ userId, conflictingBookingId: conflict.id, startTime }, 'Double booking attempt');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        `This time overlaps an existing booking at ${new Date(conflict.start_time).toISOString()}`,
        'overlap',
        {
          id: conflict.id,
          start_time: conflict.start_time,
          end_time: conflict.end_time,
          status: conflict.status,
        }
      ),
    };
  }

  const isBlockedByExternal = await CalendarSyncService.isSlotBlockedByExternalEvent(
    userId,
    startTime,
    endTime
  );

  if (isBlockedByExternal) {
    log.warn({ userId, startTime }, 'Booking blocked by external calendar event');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        'This time is blocked by an event in your external calendar',
        'external_calendar'
      ),
    };
  }

  // 2. Insert.
  const result = await schedulingBookingRepository.create({
    user_id: userId,
    service_id: serviceId,
    contact_id: contactId,
    start_time: startTime,
    end_time: endTime,
    timezone,
    notes,
    booking_source: bookingSource,
  } as Parameters<typeof schedulingBookingRepository.create>[0]);

  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: new Error('Failed to create booking') };

  const booking = result.data;

  // 3. Who the booking is for — needed by the invoice and the confirmation, so
  //    it is resolved rather than assumed when the caller did not supply it.
  let contactName = params.contactName ?? '';
  let contactEmail = params.contactEmail ?? null;

  if (!contactName || contactEmail === null) {
    const contactResult = await crmContactRepository.findById(contactId, userId);
    if (contactResult.data) {
      contactName =
        contactName ||
        `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim();
      contactEmail = contactEmail ?? contactResult.data.email ?? null;
    }
  }

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_CREATED',
      userId,
      entityType: 'scheduling_booking',
      entityId: booking.id,
      resourceName: `Booking for ${contactName || 'Client'}`,
      details: { service_id: serviceId, contact_id: contactId, start_time: startTime },
      request,
    })
    .catch(err => log.warn({ err, bookingId: booking.id }, 'Audit failed (non-blocking)'));

  const serviceResult = await schedulingServiceRepository.findById(serviceId, userId);
  const service = serviceResult.data;

  // 4. Put it in the calendar the owner actually looks at.
  let calendarSynced = false;
  if (service) {
    try {
      const sync = await CalendarSyncService.syncBookingToCalendar(booking, service, userId);
      calendarSynced = sync.success;
      if (!sync.success) {
        /*
         * "Not connected" is not a failure.
         *
         * Most businesses have never linked a calendar, so every booking they
         * made logged a warning saying calendar sync had failed — for a feature
         * they never switched on. A warning that fires on the normal path stops
         * being read, and takes the real ones with it.
         */
        const notConfigured = sync.error === 'Calendar sync not enabled';
        if (notConfigured) {
          log.debug({ bookingId: booking.id }, 'No calendar connected; skipping sync');
        } else {
          log.warn({ bookingId: booking.id, error: sync.error }, 'Calendar sync failed');
        }
      }
    } catch (err) {
      log.warn({ err, bookingId: booking.id }, 'Calendar sync threw');
    }
  }

  // 5. Bill for it, when there is something to bill. A failure here is logged
  //    and reported, never fatal — the appointment stands either way.
  let invoice: PaymentInvoice | null = null;
  /*
   * A QUOTED service is never invoiced on booking.
   *
   * `sale_mode: 'proposal'` means the price is not agreed yet — the client gets
   * a quote, and the invoice follows acceptance. Booking one from the drawer
   * used to raise an invoice on the spot for whatever placeholder price the
   * service carried, asking for money nobody had quoted.
   *
   * Price alone decides the rest, and deliberately so. This path has no
   * checkout: the drawer and the chat record a booking the owner agreed by
   * phone, so nobody has paid and the money is owed however the service says it
   * likes to collect. The public widget uses a different rule — it invoices
   * only when it did NOT take a card — because it is the one place a client can
   * actually pay at the moment of booking. Two rules, two situations; they are
   * not a contradiction.
   */
  const shouldInvoice =
    !!service &&
    service.sale_mode !== 'proposal' &&
    !!service.price &&
    service.price > 0 &&
    createInvoice;

  if (shouldInvoice) {
    try {
      invoice = await createBookingInvoice(
        userId,
        booking.id,
        service!,
        {
          contact_id: contactId,
          contact_name: contactName || 'Client',
          contact_email: contactEmail,
          start_time: startTime,
        },
        log
      );
    } catch (err) {
      log.warn({ err, bookingId: booking.id }, 'Failed to create invoice for booking');
    }
  }

  // 6. A paid booking makes someone a client rather than a lead. Non-blocking:
  //    a pipeline stage is bookkeeping, not part of the appointment.
  if (shouldInvoice) {
    crmPipelineStagesRepository
      .findActiveClientStage(userId)
      .then(async stageResult => {
        if (stageResult.data) {
          await crmContactRepository.updateStage(contactId, userId, stageResult.data.stage_key);
          log.info(
            { contactId, newStage: stageResult.data.stage_key },
            'Contact moved to active client stage for paid booking'
          );
        }
      })
      .catch(err => log.warn({ err, contactId }, 'Failed to update contact stage'));
  }

  // 7. Tell the client. `skipInvoice` because step 5 already raised and sent it;
  //    the payment link travels with the confirmation instead of separately.
  let clientNotified = false;
  try {
    const email = await BookingEmailService.sendBookingConfirmation(booking.id, userId, {
      skipInvoice: true,
      invoiceId: invoice?.id,
      stripeHostedInvoiceUrl: invoice?.stripe_hosted_invoice_url || undefined,
    });
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId: booking.id, error: email.error }, 'Confirmation email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId: booking.id }, 'Confirmation email threw');
  }

  // 8. Intake form, when asked for. The empty `intake_responses` is what makes
  //    the journey timeline show "intake pending" rather than nothing.
  if (sendIntakeForm) {
    await schedulingBookingRepository.update(booking.id, userId, {
      intake_responses: { template_id: '', template_key: 'pending', responses: {} },
    });

    /*
     * `manual`, because the OWNER asked for this one.
     *
     * It no longer changes whether the send is permitted — that is the same
     * question for everyone, and `send_after_booking` has not gated it for some
     * time. It records WHO asked.
     *
     * Kept because the history is the reason the dialog toggle exists: this
     * once consulted `send_after_booking`, so a business that sends intake by
     * hand — and therefore has that switch off — ticked "send intake form",
     * watched the booking confirmation arrive, and had the intake email
     * silently skipped.
     *
     * The client-booking routes (`website/booking/create`, `finalize`) stay
     * automatic — nobody is present there to press anything.
     */
    BookingEmailService.sendIntakeFormRequest(booking.id, userId, { manual: true }).catch(err =>
      log.warn({ err, bookingId: booking.id }, 'Intake form request email failed')
    );
  }

  log.info(
    { bookingId: booking.id, userId, calendarSynced, clientNotified, invoiceId: invoice?.id },
    'Booking created'
  );

  return {
    data: { booking, invoice, calendarSynced, clientNotified },
    error: null,
  };
}

/**
 * Raise the invoice for a booking, through Stripe when the business is set up
 * for it and locally when it is not.
 *
 * Moved verbatim from the bookings route so that a booking made from the chat is
 * billed exactly like one made from the dashboard. Throws on the local insert —
 * an unbilled booking should be reported — but swallows Stripe failures, since a
 * local invoice the owner can chase is a working outcome.
 */
/**
 * Raise the invoice for a booking.
 *
 * Exported because the WEBSITE booking flow needs it too. A service set to
 * `collection: 'invoice'` took no money online, and the public route raised no
 * invoice at all — so a ₪200 booking was marked paid, billed nobody, and the
 * client received a confirmation with nothing to pay against. This is the one
 * producer of booking invoices; there must not be a second.
 */
export async function createBookingInvoice(
  userId: string,
  bookingId: string,
  service: SchedulingService,
  bookingData: {
    contact_id: string;
    contact_name: string;
    contact_email: string | null;
    start_time: string;
  },
  log: ContextLogger
): Promise<PaymentInvoice> {
  const invoiceNumberResult = await paymentInvoiceRepository.getNextInvoiceNumber(userId);
  if (invoiceNumberResult.error) {
    throw invoiceNumberResult.error;
  }

  /*
   * Payable by the time the service happens — the day the BUSINESS holds the
   * appointment on. Taking the UTC day of the stored instant named the day
   * before for any business far enough ahead of UTC: a 09:00 appointment in
   * Auckland is 20:00 the previous day in UTC, so the client was invoiced with
   * a due date that had already passed.
   */
  const zone = await getBusinessTimezone(userId);
  const dueDate = businessDateKey(new Date(bookingData.start_time), zone);

  const invoiceResult = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bookingData.contact_id,
    booking_id: bookingId, // Links payment status back to the booking.
    service_id: service.id, // What was billed, for the revenue-by-service breakdown.
    invoice_number: invoiceNumberResult.data!,
    amount: service.price!,
    currency: service.currency,
    status: 'sent',
    client_name: bookingData.contact_name || null,
    client_email: bookingData.contact_email || null,
    line_items: [
      {
        description: service.service_name,
        quantity: 1,
        unit_price: service.price!,
        total: service.price!,
      },
    ],
    due_date: dueDate,
    payment_terms: SERVICE_DATE_TERMS,
    notes: `Booking for ${bookingData.contact_name}`,
    internal_notes: `Auto-generated for booking ${bookingId}`,
    sent_at: new Date().toISOString(),
    paid_at: null,
    payment_method: null,
    payment_received_at: null,
    payment_notes: null,
    processor_type: null,
    processor_checkout_id: null,
    processor_payment_id: null,
    processor_customer_id: null,
    processor_payment_method_id: null,
    retry_count: 0,
    last_retry_at: null,
    next_retry_at: null,
  } as Parameters<typeof paymentInvoiceRepository.create>[0]);

  if (invoiceResult.error) {
    throw invoiceResult.error;
  }

  let invoice = invoiceResult.data!;

  const stripeAccountResult = await stripeConnectRepository.findByUserId(userId);
  const stripeAccount = stripeAccountResult.data;

  if (
    stripeAccount?.stripe_account_id &&
    stripeAccount.charges_enabled &&
    bookingData.contact_email
  ) {
    try {
      log.info(
        { invoiceId: invoice.id, stripeAccountId: stripeAccount.stripe_account_id },
        'Creating Stripe invoice for booking'
      );

      const stripeInvoiceService = getStripeInvoiceService();

      const stripeInvoice = await stripeInvoiceService.createInvoice({
        connectAccountId: stripeAccount.stripe_account_id,
        customerEmail: bookingData.contact_email,
        customerName: bookingData.contact_name || 'Client',
        lineItems: [
          {
            description: service.service_name,
            quantity: 1,
            unit_price: Math.round(service.price! * 100), // Stripe works in cents.
            total: Math.round(service.price! * 100),
          },
        ],
        dueDate: new Date(bookingData.start_time),
        currency: service.currency.toLowerCase(),
        description: `Invoice for ${service.service_name}`,
        metadata: {
          neuronforge_invoice_id: invoice.id,
          booking_id: bookingId,
          invoice_number: invoice.invoice_number,
        },
      });

      // Finalizes and emails it.
      const sentStripeInvoice = await stripeInvoiceService.sendInvoice(
        stripeInvoice.invoiceId,
        stripeAccount.stripe_account_id
      );

      const updateResult = await paymentInvoiceRepository.updateStripeFields(invoice.id, userId, {
        stripe_invoice_id: sentStripeInvoice.invoiceId,
        stripe_hosted_invoice_url: sentStripeInvoice.hostedInvoiceUrl || undefined,
        stripe_invoice_pdf: sentStripeInvoice.invoicePdf || undefined,
      });

      if (updateResult.data) {
        invoice = updateResult.data;
      }

      log.info(
        { invoiceId: invoice.id, stripeInvoiceId: sentStripeInvoice.invoiceId },
        'Stripe invoice created and sent for booking'
      );
    } catch (stripeError) {
      // The local invoice is still valid and still owed.
      log.error(
        { err: stripeError, invoiceId: invoice.id },
        'Failed to create Stripe invoice, falling back to local invoice'
      );
    }
  } else {
    log.debug(
      {
        invoiceId: invoice.id,
        hasStripeAccount: !!stripeAccount?.stripe_account_id,
        chargesEnabled: stripeAccount?.charges_enabled,
        hasEmail: !!bookingData.contact_email,
      },
      'Skipping Stripe invoice (not configured or missing email)'
    );
  }

  await emitPaymentEvent(userId, {
    eventType: 'invoice.created',
    entityType: 'invoice',
    entityId: invoice.id,
    contactId: bookingData.contact_id,
    metadata: {
      bookingId,
      serviceName: service.service_name,
      amount: service.price,
      currency: service.currency,
      dueDate,
      stripeInvoiceId: invoice.stripe_invoice_id || undefined,
    },
  });

  paymentReminderService
    .scheduleInvoiceReminders(userId, invoice.id, bookingData.contact_id, dueDate)
    .catch(err => log.warn({ err, invoiceId: invoice.id }, 'Failed to schedule invoice reminders'));

  return invoice;
}

/* ────────────────────────────────────────────────────────────────────────────
 * MOVING A BOOKING
 *
 * Same argument once more. Changing `start_time` is not rescheduling: the
 * calendar still holds the old slot and the client still arrives at the old
 * time. Both of those are what "rescheduled" means to the two people involved.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RescheduleBookingParams {
  bookingId: string;
  userId: string;
  startTime: string;
  /**
   * Optional: omitted, the appointment keeps the length it already had.
   *
   * "Move it to 11" is a complete instruction about a 15-minute intro call, and
   * it was not treated as one — `end_time` was required, so the chat asked when
   * the meeting would finish. The person is looking at a card that says 10:00 to
   * 10:15; being asked its duration reads as the system not having looked.
   *
   * Derivable rather than merely convenient: this function already loads the
   * booking, so the old start and end are in hand before anything is decided.
   * Requiring the caller to restate a figure we are about to read anyway is the
   * kind of question a form asks, not a colleague.
   *
   * Pass it to CHANGE the length. Omit it to move the appointment.
   */
  endTime?: string;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface RescheduleBookingOutcome {
  booking: SchedulingBooking;
  previousStart: string;
  calendarUpdated: boolean;
  clientNotified: boolean;
}

/**
 * Move a booking to a new time.
 *
 * Refuses a slot that is already taken, for the same reason `createBooking`
 * does — moving an appointment on top of another one is a double booking that
 * happens to have arrived by a different route. The booking's own row is
 * excluded from that check, or every reschedule would collide with itself.
 */
export async function rescheduleBooking(
  params: RescheduleBookingParams
): Promise<SchedulingRepositoryResult<RescheduleBookingOutcome>> {
  const { bookingId, userId, startTime, request } = params;
  const log = params.logger ?? logger;

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  const previousStart = existing.data.start_time;

  // Moving an appointment keeps its length unless the caller says otherwise.
  // Read from the booking we just loaded, so "move it to 11" needs nothing more
  // than the new start.
  const endTime =
    params.endTime ??
    new Date(
      new Date(startTime).getTime() +
        (new Date(existing.data.end_time).getTime() - new Date(previousStart).getTime())
    ).toISOString();

  // Unchanged times are a no-op, not a reschedule: emailing a client to tell
  // them nothing moved is worse than doing nothing.
  if (
    new Date(previousStart).getTime() === new Date(startTime).getTime() &&
    new Date(existing.data.end_time).getTime() === new Date(endTime).getTime()
  ) {
    return {
      data: {
        booking: existing.data,
        previousStart,
        calendarUpdated: false,
        clientNotified: false,
      },
      error: null,
    };
  }

  const overlap = await schedulingBookingRepository.checkOverlap(userId, startTime, endTime);
  if (overlap.error) return { data: null, error: overlap.error };

  const clash = (overlap.data ?? []).find((b) => b.id !== bookingId);
  if (clash) {
    log.warn({ userId, bookingId, conflictingBookingId: clash.id }, 'Reschedule would double-book');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        `That time overlaps an existing booking at ${new Date(clash.start_time).toISOString()}`,
        'overlap',
        {
          id: clash.id,
          start_time: clash.start_time,
          end_time: clash.end_time,
          status: clash.status,
        }
      ),
    };
  }

  const result = await schedulingBookingRepository.update(bookingId, userId, {
    start_time: startTime,
    end_time: endTime,
  });

  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: new Error('Booking not found') };

  const booking = result.data;

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_RESCHEDULED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking moved to ${startTime}`,
      details: { from: previousStart, to: startTime },
      request,
    })
    .catch((err) => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  let calendarUpdated = false;
  if (booking.external_calendar_event_id) {
    try {
      const service = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (service.data) {
        const sync = await CalendarSyncService.updateCalendarEvent(booking, service.data, userId);
        calendarUpdated = sync.success;
        if (!sync.success) {
          log.warn({ bookingId, error: sync.error }, 'Calendar event update failed');
        }
      }
    } catch (err) {
      log.warn({ err, bookingId }, 'Calendar event update threw');
    }
  }

  // The client is told what changed, so the email needs the OLD time.
  let clientNotified = false;
  try {
    const email = await BookingEmailService.sendRescheduledEmail(
      bookingId,
      userId,
      new Date(previousStart)
    );
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Reschedule email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Reschedule email threw');
  }

  log.info({ bookingId, userId, calendarUpdated, clientNotified }, 'Booking rescheduled');

  return {
    data: { booking, previousStart, calendarUpdated, clientNotified },
    error: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * DELETING A BOOKING
 *
 * Distinct from cancelling, and rarer. Cancelling keeps the record and tells the
 * client; deleting removes it as if it never happened, which is only right for
 * something entered by mistake.
 *
 * Money is what makes it dangerous. `payment_invoices.booking_id` is ON DELETE
 * SET NULL, so an invoice OUTLIVES its booking as an orphan — still owed, still
 * payable through its Stripe link, and no longer traceable to anything. So an
 * unpaid invoice goes with the booking, and a paid one blocks the delete
 * outright: money that changed hands is a record to refund deliberately, not to
 * erase.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Raised when the booking has been paid for, which forbids deleting it. */
export class BookingPaidError extends Error {
  constructor(
    readonly invoiceNumbers: string[],
    readonly paidAmount: number
  ) {
    super(
      'This booking has already been paid for and cannot be deleted. ' +
        'Refund the payment first, or cancel the booking instead.'
    );
    this.name = 'BookingPaidError';
  }
}

export interface DeleteBookingOutcome {
  bookingId: string;
  deletedInvoices: string[];
}

export async function deleteBooking(params: {
  bookingId: string;
  userId: string;
  request?: NextRequest;
  logger?: ContextLogger;
}): Promise<SchedulingRepositoryResult<DeleteBookingOutcome>> {
  const { bookingId, userId, request } = params;
  const log = params.logger ?? logger;

  const { isSettledInvoice } = await import('@/lib/payments/invoiceSettlement');
  const { paymentTransactionRepository } = await import('@/lib/repositories/PaymentRepository');
  const { deleteInvoice } = await import('@/lib/payments/invoiceLifecycle');

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  const invoicesResult = await paymentInvoiceRepository.findByBookingId(bookingId, userId);
  if (invoicesResult.error) return { data: null, error: invoicesResult.error as Error };

  const bookingInvoices = invoicesResult.data || [];

  const { bookingPaymentState } = await import('@/lib/payments/bookingPaymentState');

  /*
   * Does this booking still HOLD money?
   *
   * It used to ask `payment_status === 'refunded'`, which only the booking
   * refund route ever writes. So money refunded from the money list, the CRM
   * drawer, or the Stripe dashboard left the booking reading `paid` and this
   * guard refused the delete, telling the owner to "refund the payment first"
   * about money already returned.
   *
   * Derived from the payments themselves instead, which every refund path
   * updates by trigger. `netHeld` also gets partial refunds right: a booking
   * with £40 of £100 returned is still holding £60 and is still undeletable.
   */
  const settledResult = await paymentTransactionRepository.findSettledForBooking(
    bookingId,
    bookingInvoices.map((inv) => inv.id),
    userId
  );
  if (settledResult.error) return { data: null, error: settledResult.error as Error };
  const settledPayments = settledResult.data || [];

  const money = bookingPaymentState(settledPayments);

  /*
   * An invoice marked paid with no payment recorded against it still counts.
   *
   * Marking an invoice paid by hand is a normal thing to do, and the money is
   * just as real for having arrived by bank transfer. Its refunded amount is
   * derived by trigger, so the same subtraction applies.
   */
  const invoiceHeld = bookingInvoices
    .filter(isSettledInvoice)
    .filter((inv) => !settledPayments.some((t) => t.invoice_id === inv.id))
    .reduce(
      (sum, inv) => sum + Math.max(0, (Number(inv.amount) || 0) - (Number(inv.refunded_amount) || 0)),
      0
    );

  const heldAmount = Math.round((money.netHeld + invoiceHeld) * 100) / 100;

  if (heldAmount > 0) {
    const paidInvoices = bookingInvoices.filter(isSettledInvoice);
    const paidAmount = heldAmount;

    log.info({ userId, bookingId }, 'Refused to delete a booking that has been paid for');

    return {
      data: null,
      error: new BookingPaidError(
        paidInvoices.map((inv) => inv.invoice_number),
        paidAmount
      ),
    };
  }

  // Nothing is owed and nothing is held: drop the OPEN invoices raised for this
  // booking, voiding each at the processor first so nobody can still open the
  // hosted page and pay for a session that no longer exists.
  const openInvoices = bookingInvoices.filter((inv) => !isSettledInvoice(inv));
  const deletedInvoices: string[] = [];

  for (const invoice of openInvoices) {
    const removed = await deleteInvoice({ invoiceId: invoice.id, userId, request });
    if (removed.error) return { data: null, error: removed.error };
    deletedInvoices.push(invoice.invoice_number);
  }

  const result = await schedulingBookingRepository.delete(bookingId, userId);
  if (result.error) return { data: null, error: result.error };

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_DELETED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking ${bookingId}`,
      details: { deletedInvoices },
      severity: 'warning',
      request,
    })
    .catch((err) => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  log.info({ bookingId, userId, deletedInvoices: deletedInvoices.length }, 'Booking deleted');

  return { data: { bookingId, deletedInvoices }, error: null };
}

/**
 * Ask the client to fill in the intake form for their appointment.
 *
 * The empty `intake_responses` is not decoration: it is what makes the journey
 * timeline show "intake pending" rather than nothing, so the owner can see they
 * are waiting on the client.
 */
export async function sendIntakeForm(params: {
  bookingId: string;
  userId: string;
  logger?: ContextLogger;
}): Promise<SchedulingRepositoryResult<{ bookingId: string; clientNotified: boolean }>> {
  const { bookingId, userId } = params;
  const log = params.logger ?? logger;

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  if (existing.data.intake_completed_at) {
    return {
      data: null,
      error: new Error('The client has already completed the intake form for this booking.'),
    };
  }

  if (!existing.data.intake_responses) {
    await schedulingBookingRepository.update(bookingId, userId, {
      intake_responses: { template_id: '', template_key: 'pending', responses: {} },
    });
  }

  let clientNotified = false;
  try {
    // The owner (or the assistant on their behalf) pressed Send — manual, for
    // the same reason as the creation path above.
    const email = await BookingEmailService.sendIntakeFormRequest(bookingId, userId, {
      manual: true,
    });
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Intake form request not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Intake form request threw');
  }

  log.info({ bookingId, userId, clientNotified }, 'Intake form requested');

  return { data: { bookingId, clientNotified }, error: null };
}
