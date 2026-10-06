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
import { REASONS_WITHOUT_REBOOKING, type CancelledBy } from '@/lib/business-os/cancellationReasons';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
  type SchedulingBooking,
  type SchedulingService,
  type SchedulingRepositoryResult,
} from '@/lib/repositories/SchedulingRepository';
import type { BookingStatus } from '@/lib/business-os/bookingStatus';
import { supabaseServer } from '@/lib/supabaseServer';
import { OPEN_PROPOSAL_STATUSES } from '@/lib/repositories/ProposalRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { BookingEmailService, getBusinessTimezone } from '@/lib/services/BookingEmailService';
import { businessDateKey, businessHhmm, safeTimezone } from '@/lib/scheduling/businessTime';
import { closedDayVerdict } from '@/lib/scheduling/closedDay';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
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
import { isSlotTakenError } from '@/lib/business-os/bookingStatus';
import { isInstallmentPlan } from '@/lib/payments/PaymentPlanService';
import { planStartDate } from '@/lib/payments/planSchedule';
import {
  paymentPlanRepository,
  type InstallmentFrequency,
} from '@/lib/repositories/PaymentPlanRepository';
import { termsValueForDays } from '@/lib/payments/paymentTerms';

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
   * The structured reason — a code from `cancellationReasons`, the note behind
   * it, and who called it off.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * IN ADDITION TO `reason`, never instead of it.
   *
   * `reason` is the prose that goes into `cancellation_reason`, and for a client
   * cancellation it carries `CLIENT_CANCELLED_PREFIX` — which the
   * `booking_cancelled` gap and `CashCancelledUnrefundedDetector` still parse to
   * work out who cancelled. Both keep working untouched; `cancelledBy` is the
   * column they should move to, and moving them is a separate change with its
   * own risk.
   *
   * Optional here because older callers exist — the calendar's quick-cancel, the
   * Needs-you card's gap action. The API surfaces where a person is present
   * REQUIRE a code.
   * ─────────────────────────────────────────────────────────────────────────
   */
  cancelReason?: string | null;
  cancelNote?: string | null;
  cancelledBy?: CancelledBy | null;
  /**
   * Cancel the meetings this purchase bought, for a package. Default true.
   *
   * Set false when cancelling one of those meetings, which owns none of its
   * own: the model is a purchase and its sessions, and nothing below that.
   */
  cascadeToMeetings?: boolean;
  /**
   * Tell the client. Default true.
   *
   * False only when something else is telling them: a package's meetings are
   * cancelled silently and the purchase sends one email naming every date.
   */
  notifyClient?: boolean;
  /**
   * Whether the owner's note reaches the client's email.
   *
   * Defaults to true. Only the OWNER surfaces pass false — a client cancelling
   * wrote the note themselves, so there is nothing to withhold from them.
   */
  shareNoteWithClient?: boolean;
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

/*
 * The cancellation-reason prefix moved to its own module.
 *
 * Re-exported here so every existing import keeps working. It left because two
 * constants with no dependencies were dragging this service — the email
 * transport, the calendar sync, the payment settlement path — into an insight
 * detector that only wanted to compare a string.
 */
export { CLIENT_CANCELLED_PREFIX, clientCancellationReason } from './bookingCancellationReason';

/** What actually happened to each side effect, so a caller can say so. */
export interface CancelBookingOutcome {
  booking: SchedulingBooking;
  calendarEventRemoved: boolean;
  clientNotified: boolean;
  /**
   * A PACKAGE's meetings, cancelled with it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Cancelling the purchase used to leave them standing: six confirmed
   * appointments in the diary and six live stages, for a block the owner had
   * just called off. Nothing cascades on a status change the way `ON DELETE`
   * does on a delete, and the stages hang off the MEETINGS rather than the
   * purchase, so neither half of the money was reached either.
   *
   * Each meeting is cancelled as a booking in its own right, so each voids its
   * own unpaid invoice, closes its own stage, clears its own calendar event and
   * tells the client about its own date. Zero for an ordinary booking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  meetingsCancelled: number;
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
  const { bookingId, userId, reason, request } = params;

  /*
   * Whether the email ends with "book again" — from the REASON, unless the
   * caller said otherwise.
   *
   * A cancellation for `service_discontinued` was going out saying the service is
   * no longer offered and then inviting the client to book it, with a button
   * pointing at the page for the thing just withdrawn. The caller could not have
   * known: `offerRebooking` predates reason codes and only ever meant "the
   * business is closing down".
   *
   * An explicit value still wins. A caller that has thought about it — the
   * closing-business path — is better informed than a lookup table.
   */
  const offerRebooking =
    params.offerRebooking ??
    (params.cancelReason ? !REASONS_WITHOUT_REBOOKING.has(params.cancelReason) : undefined);
  const log = params.logger ?? logger;

