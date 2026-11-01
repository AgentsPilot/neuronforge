/**
 * Stop a payment plan, whatever shape it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: THE THIRD SHAPE COULD NOT BE STOPPED AT ALL.
 *
 * "Payment plan" is three different things in this platform, and until now only
 * two of them could be called off:
 *
 *   Stripe subscription   `cancelPlan`          ✓ Money screen
 *   quote milestones      `cancelQuoteStages`   ✓ scoped by proposal_id
 *   dated instalments     — nothing —
 *
 * The third is the common case: a service sold as "2 weekly payments of ₪400"
 * and booked by the owner. It has no `payment_plan_subscriptions` row, so
 * `cancelPlan` cannot address it — its `planId` IS that row. And it has no
 * proposal, so `cancelQuoteStages` cannot either.
 *
 * It would not have helped to call `cancelPlan` anyway: its local close scopes
 * periods with `.eq('subscription_id', planId)`, and periods written by
 * `createInstallmentsForBooking` have `subscription_id` NULL. Zero rows matched.
 *
 * So the scope here is the BOOKING, which every shape has, and Stripe becomes a
 * branch rather than a precondition.
 *
 * WHAT STOPPING MEANS, EXACTLY
 *
 *   · Future periods are closed, with a reason.
 *   · An invoice already raised for one of them, and not paid, is VOIDED — or
 *     the client keeps being chased for a period that is no longer owed.
 *   · Money already collected is NOT touched. Refunding is a separate decision,
 *     made in the refund dialog against the ledger, with the over-refund guard
 *     behind it. `cancelPlan` draws the same line and for the same reason.
 *   · A completed period stays completed. Stopping a plan is not rewriting its
 *     history.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/stopBookingPlan
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { voidInvoice } from '@/lib/payments/invoiceLifecycle';
import { cancelPlan } from '@/lib/payments/cancelPlan';
import type { StopReason } from '@/lib/business-os/cancellationReasons';

const logger = createLogger({ module: 'StopBookingPlan' });

/*
 * `ALREADY_CLOSED` used to live here. The filter it built —
 * `not status in (paid,cancelled)` — now lives inside
 * `findOpenPeriodsForBooking`, with the reason beside the query.
 */

export interface StopBookingPlanResult {
  ok: boolean;
  /** Periods moved to `cancelled` by this call. */
  cancelledPeriods: number;
  /** Unpaid invoices voided so the client stops being chased for them. */
  voidedInvoices: number;
  /** True when a Stripe subscription was cancelled as part of this. */
  subscriptionStopped: boolean;
  error?: string;
}

