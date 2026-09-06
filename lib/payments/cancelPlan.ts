/**
 * Stopping a payment plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There was no way to do this. `subscriptionSchedules.cancel` appears nowhere in
 * the codebase and `close(id, 'cancelled')` had zero callers, so a plan sold to
 * a client who then cancelled kept billing their card every period, and its
 * remaining installments inflated the business's receivables forever.
 *
 * `.cancel`, NEVER `.release`
 *
 * They read as near-synonyms and do opposite things. `release` DETACHES the
 * schedule from the subscription and leaves the subscription running — which
 * removes the very thing (`end_behavior: 'cancel'`) that bounds the plan to its
 * agreed number of periods. A released plan bills the client forever. `cancel`
 * ends the schedule and the subscription together, which is what stopping means.
 *
 * STOPPING IS NOT REFUNDING
 *
 * Two separate decisions, and conflating them gets money wrong in both
 * directions. A client who cancels a course halfway is usually not owed the
 * lessons they attended; a business that cannot deliver usually owes all of it.
 * So this stops the plan and returns nothing unless asked — `refundCollected`
 * is opt-in, and the caller presents the choice.
 *
 * ORDER: Stripe first, Postgres second. If the process dies between them, the
 * client's card is safe and the plan reads active — wrong, visible, and fixable.
 * The reverse leaves a tidy local record of a subscription that still bills.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/cancelPlan
 */

import type Stripe from 'stripe';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { PaymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { refundGroup, resolveRefundTargets, type GroupRefundOutcome } from './RefundService';
import { syncBookingsForTransactions } from './syncBookingPaymentState';

const logger = createLogger({ module: 'CancelPlan' });
const planRepo = new PaymentPlanSubscriptionRepository();

export type CancelPlanErrorCode =
  | 'NOT_FOUND'
  /** No Stripe reference on the plan, so nothing can be stopped at the processor. */
  | 'MISSING_REFERENCE'
  | 'PROCESSOR_ERROR';

export interface CancelPlanResult {
  ok: boolean;
  code?: CancelPlanErrorCode;
  message?: string;
  /** True when the plan was already stopped — cancelling twice is not an error. */
  alreadyStopped?: boolean;
  /** How many future periods left the books. */
  cancelledPeriods?: number;
  /** Present only when the caller asked for the money back too. */
  refund?: GroupRefundOutcome;
}

/**
 * Stripe's word for a schedule that is already over.
 *
 * Cancelling one twice has to succeed: the webhook mirrors dashboard
 * cancellations, so the local state can already be right when this runs.
 */
const ALREADY_DONE = new Set([
  'resource_missing',
  'schedule_not_active',
  'subscription_schedule_canceled',
]);

function isAlreadyDone(err: unknown): boolean {
  const code = (err as { code?: string; raw?: { code?: string } })?.code
    ?? (err as { raw?: { code?: string } })?.raw?.code;
  if (code && ALREADY_DONE.has(code)) return true;

  const message = (err as Error)?.message ?? '';
  return /already canceled|already cancelled|not active/i.test(message);
}

export async function cancelPlan(input: {
  /** The `payment_plan_subscriptions` row. */
  planId: string;
  userId: string;
  stripe: Pick<Stripe, 'subscriptionSchedules' | 'subscriptions'>;
  /** Return everything collected so far, as well as stopping future charges. */
  refundCollected?: boolean;
  /**
   * Return only part of what was collected.
   *
   * Taken from the most recent period backwards — see `refundGroup`. Ignored
   * unless `refundCollected` is set, so a stray amount cannot move money on its
   * own.
   */
  refundAmount?: number;
  reason?: string;
  clientRequestId?: string;
}): Promise<CancelPlanResult> {
  const { data: plan } = await supabaseServer
    .from('payment_plan_subscriptions')
    .select(
      'id, user_id, booking_id, status, stripe_subscription_id, stripe_schedule_id, stripe_connect_account_id'
    )
    .eq('id', input.planId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, code: 'NOT_FOUND', message: 'This payment plan could not be found.' };
  }

  const alreadyStopped = plan.status === 'cancelled' || plan.status === 'completed';

  if (!plan.stripe_schedule_id && !plan.stripe_subscription_id && !alreadyStopped) {
    /*
     * A plan recorded but never bound to Stripe — the `pending` state the
     * repository writes before calling Stripe. There is nothing at the processor
     * to stop, but the local record must still be closed or it bills nothing and
     * shows as active forever.
     */
    logger.warn({ planId: plan.id }, 'Plan has no Stripe reference; closing the local record only');
    await closeLocally(plan.id, plan.user_id);
    return { ok: true, cancelledPeriods: await cancelledCount(plan.id, plan.user_id) };
  }

  if (!alreadyStopped) {
    try {
      /*
       * The SCHEDULE is the thing that bounds the plan, so it is what gets
       * cancelled — and cancelling it cancels the subscription with it. Falling
       * through to the subscription covers a plan bound before schedules were
       * attached.
       */
      /*
       * NO PRORATION, AND NO FINAL INVOICE.
       *
       * Both default to TRUE on `subscriptionSchedules.cancel`, and passing no
       * params accepts them. Stopping a plan one day into a month therefore made
       * Stripe raise a credit note for the "unused time" — on this account, a
       * −$322.46 draft invoice with `auto_advance: true`, created in the same
       * second as the cancellation and due to finalise on its own.
       *
       * That is money leaving the business that nobody asked for, and it stacks
       * on top of whatever the owner refunded deliberately: a $333.33 period
       * with a $175 refund would have given the client $497.46 back.
       *
       * Refunds are an explicit decision made in the refund dialog, against the
       * ledger, with the over-refund guard behind them. A cancellation stops
       * future charges and does nothing else.
       */
      const stopParams = { invoice_now: false, prorate: false } as const;

      if (plan.stripe_schedule_id) {
        await input.stripe.subscriptionSchedules.cancel(
          plan.stripe_schedule_id,
          stopParams,
          plan.stripe_connect_account_id
            ? { stripeAccount: plan.stripe_connect_account_id }
            : undefined
        );
      } else if (plan.stripe_subscription_id) {
        await input.stripe.subscriptions.cancel(
          plan.stripe_subscription_id,
          stopParams,
          plan.stripe_connect_account_id
            ? { stripeAccount: plan.stripe_connect_account_id }
            : undefined
        );
      }
    } catch (err) {
      if (!isAlreadyDone(err)) {
        logger.error({ err, planId: plan.id }, 'Stripe refused to stop the plan');
        return {
          ok: false,
          code: 'PROCESSOR_ERROR',
          message: 'The plan could not be stopped at Stripe, so nothing was changed.',
        };
      }
      logger.info({ planId: plan.id }, 'Plan was already stopped at Stripe');
    }
  }

  await closeLocally(plan.id, plan.user_id);
  const cancelledPeriods = await cancelledCount(plan.id, plan.user_id);

  /*
   * The money already collected, if the caller asked for it.
   *
   * After the stop, never before: a refund that succeeds against a plan still
   * billing would return money and then take it again next period.
   */
  let refund: GroupRefundOutcome | undefined;

  if (input.refundCollected && plan.booking_id) {
    const targets = await resolveRefundTargets({ userId: plan.user_id, bookingId: plan.booking_id });

    if ('error' in targets) {
      logger.warn({ planId: plan.id }, 'Plan stopped, but no settled payments were found to refund');
    } else {
      refund = await refundGroup({
        userId: plan.user_id,
        transactionIds: targets.transactionIds,
        reason: input.reason,
        source: 'app',
        initiatedBy: plan.user_id,
        clientRequestId: input.clientRequestId,
        // Undefined means everything; a figure caps it.
        maxTotal: input.refundAmount,
      });

      // The booking follows the money. Owned by `propagate_refund_to_booking`
      // once that migration is applied; called here so a plan refunded on
      // cancellation does not leave its booking reading `paid`.
      await syncBookingsForTransactions(targets.transactionIds, plan.user_id);
    }
  }

  logger.info(
    { planId: plan.id, alreadyStopped, cancelledPeriods, refunded: refund?.refundedTotal ?? 0 },
    'Payment plan stopped'
  );

  return { ok: true, alreadyStopped, cancelledPeriods, refund };
}