  log.info(
    { bookingId, userId, reason, cancelReason: params.cancelReason ?? null, cancelledBy: params.cancelledBy ?? null },
    'Cancelling booking'
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A PACKAGE'S MEETINGS GO WITH IT.
   *
   * Cancelling the purchase used to leave six confirmed appointments in the
   * diary and six live stages: nothing cascades on a status change, and the
   * stages hang off the MEETINGS rather than the purchase, so neither half of
   * the money was reached.
   *
   * FIRST, before the purchase itself. A failure then leaves the purchase open
   * with some of its meetings cancelled — recoverable and visible — where the
   * other order leaves a cancelled purchase whose appointments are all still
   * live and still reminding the client.
   *
   * Each meeting is cancelled as a booking in its own right, which is what
   * makes this correct rather than a loop of status writes: it voids that
   * meeting's unpaid invoice, closes its stage, clears its calendar event and
   * tells the client about its own date, with its own reason.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let meetingsCancelled = 0;

  /*
   * ONE LEVEL, AND ONLY ONE.
   *
   * A meeting owns no meetings — the model has a purchase and its sessions, and
   * nothing below that — so a cancellation reaching this point from the loop
   * below must not go looking again. Stated as a parameter rather than left to
   * the query returning nothing: a row whose parent pointed at itself, or a
   * pair pointing at each other, would otherwise recurse until the process
   * died. It did, in the first version of this.
   */
  const { data: meetings } = params.cascadeToMeetings === false
    ? { data: [] as SchedulingBooking[] }
    : await schedulingBookingRepository.findChildren(bookingId, userId);

  for (const meeting of meetings ?? []) {
    if (meeting.status === 'cancelled' || meeting.status === 'completed') continue;

    const child = await cancelBooking({
      ...params,
      bookingId: meeting.id,
      // A meeting owns no meetings. See the note above.
      cascadeToMeetings: false,
      /*
       * Silently: the purchase sends ONE email below, listing every date. Six
       * separate cancellations arriving together is six times the alarm for one
       * piece of news, and leaves the client working out whether anything
       * survived.
       */
      notifyClient: false,
      logger: log,
    });

    if (child.error) {
      log.error(
        { err: child.error, bookingId, meetingId: meeting.id },
        'A package meeting could not be cancelled; the purchase is left open'
      );
      return { data: null, error: child.error };
    }

    meetingsCancelled += 1;
  }

  const result = await schedulingBookingRepository.cancel(bookingId, userId, reason, {
    code: params.cancelReason ?? null,
    note: params.cancelNote ?? null,
    cancelledBy: params.cancelledBy ?? null,
  });

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
  /*
   * Collected and refunded, hoisted for the same reason `amountHeld` is: they are
   * worked out inside the try below and read by the client email further down.
   *
   * Both, not just the remainder. Zero held means either "never paid" or
   * "refunded in full", and those are opposite things to tell a client.
   */
  let collectedTotal = 0;
  let refundedTotal = 0;
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
    collectedTotal = held.collected;
    refundedTotal = held.refunded;
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
      .update({
        status: 'cancelled',
        /*
         * THE REASON TRAVELS HERE TOO.
         *
         * ───────────────────────────────────────────────────────────────────
         * It already travels to the proposal a few lines below — "one
         * namespace, so the booking's cancel code is a valid stop code, and a
         * report counting `client_not_paying` finds both". The periods closed
         * by this very statement were the one thing left out, so a plan
         * stopped THIS way recorded nothing countable while the same plan
         * stopped from Manage Payment recorded a code, a note and an owner.
         *
         * The columns are the same three every other cancellation surface uses
         * (20260930_installment_cancel_reason), which is what lets one report
         * union them without a translation layer.
         * ───────────────────────────────────────────────────────────────────
         */
        cancel_reason: params.cancelReason ?? null,
        cancel_note: params.cancelNote ?? null,
        cancelled_by: params.cancelledBy ?? 'owner',
        cancelled_at: new Date().toISOString(),
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('booking_id', bookingId)
      /*
       * Everything not settled, not just `pending`.
       *
       * A stage that had been BILLED — an invoice raised, nobody paid — stayed
       * open on a cancelled booking, because this matched only `pending`. The
       * invoices are cancelled a few statements above, so the stage was left
       * disagreeing with its own invoice: "billed" on a booking that is off.
       *
       * `paid` is never rewritten; it records money that arrived. Same rule as
       * `cancelQuoteStages` and `stopBookingPlan`, so the three ways of calling
       * work off leave the same state behind.
       */
      .not('status', 'in', '(paid,cancelled)')
      .is('subscription_id', null)
      .select('id');

    stagesClosed = closed?.length ?? 0;

    /*
     * An ACCEPTED quote ends with the booking, not just its stages.
     *
     * ───────────────────────────────────────────────────────────────────────
     * The block above withdraws quotes, but only `OPEN_PROPOSAL_STATUSES` —
     * draft, sent, viewed. An accepted one is deliberately not withdrawable,
     * because money was created against it.
     *
     * Which left the exact state `cancelQuoteStages` was written to prevent:
     * the stages just closed above, sitting under a quote that still reads
     * `accepted` — indistinguishable from a job that finished and was paid in
     * full. Stopping the job from the quote produced the right state; cancelling
     * the same job from the booking did not.
     *
     * Conditional on `accepted`, like the stop path, so this cannot clobber
     * declined, expired, withdrawn or superseded — and a second cancellation is
     * a no-op rather than a rewritten `stopped_at`.
     *
     * The reason travels. One namespace, so the booking's cancel code is a valid
     * stop code, and a report counting `client_not_paying` finds both.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (stagesClosed > 0 || params.cancelReason) {
      const { data: stoppedQuotes } = await supabaseServer
        .from('proposals')
        .update({
          status: 'stopped',
          stop_reason: params.cancelReason ?? null,
          stop_note: params.cancelNote?.trim() || null,
          stopped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('booking_id', bookingId)
        .eq('status', 'accepted')
        .select('id');

      if ((stoppedQuotes?.length ?? 0) > 0) {
        log.info(
          { bookingId, stopped: stoppedQuotes?.length },
          'Marked the accepted quote stopped along with its booking'
        );
      }
    }

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
  if (params.notifyClient === false) {
    // Something else is telling them — see `notifyClient`.
    log.info({ bookingId }, 'Cancellation email suppressed by the caller');
  } else if (meetingsCancelled > 0) {
    /*
     * ONE EMAIL FOR THE WHOLE BLOCK, listing every date that is now off.
     *
     * The purchase has no hour of its own, so a cancellation about it alone
     * would name no date — and one per meeting is six times the alarm for one
     * piece of news. The meetings were cancelled silently above; this is where
     * the client is told, once, with the list.
     *
     * Sent from the FIRST cancelled meeting, because the email needs a booking
     * to read the service, the client and the brand from, and that meeting is
     * one of the things being cancelled. The dates come from all of them.
     */
    const cancelledMeetings = (meetings ?? [])
      .filter(meeting => meeting.status !== 'completed' && meeting.status !== 'cancelled')
      .filter(meeting => Boolean(meeting.start_time));

    /*
     * ───────────────────────────────────────────────────────────────────────
     * WHAT TOOK PLACE, AND WHAT IT CAME TO.
     *
     * A block of six cancelled after two is not six cancellations. The client
     * has had two sessions and paid for them, and an email naming only the four
     * that are off reads as though the whole thing was undone — which is the
     * version a dispute would be argued from.
     *
     * The money matters even more. The figures above are read from the
     * PURCHASE, and on a package billed per session the money sits on each
     * MEETING's invoice — so the email would have told a client who had paid
     * for two sessions that nothing was ever collected. Summed across the whole
     * package instead: the purchase and every one of its meetings.
     * ───────────────────────────────────────────────────────────────────────
     */
    const heldMeetings = (meetings ?? [])
      .filter(meeting => meeting.status === 'completed')
      .filter(meeting => Boolean(meeting.start_time));

    for (const meeting of meetings ?? []) {
      try {
        const { data: meetingInvoices } = await paymentInvoiceRepository.findByBookingId(
          meeting.id,
          userId
        );

        const { data: meetingSettled } = await paymentTransactionRepository.findSettledForBooking(
          meeting.id,
          (meetingInvoices ?? []).map(invoice => invoice.id),
          userId
        );

        const state = bookingPaymentState(meetingSettled ?? []);
        amountHeld += state.netHeld;
        collectedTotal += state.collected;
        refundedTotal += state.refunded;
        heldCurrency = heldCurrency ?? (meetingSettled ?? []).find(row => row.currency)?.currency ?? null;
      } catch (err) {
        /*
         * Loud, and not fatal. The cancellation has happened; what is at risk
         * is the accuracy of a figure in an email, and an email that goes
         * without it is better than none at all — but an owner needs to know
         * the client may have been told a number that is short.
         */
        log.error(
          { err, bookingId, meetingId: meeting.id },
          'Could not read a meeting’s money for the cancellation email'
        );
      }
    }

    if (cancelledMeetings.length === 0) {
      log.info({ bookingId }, 'Package cancelled with no dated meetings to tell the client about');
    } else {
      try {
        const email = await BookingEmailService.sendCancellationEmail(
          cancelledMeetings[0].id,
          userId,
          reason,
          {
            offerRebooking,
            shareNoteWithClient: params.shareNoteWithClient,
            amountHeld,
            heldCurrency,
            paidAmount: collectedTotal,
            refundedAmount: refundedTotal,
            sessions: cancelledMeetings.map(meeting => new Date(meeting.start_time as string)),
            // What was delivered, stated as plainly as what is not.
            heldSessions: heldMeetings.map(meeting => new Date(meeting.start_time as string)),
          }
        );

        clientNotified = email.sent;
        if (!email.sent) {
          log.warn({ bookingId, error: email.error }, 'Package cancellation email not sent');
        }
      } catch (err) {
        log.warn({ err, bookingId }, 'Package cancellation email threw');
      }
    }
  } else if (!meetingStillAhead) {
    log.info({ bookingId }, 'Cancellation email skipped — the meeting had already passed');
  } else try {
    const email = await BookingEmailService.sendCancellationEmail(bookingId, userId, reason, {
      offerRebooking,
      // Undefined leaves it shared, which is what every caller that has not been
      // updated — and every CLIENT cancellation — should keep doing.
      shareNoteWithClient: params.shareNoteWithClient,
      /*
       * The same figure the owner is asked about, told to the client.
       *
       * Worked out above from the settled payments. Cancelling does not refund
       * anything by design, so without this the client received a cancellation
       * that said nothing about the money they had already paid.
       */
      amountHeld,
      heldCurrency,
      /*
       * Collected and refunded, not just what is left.
       *
       * `bookingPaymentState` has worked all three out above. Sending only the
       * remainder made "never paid" and "refunded in full" indistinguishable —
       * both are zero held — and they are opposite things to tell a client.
       */
      paidAmount: collectedTotal,
      refundedAmount: refundedTotal,
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
      meetingsCancelled,
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
/**
 * The owner closed this date, and is booking a client into it anyway.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT a `BookingSlotUnavailableError`. That one means somebody else has the
 * hour, and every surface translates it as "pick another time" — which is the
 * wrong instruction here, because the obstacle is the owner's OWN statement
 * about the day and they are entitled to overrule it. Seeing one client during
 * a holiday is a real thing a business does; doing it by accident is not.
 *
 * So this is a question, not a refusal: the caller is expected to put it to the
 * owner and come back with `allowClosedDay: true` if they mean it. Nothing is
 * created in the meantime, which is the whole point — the bug was a client
 * receiving a confirmation, and then a reminder, for a day the business is shut.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class BookingOnClosedDayError extends Error {
  constructor(
    /** `all_day`: the date is off. `short_day`: open, but not at this hour. */
    readonly kind: 'all_day' | 'short_day',
    /** `YYYY-MM-DD` on the business's own calendar. */
    readonly dateKey: string,
    /** What the owner called it — 'Sukkot'. Null when they named nothing. */
    readonly closedReason: string | null,
    /** The hours it IS open, for a short day. */
    readonly hours?: { start: string; end: string }
  ) {
    super(
      kind === 'all_day'
        ? `You are closed on ${dateKey}${closedReason ? ` (${closedReason})` : ''}`
        : `On ${dateKey} you are open ${hours?.start}–${hours?.end}${
            closedReason ? ` (${closedReason})` : ''
          }`
    );
    this.name = 'BookingOnClosedDayError';
  }
}

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
  /**
   * When it happens — ABSENT for a service that is not scheduled.
   *
   * A course, a product, a deliverable: something bought rather than booked
   * into a slot. `is_scheduled: false` on the service is what decides it, and
   * the public booking route has always supported it by writing nulls. This
   * path did not, so an owner booking the same course from the CRM drawer was
   * asked to pick a time the client journey has no step for.
   */
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string;
  notes?: string;
  bookingSource?: string;
  /**
   * A PACKAGE's meeting: the purchase it belongs to, and which one it is.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Set when a meeting is ADDED to a package that is already running — a
   * make-up for one the client missed, or a seventh session on a block of six.
   *
   * The meeting goes through this verb like any other, so it gets the overlap
   * check, the closed-day question, the calendar event and the client's
   * confirmation. What it does NOT get is an invoice: a package's money is the
   * purchase's, and an added meeting either rides on what was already agreed or
   * is billed by a stage of its own — never by an invoice raised here.
   * ───────────────────────────────────────────────────────────────────────────
   */
  parentBookingId?: string | null;
  occurrenceNumber?: number | null;
  /**
   * What the booking starts as. Defaults to `confirmed`, as it always has.
   *
   * A meeting added to a package follows its purchase: `pending` while the
   * block is still waiting to be paid for, so it holds its hour without
   * telling the client it is on, and `confirmed` once the money has arrived.
   */
  status?: BookingStatus;
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
  /**
   * The owner has been told the day is closed and said book it anyway.
   *
   * Only ever set from a surface that ASKED. Defaulting it true anywhere would
   * put the original bug back: a client confirmed into a day the business shut,
   * with nobody having decided that.
   */
  allowClosedDay?: boolean;
}

export interface CreateBookingOutcome {
  booking: SchedulingBooking;
  invoice: PaymentInvoice | null;
  calendarSynced: boolean;
  clientNotified: boolean;
}

/**
 * Whether this slot falls on a day the owner closed, or outside a short day's
 * hours — and null when it does not, or when the answer cannot be read.
 *
 * AN UNREADABLE LIST ALLOWS THE BOOKING. The owner is sitting in front of the
 * dialog with a client on the phone; a database hiccup must not become "you
 * cannot book anyone today". The public booking page makes the same call for
 * the same reason, and the worst case here is the thing that happened before
 * this check existed.
 *
 * Only the START's date is consulted. A booking that runs past midnight is
 * vanishingly rare in this product and asking about two dates would mean
 * deciding which one's reason to show; the start is the day the owner picked.
 *
 * EXPORTED for the one path that does not come through this file: the owner's
 * update route writes `start_time` itself rather than calling
 * `rescheduleBooking`. That is a second implementation of a verb that has one,
 * and worth collapsing — but collapsing it is a change to a route that also
 * settles invoices and moves pipeline stages, so until then it asks the same
 * question through the same function rather than growing its own copy.
 */
export async function closedDayCheck(
  userId: string,
  startTime: string,
  endTime: string,
  timezone: string,
  log: ContextLogger = logger
): Promise<{ kind: 'all_day' | 'short_day'; error: BookingOnClosedDayError } | null> {
  const zone = safeTimezone(timezone);
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const dateKey = businessDateKey(start, zone);

  const { data: timeOff, error } = await schedulingTimeOffRepository.list(userId, {
    from: dateKey,
    to: dateKey,
  });

  if (error || !timeOff) {
    log.warn({ err: error, userId, dateKey }, 'Time off unreadable; the booking is allowed');
    return null;
  }

  const verdict = closedDayVerdict(timeOff, dateKey, {
    start: businessHhmm(start, zone),
    end: businessHhmm(end, zone),
  });

  if (!verdict.closed) return null;

  return {
    kind: verdict.kind,
    error: new BookingOnClosedDayError(
      verdict.kind,
      dateKey,
      verdict.reason,
      verdict.kind === 'short_day' ? verdict.hours : undefined
    ),
  };
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

  /*
   * Is there a slot to check at all?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * An unscheduled service occupies no time, so both guards below are asking
   * about nothing: `checkOverlap` on an undefined range, and an external
   * calendar that cannot block a slot that does not exist. Run anyway, they
   * would compare against `undefined` and refuse or admit on nonsense.
   *
   * The booking itself is real either way — it carries the money, the intake
   * form and the client journey. It simply has no hour attached.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const scheduled = Boolean(startTime && endTime);

  // 1. The slot must be free — of this user's own bookings, and of anything in
  //    the calendar they actually live by. Both refuse the booking outright:
  //    double-booking someone is not a warning.
  const overlapCheck = scheduled
    ? await schedulingBookingRepository.checkOverlap(userId, startTime as string, endTime as string)
    : { data: [], error: null };

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

  const isBlockedByExternal = scheduled
    ? await CalendarSyncService.isSlotBlockedByExternalEvent(
        userId,
        startTime as string,
        endTime as string
      )
    : false;

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

  /*
   * 1b. IS THE BUSINESS EVEN OPEN THAT DAY?
   *
   * Time off reached every surface that publishes an hour and none that takes a
   * booking, so an owner who closed 7 October could book a client into it from
   * their own calendar — no warning, a confirmation email naming a day the
   * business is shut, and a reminder on the morning of it.
   *
   * A QUESTION, NOT A REFUSAL. `allowClosedDay` is the owner answering it; the
   * dialog asks before it sends. Unlike the two checks above, this obstacle is
   * the owner's own statement about their diary and theirs to overrule.
   */
  if (scheduled && !params.allowClosedDay) {
    const closed = await closedDayCheck(userId, startTime as string, endTime as string, timezone, log);
    if (closed) {
      log.info({ userId, startTime, kind: closed.kind }, 'Booking refused: the day is closed');
      return { data: null, error: closed.error };
    }
  }

  // 2. Insert.
  const result = await schedulingBookingRepository.create({
    user_id: userId,
    service_id: serviceId,
    contact_id: contactId,
    /*
     * Null, not undefined. The column is nullable and the public booking route
     * has always written null for a product, so two spellings of "no time"
     * would give every reader two cases to handle instead of one.
     */
    start_time: startTime ?? null,
    end_time: endTime ?? null,
    timezone,
    notes,
    booking_source: bookingSource,
    status: params.status,
    // Null on every ordinary booking, which is almost all of them.
    parent_booking_id: params.parentBookingId ?? null,
    occurrence_number: params.occurrenceNumber ?? null,
  } as Parameters<typeof schedulingBookingRepository.create>[0]);

  /*
   * The slot went between the check above and this write.
   *
   * `scheduling_bookings_no_overlap` (20261001) is the one check that cannot be
   * raced, and when it fires it is not a fault: two clients pressed Book at the
   * same second and one of them lost. Reported as the SAME error the pre-check
   * raises, so every surface that already handles a clash handles this too —
   * without it the loser saw an internal error for working as designed.
   */
  if (isSlotTakenError(result.error)) {
    log.info({ userId, startTime }, 'Slot taken between the check and the write');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        'That time has just been taken. Please choose another.',
        'overlap'
      ),
    };
  }

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
/**
 * The plan behind a booking of an instalment service.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: THE OWNER'S PATH COLLECTED THE WHOLE PRICE.
 *
 * `isInstallmentPlan` was consulted by three routes, all of them
 * `/api/website/*` — the public widget. A booking made by the OWNER (the drawer,
 * the chat, the bookings API) went straight to `createBookingInvoice`, which
 * billed `service.price` with no idea a plan existed.
 *
 * So a service sold as "2 weekly payments of ₪400" produced one ₪800 invoice,
 * one ₪800 Stripe page, and one ₪800 charge. The client saw a plan in the email
 * and paid the lot. The public dialog showed the split correctly the whole time,
 * which is what made it look like the plan system worked.
 *
 * THE MECHANISM IS THE QUOTE'S, NOT STRIPE'S. A Stripe Subscription Schedule
 * needs a card on file, and this path has no checkout — the client is emailed an
 * invoice link. So the schedule is written as dated `payment_plan_installments`,
 * exactly as an accepted proposal writes its stages, and
 * `PaymentReminderService.billDueDatedStages` raises each later period's invoice
 * when its date arrives. `trigger` defaults to 'date', which is what that sweep
 * selects on.
 *
 * Period 1 is invoiced here and its stage is stamped with that invoice id, so
 * the sweep's `.is('invoice_id', null)` claim cannot bill it a second time.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function createBookingPaymentPlan(
  userId: string,
  bookingId: string,
  contactId: string,
  service: SchedulingService,
  log: ContextLogger
): Promise<{ planId: string; firstAmount: number; firstDueDate: string; count: number }> {
  const count = service.installment_count!;

  /*
   * THE SERVICE'S OWN PLAN ROW, NOT A SECOND ONE.
   *
   * `syncServicePaymentPlan` writes a `payment_plans` row whenever a service is
   * saved, and that row is what the public booking dialog, the contact drawer
   * and `PaymentReminderService` all read. Creating another here would give one
   * service two live plans: `findByServiceId` returns both, newest first, and
   * the surfaces would disagree about which is the agreement.
   *
   * So the row is reused when it exists, and written only when it does not —
   * a service saved before that sync existed, which is exactly the account this
   * bug was found on.
   */
  const existing = await paymentPlanRepository.findByServiceId(service.id, userId);
  const reusable = existing.data?.find(
    row => row.installment_count === count && Number(row.total_amount) === service.price
  );

  const planResult = reusable
    ? { data: reusable, error: null }
    : await paymentPlanRepository.create({
        user_id: userId,
        service_id: service.id,
        name: service.service_name,
        total_amount: service.price!,
        currency: service.currency,
        installment_count: count,
        // The headline figure. The instalment rows carry the authoritative
        // amounts, including the remainder on the final period.
        installment_amount: service.price! / count,
        installment_frequency: (service.installment_frequency ||
          'monthly') as InstallmentFrequency,
      });

  if (planResult.error || !planResult.data) {
    throw planResult.error ?? new Error('Payment plan was created but returned no row');
  }

  const start = planStartDate(
    {
      firstPaymentDue: (service.first_payment_due as 'on_booking' | 'days_after') ?? 'on_booking',
      firstPaymentDays: service.first_payment_days ?? 0,
    },
    new Date()
  );

  const installmentResult = await paymentPlanRepository.createInstallmentsForBooking(
    planResult.data.id,
    userId,
    contactId,
    start.toISOString(),
    { bookingId, currency: service.currency, customAmount: service.price! }
  );

  if (installmentResult.error || !installmentResult.data?.length) {
    /*
     * The plan row exists and its schedule does not. Raising the full price
     * instead would be the very bug this function was written to end, so the
     * throw is deliberate: the caller logs it and the booking is left with no
     * invoice — visible, and recoverable by the owner.
     */
    throw installmentResult.error ?? new Error('Payment plan has no instalments');
  }

  const periods = [...installmentResult.data].sort(
    (a, b) => a.installment_number - b.installment_number
  );

  log.info(
    { bookingId, planId: planResult.data.id, count, firstAmount: periods[0].amount },
    'Booking sold on a payment plan; invoicing the first period only'
  );

  return {
    planId: planResult.data.id,
    firstAmount: periods[0].amount,
    firstDueDate: periods[0].due_date,
    count,
  };
}

export async function createBookingInvoice(
  userId: string,
  bookingId: string,
  service: SchedulingService,
  bookingData: {
    contact_id: string;
    contact_name: string;
    contact_email: string | null;
    /** Absent for a service that is not booked into a time. */
    start_time?: string | null;
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

  /*
   * "Due on the service date" needs a service date.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A course or a product has none — it is bought, not booked into an hour —
   * and `new Date(undefined)` is an Invalid Date, which would write a null due
   * date or throw. So an unscheduled sale is payable on issue, which is what
   * buying something ordinarily means.
   *
   * The TERMS change with it, and that matters beyond wording:
   * `SERVICE_DATE_TERMS` is READ by the overdue chase, which holds an invoice
   * carrying it while its session is still ahead. Writing it on a booking with
   * no session would claim a rule nothing can evaluate.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const scheduledSale = Boolean(bookingData.start_time);

  /*
   * A plan changes what is being asked for: the first period, not the price.
   *
   * Everything below reads from `billed` rather than `service.price` so the two
   * cases cannot diverge — see `createBookingPaymentPlan` for why this path was
   * collecting the whole total.
   */
  const plan = isInstallmentPlan(service)
    ? await createBookingPaymentPlan(userId, bookingId, bookingData.contact_id, service, log)
    : null;

  const billed = plan ? plan.firstAmount : service.price!;
  const billedFor = plan
    ? `${service.service_name} (1/${plan.count})`
    : service.service_name;

  const dueDate = plan
    ? plan.firstDueDate
    : scheduledSale
      ? businessDateKey(new Date(bookingData.start_time as string), zone)
      : businessDateKey(new Date(), zone);

  /*
   * A plan period's terms come from its own due date, not the service date.
   * `SERVICE_DATE_TERMS` is read by the overdue chase, which holds an invoice
   * carrying it while its session is still ahead — a rule that would wrongly
   * excuse a first period due today on a service booked for next month.
   */
  const planTermsDays = plan
    ? Math.max(
        0,
        Math.round(
          (new Date(`${plan.firstDueDate}T12:00:00Z`).getTime() - Date.now()) / 86_400_000
        )
      )
    : 0;

  const invoiceResult = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bookingData.contact_id,
    booking_id: bookingId, // Links payment status back to the booking.
    service_id: service.id, // What was billed, for the revenue-by-service breakdown.
    invoice_number: invoiceNumberResult.data!,
    amount: billed,
    currency: service.currency,
    // See the note on `sent_at` below: 'draft' until the confirmation is away.
    status: 'draft',
    client_name: bookingData.contact_name || null,
    client_email: bookingData.contact_email || null,
    line_items: [
      {
        description: billedFor,
        quantity: 1,
        unit_price: billed,
        total: billed,
      },
    ],
    due_date: dueDate,
    payment_terms: plan
      ? termsValueForDays(planTermsDays)
      : scheduledSale
        ? SERVICE_DATE_TERMS
        : 'due_on_receipt',
    notes: `Booking for ${bookingData.contact_name}`,
    internal_notes: `Auto-generated for booking ${bookingId}`,
    /*
     * NOT `sent_at`, and the status above is 'draft' rather than 'sent'.
     *
     * This claimed both at the moment of creation, before any mail existed. Two
     * things followed. `InvoiceDeliveryService` states the rule this broke —
     * "an invoice marked sent that nobody received is the exact bug this module
     * exists to prevent" — and, because `alreadyWithTheClient` reads exactly
     * that status to decide the COPY watermark, the client's FIRST copy of a
     * brand-new invoice arrived stamped as a duplicate.
     *
     * `markBookingInvoiceSent` sets both once the confirmation is actually away,
     * the same order `sendInvoiceEmail` uses.
     */
    sent_at: null,
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

  /*
   * Claim period 1 against this invoice, and tell the booking it is on a plan.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * FIRST, AND SCOPED BY BOOKING. Both details are load-bearing.
   *
   * FIRST, because `billDueDatedStages` claims a period with
   * `.eq('status','pending').is('invoice_id', null)`. A first period due TODAY
   * — which `first_payment_due: 'on_booking'` makes the normal case — is
   * eligible for that sweep the moment it is written, so every line between
   * writing the schedule and stamping it is a window in which the client could
   * be invoiced twice. Stamping here, before the Stripe round trip below,
   * leaves the narrowest one available.
   *
   * BY BOOKING, because the plan row is the SERVICE's and is shared by every
   * booking of it. Scoping on `payment_plan_id` + `installment_number` alone
   * would stamp period 1 of every other client's booking on the same service
   * with this client's invoice — and then none of them would ever be billed.
   *
   * Non-blocking: the money has been asked for correctly and a bookkeeping
   * write must not undo that. Logged at error level because it needs a human,
   * unlike the warnings around it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (plan) {
    const { error: stampError } = await supabaseServer
      .from('payment_plan_installments')
      .update({ invoice_id: invoice.id, updated_at: new Date().toISOString() })
      .eq('payment_plan_id', plan.planId)
      .eq('booking_id', bookingId)
      .eq('installment_number', 1)
      .eq('user_id', userId);

    if (stampError) {
      log.error(
        { err: stampError, planId: plan.planId, bookingId, invoiceId: invoice.id },
        'Could not stamp the first plan period with its invoice; it may be billed twice'
      );
    }

    const { error: linkError } = await supabaseServer
      .from('scheduling_bookings')
      .update({ payment_plan_id: plan.planId, updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('user_id', userId);

    if (linkError) {
      log.error(
        { err: linkError, bookingId, planId: plan.planId },
        'Could not link the booking to its payment plan'
      );
    }
  }

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
            /*
             * `billed`, NOT `service.price`.
             *
             * This is the figure the client is actually charged, and it was the
             * last place the full price survived: the local invoice could say
             * ₪400 while the Stripe page still asked for ₪800, which is exactly
             * what happened to INV-00012.
             */
            description: billedFor,
            quantity: 1,
            unit_price: Math.round(billed * 100), // Stripe works in cents.
            total: Math.round(billed * 100),
          },
        ],
        /*
         * The same rule as the local invoice above: due on the service date
         * where there is one, on issue where there is not. `new Date(undefined)`
         * is an Invalid Date, and Stripe would have been sent one.
         */
        dueDate: scheduledSale ? new Date(bookingData.start_time as string) : new Date(),
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
      // What this invoice asks for. On a plan that is the first period, not the
      // agreed total — the event feeds revenue reads that must not book ₪800
      // when ₪400 was raised.
      amount: billed,
      currency: service.currency,
      dueDate,
      planId: plan?.planId,
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
  /**
   * The owner has been told the new day is closed and said move it anyway.
   *
   * Only the OWNER's surfaces ever send this. A client rescheduling from their
   * own link is offered slots that already exclude the closed days, so for them
   * the check below is a backstop and a refusal is the right end of it — they
   * are not in a position to decide that the business will open for them.
   */
  allowClosedDay?: boolean;
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