export async function stopBookingPlan(input: {
  bookingId: string;
  userId: string;
  /**
   * Why it stopped, from `STOP_REASONS`. REQUIRED.
   *
   * Mandatory on every cancellation surface in this platform — an owner is
   * present and can answer. The column is nullable only for rows that predate
   * it.
   */
  reason: StopReason;
  /** The owner's own sentence. Never a substitute for `reason`. */
  note?: string;
  /**
   * Needed only when this booking's plan is a Stripe subscription.
   *
   * Deliberately optional: an invoice-billed plan has nothing at the processor,
   * and requiring a Stripe client to stop one made it unstoppable on accounts
   * with no card processing at all.
   */
  stripe?: Pick<Stripe, 'subscriptionSchedules' | 'subscriptions'>;
}): Promise<StopBookingPlanResult> {
  const { bookingId, userId, reason, note } = input;
  const log = logger.child({ bookingId, userId });

  const empty: StopBookingPlanResult = {
    ok: false,
    cancelledPeriods: 0,
    voidedInvoices: 0,
    subscriptionStopped: false,
  };

  /*
   * Ownership first, before anything is written. Every other scope below filters
   * on `user_id` too — this is the check that produces a clean refusal rather
   * than a silent no-op on someone else's booking.
   */
  const { data: ownedBookingId, error: bookingError } =
    await schedulingBookingRepository.findOwnedId(bookingId, userId);

  if (bookingError) {
    log.error({ err: bookingError }, 'Could not read the booking');
    return { ...empty, error: 'Could not read the booking' };
  }
  if (!ownedBookingId) return { ...empty, error: 'Booking not found' };

  /*
   * A Stripe plan is stopped AT STRIPE, and `cancelPlan` is how.
   *
   * Closing the local rows while the subscription kept its schedule would show
   * a stopped plan to the owner and keep charging the client — the worst of the
   * available failures. So this branch delegates entirely, including the local
   * close, and refuses rather than half-doing it when no Stripe client is
   * available.
   *
   * THE LIVE-PLAN QUESTION IS ASKED IN THE QUERY, not of the answer. This used
   * to read every plan row and then test `!isPlanStopped(status)` here;
   * `findLiveForBooking` filters `PLAN_STOPPED_STATUSES` out instead, which is
   * the same set, so a row coming back IS a live plan and there is nothing left
   * to re-check. It is also what makes `maybeSingle` safe: the partial unique
   * index `idx_plan_subs_one_live_per_booking` covers exactly the four
   * non-stopped statuses, so at most one row can match.
   *
   * A FAILED READ REFUSES, and has to: "no live plan" and "could not find
   * out whether there is one" both arrive here as the same `null`. Treating
   * the second as the first closes the local periods and voids the invoices
   * on a booking whose subscription keeps its schedule — the owner is shown
   * a stopped plan while the client goes on being charged. That is the exact
   * failure this branch exists to prevent, reached by a different road.
   *
   * So the error is read, as it is for every other read in this function.
   * The owner gets a refusal they can retry, and nothing is written either
   * way. (This was carried as FU-Q6 when the query was first routed.)
   */
  const { data: livePlan, error: planError } =
    await paymentPlanSubscriptionRepository.findLiveForBooking(bookingId, userId);

  if (planError) {
    log.error({ err: planError }, 'Could not check whether this plan is billed by Stripe');
    return { ...empty, error: "Could not check this booking's payment plan" };
  }

  if (livePlan) {
    if (!input.stripe) {
      return {
        ...empty,
        error: 'This plan is billed by Stripe and cannot be stopped without it.',
      };
    }

    const outcome = await cancelPlan({
      planId: livePlan.id,
      userId,
      stripe: input.stripe,
      reasonCode: reason,
      reason: note,
    });

    return {
      ok: outcome.ok,
      cancelledPeriods: outcome.cancelledPeriods ?? 0,
      // `cancelPlan` voids nothing: a Stripe plan's periods are collected by the
      // processor, so there are no platform invoices sitting open behind them.
      voidedInvoices: 0,
      subscriptionStopped: true,
      error: outcome.ok ? undefined : outcome.message,
    };
  }

  /*
   * The invoice-billed case: the periods themselves are the plan.
   *
   * Read before updating, because the invoices have to be voided individually
   * and a bulk update would leave nothing to iterate. `cancelQuoteStages` reads
   * separately for exactly this reason.
   */
  const { data: openPeriods, error: periodsError } =
    await paymentPlanRepository.findOpenPeriodsForBooking(bookingId, userId);

  if (periodsError) {
    log.error({ err: periodsError }, 'Could not read the plan periods');
    return { ...empty, error: 'Could not read the plan periods' };
  }

  if (!openPeriods?.length) {
    // Nothing owed. Not an error: a plan collected in full, or already stopped.
    return { ...empty, ok: true };
  }

  /*
   * Void the invoices that are still asking for money.
   *
   * `voidInvoice` refuses a settled one, so a period billed AND paid — which
   * cannot appear here anyway, having been filtered above — is safe either way.
   * Failures are counted and logged rather than aborting: a plan half-stopped
   * is worse than one stopped with an invoice still open, and the open invoice
   * is visible where a still-charging plan is not.
   */
  let voidedInvoices = 0;
  for (const period of openPeriods) {
    const invoiceId = period.invoice_id;
    if (!invoiceId) continue;

    const { error: voidError } = await voidInvoice({ invoiceId, userId });
    if (voidError) {
      log.error(
        { err: voidError, invoiceId, period: period.installment_number },
        'Plan stopped but one of its invoices could not be voided',
      );
      continue;
    }
    voidedInvoices += 1;
  }

  /*
   * BY THE IDS JUST READ AND VOIDED, which is why this is `cancelStagesByIds`
   * and not the booking-scoped `cancelOpenStagesForBooking`. Re-deriving the
   * rows from the booking here would catch a period written between the read
   * above and this close, cancelling it with no invoice voided for it.
   *
   * `cancelled_by` is left to the method's `'owner'` default, and the patch —
   * including clearing `next_retry_at` so the retry scheduler stops chasing a
   * cancelled period — is fixed inside it.
   */
  const { error: closeError } = await paymentPlanRepository.cancelStagesByIds(
    openPeriods.map(p => p.id),
    userId,
    { reason, note }
  );

  if (closeError) {
    log.error({ err: closeError }, 'Could not close the plan periods');
    return { ...empty, voidedInvoices, error: 'Could not close the plan periods' };
  }

  log.info(
    { cancelledPeriods: openPeriods.length, voidedInvoices, reason },
    'Payment plan stopped',
  );

  return {
    ok: true,
    cancelledPeriods: openPeriods.length,
    voidedInvoices,
    subscriptionStopped: false,
  };
}