/**
 * Close the mirror and take the future periods off the books.
 *
 * `cancelled` is in `SETTLED_PERIOD_STATUSES`, so this is what removes the
 * remaining installments from what the business is owed. Left `pending`, a
 * cancelled twelve-month plan goes on claiming eleven months of receivables.
 */
async function closeLocally(planId: string, userId: string) {
  await planRepo.close(planId, 'cancelled');

  /*
   * Scoped by `subscription_id` — this SALE — not by `payment_plan_id`, which
   * is the plan OFFER and may have been sold to the same contact twice.
   * Cancelling by offer would void a live plan alongside the stopped one.
   *
   * The value is the LOCAL `payment_plan_subscriptions` id, not the Stripe
   * subscription id. `bindPlanSubscription` writes `subscription_id:
   * created.data.id` when it projects the periods, and live data confirms it:
   * the installments for the plan on this account carry
   * `12ef6315-…`, the row id, while its Stripe id is `sub_1UBHsW…`. Filtering
   * on the Stripe id matched nothing, so a stopped plan kept every remaining
   * period `pending` — still in receivables, which is the one thing cancelling
   * is supposed to fix.
   */
  const { error } = await supabaseServer
    .from('payment_plan_installments')
    .update({ status: 'cancelled', next_retry_at: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('subscription_id', planId)
    // Only what has not happened. A paid period is a record of money that
    // arrived and is never rewritten.
    .eq('status', 'pending');

  if (error) {
    logger.error({ err: error, planId }, 'Plan stopped but its future periods are still on the books');
  }
}

async function cancelledCount(planId: string, userId: string): Promise<number> {
  const { data } = await supabaseServer
    .from('payment_plan_subscriptions')
    .select('installment_count, periods_paid')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return 0;
  return Math.max(0, (data.installment_count ?? 0) - (data.periods_paid ?? 0));
}