  /*
   * IS THE BUSINESS OPEN ON THE DAY IT IS MOVING TO?
   *
   * Moving an appointment onto a closed day is the same mistake as booking one
   * there, arriving by a different route — and it is the likelier of the two,
   * because a reschedule is usually "some time next week" rather than a date
   * the owner has just thought about.
   *
   * The booking's OWN timezone, not a parameter: it is the business's clock,
   * stored on the row when it was taken, and every client-facing email about
   * this appointment is already formatted against it.
   */
  if (!params.allowClosedDay) {
    const closed = await closedDayCheck(
      userId,
      startTime,
      endTime,
      existing.data.timezone,
      log
    );
    if (closed) {
      log.info({ userId, bookingId, startTime, kind: closed.kind }, 'Reschedule refused: the day is closed');
      return { data: null, error: closed.error };
    }
  }

  const result = await schedulingBookingRepository.update(bookingId, userId, {
    start_time: startTime,
    end_time: endTime,
  });

  // Same race as creating one, and the same answer: the new time went while the
  // move was in flight, and the booking is untouched where it was.
  if (isSlotTakenError(result.error)) {
    log.info({ userId, bookingId, startTime }, 'Slot taken while rescheduling');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        'That time has just been taken. Please choose another.',
        'overlap'
      ),
    };
  }

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

