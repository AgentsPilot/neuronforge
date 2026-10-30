/**
 * What must be settled before a business may switch its card processor off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * "Disconnect" wrote a flag on our own row and told Stripe nothing. Stripe does
 * not stop because we did: a payment plan is a SUBSCRIPTION or a SCHEDULE living
 * on the connected account, and Stripe keeps its own clock, charges the saved
 * card, and runs its own dunning emails. An owner who disconnected to stop
 * paying card fees went on paying them, and their clients went on being charged
 * and chased by a company the owner thought they had left.
 *
 * Nothing we can write locally fixes that, because the schedule is not ours.
 *
 * WHY BLOCKING RATHER THAN PAUSING AT STRIPE
 *
 * Pausing is the kinder answer and is a much larger change: a plan is two
 * different Stripe object types (`stripe_schedule_id` or
 * `stripe_subscription_id`, see `cancelPlan`), each on a connected account, and
 * a partial failure across several plans leaves some clients charged and some
 * not — with a resume that has to mirror it exactly or plans silently never
 * restart. That deserves its own change with its own rollback story.
 *
 * Blocking cannot half-apply. The owner is told what is outstanding and settles
 * it first, which is also what the platform already decided for the permanent
 * "Remove connection" path.
 *
 * WHAT COUNTS, AND WHY EACH
 *
 *   running plans      the only thing that CHARGES without us. Stripe owns the
 *                      schedule; stopping it is `cancelPlan`, not a flag.
 *   card-payable
 *   unpaid invoices    a document the client is holding that offers a card
 *                      today. Switching cards off changes it underneath them.
 *
 * ONLY WHAT CARD PAYMENT ACTUALLY TOUCHES.
 *
 * A business with Stripe connected still issues invoices that were never
 * card-payable — `allow_online_payment = false`, settled by transfer or cash.
 * Turning cards off changes nothing for those, so blocking on them would trap
 * an owner behind debts that have no bearing on the decision. They are counted
 * out, following `invoicePaymentOptions`: only an EXPLICIT `false` means no
 * card, so null and true both count as card-payable.
 *
 * Unbilled plan stages are out for the same reason. A stage carries no card
 * button until it is billed, and billing it raises an invoice — which the
 * second blocker already sees. While its plan is still running the first
 * blocker covers it; once the plan has stopped, an unbilled stage is simply
 * money to invoice later, by whatever method the owner then has.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/connectExitBlockers
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { PLAN_STOPPED_STATUSES } from '@/lib/payments/planStatus';

const logger = createLogger({ module: 'ConnectExitBlockers' });

/** One reason a business cannot switch cards off yet. */
export interface ConnectExitBlocker {
  /** Machine-readable, so each surface can word it for its own reader. */
  code: 'client_plans_running' | 'invoices_unpaid';
  /** How many of them. Never an amount: this is about obligations, not money. */
  count: number;
}

export type ConnectExitVerdict =
  | { kind: 'clear' }
  | { kind: 'blocked'; blockers: ConnectExitBlocker[] }
  /** The check itself failed. Refuse, and say which, rather than guessing. */
  | { kind: 'unreadable'; reason: string };

/**
 * May this business switch card payments off?
 *
 * A FAILED READ REFUSES. The opposite of `isCardCollectionPaused`, and on
 * purpose: there, not knowing must not stop a client paying; here, not knowing
 * must not let an owner strand live client subscriptions. The dangerous answer
 * is the confident yes.
 */
export async function checkConnectExitBlockers(
  db: SupabaseClient,
  userId: string
): Promise<ConnectExitVerdict> {
  try {
    const [plans, invoices] = await Promise.all([
      /*
       * Still charging. `PLAN_STOPPED_STATUSES` is the platform's own answer to
       * "has this plan finished", reused rather than restated — an unrecognised
       * status counts as running, because not knowing is not the same as
       * knowing it is finished.
       */
      db
        .from('payment_plan_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('status', 'in', `(${PLAN_STOPPED_STATUSES.join(',')})`),

      /*
       * Asked for, not yet paid, AND payable by card.
       *
       * `allow_online_payment` is `boolean | null`, and only an explicit
       * `false` turns the card option off — exactly the test
       * `invoicePaymentOptions` applies when it decides whether to put a card
       * button on the document. Null means the question was never asked, which
       * has always meant "card allowed", so it counts.
       */
      db
        .from('payment_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', ['pending', 'overdue', 'sent'])
        .or('allow_online_payment.is.null,allow_online_payment.eq.true'),
    ]);

    const failed = plans.error || invoices.error;
    if (failed) {
      logger.error({ err: failed, userId }, 'Could not read exit blockers — refusing');
      return { kind: 'unreadable', reason: 'check_failed' };
    }

    const blockers: ConnectExitBlocker[] = [];
    if ((plans.count ?? 0) > 0) blockers.push({ code: 'client_plans_running', count: plans.count! });
    if ((invoices.count ?? 0) > 0) blockers.push({ code: 'invoices_unpaid', count: invoices.count! });

    return blockers.length > 0 ? { kind: 'blocked', blockers } : { kind: 'clear' };
  } catch (error) {
    logger.error({ err: error, userId }, 'Exit blocker check threw — refusing');
    return { kind: 'unreadable', reason: 'check_failed' };
  }
}