/**
 * A booking that cannot be deleted because a payment plan points at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DATABASE REFUSES THIS, NOT US — and that is the right place for it.
 *
 * `payment_plan_subscriptions.booking_id` is `ON DELETE RESTRICT` (20260828e),
 * so Postgres rejects the delete outright. Nothing in application code could
 * orphan a live Stripe subscription even by mistake, which is exactly the
 * protection worth having around money that is still arriving.
 *
 * What was missing was the translation. The raw `23503` came back through the
 * repository, the route turned it into a flat 500 "Failed to delete booking",
 * and the owner got a dead end with no reason and no hint that stopping the
 * plan is the way through.
 *
 * Deliberately NOT solved by cancelling the plan here. `cancelBooking` sets out
 * the reasoning at length: a plan can fund more than one booking, and ending
 * someone's payment arrangement is a decision with a client on the other side
 * of it. `cancelPlan` stays a human's to press.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class BookingHasPlanError extends Error {
  /**
   * @param planLive Whether the plan is still charging.
   *
   * It changes the advice, and getting it wrong wastes the owner's time.
   * RESTRICT is status-agnostic — ANY row referencing the booking blocks the
   * delete, a finished plan included — so "stop the payment plan first" is
   * useless to somebody whose plan stopped months ago. Cancelling is the way
   * out of both, and is the only way out of the second.
   */
  constructor(readonly planLive: boolean) {
    super(
      planLive
        ? 'This booking has a payment plan that is still charging the client. ' +
            'Stop the payment plan first, or cancel the booking instead.'
        : 'This booking has a payment plan on record, so it cannot be deleted without ' +
            'erasing that history. Cancel the booking instead.'
    );
    this.name = 'BookingHasPlanError';
  }
}

/**
 * Did the DATABASE refuse this delete because something still references the
 * booking?
 *
 * In practice that is the payment plan: it is the only foreign key to
 * `scheduling_bookings` with `ON DELETE RESTRICT`. Every other reference is
 * `SET NULL` or `CASCADE` and cannot block a delete.
 *
 * Matched on the code AND the constraint name, the same belt-and-braces
 * `isSlotTakenError` uses for `23P01`: PostgREST does not always carry the
 * code through, and a `23503` from anywhere else should not be reported to the
 * owner as a payment plan.
 */
function isPlanRestrictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const message = (error as { message?: unknown }).message;
  const details = (error as { details?: unknown }).details;
  const text = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;

  if (text.includes('payment_plan_subscriptions')) return true;

  // A bare 23503 with no table named: still a reference blocking the delete,
  // and the plan is the only one that can.
  return (error as { code?: unknown }).code === '23503';
}

export interface DeleteBookingOutcome {
  bookingId: string;
  deletedInvoices: string[];
  /**
   * The client was told the appointment is off.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * DELETING NOTIFIES, exactly as cancelling does.
   *
   * Nothing here used to. A booking sends the client a confirmation the moment
   * it is made, so the appointment exists for them as much as for the business —
   * and deleting it removed every trace on this side while they went on
   * expecting to be seen. Silence is not a smaller version of cancelling; it is
   * the one outcome that leaves somebody turning up.
   *
   * False is a real answer and not only a failure: a booking with no client
   * email has nobody to tell, and one whose meeting has already passed is not
   * sent "your appointment has been cancelled" about last Tuesday.
   * ───────────────────────────────────────────────────────────────────────────
   */
  clientNotified: boolean;
  /**
   * The external calendar event is gone.
   *
   * Deleting the row frees the slot in OUR availability — nothing is left to
   * match `SLOT_HOLDING_STATUSES` — but the event in the owner's Google or
   * Outlook calendar is a separate object, and leaving it behind is worse than
   * the missing email: the platform offers the time to a new client while the
   * owner's own calendar still shows them busy in it.
   */
  calendarEventRemoved: boolean;
}

/**
 * What a booking still HOLDS, and the invoices it raised.
 *
 * Lifted out of `deleteBooking` unchanged, because a second caller needs the
 * same answer BEFORE it deletes anything. Removing a contact removes their
 * bookings, and a guard that only refused when it reached the paid one would
 * already have destroyed the two before it. So that caller asks every booking
 * first, and only then deletes any.
 *
 * Exported for that reason alone — it is the money half of the delete guard,
 * and a second copy of it would be a second set of answers.
 */
export async function heldOnBooking(
  bookingId: string,
  userId: string
): Promise<SchedulingRepositoryResult<{ heldAmount: number; invoices: PaymentInvoice[] }>> {
  const { isSettledInvoice } = await import('@/lib/payments/invoiceSettlement');
  const { paymentTransactionRepository } = await import('@/lib/repositories/PaymentRepository');

  const invoicesResult = await paymentInvoiceRepository.findByBookingId(bookingId, userId);
  if (invoicesResult.error) return { data: null, error: invoicesResult.error as Error };

  const bookingInvoices = invoicesResult.data || [];

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

  return {
    data: {
      heldAmount: Math.round((money.netHeld + invoiceHeld) * 100) / 100,
      invoices: bookingInvoices,
    },
    error: null,
  };
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
  const { deleteInvoice } = await import('@/lib/payments/invoiceLifecycle');

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  // Bound once, narrowed by the guard above: the calendar step needs
  // `external_calendar_event_id` and the email step needs `start_time`, both
  // read BEFORE the row is deleted.
  const booking = existing.data;

  const money = await heldOnBooking(bookingId, userId);
  if (money.error) return { data: null, error: money.error };

  const { heldAmount, invoices: bookingInvoices } = money.data!;

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A PAYMENT PLAN BLOCKS THE DELETE — asked HERE, before anything is destroyed.
   *
   * The database already refuses it: `payment_plan_subscriptions.booking_id` is
   * `ON DELETE RESTRICT`. But that refusal arrives at the very LAST step, and by
   * then this function has voided and deleted the invoices, removed the calendar
   * event and emailed the client that their appointment is cancelled — for a
   * booking that then survives. Every one of those is unrecoverable, and the
   * email is a lie the moment the delete fails.
   *
   * So the constraint is asked about up front and left in place as the backstop
   * it should be, not as the control flow.
   *
   * ANY row counts, live or finished, because that is what RESTRICT enforces.
   * `cancelBooking`'s plan read filters to live plans — correct there, where the
   * question is "is this client still being charged" — and copying that filter
   * here would let a booking with a stopped plan through to a delete the
   * database then rejects, which is the exact failure above.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: attachedPlan, error: planReadError } = await supabaseServer
    .from('payment_plan_subscriptions')
    // `installment_count`, never `periods_total` — one unknown column makes
    // PostgREST reject the WHOLE select, and this would then report no plan on
    // every booking that has one.
    .select('id, status')
    .eq('user_id', userId)
    .eq('booking_id', bookingId)
    .limit(1)
    .maybeSingle();

  if (planReadError) {
    // Refuse rather than guess. Proceeding would hit RESTRICT at the last step,
    // after the invoices, the calendar and the email are already gone.
    log.error({ err: planReadError, bookingId, userId }, 'Could not check for a payment plan before deleting');
    return { data: null, error: planReadError as Error };
  }

  if (attachedPlan) {
    // `isPlanStopped`, the same predicate `cancelPlan` and `cancelBooking` read,
    // so the three cannot disagree about what "live" means.
    const planLive = !isPlanStopped(attachedPlan.status);
    log.info(
      { userId, bookingId, planId: attachedPlan.id, planStatus: attachedPlan.status, planLive },
      'Refused to delete a booking with a payment plan attached'
    );
    return { data: null, error: new BookingHasPlanError(planLive) };
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

  /*
   * The calendar event, before the row that names it goes.
   *
   * `external_calendar_event_id` lives on the booking, so after the delete there
   * is nothing left to read it from and the event would stay in the owner's
   * calendar for good. Same two-step as `cancelBooking`: the service REPORTS
   * failure rather than throwing, so the returned flag decides the outcome and
   * the try/catch is only for the unexpected.
   */
  let calendarEventRemoved = false;
  if (booking.external_calendar_event_id) {
    try {
      const sync = await CalendarSyncService.deleteCalendarEvent(booking, userId);
      calendarEventRemoved = sync.success;
      if (!sync.success) {
        log.warn({ bookingId, error: sync.error }, 'Calendar event delete failed on a booking delete');
      }
    } catch (err) {
      log.warn({ err, bookingId }, 'Calendar event delete threw on a booking delete');
    }
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE EMAIL, AND WHY IT IS SENT HERE AND NOT A LINE LATER.
   *
   * `sendCancellationEmail` takes a booking ID and re-reads the booking with
   * `findById`, so after the row is deleted it returns
   * `{ sent: false, error: 'Booking not found' }`. A call placed after the
   * delete — the obvious place for it — compiles, runs, logs that, and sends
   * nothing. This has to run while the booking still exists.
   *
   * And it runs AFTER the invoices, deliberately. Invoice deletion returns
   * early on failure, and a client told their appointment is cancelled when
   * the delete then failed is worse than one told a moment later. By this point
   * the invoices are gone and the booking is going; the only step left is one
   * that does not depend on anything outside this process.
   *
   * No money is mentioned because none can be held: `heldAmount > 0` was
   * refused above, so every figure `cancelBooking` passes would be zero here.
   * Rebooking IS offered — deleting frees the slot, so booking again is a real
   * suggestion rather than a dead link.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const meetingStillAhead = !booking.start_time || new Date(booking.start_time) > new Date();

  let clientNotified = false;
  if (!meetingStillAhead) {
    log.info({ bookingId }, 'Deletion email skipped — the meeting had already passed');
  } else {
    try {
      const email = await BookingEmailService.sendCancellationEmail(bookingId, userId);
      clientNotified = email.sent;
      if (!email.sent) {
        log.warn({ bookingId, error: email.error }, 'Deletion email not sent');
      }
    } catch (err) {
      // Never fails the delete. The owner asked for the booking to go; a mail
      // transport problem must not leave it standing, and the flag reports it.
      log.warn({ err, bookingId }, 'Deletion email threw');
    }
  }

  const result = await schedulingBookingRepository.delete(bookingId, userId);
  if (result.error) {
    /*
     * The backstop. The plan guard above should have caught this, so reaching
     * here means something referencing the booking appeared between the two —
     * or a reference this code does not know about acquired RESTRICT. Reported
     * as the plan refusal rather than a bare 500, because that is what it is,
     * and logged at error so the gap between the guard and the constraint is
     * visible rather than silently smoothed over.
     */
    if (isPlanRestrictError(result.error)) {
      log.error(
        { err: result.error, bookingId, userId },
        'Delete refused by a database reference the plan guard did not catch'
      );
      return { data: null, error: new BookingHasPlanError(true) };
    }
    return { data: null, error: result.error };
  }

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_DELETED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      /*
       * Named for the client, which is how an owner reading the audit trail
       * recognises it — a bare UUID identifies nothing to a human.
       *
       * No extra query: `findById` normalises `client_first_name` and
       * `client_last_name` onto the row it already returned. The route this
       * replaced ran a second `crmContactRepository.findById` purely for these
       * two words.
       */
      /*
       * Named for the client, which is how an owner reading the audit trail
       * recognises it — a bare UUID identifies nothing to a human.
       *
       * No extra query: `findById` normalises `client_first_name` and
       * `client_last_name` onto the row it already returned. The route this
       * replaced ran a second `crmContactRepository.findById` purely for these
       * two words.
       */
      resourceName: `Booking for ${
        [booking.client_first_name, booking.client_last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Client'
      }`,
      details: { deletedInvoices, clientNotified, calendarEventRemoved },
      severity: 'warning',
      request,
    })
    .catch((err) => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  log.info(
    { bookingId, userId, deletedInvoices: deletedInvoices.length, clientNotified, calendarEventRemoved },
    'Booking deleted'
  );

  return { data: { bookingId, deletedInvoices, clientNotified, calendarEventRemoved }, error: null };
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
